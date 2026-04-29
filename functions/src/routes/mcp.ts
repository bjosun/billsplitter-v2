import { Router } from 'express';
import { AuthRequest, authenticateOAuth } from '../middleware/auth';
import { db, admin } from '../config/firebase';
import { HouseholdService } from '../services/household.service';
import { calculateExpenditure, getHistoricalBillSuggestions, matchBillsWithHistory } from '../services/calculation.service';

const router = Router();

// MCP Protocol: JSON-RPC 2.0
interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

// MCP Tools
const tools = [
  {
    name: 'create_household',
    description: 'Create a new household',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Household name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'join_household',
    description: 'Join a household with invite code',
    inputSchema: {
      type: 'object',
      properties: {
        inviteCode: { type: 'string', description: 'Invite code' },
      },
      required: ['inviteCode'],
    },
  },
  {
    name: 'get_household',
    description: 'Get household details',
    inputSchema: {
      type: 'object',
      properties: {
        householdId: { type: 'string', description: 'Household ID' },
      },
      required: ['householdId'],
    },
  },
  {
    name: 'add_contributor',
    description: 'Add a contributor with income',
    inputSchema: {
      type: 'object',
      properties: {
        householdId: { type: 'string', description: 'Household ID' },
        name: { type: 'string', description: 'Contributor name' },
        income: { type: 'number', description: 'Monthly income' },
      },
      required: ['householdId', 'name', 'income'],
    },
  },
  {
    name: 'add_bill',
    description: 'Add a bill to household',
    inputSchema: {
      type: 'object',
      properties: {
        householdId: { type: 'string', description: 'Household ID' },
        name: { type: 'string', description: 'Bill name' },
        amount: { type: 'number', description: 'Bill amount' },
        shared: { type: 'boolean', description: 'Is bill shared?' },
        payer: { type: 'string', description: 'Payer name' },
      },
      required: ['householdId', 'name', 'amount', 'shared', 'payer'],
    },
  },
  {
    name: 'update_bill',
    description: 'Update a bill',
    inputSchema: {
      type: 'object',
      properties: {
        householdId: { type: 'string', description: 'Household ID' },
        billId: { type: 'string', description: 'Bill ID' },
        name: { type: 'string', description: 'Bill name' },
        amount: { type: 'number', description: 'Bill amount' },
        shared: { type: 'boolean', description: 'Is bill shared?' },
        payer: { type: 'string', description: 'Payer name' },
      },
      required: ['householdId', 'billId'],
    },
  },
  {
    name: 'remove_bill',
    description: 'Remove a bill',
    inputSchema: {
      type: 'object',
      properties: {
        householdId: { type: 'string', description: 'Household ID' },
        billId: { type: 'string', description: 'Bill ID' },
      },
      required: ['householdId', 'billId'],
    },
  },
  {
    name: 'calculate_split',
    description: 'Calculate bill split for household',
    inputSchema: {
      type: 'object',
      properties: {
        householdId: { type: 'string', description: 'Household ID' },
        contributors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              income: { type: 'number' },
            },
          },
          description: 'List of contributors with incomes',
        },
        bills: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              amount: { type: 'number' },
              shared: { type: 'boolean' },
              payer: { type: 'string' },
            },
          },
          description: 'List of bills',
        },
      },
      required: ['householdId', 'contributors', 'bills'],
    },
  },
  {
    name: 'parse_bank_text',
    description: 'Parse bank transaction text from multiple banks (SEB, Swedbank, Nordea, etc.) to extract bills',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Raw text from bank transactions (copy from upcoming transactions/transaction history)',
        },
      },
      required: ['text'],
    },
  },
];

// MCP Resources
const resources = [
  {
    uri: 'households',
    name: 'Households',
    description: 'List of user households',
    mimeType: 'application/json',
  },
  {
    uri: 'contributors',
    name: 'Contributors',
    description: 'Contributors in household',
    mimeType: 'application/json',
  },
  {
    uri: 'bills',
    name: 'Bills',
    description: 'Bills in household',
    mimeType: 'application/json',
  },
  {
    uri: 'history',
    name: 'History',
    description: 'Calculation history',
    mimeType: 'application/json',
  },
];

// Tool handlers
// Smart Multi-Bank Text Parser
function parseBankTextBackend(text: string): any[] {
  const lines = text.trim().split('\n');
  const bills: any[] = [];

  if (lines.length === 0) return [];

  // Detect separator (tab, comma, or multiple spaces)
  let separator: '\t' | ',' | 'spaces' = '\t';
  const firstLine = lines[0];
  if (firstLine.includes(',')) {
    separator = ',';
  } else if (firstLine.split(/\s{2,}/).length > 1) {
    separator = 'spaces';
  }

  // Helper to split line based on separator
  const splitLine = (line: string): string[] => {
    if (separator === 'spaces') {
      return line.split(/\s{2,}/).map((v: string) => v.trim());
    }
    return line.split(separator).map((v: string) => v.trim());
  };

  // Find header line with date and description columns
  let headerIndex = -1;
  let dateCol = -1;
  let descCol = -1;
  let amountCol = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = splitLine(line);

    // Try to identify columns by content
    for (let j = 0; j < values.length; j++) {
      const val = values[j].toLowerCase();
      if (val.includes('datum') || val.includes('date')) {
        dateCol = j;
      } else if (val.includes('text') || val.includes('beskriv') || val.includes('konto') || val.includes('namn') || val.includes('description')) {
        descCol = j;
      } else if (val.includes('uttag') || val.includes('belopp') || val.includes('amount') || val.includes('insätt')) {
        amountCol = j;
      }
    }

    if (dateCol >= 0 && descCol >= 0 && amountCol >= 0) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    // Fallback: try to parse without explicit header
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.includes('transaktion') || line.includes('reserver') || line.includes('historik')) {
        continue;
      }

      const values = splitLine(line);
      if (values.length >= 2) {
        for (let j = 2; j < values.length; j++) {
          const val = values[j].replace(/\s/g, '').replace(',', '.');
          if (!isNaN(parseFloat(val)) && val !== '0') {
            dateCol = 0;
            descCol = 1;
            amountCol = j;
            headerIndex = i;
            break;
          }
        }
        if (headerIndex >= 0) break;
      }
    }
  }

  if (headerIndex === -1) return [];

  // Parse data rows
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.toLowerCase().includes('transaktion') || line.toLowerCase().includes('reserver') || line.toLowerCase().includes('historik') || line.toLowerCase().includes('total')) {
      continue;
    }

    const values = splitLine(line);
    if (values.length <= Math.max(dateCol, descCol, amountCol)) continue;

    const description = values[descCol];
    let amountStr = values[amountCol];

    if (!description || !amountStr) continue;

    // Parse amount - handle Swedish format
    amountStr = amountStr.replace(/\s/g, '').replace(',', '.');
    const amount = parseFloat(amountStr);

    if (isNaN(amount) || amount === 0) continue;

    // Determine if it's a withdrawal (bill)
    const isWithdrawal = amount < 0 || line.toLowerCase().includes('uttag') || line.toLowerCase().includes('debit');

    if (isWithdrawal) {
      bills.push({
        name: description,
        amount: Math.abs(amount),
        shared: true,
      });
    }
  }

  return bills;
}

// Tool handlers
const toolHandlers: Record<string, any> = {
  create_household: async (req: AuthRequest, params: any) => {
    const { name } = params;
    const household = {
      name,
      ownerId: req.user!.uid,
      inviteCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
      members: [req.user!.uid],
      createdAt: new Date().toISOString(),
    };
    const docRef = await db.collection('households').add(household);
    return { id: docRef.id, ...household };
  },

  join_household: async (req: AuthRequest, params: any) => {
    const { inviteCode } = params;
    const querySnapshot = await db.collection('households').where('inviteCode', '==', inviteCode).get();
    
    if (querySnapshot.empty) {
      throw new Error('Invalid invite code');
    }
    
    const householdDoc = querySnapshot.docs[0];
    const householdData = householdDoc.data();
    
    if (!householdData.members.includes(req.user!.uid)) {
      await db.collection('households').doc(householdDoc.id).update({
        members: [...householdData.members, req.user!.uid],
      });
    }
    
    return { id: householdDoc.id, ...householdData };
  },

  get_household: async (req: AuthRequest, params: any) => {
    const { householdId } = params;
    const docSnap = await db.collection('households').doc(householdId).get();
    
    if (!docSnap.exists) {
      throw new Error('Household not found');
    }
    
    return { id: docSnap.id, ...docSnap.data() };
  },

  add_contributor: async (req: AuthRequest, params: any) => {
    const { householdId, name, income } = params;
    const contributor = {
      householdId,
      name,
      income,
      createdAt: new Date().toISOString(),
    };
    const docRef = await db.collection('contributors').add(contributor);
    return { id: docRef.id, ...contributor };
  },

  add_bill: async (req: AuthRequest, params: any) => {
    const { householdId, name, amount, shared, payer } = params;
    const bill = {
      householdId,
      name,
      amount,
      shared,
      payer,
      createdAt: new Date().toISOString(),
    };
    const docRef = await db.collection('bills').add(bill);
    return { id: docRef.id, ...bill };
  },

  update_bill: async (req: AuthRequest, params: any) => {
    const { householdId, billId, name, amount, shared, payer } = params;
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (amount !== undefined) updates.amount = amount;
    if (shared !== undefined) updates.shared = shared;
    if (payer !== undefined) updates.payer = payer;
    
    await db.collection('bills').doc(billId).update(updates);
    return { id: billId, ...updates };
  },

  remove_bill: async (req: AuthRequest, params: any) => {
    const { householdId, billId } = params;
    await db.collection('bills').doc(billId).delete();
    return { success: true };
  },

  calculate_split: async (req: AuthRequest, params: any) => {
    const { householdId, contributors, bills } = params;
    
    // Filter shared bills
    const sharedBills = bills.filter((b: any) => b.shared);
    
    // Convert contributors array to income record
    const incomes: Record<string, number> = {};
    contributors.forEach((c: any) => {
      incomes[c.name] = c.income;
    });
    
    // Calculate
    const expenditure = calculateExpenditure(incomes, sharedBills);
    
    // Save to history
    const calculation = {
      userId: req.user!.uid,
      householdId,
      contributors,
      bills: sharedBills,
      result: expenditure,
      createdAt: new Date().toISOString(),
    };
    const docRef = await db.collection('calculations').add(calculation);
    
    return {
      id: docRef.id,
      expenditure,
    };
  },

  parse_bank_text: async (req: AuthRequest, params: any) => {
    const { text } = params;
    const bills = parseBankTextBackend(text);

    // Get historical suggestions for individual bills
    const billNames = bills.map(b => b.name);
    const historicalSuggestions = await getHistoricalBillSuggestions(req.user!.uid, billNames);

    // Apply historical suggestions
    const billsWithSuggestions = matchBillsWithHistory(bills, historicalSuggestions);

    // Return suggestions separately so user can confirm
    const suggestedIndividualBills = billsWithSuggestions.filter(b => !b.isShared);

    return {
      bills: billsWithSuggestions,
      count: bills.length,
      suggestions: suggestedIndividualBills,
      message: suggestedIndividualBills.length > 0
        ? `Found ${suggestedIndividualBills.length} bills marked as individual based on history. Confirm or modify before calculating.`
        : null
    };
  },
};

// Resource handlers
const resourceHandlers: Record<string, any> = {
  households: async (req: AuthRequest) => {
    const querySnapshot = await db.collection('households').where('members', 'array-contains', req.user!.uid).get();
    return querySnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  },

  contributors: async (req: AuthRequest, params: any) => {
    const { householdId } = params;
    const querySnapshot = await db.collection('contributors').where('householdId', '==', householdId).get();
    return querySnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  },

  bills: async (req: AuthRequest, params: any) => {
    const { householdId } = params;
    const querySnapshot = await db.collection('bills').where('householdId', '==', householdId).get();
    return querySnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  },

  history: async (req: AuthRequest, params: any) => {
    const { householdId } = params;

    const mapAndSort = (snapshot: any) => {
      const history = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
      history.sort((a: any, b: any) => {
        const aTime = new Date(a.createdAt || 0).getTime();
        const bTime = new Date(b.createdAt || 0).getTime();
        return bTime - aTime;
      });
      return history;
    };

    try {
      const querySnapshot = await db.collection('calculations')
        .where('householdId', '==', householdId)
        .orderBy('createdAt', 'desc')
        .get();
      return mapAndSort(querySnapshot);
    } catch (error: any) {
      const code = error?.code;
      const message = String(error?.message || '').toLowerCase();
      const missingIndex = code === 9 || code === 'failed-precondition' || message.includes('requires an index');

      if (!missingIndex) {
        throw error;
      }

      const fallbackSnapshot = await db.collection('calculations')
        .where('householdId', '==', householdId)
        .get();
      return mapAndSort(fallbackSnapshot);
    }
  },
};

// MCP endpoint
router.post('/', authenticateOAuth, async (req: AuthRequest, res) => {
  const mcpReq: MCPRequest = req.body;

  try {
    let result: any;

    switch (mcpReq.method) {
      case 'tools/list':
        result = { tools };
        break;

      case 'tools/call':
        const { name, arguments: args } = mcpReq.params;
        if (!toolHandlers[name]) {
          throw new Error(`Unknown tool: ${name}`);
        }
        result = await toolHandlers[name](req, args);
        break;

      case 'resources/list':
        result = { resources };
        break;

      case 'resources/read':
        const { uri } = mcpReq.params;
        if (!resourceHandlers[uri]) {
          throw new Error(`Unknown resource: ${uri}`);
        }
        result = { contents: [{ uri, value: await resourceHandlers[uri](req, mcpReq.params) }] };
        break;

      default:
        throw new Error(`Unknown method: ${mcpReq.method}`);
    }

    const response: MCPResponse = {
      jsonrpc: '2.0',
      id: mcpReq.id,
      result,
    };

    res.json(response);
  } catch (error: any) {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id: mcpReq.id,
      error: {
        code: -32603,
        message: error.message || 'Internal error',
      },
    };
    res.status(500).json(response);
  }
});

export default router;

import { Router } from 'express';
import { AuthRequest, authenticateOAuth } from '../middleware/auth';
import { db, admin } from '../config/firebase';
import { HouseholdService } from '../services/household.service';
import { calculateExpenditure, getHistoricalBillSuggestions, matchBillsWithHistory } from '../services/calculation.service';

const router = Router();

// MCP Protocol: JSON-RPC 2.0
interface MCPRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'billsplitter-mcp', version: '1.0.0' };

// JSON-RPC error codes
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

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
    name: 'list_households',
    description: 'List all households the user is a member of',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_contributors',
    description: 'List contributors in a household',
    inputSchema: {
      type: 'object',
      properties: {
        householdId: { type: 'string', description: 'Household ID' },
      },
      required: ['householdId'],
    },
  },
  {
    name: 'list_bills',
    description: 'List bills in a household',
    inputSchema: {
      type: 'object',
      properties: {
        householdId: { type: 'string', description: 'Household ID' },
      },
      required: ['householdId'],
    },
  },
  {
    name: 'update_contributor',
    description: 'Update an existing contributor (name and/or income)',
    inputSchema: {
      type: 'object',
      properties: {
        contributorId: { type: 'string', description: 'Contributor ID' },
        name: { type: 'string', description: 'New name (optional)' },
        income: { type: 'number', description: 'New monthly income (optional)' },
      },
      required: ['contributorId'],
    },
  },
  {
    name: 'remove_contributor',
    description: 'Remove a contributor from their household',
    inputSchema: {
      type: 'object',
      properties: {
        contributorId: { type: 'string', description: 'Contributor ID' },
      },
      required: ['contributorId'],
    },
  },
  {
    name: 'get_calculation',
    description: 'Get a saved split calculation by id',
    inputSchema: {
      type: 'object',
      properties: {
        calculationId: { type: 'string', description: 'Calculation ID' },
      },
      required: ['calculationId'],
    },
  },
  {
    name: 'mark_transfer_paid',
    description: 'Mark a transfer in a calculation as paid or pending',
    inputSchema: {
      type: 'object',
      properties: {
        calculationId: { type: 'string', description: 'Calculation ID' },
        transferIndex: { type: 'number', description: 'Zero-based index of transfer in the calculation' },
        status: {
          type: 'string',
          enum: ['paid', 'pending'],
          description: 'New status (default: paid)',
        },
      },
      required: ['calculationId', 'transferIndex'],
    },
  },
  {
    name: 'summarize_month',
    description: 'Summarize all split calculations for a household in a given month (totals, per-contributor, transfer status)',
    inputSchema: {
      type: 'object',
      properties: {
        householdId: { type: 'string', description: 'Household ID' },
        month: { type: 'string', description: 'Month in YYYY-MM format, e.g. 2026-05' },
      },
      required: ['householdId', 'month'],
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

// Verify the authenticated user is a member of the given household.
// Pre-existing tools (add_bill, calculate_split, etc.) do not check this; new tools must.
async function assertHouseholdMember(uid: string, householdId: string) {
  const doc = await db.collection('households').doc(householdId).get();
  if (!doc.exists) {
    throw new Error('Household not found');
  }
  const data = doc.data() as any;
  const members: string[] = data?.members || [];
  if (!members.includes(uid)) {
    throw new Error('Not a member of this household');
  }
  return { id: doc.id, ...data };
}

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
    return assertHouseholdMember(req.user!.uid, householdId);
  },

  add_contributor: async (req: AuthRequest, params: any) => {
    const { householdId, name, income } = params;
    await assertHouseholdMember(req.user!.uid, householdId);
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
    await assertHouseholdMember(req.user!.uid, householdId);
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
    const { billId, name, amount, shared, payer } = params;
    const billRef = db.collection('bills').doc(billId);
    const billSnap = await billRef.get();
    if (!billSnap.exists) {
      throw new Error('Bill not found');
    }
    // Verify against the bill's actual householdId, not user-supplied — avoids spoofing.
    const billData = billSnap.data() as any;
    await assertHouseholdMember(req.user!.uid, billData.householdId);

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (amount !== undefined) updates.amount = amount;
    if (shared !== undefined) updates.shared = shared;
    if (payer !== undefined) updates.payer = payer;

    await billRef.update(updates);
    return { id: billId, ...updates };
  },

  remove_bill: async (req: AuthRequest, params: any) => {
    const { billId } = params;
    const billRef = db.collection('bills').doc(billId);
    const billSnap = await billRef.get();
    if (!billSnap.exists) {
      throw new Error('Bill not found');
    }
    const billData = billSnap.data() as any;
    await assertHouseholdMember(req.user!.uid, billData.householdId);

    await billRef.delete();
    return { success: true };
  },

  calculate_split: async (req: AuthRequest, params: any) => {
    const { householdId, contributors, bills } = params;
    await assertHouseholdMember(req.user!.uid, householdId);

    // Filter shared bills
    const sharedBills = bills.filter((b: any) => b.shared);

    // Convert contributors array to income record
    const incomes: Record<string, number> = {};
    contributors.forEach((c: any) => {
      incomes[c.name] = c.income;
    });

    // Calculate
    const expenditure = calculateExpenditure(incomes, sharedBills);

    // Attach pending status to every transfer so mark_transfer_paid can flip it later.
    const expenditureWithStatus = {
      ...expenditure,
      transfers: expenditure.transfers.map((t) => ({ ...t, status: 'pending' as const })),
    };

    // Save to history
    const calculation = {
      userId: req.user!.uid,
      householdId,
      contributors,
      bills: sharedBills,
      result: expenditureWithStatus,
      createdAt: new Date().toISOString(),
    };
    const docRef = await db.collection('calculations').add(calculation);

    return {
      id: docRef.id,
      expenditure: expenditureWithStatus,
    };
  },

  list_households: async (req: AuthRequest) => {
    const uid = req.user!.uid;
    console.log('[list_households] Looking for user:', uid);
    const snapshot = await db.collection('households').get();
    console.log('[list_households] Total households:', snapshot.docs.length);

    const filtered = snapshot.docs.filter((doc: any) => {
      const data = doc.data();
      const members = data.members;
      console.log(`[list_households] Household "${data.name}": members type=${typeof members}, isArray=${Array.isArray(members)}, members=`, members);

      // Handle both array and object formats
      if (Array.isArray(members)) {
        const found = members.some((m: any) => m.uid === uid);
        console.log(`[list_households] Array check: found=${found}`);
        return found;
      } else if (members && typeof members === 'object') {
        // If members is an object with UIDs as keys
        const found = Object.keys(members).includes(uid) ||
                      Object.values(members).some((m: any) => m?.uid === uid);
        console.log(`[list_households] Object check: found=${found}`);
        return found;
      }
      console.log('[list_households] No members data');
      return false;
    });

    console.log('[list_households] Filtered households:', filtered.length);
    return filtered.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  },

  list_contributors: async (req: AuthRequest, params: any) => {
    const { householdId } = params;
    await assertHouseholdMember(req.user!.uid, householdId);
    const snapshot = await db.collection('contributors')
      .where('householdId', '==', householdId)
      .get();
    return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  },

  list_bills: async (req: AuthRequest, params: any) => {
    const { householdId } = params;
    await assertHouseholdMember(req.user!.uid, householdId);
    const snapshot = await db.collection('bills')
      .where('householdId', '==', householdId)
      .get();
    return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  },

  update_contributor: async (req: AuthRequest, params: any) => {
    const { contributorId, name, income } = params;
    const docRef = db.collection('contributors').doc(contributorId);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new Error('Contributor not found');
    }
    const data = snap.data() as any;
    await assertHouseholdMember(req.user!.uid, data.householdId);

    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (income !== undefined) updates.income = income;
    if (Object.keys(updates).length === 0) {
      return { id: contributorId, ...data };
    }
    await docRef.update(updates);
    return { id: contributorId, ...data, ...updates };
  },

  remove_contributor: async (req: AuthRequest, params: any) => {
    const { contributorId } = params;
    const docRef = db.collection('contributors').doc(contributorId);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new Error('Contributor not found');
    }
    const data = snap.data() as any;
    await assertHouseholdMember(req.user!.uid, data.householdId);
    await docRef.delete();
    return { success: true, id: contributorId };
  },

  get_calculation: async (req: AuthRequest, params: any) => {
    const { calculationId } = params;
    const snap = await db.collection('calculations').doc(calculationId).get();
    if (!snap.exists) {
      throw new Error('Calculation not found');
    }
    const data = snap.data() as any;
    if (data.userId !== req.user!.uid) {
      await assertHouseholdMember(req.user!.uid, data.householdId);
    }
    return { id: snap.id, ...data };
  },

  mark_transfer_paid: async (req: AuthRequest, params: any) => {
    const { calculationId, transferIndex, status } = params;
    const newStatus = status === 'pending' ? 'pending' : 'paid';

    const docRef = db.collection('calculations').doc(calculationId);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new Error('Calculation not found');
    }
    const data = snap.data() as any;
    if (data.userId !== req.user!.uid) {
      await assertHouseholdMember(req.user!.uid, data.householdId);
    }

    const transfers: any[] = data?.result?.transfers || [];
    if (transferIndex < 0 || transferIndex >= transfers.length) {
      throw new Error(`transferIndex ${transferIndex} out of range (have ${transfers.length} transfers)`);
    }

    const updatedTransfers = transfers.map((t, i) =>
      i === transferIndex ? { ...t, status: newStatus } : t
    );

    await docRef.update({
      'result.transfers': updatedTransfers,
      updatedAt: new Date().toISOString(),
    });

    return {
      id: calculationId,
      transferIndex,
      transfer: updatedTransfers[transferIndex],
    };
  },

  summarize_month: async (req: AuthRequest, params: any) => {
    const { householdId, month } = params;
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new Error('month must be YYYY-MM (e.g. 2026-05)');
    }
    await assertHouseholdMember(req.user!.uid, householdId);

    const snapshot = await db.collection('calculations')
      .where('householdId', '==', householdId)
      .get();

    // createdAt is stored as ISO string by MCP; filter by month prefix in code.
    const monthCalcs = snapshot.docs
      .map((doc: any) => ({ id: doc.id, ...doc.data() }))
      .filter((c: any) => typeof c.createdAt === 'string' && c.createdAt.startsWith(month));

    let totalSharedBills = 0;
    let totalIndividualBills = 0;
    const perContributor: Record<string, { contribution: number; individualBills: number }> = {};
    let transferTotal = 0;
    let transferPaid = 0;
    let transferPending = 0;
    let amountTotal = 0;
    let amountPaid = 0;
    let amountPending = 0;

    for (const calc of monthCalcs) {
      const bills: any[] = calc.bills || [];
      for (const b of bills) {
        if (b.shared || b.isShared) {
          totalSharedBills += Number(b.amount) || 0;
        } else {
          totalIndividualBills += Number(b.amount) || 0;
        }
      }

      const contributions: Record<string, number> = calc?.result?.contributions || {};
      for (const [name, amount] of Object.entries(contributions)) {
        perContributor[name] ||= { contribution: 0, individualBills: 0 };
        perContributor[name].contribution += Number(amount) || 0;
      }

      const individualByPerson: Record<string, any[]> = calc?.result?.individualBills || {};
      for (const [name, list] of Object.entries(individualByPerson)) {
        perContributor[name] ||= { contribution: 0, individualBills: 0 };
        for (const b of list || []) {
          perContributor[name].individualBills += Number(b.amount) || 0;
        }
      }

      const transfers: any[] = calc?.result?.transfers || [];
      for (const t of transfers) {
        transferTotal += 1;
        const amount = Number(t.amount) || 0;
        amountTotal += amount;
        if (t.status === 'paid') {
          transferPaid += 1;
          amountPaid += amount;
        } else {
          transferPending += 1;
          amountPending += amount;
        }
      }
    }

    return {
      householdId,
      month,
      calculationCount: monthCalcs.length,
      totals: {
        sharedBills: totalSharedBills,
        individualBills: totalIndividualBills,
        allBills: totalSharedBills + totalIndividualBills,
      },
      perContributor,
      transfers: {
        total: transferTotal,
        paid: transferPaid,
        pending: transferPending,
        amountTotal,
        amountPaid,
        amountPending,
      },
      calculations: monthCalcs.map((c: any) => ({
        id: c.id,
        createdAt: c.createdAt,
        transferCount: (c?.result?.transfers || []).length,
      })),
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
    await assertHouseholdMember(req.user!.uid, householdId);
    const querySnapshot = await db.collection('contributors').where('householdId', '==', householdId).get();
    return querySnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  },

  bills: async (req: AuthRequest, params: any) => {
    const { householdId } = params;
    await assertHouseholdMember(req.user!.uid, householdId);
    const querySnapshot = await db.collection('bills').where('householdId', '==', householdId).get();
    return querySnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  },

  history: async (req: AuthRequest, params: any) => {
    const { householdId } = params;
    await assertHouseholdMember(req.user!.uid, householdId);

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

function sendRpcError(
  res: any,
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: any,
) {
  const response: MCPResponse = {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
  // JSON-RPC errors are returned over HTTP 200 — HTTP status reserved for transport-level failures.
  res.status(200).json(response);
}

// MCP endpoint
router.post('/', authenticateOAuth, async (req: AuthRequest, res) => {
  const mcpReq: MCPRequest = req.body;

  // Notifications: JSON-RPC requests without an id — no response expected.
  const isNotification = mcpReq.id === undefined || mcpReq.id === null;

  try {
    let result: any;

    switch (mcpReq.method) {
      case 'initialize': {
        const clientVersion = mcpReq.params?.protocolVersion;
        result = {
          protocolVersion: clientVersion || PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false, subscribe: false },
            prompts: { listChanged: false },
          },
          serverInfo: SERVER_INFO,
        };
        break;
      }

      case 'notifications/initialized':
      case 'notifications/cancelled':
      case 'notifications/roots/list_changed':
        // Notifications expect no response body.
        return res.status(202).end();

      case 'ping':
        result = {};
        break;

      case 'tools/list':
        result = { tools };
        break;

      case 'tools/call': {
        const params = mcpReq.params || {};
        const { name, arguments: args } = params;
        if (!name || !toolHandlers[name]) {
          return sendRpcError(res, mcpReq.id, METHOD_NOT_FOUND, `Unknown tool: ${name}`);
        }
        try {
          const toolResult = await toolHandlers[name](req, args || {});
          result = {
            content: [
              { type: 'text', text: JSON.stringify(toolResult, null, 2) },
            ],
            isError: false,
          };
        } catch (toolError: any) {
          // Tool execution errors are returned as result content with isError, per MCP spec —
          // JSON-RPC errors are reserved for protocol-level failures.
          result = {
            content: [
              { type: 'text', text: toolError?.message || 'Tool execution failed' },
            ],
            isError: true,
          };
        }
        break;
      }

      case 'resources/list':
        result = { resources };
        break;

      case 'resources/read': {
        const params = mcpReq.params || {};
        const { uri } = params;
        if (!uri || !resourceHandlers[uri]) {
          return sendRpcError(res, mcpReq.id, METHOD_NOT_FOUND, `Unknown resource: ${uri}`);
        }
        const resourceData = await resourceHandlers[uri](req, params);
        result = {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(resourceData, null, 2),
            },
          ],
        };
        break;
      }

      case 'prompts/list':
        result = { prompts: [] };
        break;

      case 'prompts/get':
        return sendRpcError(res, mcpReq.id, METHOD_NOT_FOUND, 'Prompts are not supported');

      default:
        if (isNotification) {
          return res.status(202).end();
        }
        return sendRpcError(res, mcpReq.id, METHOD_NOT_FOUND, `Method not found: ${mcpReq.method}`);
    }

    if (isNotification) {
      return res.status(202).end();
    }

    const response: MCPResponse = {
      jsonrpc: '2.0',
      id: mcpReq.id ?? null,
      result,
    };
    res.json(response);
  } catch (error: any) {
    console.error('MCP error:', error);
    if (isNotification) {
      return res.status(202).end();
    }
    return sendRpcError(res, mcpReq.id, INTERNAL_ERROR, error?.message || 'Internal error');
  }
});

export default router;

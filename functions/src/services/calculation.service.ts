import { db } from '../config/firebase';

export interface Contributor {
  name: string;
  income: number;
}

export interface Bill {
  name: string;
  amount: number;
  isShared: boolean;
  payer?: string;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface CalculationResult {
  contributions: Record<string, number>;
  remainingAmounts: Record<string, number>;
  targetRemainingBalance: number;
  transfers: Transfer[];
  individualBills: Record<string, Bill[]>;
}

export function calculateExpenditure(
  incomes: Record<string, number>,
  bills: Bill[],
  primaryPayer?: string
): CalculationResult {
  // Separate shared and individual bills
  const sharedBills = bills.filter(b => b.isShared);
  const individualBills = bills.filter(b => !b.isShared);

  // Calculate total shared bills
  const totalSharedBills = sharedBills.reduce((sum, bill) => sum + bill.amount, 0);

  // Calculate individual bills per person
  const individualBillsByPerson: Record<string, Bill[]> = {};
  const individualBillsTotalByPerson: Record<string, number> = {};

  individualBills.forEach(bill => {
    if (bill.payer) {
      if (!individualBillsByPerson[bill.payer]) {
        individualBillsByPerson[bill.payer] = [];
        individualBillsTotalByPerson[bill.payer] = 0;
      }
      individualBillsByPerson[bill.payer].push(bill);
      individualBillsTotalByPerson[bill.payer] += bill.amount;
    }
  });

  const totalIncome = Object.values(incomes).reduce((a, b) => a + b, 0);

  // Individual bills are personal expenses — only shared bills factor into the split
  const targetRemainingBalance = (totalIncome - totalSharedBills) / Object.keys(incomes).length;

  const contributions: Record<string, number> = {};
  const remainingAmounts: Record<string, number> = {};

  for (const [name, income] of Object.entries(incomes)) {
    // Contribution = income - target_remaining
    // Individual bills are NOT deducted — they are each person's own responsibility
    const contributionToShared = income - targetRemainingBalance;
    contributions[name] = contributionToShared;
    remainingAmounts[name] = targetRemainingBalance;
  }

  const transfers = calculateTransfers(contributions, primaryPayer);

  return {
    contributions,
    remainingAmounts,
    targetRemainingBalance,
    transfers,
    individualBills: individualBillsByPerson,
  };
}

// Settlement model: everyone pays their income-proportional share of the shared
// bills. If a single primary payer fronts all shared bills, everyone else simply
// transfers their full share to that person. With no primary payer there are no
// inter-person transfers — each person pays their own share directly.
export function calculateTransfers(
  contributions: Record<string, number>,
  primaryPayer?: string
): Transfer[] {
  if (!primaryPayer || !(primaryPayer in contributions)) {
    return [];
  }

  const transfers: Transfer[] = [];
  for (const [name, contribution] of Object.entries(contributions)) {
    if (name === primaryPayer) continue;
    if (contribution > 0.005) {
      transfers.push({ from: name, to: primaryPayer, amount: contribution });
    }
  }

  return transfers;
}

// Function to check historical bills for individual bill suggestions
export async function getHistoricalBillSuggestions(userId: string, billNames: string[]): Promise<Record<string, { isShared: boolean; payer?: string }>> {
  const suggestions: Record<string, { isShared: boolean; payer?: string }> = {};

  try {
    // Get recent calculations for this user
    const querySnapshot = await db.collection('calculations')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    // Build a map of bill names to their individual status and payer
    for (const doc of querySnapshot.docs) {
      const data = doc.data();
      if (data.bills && Array.isArray(data.bills)) {
        for (const bill of data.bills) {
          if (!bill.isShared && bill.payer) {
            // Only suggest if this bill was individual
            const billName = bill.name.toLowerCase().trim();
            if (!suggestions[billName]) {
              suggestions[billName] = {
                isShared: false,
                payer: bill.payer
              };
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error fetching historical bills:', error);
  }

  return suggestions;
}

// Function to match bill names with historical suggestions
export function matchBillsWithHistory(bills: Bill[], historicalSuggestions: Record<string, { isShared: boolean; payer?: string }>): Bill[] {
  return bills.map(bill => {
    const billNameLower = bill.name.toLowerCase().trim();
    const suggestion = historicalSuggestions[billNameLower];

    if (suggestion && !suggestion.isShared) {
      return {
        ...bill,
        isShared: false,
        payer: suggestion.payer
      };
    }

    return bill;
  });
}

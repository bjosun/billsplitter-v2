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
  bills: Bill[]
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

  // Total income and total bills (shared + individual)
  const totalIncome = Object.values(incomes).reduce((a, b) => a + b, 0);
  const totalIndividualBills = Object.values(individualBillsTotalByPerson).reduce((a, b) => a + b, 0);
  const totalBills = totalSharedBills + totalIndividualBills;

  // Calculate target remaining balance after ALL bills
  const targetRemainingBalance = (totalIncome - totalBills) / Object.keys(incomes).length;

  const contributions: Record<string, number> = {};
  const remainingAmounts: Record<string, number> = {};

  for (const [name, income] of Object.entries(incomes)) {
    const individualBillAmount = individualBillsTotalByPerson[name] || 0;
    // Contribution = income - target_remaining (this is what they pay towards shared bills)
    // Their total outflow = individual bills + contribution to shared
    const contributionToShared = income - targetRemainingBalance - individualBillAmount;
    contributions[name] = contributionToShared;
    remainingAmounts[name] = targetRemainingBalance;
  }

  const transfers = calculateTransfers(contributions, targetRemainingBalance);

  return {
    contributions,
    remainingAmounts,
    targetRemainingBalance,
    transfers,
    individualBills: individualBillsByPerson,
  };
}
export function calculateTransfers(
  contributions: Record<string, number>,
  targetRemainingBalance: number
): Transfer[] {
  const transfers: Transfer[] = [];
  
  const payers: Array<{ name: string; amount: number }> = [];
  const receivers: Array<{ name: string; amount: number }> = [];
  
  for (const [name, contribution] of Object.entries(contributions)) {
    if (contribution > targetRemainingBalance) {
      payers.push({ name, amount: contribution - targetRemainingBalance });
    } else if (contribution < targetRemainingBalance) {
      receivers.push({ name, amount: targetRemainingBalance - contribution });
    }
  }
  
  for (const payer of payers) {
    let remainingToPay = payer.amount;
    
    for (const receiver of receivers) {
      if (remainingToPay <= 0) break;
      if (receiver.amount <= 0) continue;
      
      const transferAmount = Math.min(remainingToPay, receiver.amount);
      transfers.push({
        from: payer.name,
        to: receiver.name,
        amount: transferAmount,
      });
      
      remainingToPay -= transferAmount;
      receiver.amount -= transferAmount;
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

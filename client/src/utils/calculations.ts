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

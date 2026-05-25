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

  // Track shared bills pre-paid by a specific person (for transfer settlement)
  const sharedPaidByPerson: Record<string, number> = {};
  sharedBills.forEach(bill => {
    if (bill.payer) {
      sharedPaidByPerson[bill.payer] = (sharedPaidByPerson[bill.payer] || 0) + bill.amount;
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

  const transfers = calculateTransfers(contributions, sharedPaidByPerson);

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
  sharedBillsPaidByPerson: Record<string, number> = {}
): Transfer[] {
  const transfers: Transfer[] = [];

  // net = already paid towards shared - what they owe
  // positive net → overpaid → should receive money from others
  // negative net → underpaid → needs to send money to others
  const receivers: Array<{ name: string; amount: number }> = [];
  const senders: Array<{ name: string; amount: number }> = [];

  for (const [name, contribution] of Object.entries(contributions)) {
    const alreadyPaid = sharedBillsPaidByPerson[name] || 0;
    const net = alreadyPaid - contribution;

    if (net > 0.005) {
      receivers.push({ name, amount: net });
    } else if (net < -0.005) {
      senders.push({ name, amount: -net });
    }
  }

  for (const sender of senders) {
    let remaining = sender.amount;
    for (const receiver of receivers) {
      if (remaining <= 0.005) break;
      if (receiver.amount <= 0.005) continue;
      const amount = Math.min(remaining, receiver.amount);
      transfers.push({ from: sender.name, to: receiver.name, amount });
      remaining -= amount;
      receiver.amount -= amount;
    }
  }

  return transfers;
}

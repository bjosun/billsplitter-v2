export interface Expense {
  id: string;
  householdId: string;
  createdBy: string;
  month: string;
  bills: number;
  contributors: {
    [name: string]: {
      income: number;
      contribution: number;
      remaining: number;
    };
  };
  transfers: {
    from: string;
    to: string;
    amount: number;
    status: 'pending' | 'completed';
  }[];
  targetRemainingBalance: number;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface CreateExpenseData {
  householdId: string;
  createdBy: string;
  month: string;
  bills: number;
  contributors: {
    [name: string]: {
      income: number;
      contribution: number;
      remaining: number;
    };
  };
  transfers: {
    from: string;
    to: string;
    amount: number;
    status: 'pending' | 'completed';
  }[];
  targetRemainingBalance: number;
}

export interface Contributor {
  name: string;
  income: number;
}

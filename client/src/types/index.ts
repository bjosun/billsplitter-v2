export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  households: string[];
  createdAt: any;
  updatedAt: any;
}

export interface Household {
  id: string;
  name: string;
  createdBy: string;
  inviteCode: string;
  members: {
    [userId: string]: {
      name: string;
      role: 'admin' | 'member';
      joinedAt: any;
    };
  };
  createdAt: any;
  updatedAt: any;
}

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
  createdAt: any;
  updatedAt: any;
}

export interface Contributor {
  name: string;
  income: number;
}

export interface Invite {
  id: string;
  householdId: string;
  householdName: string;
  code: string;
  email: string;
  invitedBy: string;
  invitedByName?: string;
  expiresAt: any;
  usedAt: any | null;
  usedBy: string | null;
  revokedAt: any | null;
  createdAt: any;
}

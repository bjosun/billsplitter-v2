export interface Household {
  id: string;
  name: string;
  createdBy: string;
  inviteCode: string;
  members: {
    [userId: string]: {
      name: string;
      role: 'admin' | 'member';
      joinedAt: FirebaseFirestore.Timestamp;
    };
  };
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface CreateHouseholdData {
  name: string;
  createdBy: string;
}

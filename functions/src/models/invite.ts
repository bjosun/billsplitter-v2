export interface Invite {
  id: string;
  householdId: string;
  householdName: string;
  code: string;
  email: string;
  invitedBy: string;
  invitedByName?: string;
  expiresAt: FirebaseFirestore.Timestamp;
  usedAt: FirebaseFirestore.Timestamp | null;
  usedBy: string | null;
  revokedAt: FirebaseFirestore.Timestamp | null;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface CreateInviteData {
  householdId: string;
  email: string;
  invitedBy: string;
  invitedByName?: string;
}

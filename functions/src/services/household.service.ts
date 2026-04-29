import { db, admin } from '../config/firebase';
import { Household, CreateHouseholdData } from '../models/household';

export class HouseholdService {
  private static generateInviteCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  static async createHousehold(data: CreateHouseholdData): Promise<Household> {
    const inviteCode = this.generateInviteCode();
    const now = admin.firestore.Timestamp.now();
    
    const householdData = {
      name: data.name,
      createdBy: data.createdBy,
      inviteCode,
      members: {
        [data.createdBy]: {
          name: 'Creator',
          role: 'admin' as const,
          joinedAt: now,
        },
      },
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await db.collection('households').add(householdData);
    const household: Household = { id: docRef.id, ...householdData };
    
    // Add household to user's households array
    await db.collection('users').doc(data.createdBy).set({
      id: data.createdBy,
      households: admin.firestore.FieldValue.arrayUnion(docRef.id),
      updatedAt: now,
    }, { merge: true });
    
    return household;
  }

  static async getHousehold(householdId: string): Promise<Household | null> {
    const doc = await db.collection('households').doc(householdId).get();
    if (!doc.exists) return null;
    
    return { ...(doc.data() as object), id: doc.id } as Household;
  }

  static async getHouseholdByInviteCode(inviteCode: string): Promise<Household | null> {
    const querySnapshot = await db.collection('households').where('inviteCode', '==', inviteCode).limit(1).get();
    if (querySnapshot.empty) return null;

    const householdDoc = querySnapshot.docs[0];
    return { ...(householdDoc.data() as object), id: householdDoc.id } as Household;
  }

  static async getUserHouseholds(userId: string): Promise<Household[]> {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return [];
    
    const userData = userDoc.data();
    const householdIds = userData?.households || [];
    
    if (householdIds.length === 0) return [];
    
    const households = await Promise.all(
      householdIds.map((id: string) => this.getHousehold(id))
    );
    
    return households.filter((h): h is Household => h !== null);
  }

  static async joinHousehold(
    householdId: string,
    userId: string,
    userName: string
  ): Promise<boolean> {
    const household = await this.getHousehold(householdId);
    if (!household) return false;
    
    const now = admin.firestore.Timestamp.now();
    
    await db.collection('households').doc(householdId).update({
      [`members.${userId}`]: {
        name: userName,
        role: 'member',
        joinedAt: now,
      },
      updatedAt: now,
    });
    
    await db.collection('users').doc(userId).set({
      id: userId,
      households: admin.firestore.FieldValue.arrayUnion(householdId),
      updatedAt: now,
    }, { merge: true });
    
    return true;
  }

  static async joinHouseholdByInviteCode(
    inviteCode: string,
    userId: string,
    userName: string
  ): Promise<Household | null> {
    const household = await this.getHouseholdByInviteCode(inviteCode);
    if (!household) return null;

    await this.joinHousehold(household.id, userId, userName);
    return this.getHousehold(household.id);
  }

  static async removeMember(
    householdId: string,
    userId: string
  ): Promise<boolean> {
    const now = admin.firestore.Timestamp.now();
    
    await db.collection('households').doc(householdId).update({
      [`members.${userId}`]: admin.firestore.FieldValue.delete(),
      updatedAt: now,
    });
    
    await db.collection('users').doc(userId).set({
      id: userId,
      households: admin.firestore.FieldValue.arrayRemove(householdId),
      updatedAt: now,
    }, { merge: true });
    
    return true;
  }
}

/**
 * Migration script: Add householdId to existing calculations.
 *
 * This script finds all calculations that have a userId but no householdId,
 * and assigns the user's first household to them.
 *
 * To run:
 * 1. Add this as a temporary callable function in functions/src/routes/admin.ts
 * 2. Deploy functions
 * 3. Call from frontend or use Firebase shell
 *
 * Or run locally with:
 * firebase functions:shell
 * > migrateCalculations()
 */

import { db, admin } from '../config/firebase';

interface Calculation {
  id: string;
  userId?: string;
  householdId?: string;
  createdAt?: any;
}

export async function migrateCalculationsToHousehold(): Promise<{
  total: number;
  migrated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let migrated = 0;
  let total = 0;

  try {
    // Get all calculations without householdId but with userId
    const snapshot = await db
      .collection('calculations')
      .where('userId', '!=', null)
      .get();

    total = snapshot.size;
    console.log(`Found ${total} calculations with userId`);

    for (const doc of snapshot.docs) {
      const calc = doc.data() as Calculation;
      const calcId = doc.id;

      // Skip if already has householdId
      if (calc.householdId) {
        continue;
      }

      if (!calc.userId) {
        errors.push(`Calculation ${calcId} has no userId`);
        continue;
      }

      try {
        // Get user's households
        const userDoc = await db.collection('users').doc(calc.userId).get();
        if (!userDoc.exists) {
          errors.push(`User ${calc.userId} not found for calculation ${calcId}`);
          continue;
        }

        const userData = userDoc.data();
        const householdIds = userData?.households || [];

        if (householdIds.length === 0) {
          console.log(`Skipping calculation ${calcId}: user has no households`);
          continue;
        }

        // Assign first household
        const firstHouseholdId = householdIds[0];

        await db.collection('calculations').doc(calcId).update({
          householdId: firstHouseholdId,
        });

        migrated++;
        console.log(`Migrated calculation ${calcId} → household ${firstHouseholdId}`);
      } catch (err) {
        errors.push(`Failed to migrate calculation ${calcId}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    errors.push(`Migration failed: ${(err as Error).message}`);
  }

  return {
    total,
    migrated,
    errors,
  };
}

// Export for use in routes
export default migrateCalculationsToHousehold;

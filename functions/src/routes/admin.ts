import { Router } from 'express';
import { authenticateUser, AuthRequest } from '../middleware/auth';
import migrateCalculationsToHousehold from '../migrations/migrate-calculations-household';

const router = Router();

// POST /admin/migrate-calculations - Migrate old calculations to household
router.post('/migrate-calculations', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // In production, you may want to restrict this to specific admin users
    // For now, any authenticated user can run it (or remove authenticateUser entirely for local testing)

    console.log('Starting calculations migration...');
    const result = await migrateCalculationsToHousehold();
    console.log('Migration complete:', result);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({ error: 'Migration failed', message: (error as Error).message });
  }
});

export default router;

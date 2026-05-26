import { Router } from 'express';
import { db, admin } from '../config/firebase';
import { authenticateUser, AuthRequest } from '../middleware/auth';

const router = Router();

router.put('/me', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name, phone, email } = req.body as { name?: string; phone?: string; email?: string };
    if (name !== undefined && typeof name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' });
    }
    if (email !== undefined && (typeof email !== 'string' || !email.includes('@'))) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const updates: Record<string, unknown> = {
      updatedAt: admin.firestore.Timestamp.now(),
    };
    if (name !== undefined) updates.name = name.trim();
    if (phone !== undefined) updates.phone = phone.trim();
    if (email !== undefined) updates.email = email.trim().toLowerCase();

    await db.collection('users').doc(req.user.uid).set(updates, { merge: true });

    const updatedDoc = await db.collection('users').doc(req.user.uid).get();
    return res.json({ user: { id: updatedDoc.id, ...updatedDoc.data() } });
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

router.get('/me', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    
    if (!userDoc.exists) {
      // Create user if doesn't exist
      const now = admin.firestore.Timestamp.now();
      const userData = {
        id: req.user.uid,
        name: req.user.name || '',
        email: req.user.email,
        households: [],
        createdAt: now,
        updatedAt: now,
      };
      
      await db.collection('users').doc(req.user.uid).set(userData);
      res.json({ user: userData });
    } else {
      res.json({ user: { id: userDoc.id, ...userDoc.data() } });
    }
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

router.put('/:userId', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { userId } = req.params;
    if (userId === req.user.uid) {
      return res.status(400).json({ error: 'Use PUT /users/me to update your own profile' });
    }

    // Caller must be admin of a household that the target user also belongs to
    const callerDoc = await db.collection('users').doc(req.user.uid).get();
    const targetDoc = await db.collection('users').doc(userId).get();

    if (!callerDoc.exists || !targetDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const callerHouseholds: string[] = callerDoc.data()?.households || [];
    const targetHouseholds: string[] = targetDoc.data()?.households || [];
    const sharedHouseholds = callerHouseholds.filter(id => targetHouseholds.includes(id));

    if (sharedHouseholds.length === 0) {
      return res.status(403).json({ error: 'No shared household with this user' });
    }

    const adminChecks = await Promise.all(
      sharedHouseholds.map(async (householdId) => {
        const hDoc = await db.collection('households').doc(householdId).get();
        const member = hDoc.data()?.members?.[req.user!.uid];
        return member?.role === 'admin';
      })
    );
    const isAdmin = adminChecks.some(Boolean);

    if (!isAdmin) {
      return res.status(403).json({ error: 'Must be admin of a shared household to edit member profiles' });
    }

    const { name, phone, email } = req.body as { name?: string; phone?: string; email?: string };
    if (email !== undefined && (typeof email !== 'string' || !email.includes('@'))) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    const updates: Record<string, unknown> = { updatedAt: admin.firestore.Timestamp.now() };
    if (name !== undefined) updates.name = (name as string).trim();
    if (phone !== undefined) updates.phone = (phone as string).trim();
    if (email !== undefined) updates.email = (email as string).trim().toLowerCase();

    await db.collection('users').doc(userId).set(updates, { merge: true });
    const updated = await db.collection('users').doc(userId).get();
    return res.json({ user: { id: updated.id, ...updated.data() } });
  } catch (error) {
    console.error('Admin update user error:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

router.get('/me/bill-groups', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: 'Unauthorized' });
    const doc = await db.collection('users').doc(req.user.uid).get();
    const data = doc.data() || {};
    return res.json({
      billGrouping: {
        enabled: data.billGroupingEnabled ?? false,
        groups: data.billGroups ?? [],
      },
    });
  } catch (error) {
    console.error('Get bill groups error:', error);
    return res.status(500).json({ error: 'Failed to fetch bill groups' });
  }
});

router.put('/me/bill-groups', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: 'Unauthorized' });
    const { enabled, groups } = req.body as { enabled: unknown; groups: unknown };
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    if (!Array.isArray(groups)) {
      return res.status(400).json({ error: 'groups must be an array' });
    }
    for (const g of groups) {
      const group = g as Record<string, unknown>;
      if (
        typeof group.id !== 'string' ||
        typeof group.label !== 'string' ||
        !Array.isArray(group.patterns) ||
        (group.patterns as unknown[]).some((p) => typeof p !== 'string')
      ) {
        return res.status(400).json({ error: 'Invalid group structure: each group needs id, label, and patterns string[]' });
      }
    }
    await db.collection('users').doc(req.user.uid).set(
      { billGroupingEnabled: enabled, billGroups: groups, updatedAt: admin.firestore.Timestamp.now() },
      { merge: true }
    );
    return res.json({ billGrouping: { enabled, groups } });
  } catch (error) {
    console.error('Save bill groups error:', error);
    return res.status(500).json({ error: 'Failed to save bill groups' });
  }
});

export default router;

import { Router } from 'express';
import { db, admin } from '../config/firebase';
import { authenticateUser, AuthRequest } from '../middleware/auth';

const router = Router();

router.put('/me', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name, phone } = req.body as { name?: string; phone?: string };
    if (name !== undefined && typeof name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' });
    }

    const updates: Record<string, unknown> = {
      updatedAt: admin.firestore.Timestamp.now(),
    };
    if (name !== undefined) updates.name = name.trim();
    if (phone !== undefined) updates.phone = phone.trim();

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

export default router;

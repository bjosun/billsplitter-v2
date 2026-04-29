import { Router } from 'express';
import { HouseholdService } from '../services/household.service';
import { InviteService } from '../services/invite.service';
import { authenticateUser, AuthRequest } from '../middleware/auth';

const router = Router();

const ensureHouseholdMember = async (
  householdId: string,
  userId: string
): Promise<{ allowed: boolean; status?: number; error?: string }> => {
  const household = await HouseholdService.getHousehold(householdId);
  if (!household) {
    return { allowed: false, status: 404, error: 'Household not found' };
  }
  if (!household.members || !household.members[userId]) {
    return { allowed: false, status: 403, error: 'Not a member of this household' };
  }
  return { allowed: true };
};

router.get('/', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const households = await HouseholdService.getUserHouseholds(req.user.uid);
    res.json({ households });
  } catch (error) {
    console.error('Get households error:', error);
    res.status(500).json({ error: 'Failed to fetch households' });
  }
});

router.post('/', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    
    const household = await HouseholdService.createHousehold({
      name,
      createdBy: req.user.uid,
    });
    
    res.json({ household });
  } catch (error) {
    console.error('Create household error:', error);
    res.status(500).json({ error: 'Failed to create household' });
  }
});

router.post('/join', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userName = req.user.name || req.user.email || 'Member';

    const inviteCode = String(req.body?.inviteCode || req.body?.code || '').trim().toUpperCase();
    if (!inviteCode) {
      return res.status(400).json({ error: 'inviteCode is required' });
    }

    // Try the new one-time invite system first
    const redeem = await InviteService.redeemInvite(inviteCode, req.user.uid, userName);

    if (redeem.status === 'redeemed') {
      const household = await HouseholdService.getHousehold(redeem.householdId);
      return res.json({ household });
    }

    if (redeem.status === 'expired') {
      return res.status(410).json({ error: 'This invite code has expired.' });
    }
    if (redeem.status === 'already-used') {
      return res.status(409).json({ error: 'This invite code has already been used.' });
    }
    if (redeem.status === 'revoked') {
      return res.status(410).json({ error: 'This invite code has been revoked.' });
    }

    // Backwards compatibility: legacy shared household invite code
    const legacy = await HouseholdService.joinHouseholdByInviteCode(
      inviteCode,
      req.user.uid,
      userName
    );

    if (!legacy) {
      return res.status(404).json({ error: 'Invalid invite code' });
    }

    res.json({ household: legacy });
  } catch (error) {
    console.error('Join household by invite code error:', error);
    res.status(500).json({ error: 'Failed to join household' });
  }
});

router.post('/:householdId/invites', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { householdId } = req.params;
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }

    const access = await ensureHouseholdMember(householdId, req.user.uid);
    if (!access.allowed) {
      return res.status(access.status || 403).json({ error: access.error || 'Forbidden' });
    }

    const result = await InviteService.createInvite({
      householdId,
      email,
      invitedBy: req.user.uid,
      invitedByName: req.user.name || req.user.email,
    });

    res.json({
      invite: result.invite,
      emailDelivered: result.emailDelivered,
      emailReason: result.emailReason,
    });
  } catch (error) {
    console.error('Create invite error:', error);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

router.get('/:householdId/invites', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { householdId } = req.params;
    const access = await ensureHouseholdMember(householdId, req.user.uid);
    if (!access.allowed) {
      return res.status(access.status || 403).json({ error: access.error || 'Forbidden' });
    }

    const invites = await InviteService.listInvitesForHousehold(householdId);
    res.json({ invites });
  } catch (error) {
    console.error('List invites error:', error);
    res.status(500).json({ error: 'Failed to list invites' });
  }
});

router.delete(
  '/:householdId/invites/:inviteId',
  authenticateUser,
  async (req: AuthRequest, res) => {
    try {
      if (!req.user?.uid) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { householdId, inviteId } = req.params;
      const access = await ensureHouseholdMember(householdId, req.user.uid);
      if (!access.allowed) {
        return res.status(access.status || 403).json({ error: access.error || 'Forbidden' });
      }

      const success = await InviteService.revokeInvite(inviteId);
      if (!success) {
        return res.status(404).json({ error: 'Invite not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Revoke invite error:', error);
      res.status(500).json({ error: 'Failed to revoke invite' });
    }
  }
);

router.get('/:householdId', authenticateUser, async (req: AuthRequest, res) => {
  try {
    const { householdId } = req.params;
    const household = await HouseholdService.getHousehold(householdId);
    
    if (!household) {
      return res.status(404).json({ error: 'Household not found' });
    }
    
    res.json({ household });
  } catch (error) {
    console.error('Get household error:', error);
    res.status(500).json({ error: 'Failed to fetch household' });
  }
});

router.post('/:householdId/join', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid || !req.user?.name) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { householdId } = req.params;
    const success = await HouseholdService.joinHousehold(
      householdId,
      req.user.uid,
      req.user.name
    );
    
    if (!success) {
      return res.status(404).json({ error: 'Household not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Join household error:', error);
    res.status(500).json({ error: 'Failed to join household' });
  }
});

router.delete(
  '/:householdId/members/:userId',
  authenticateUser,
  async (req: AuthRequest, res) => {
    try {
      const { householdId, userId } = req.params;
      const success = await HouseholdService.removeMember(householdId, userId);
      
      if (!success) {
        return res.status(404).json({ error: 'Failed to remove member' });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Remove member error:', error);
      res.status(500).json({ error: 'Failed to remove member' });
    }
  }
);

export default router;

import { Router } from 'express';
import { ExpenseService } from '../services/expense.service';
import { authenticateUser, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', authenticateUser, async (req: AuthRequest, res) => {
  try {
    const { householdId, month } = req.query;
    
    if (!householdId) {
      return res.status(400).json({ error: 'householdId is required' });
    }
    
    const expenses = await ExpenseService.getHouseholdExpenses(
      householdId as string,
      month as string | undefined
    );
    
    res.json({ expenses });
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

router.post('/', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { householdId, bills, contributors } = req.body;
    
    if (!householdId || !bills || !contributors) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const expense = await ExpenseService.calculateAndCreate(
      householdId,
      req.user.uid,
      bills,
      contributors
    );
    
    res.json({ expense });
  } catch (error) {
    console.error('Create expense error:', error);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

router.get('/:expenseId', authenticateUser, async (req: AuthRequest, res) => {
  try {
    const { expenseId } = req.params;
    const expense = await ExpenseService.getExpense(expenseId);
    
    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    
    res.json({ expense });
  } catch (error) {
    console.error('Get expense error:', error);
    res.status(500).json({ error: 'Failed to fetch expense' });
  }
});

router.put(
  '/:expenseId/transfers/:transferIndex',
  authenticateUser,
  async (req: AuthRequest, res) => {
    try {
      const { expenseId, transferIndex } = req.params;
      const { status } = req.body;
      
      if (!status || !['pending', 'completed'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      
      const expense = await ExpenseService.updateTransferStatus(
        expenseId,
        parseInt(transferIndex),
        status
      );
      
      if (!expense) {
        return res.status(404).json({ error: 'Expense not found' });
      }
      
      res.json({ expense });
    } catch (error) {
      console.error('Update transfer error:', error);
      res.status(500).json({ error: 'Failed to update transfer' });
    }
  }
);

export default router;

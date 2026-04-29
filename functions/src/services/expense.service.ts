import { db, admin } from '../config/firebase';
import { Expense, CreateExpenseData, Contributor } from '../models/expense';
import { calculateExpenditure, Bill } from './calculation.service';

export class ExpenseService {
  static async createExpense(
    data: CreateExpenseData
  ): Promise<Expense> {
    const now = admin.firestore.Timestamp.now();
    
    const expense: Expense = {
      id: '',
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    
    const docRef = await db.collection('expenses').add(expense);
    expense.id = docRef.id;
    
    return expense;
  }

  static async getExpense(expenseId: string): Promise<Expense | null> {
    const doc = await db.collection('expenses').doc(expenseId).get();
    if (!doc.exists) return null;
    
    return { id: doc.id, ...doc.data() } as Expense;
  }

  static async getHouseholdExpenses(
    householdId: string,
    month?: string
  ): Promise<Expense[]> {
    let query = db
      .collection('expenses')
      .where('householdId', '==', householdId)
      .orderBy('createdAt', 'desc');
    
    if (month) {
      query = query.where('month', '==', month);
    }
    
    const snapshot = await query.get();
    
    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() } as Expense)
    );
  }

  static async updateTransferStatus(
    expenseId: string,
    transferIndex: number,
    status: 'pending' | 'completed'
  ): Promise<Expense | null> {
    const expense = await this.getExpense(expenseId);
    if (!expense) return null;
    
    expense.transfers[transferIndex].status = status;
    expense.updatedAt = admin.firestore.Timestamp.now();
    
    await db
      .collection('expenses')
      .doc(expenseId)
      .update({
        transfers: expense.transfers,
        updatedAt: expense.updatedAt,
      });
    
    return expense;
  }

  static async calculateAndCreate(
    householdId: string,
    createdBy: string,
    bills: Bill[],
    contributors: Contributor[]
  ): Promise<Expense> {
    const incomes: Record<string, number> = {};
    contributors.forEach((c) => {
      incomes[c.name] = c.income;
    });

    const result = calculateExpenditure(incomes, bills);
    
    const contributorData: Record<string, any> = {};
    contributors.forEach((c) => {
      contributorData[c.name] = {
        income: c.income,
        contribution: result.contributions[c.name],
        remaining: result.remainingAmounts[c.name],
      };
    });

    // Calculate total bills for expense model
    const totalBills = bills.reduce((sum, bill) => sum + bill.amount, 0);

    const expenseData: CreateExpenseData = {
      householdId,
      createdBy,
      month: new Date().toISOString().slice(0, 7), // YYYY-MM
      bills: totalBills,
      contributors: contributorData,
      transfers: result.transfers.map((t) => ({
        ...t,
        status: 'pending' as const,
      })),
      targetRemainingBalance: result.targetRemainingBalance,
    };
    
    return this.createExpense(expenseData);
  }
}

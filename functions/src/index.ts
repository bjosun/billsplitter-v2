import * as functions from 'firebase-functions';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import householdRoutes from './routes/households';
import expenseRoutes from './routes/expenses';
import userRoutes from './routes/users';
import mcpRoutes from './routes/mcp';
import adminRoutes from './routes/admin';
import { errorHandler } from './middleware/error';

const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

// Routes
app.use('/auth', authRoutes);
app.use('/households', householdRoutes);
app.use('/expenses', expenseRoutes);
app.use('/users', userRoutes);
app.use('/mcp', mcpRoutes);
app.use('/admin', adminRoutes);

// Error handling
app.use(errorHandler);

// Export as Firebase Function
export const api = functions.https.onRequest(app);

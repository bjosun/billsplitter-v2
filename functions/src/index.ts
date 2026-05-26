import * as functions from 'firebase-functions';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import householdRoutes from './routes/households';
import expenseRoutes from './routes/expenses';
import userRoutes from './routes/users';
import mcpRoutes from './routes/mcp';
import adminRoutes from './routes/admin';
import notificationRoutes from './routes/notifications';
import { errorHandler } from './middleware/error';

const app = express();

app.use(cors({ origin: true, exposedHeaders: ['WWW-Authenticate'] }));
app.use(express.json());

// OAuth discovery — MCP clients read these to auto-configure the OAuth flow.
const issuer = () => {
  const host = process.env.FUNCTION_HOST || 'us-central1-billsplitter-v2.cloudfunctions.net';
  return `https://${host}/api`;
};

app.get('/.well-known/oauth-protected-resource', (_req, res) => {
  res.json({
    resource: `${issuer()}/mcp`,
    authorization_servers: [issuer()],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'email', 'profile'],
  });
});

app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  const base = issuer();
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/auth/authorize`,
    token_endpoint: `${base}/auth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: ['openid', 'email', 'profile'],
  });
});

// Routes
app.use('/auth', authRoutes);
app.use('/households', householdRoutes);
app.use('/expenses', expenseRoutes);
app.use('/users', userRoutes);
app.use('/mcp', mcpRoutes);
app.use('/admin', adminRoutes);
app.use('/notifications', notificationRoutes);

// Error handling
app.use(errorHandler);

// Export as Firebase Function
export const api = functions.https.onRequest(app);

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

const FUNCTIONS_BASE = 'https://us-central1-billsplitter-v2.cloudfunctions.net';

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

// ---------------------------------------------------------------------------
// OAuth shims — Claude Desktop derives these URLs from the MCP server origin
// by stripping the path and appending /authorize or /token.
// These functions redirect/proxy into the real handlers inside the `api` function.
// ---------------------------------------------------------------------------

// GET https://us-central1-billsplitter-v2.cloudfunctions.net/authorize?...
const authorizeShimApp = express();
authorizeShimApp.use(cors({ origin: true }));
authorizeShimApp.get('*', (req, res) => {
  const params = new URLSearchParams(req.query as Record<string, string>).toString();
  res.redirect(302, `${FUNCTIONS_BASE}/api/auth/authorize${params ? '?' + params : ''}`);
});
export const authorize = functions.https.onRequest(authorizeShimApp);

// POST https://us-central1-billsplitter-v2.cloudfunctions.net/token
const tokenShimApp = express();
tokenShimApp.use(cors({ origin: true }));
tokenShimApp.use(express.json());
tokenShimApp.use(express.urlencoded({ extended: true }));
tokenShimApp.post('*', async (req, res) => {
  try {
    const response = await fetch(`${FUNCTIONS_BASE}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json() as object;
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Token shim error:', err);
    res.status(502).json({ error: 'token_proxy_error' });
  }
});
export const token = functions.https.onRequest(tokenShimApp);

import { Router } from 'express';
import { auth } from '../config/firebase';

const router = Router();

// In-memory store for pending OAuth states (maps our state → Claude's original redirect_uri + state)
// Fine for stateless Cloud Functions since the callback happens within seconds.
const pendingStates = new Map<string, { claudeRedirectUri: string; claudeState: string; codeVerifier?: string }>();

const getSelfBaseUrl = (req: any): string => {
  const host = req.get('host');
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  return `${proto}://${host}/api`;
};

// OAuth 2.0 Authorization endpoint for Claude Desktop
// Claude Desktop calls this with its own redirect_uri (e.g. claude://...).
// We proxy through Google using our own server-side callback URL so that
// Google never sees the custom claude:// scheme it would reject.
router.get('/authorize', (req, res) => {
  const clientId = process.env.OAUTH_CLIENT_ID;
  const claudeRedirectUri = String(req.query.redirect_uri || '');
  const claudeState = String(req.query.state || '');
  const scope = String(req.query.scope || 'openid email profile');
  const responseType = String(req.query.response_type || 'code');

  if (!clientId || !claudeRedirectUri) {
    return res.status(400).json({ error: 'OAuth configuration missing' });
  }

  // Generate a new state that maps back to Claude's original redirect_uri + state
  const ourState = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  pendingStates.set(ourState, { claudeRedirectUri, claudeState });
  // Clean up after 10 minutes
  setTimeout(() => pendingStates.delete(ourState), 10 * 60 * 1000);

  const selfBase = getSelfBaseUrl(req);
  const ourCallbackUri = `${selfBase}/auth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: ourCallbackUri,
    response_type: responseType,
    scope,
    access_type: 'offline',
    prompt: 'consent',
    state: ourState,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.redirect(authUrl);
});

// OAuth 2.0 Callback — Google redirects here, we forward to Claude Desktop
router.get('/callback', async (req, res) => {
  const code = String(req.query.code || '');
  const ourState = String(req.query.state || '');
  const error = String(req.query.error || '');

  const pending = pendingStates.get(ourState);
  if (!pending) {
    return res.status(400).send('Invalid or expired OAuth state');
  }
  pendingStates.delete(ourState);

  const { claudeRedirectUri, claudeState } = pending;

  if (error) {
    const params = new URLSearchParams({ error });
    if (claudeState) params.set('state', claudeState);
    return res.redirect(`${claudeRedirectUri}?${params.toString()}`);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  // Exchange code for tokens server-side so we can get an id_token to return to Claude
  try {
    const clientId = process.env.OAUTH_CLIENT_ID!;
    const clientSecret = process.env.OAUTH_CLIENT_SECRET || '';
    const selfBase = getSelfBaseUrl(req);
    const ourCallbackUri = `${selfBase}/auth/callback`;

    const body = new URLSearchParams({
      client_id: clientId,
      redirect_uri: ourCallbackUri,
      grant_type: 'authorization_code',
      code,
    });
    if (clientSecret) body.set('client_secret', clientSecret);

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const tokenJson: any = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', tokenJson);
      const params = new URLSearchParams({ error: 'token_exchange_failed' });
      if (claudeState) params.set('state', claudeState);
      return res.redirect(`${claudeRedirectUri}?${params.toString()}`);
    }

    // Pass the id_token back to Claude Desktop as the access_token
    // (our MCP middleware validates it via verifyIdToken / getTokenInfo)
    const accessToken = tokenJson.id_token || tokenJson.access_token;

    const callbackParams = new URLSearchParams({ code: accessToken });
    if (claudeState) callbackParams.set('state', claudeState);
    return res.redirect(`${claudeRedirectUri}?${callbackParams.toString()}`);
  } catch (err) {
    console.error('Callback error:', err);
    const params = new URLSearchParams({ error: 'server_error' });
    if (claudeState) params.set('state', claudeState);
    return res.redirect(`${claudeRedirectUri}?${params.toString()}`);
  }
});

// OAuth 2.0 Token endpoint for Claude Desktop
// Claude will call this to exchange the code (id_token) it got from /callback.
// We just echo the token back since it's already a valid Google id_token.
router.post('/token', async (req, res) => {
  try {
    const clientId = process.env.OAUTH_CLIENT_ID;
    const clientSecret = process.env.OAUTH_CLIENT_SECRET || '';

    const { grant_type, code, redirect_uri, refresh_token } = req.body;

    if (!clientId) {
      return res.status(500).json({ error: 'OAuth not configured' });
    }

    // If the "code" looks like a JWT (id_token we passed back via /callback),
    // return it directly as the access_token — no second exchange needed.
    if (grant_type !== 'refresh_token' && code && String(code).split('.').length === 3) {
      return res.json({
        access_token: code,
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }

    const body = new URLSearchParams();
    body.set('client_id', clientId);
    if (clientSecret) {
      body.set('client_secret', clientSecret);
    }
    body.set('grant_type', grant_type || 'authorization_code');

    if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        return res.status(400).json({ error: 'refresh_token is required' });
      }
      body.set('refresh_token', String(refresh_token));
    } else {
      if (!code || !redirect_uri) {
        return res.status(400).json({ error: 'code and redirect_uri are required' });
      }
      body.set('code', String(code));
      body.set('redirect_uri', String(redirect_uri));
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const tokenJson = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res.status(tokenResponse.status).json(tokenJson);
    }

    res.json(tokenJson);
  } catch (error) {
    console.error('Token error:', error);
    res.status(500).json({ error: 'Token exchange failed' });
  }
});

router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    
    if (!idToken) {
      return res.status(400).json({ error: 'idToken is required' });
    }
    
    const decodedToken = await auth.verifyIdToken(idToken);
    
    res.json({
      firebaseToken: idToken,
      user: {
        uid: decodedToken.uid,
        email: decodedToken.email,
        name: decodedToken.name,
      },
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;

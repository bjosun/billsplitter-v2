import { Router } from 'express';
import * as crypto from 'crypto';
import { auth, db, admin } from '../config/firebase';

const router = Router();

// Firestore-backed state store so all Cloud Function instances share it.
const STATE_COLLECTION = 'oauth_states';

async function saveState(
  state: string,
  data: { claudeRedirectUri: string; claudeState: string; codeChallenge?: string; codeChallengeMethod?: string }
): Promise<void> {
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
  await db.collection(STATE_COLLECTION).doc(state).set({ ...data, expiresAt });
}

async function popState(
  state: string
): Promise<{ claudeRedirectUri: string; claudeState: string; codeChallenge?: string; codeChallengeMethod?: string } | null> {
  const ref = db.collection(STATE_COLLECTION).doc(state);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  await ref.delete();
  // Reject expired states
  if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) return null;
  return data as any;
}

function verifyPkce(codeVerifier: string, codeChallenge: string, method: string): boolean {
  if (method === 'S256') {
    const digest = crypto.createHash('sha256').update(codeVerifier).digest();
    const computed = digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return computed === codeChallenge;
  }
  // plain method
  return codeVerifier === codeChallenge;
}

const getSelfBaseUrl = (req: any): string => {
  const host = req.get('host');
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  return `${proto}://${host}/api`;
};

// OAuth 2.0 Authorization endpoint for Claude Desktop
// Claude Desktop calls this with its own redirect_uri (e.g. claude://...).
// We proxy through Google using our own server-side callback URL so that
// Google never sees the custom claude:// scheme it would reject.
router.get('/authorize', async (req, res) => {
  const clientId = process.env.OAUTH_CLIENT_ID;
  const claudeRedirectUri = String(req.query.redirect_uri || '');
  const claudeState = String(req.query.state || '');
  const scope = String(req.query.scope || 'openid email profile');
  const responseType = String(req.query.response_type || 'code');

  if (!clientId || !claudeRedirectUri) {
    return res.status(400).json({ error: 'OAuth configuration missing' });
  }

  const codeChallenge = String(req.query.code_challenge || '');
  const codeChallengeMethod = String(req.query.code_challenge_method || 'plain');

  // Generate a new state that maps back to Claude's original redirect_uri + state (Firestore-backed)
  const ourState = crypto.randomBytes(16).toString('hex');
  await saveState(ourState, {
    claudeRedirectUri,
    claudeState,
    ...(codeChallenge ? { codeChallenge, codeChallengeMethod } : {}),
  });

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

  const pending = await popState(ourState);
  if (!pending) {
    return res.status(400).send('Invalid or expired OAuth state');
  }

  const { claudeRedirectUri, claudeState } = pending;

  if (error) {
    const separator = claudeRedirectUri.includes('?') ? '&' : '?';
    const params = new URLSearchParams({ error });
    if (claudeState) params.set('state', claudeState);
    return res.redirect(`${claudeRedirectUri}${separator}${params.toString()}`);
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
      const sep = claudeRedirectUri.includes('?') ? '&' : '?';
      const params = new URLSearchParams({ error: 'token_exchange_failed' });
      if (claudeState) params.set('state', claudeState);
      return res.redirect(`${claudeRedirectUri}${sep}${params.toString()}`);
    }

    // Pass the id_token back to Claude Desktop as the access_token
    // (our MCP middleware validates it via verifyIdToken / getTokenInfo)
    const accessToken = tokenJson.id_token || tokenJson.access_token;

    // Store the token mapped to an opaque code so PKCE can be verified at /token
    const opaqueCode = crypto.randomBytes(16).toString('hex');
    await saveState(`code:${opaqueCode}`, {
      claudeRedirectUri,
      claudeState,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
    });
    // Temporarily store the token under the opaque code key
    await db.collection(STATE_COLLECTION).doc(`token:${opaqueCode}`).set({
      accessToken,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
    });

    const separator = claudeRedirectUri.includes('?') ? '&' : '?';
    const callbackParams = new URLSearchParams({ code: opaqueCode });
    if (claudeState) callbackParams.set('state', claudeState);
    return res.redirect(`${claudeRedirectUri}${separator}${callbackParams.toString()}`);
  } catch (err) {
    console.error('Callback error:', err);
    const separator = claudeRedirectUri.includes('?') ? '&' : '?';
    const params = new URLSearchParams({ error: 'server_error' });
    if (claudeState) params.set('state', claudeState);
    return res.redirect(`${claudeRedirectUri}${separator}${params.toString()}`);
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

    if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        return res.status(400).json({ error: 'refresh_token is required' });
      }
      const body = new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: String(refresh_token),
      });
      if (clientSecret) body.set('client_secret', clientSecret);
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const tokenJson: any = await tokenResponse.json();
      if (!tokenResponse.ok) return res.status(tokenResponse.status).json(tokenJson);
      return res.json({ ...tokenJson, token_type: 'Bearer', scope: 'openid email profile' });
    }

    // Authorization code grant — look up the opaque code we stored at /callback
    if (!code) {
      return res.status(400).json({ error: 'code is required' });
    }
    const codeStr = String(code);

    // Legacy path: code is already a raw JWT (old clients)
    if (codeStr.split('.').length === 3) {
      return res.json({
        access_token: codeStr,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid email profile',
      });
    }

    // New path: code is an opaque code, look up stored state + token
    const [stateSnap, tokenSnap] = await Promise.all([
      db.collection(STATE_COLLECTION).doc(`code:${codeStr}`).get(),
      db.collection(STATE_COLLECTION).doc(`token:${codeStr}`).get(),
    ]);

    if (!stateSnap.exists || !tokenSnap.exists) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown or expired code' });
    }

    const stateData = stateSnap.data()!;
    const tokenData = tokenSnap.data()!;

    // Clean up immediately
    await Promise.all([
      stateSnap.ref.delete(),
      tokenSnap.ref.delete(),
    ]);

    // Verify expiry
    if (tokenData.expiresAt?.toMillis() < Date.now()) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Code expired' });
    }

    // Verify PKCE if the original request included a code_challenge
    const { code_verifier } = req.body as { code_verifier?: string };
    if (stateData.codeChallenge) {
      if (!code_verifier) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier required' });
      }
      const valid = verifyPkce(String(code_verifier), stateData.codeChallenge, stateData.codeChallengeMethod || 'S256');
      if (!valid) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
      }
    }

    return res.json({
      access_token: tokenData.accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'openid email profile',
    });
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

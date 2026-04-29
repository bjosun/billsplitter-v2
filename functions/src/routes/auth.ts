import { Router } from 'express';
import { auth } from '../config/firebase';

const router = Router();

// OAuth 2.0 Authorization endpoint for Claude Desktop
router.get('/authorize', (req, res) => {
  const clientId = process.env.OAUTH_CLIENT_ID;
  const redirectUri = String(req.query.redirect_uri || '');
  const state = String(req.query.state || '');
  const scope = String(req.query.scope || 'openid email profile');
  const responseType = String(req.query.response_type || 'code');

  if (!clientId || !redirectUri) {
    return res.status(400).json({ error: 'OAuth configuration missing' });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: responseType,
    scope,
    access_type: 'offline',
    prompt: 'consent',
  });

  if (state) {
    params.set('state', state);
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.redirect(authUrl);
});

// OAuth 2.0 Token endpoint for Claude Desktop
router.post('/token', async (req, res) => {
  try {
    const clientId = process.env.OAUTH_CLIENT_ID;
    const clientSecret = process.env.OAUTH_CLIENT_SECRET || '';

    const { grant_type, code, redirect_uri, refresh_token } = req.body;

    if (!clientId) {
      return res.status(500).json({ error: 'OAuth not configured' });
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

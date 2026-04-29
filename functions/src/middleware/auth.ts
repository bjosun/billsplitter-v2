import { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { auth } from '../config/firebase';

export interface AuthRequest extends Request {
  user?: {
    uid: string;
    email: string;
    name?: string;
  };
}

// Google OAuth 2.0 authentication for Claude Desktop
export const authenticateOAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split('Bearer ')[1];
    const oauthClientId = process.env.OAUTH_CLIENT_ID;

    if (!oauthClientId) {
      return res.status(500).json({ error: 'OAuth not configured' });
    }

    const client = new OAuth2Client(oauthClientId);

    try {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: oauthClientId,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      req.user = {
        uid: payload.sub || payload.email || '',
        email: payload.email || '',
        name: payload.name,
      };

      return next();
    } catch {
      const tokenInfo = await client.getTokenInfo(token);
      const audience = (tokenInfo as any).aud || (tokenInfo as any).audience;

      if (audience && audience !== oauthClientId) {
        return res.status(401).json({ error: 'Invalid token audience' });
      }

      req.user = {
        uid: (tokenInfo as any).sub || (tokenInfo as any).user_id || (tokenInfo as any).email || '',
        email: (tokenInfo as any).email || '',
        name: undefined,
      };

      return next();
    }
  } catch (error) {
    console.error('OAuth auth error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// Firebase Auth for other routes
export const authenticateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(idToken);

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || '',
      name: decodedToken.name,
    };

    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
};

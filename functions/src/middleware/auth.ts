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

// MCP clients use the WWW-Authenticate header to discover the OAuth resource metadata.
const sendUnauthorized = (res: Response, error: string, description?: string) => {
  const host = res.req?.get('host');
  const proto = (res.req?.headers['x-forwarded-proto'] as string) || res.req?.protocol || 'https';
  // Cloud Functions strips `/api` from the path when routing into Express, so we re-add it
  // for the externally-reachable URL that MCP clients will fetch.
  const resourceMetadata = host
    ? `${proto}://${host}/api/.well-known/oauth-protected-resource`
    : undefined;

  const challengeParts = ['Bearer realm="billsplitter-mcp"', `error="${error}"`];
  if (description) {
    challengeParts.push(`error_description="${description}"`);
  }
  if (resourceMetadata) {
    challengeParts.push(`resource_metadata="${resourceMetadata}"`);
  }
  res.setHeader('WWW-Authenticate', challengeParts.join(', '));
  res.status(401).json({ error: description || error });
};

// Google OAuth 2.0 authentication for Claude Desktop
export const authenticateOAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return sendUnauthorized(res, 'invalid_request', 'Missing Bearer token');
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
        return sendUnauthorized(res, 'invalid_token', 'Invalid token');
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
        return sendUnauthorized(res, 'invalid_token', 'Invalid token audience');
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
    return sendUnauthorized(res, 'invalid_token', 'Authentication failed');
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

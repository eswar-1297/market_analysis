// OAuth 2.1 authorization for the /mcp connector, so Claude org connectors can
// let each marketer sign in. We are the authorization server (the MCP SDK's
// router provides the spec-compliant /authorize, /token, /register, and
// metadata endpoints); the actual USER LOGIN is delegated to Microsoft Entra —
// the same identity your dashboard already uses. Only your Entra tenant's users
// (optionally restricted to allowed email domains) can obtain a token.
//
// Two credentials, kept separate: the user's OAuth token only proves "an allowed
// CloudFuze user"; the Google/Ads data credentials never leave the server.

import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'url';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENTS_FILE = path.join(__dirname, '..', 'data', 'mcp-oauth-clients.json');

const MS_REDIRECT = () => `${config.publicUrl}/mcp-oauth/ms-callback`;
const msAuthority = () => `https://login.microsoftonline.com/${config.ms.tenantId}`;

// Signing key for our self-contained tokens (stable across restarts).
const SIGN_KEY = (process.env.MCP_OAUTH_SECRET || `${config.authPass}|${config.ms.clientSecret}|mcp`).trim();

// --- self-contained signed tokens (no server-side session needed) -----------
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SIGN_KEY).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verify(tok, expectTyp) {
  try {
    const [body, sig] = String(tok || '').split('.');
    if (!body || !sig) return null;
    const expect = crypto.createHmac('sha256', SIGN_KEY).update(body).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expect);
    // timingSafeEqual throws on length mismatch — guard so a malformed token
    // returns null (→ 401) instead of throwing (→ 500).
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p.typ !== expectTyp) return null;
    if (!p.exp || Date.now() / 1000 > p.exp) return null;
    return p;
  } catch {
    return null; // any malformed token -> treated as invalid
  }
}

// --- registered clients (Dynamic Client Registration), persisted to disk -----
function loadClients() {
  try {
    return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveClients(map) {
  try {
    fs.mkdirSync(path.dirname(CLIENTS_FILE), { recursive: true });
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(map, null, 2));
  } catch {
    /* best-effort; tokens are self-contained so this only affects re-auth */
  }
}
const clientsStore = {
  getClient(clientId) {
    return loadClients()[clientId];
  },
  registerClient(client) {
    const map = loadClients();
    map[client.client_id] = client;
    saveClients(map);
    return client;
  },
};

// --- short-lived in-memory state for in-flight logins + auth codes -----------
const pendingLogins = new Map(); // loginId -> { clientId, codeChallenge, redirectUri, state, scopes, at }
const authCodes = new Map(); // code -> { clientId, codeChallenge, redirectUri, user, at }
const TEN_MIN = 10 * 60 * 1000;
function sweep(map) {
  const now = Date.now();
  for (const [k, v] of map) if (now - v.at > TEN_MIN) map.delete(k);
}

// --- Microsoft Entra helpers (delegated user login) --------------------------
async function exchangeMsCode(code) {
  const body = new URLSearchParams({
    client_id: config.ms.clientId,
    client_secret: config.ms.clientSecret,
    code,
    redirect_uri: MS_REDIRECT(),
    grant_type: 'authorization_code',
    scope: 'openid profile email',
  });
  const res = await fetch(`${msAuthority()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tokens = await res.json();
  if (!res.ok || !tokens.id_token) throw new Error(tokens.error_description || 'Microsoft token exchange failed.');
  // id_token came directly from Microsoft over TLS in this server-to-server
  // exchange (authenticated with our client secret), so it's trusted as-is.
  return JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
}
function emailAllowed(email) {
  if (!config.ms.allowedDomains.length) return true;
  const e = String(email || '').toLowerCase();
  return config.ms.allowedDomains.some((d) => e.endsWith('@' + d) || e.endsWith('.' + d));
}

// --- the OAuthServerProvider the SDK router calls ----------------------------
export const mcpOAuthProvider = {
  clientsStore,

  // Begin auth: stash Claude's request, send the user to Microsoft to log in.
  async authorize(client, params, res) {
    sweep(pendingLogins);
    const loginId = crypto.randomBytes(16).toString('hex');
    pendingLogins.set(loginId, {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      state: params.state,
      scopes: params.scopes || [],
      at: Date.now(),
    });
    const q = new URLSearchParams({
      client_id: config.ms.clientId,
      response_type: 'code',
      redirect_uri: MS_REDIRECT(),
      response_mode: 'query',
      scope: 'openid profile email',
      state: loginId,
    });
    res.redirect(`${msAuthority()}/oauth2/v2.0/authorize?${q}`);
  },

  // PKCE: hand the SDK the challenge we stored for this code (SDK validates).
  async challengeForAuthorizationCode(client, authorizationCode) {
    const rec = authCodes.get(authorizationCode);
    if (!rec || rec.clientId !== client.client_id) throw new Error('Invalid authorization code.');
    return rec.codeChallenge;
  },

  // Exchange our one-time code for a signed access (+ refresh) token.
  async exchangeAuthorizationCode(client, authorizationCode) {
    const rec = authCodes.get(authorizationCode);
    if (!rec || rec.clientId !== client.client_id) throw new Error('Invalid authorization code.');
    authCodes.delete(authorizationCode); // one-time use
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: sign({ typ: 'access', sub: rec.user, cid: client.client_id, exp: now + 3600 }),
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: sign({ typ: 'refresh', sub: rec.user, cid: client.client_id, exp: now + 30 * 24 * 3600 }),
      scope: 'read',
    };
  },

  async exchangeRefreshToken(client, refreshToken) {
    const p = verify(refreshToken, 'refresh');
    if (!p || p.cid !== client.client_id) throw new Error('Invalid refresh token.');
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: sign({ typ: 'access', sub: p.sub, cid: client.client_id, exp: now + 3600 }),
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: sign({ typ: 'refresh', sub: p.sub, cid: client.client_id, exp: now + 30 * 24 * 3600 }),
      scope: 'read',
    };
  },

  // Validate the Bearer token on every /mcp request (stateless). Throw
  // InvalidTokenError (not a generic Error) so the middleware returns 401 —
  // which prompts the client to refresh — rather than a 500 that breaks it.
  async verifyAccessToken(token) {
    const p = verify(token, 'access');
    if (!p) throw new InvalidTokenError('Invalid or expired access token.');
    return { token, clientId: p.cid, scopes: ['read'], expiresAt: p.exp, extra: { email: p.sub } };
  },
};

// Express route that completes the Microsoft login and hands Claude our code.
export function mountMcpOAuthCallback(app) {
  app.get('/mcp-oauth/ms-callback', async (req, res) => {
    sweep(pendingLogins);
    sweep(authCodes);
    const { code, state, error, error_description } = req.query;
    const pending = state && pendingLogins.get(String(state));
    if (!pending) return res.status(400).send('Sign-in expired or invalid — please reconnect from Claude.');
    pendingLogins.delete(String(state));
    const bounce = (params) => res.redirect(`${pending.redirectUri}?${new URLSearchParams(params)}`);
    if (error) return bounce({ error, error_description: error_description || '', state: pending.state || '' });
    try {
      const claims = await exchangeMsCode(String(code));
      const email = claims.preferred_username || claims.email || claims.upn || '';
      if (!emailAllowed(email)) {
        return bounce({ error: 'access_denied', error_description: 'Account not permitted.', state: pending.state || '' });
      }
      const ourCode = crypto.randomBytes(24).toString('hex');
      authCodes.set(ourCode, {
        clientId: pending.clientId,
        codeChallenge: pending.codeChallenge,
        redirectUri: pending.redirectUri,
        user: email,
        at: Date.now(),
      });
      bounce({ code: ourCode, state: pending.state || '' });
    } catch (e) {
      bounce({ error: 'server_error', error_description: e.message, state: pending.state || '' });
    }
  });
}

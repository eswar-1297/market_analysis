// Shared Google auth for GA4 + Search Console.
// Prefers your own-account OAuth (works with view-only access, no admin needed);
// falls back to a service-account key if that's what you configured instead.

import { google } from 'googleapis';
import { config, hasOAuth } from '../config.js';

export const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
];

let cached;

// Build every plausible decoding of the env value — raw JSON, base64 (with the
// common "+ became space" repair), base64url, and hex — so whatever the host
// did to the value, at least one candidate is the real JSON.
function decodeCandidates(rawInput) {
  let raw = (rawInput || '').trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  const out = [];
  if (raw.startsWith('{')) out.push(raw); // raw JSON

  const noWs = raw.replace(/\s+/g, '');
  // hex (only 0-9a-f, immune to URL/form mangling)
  if (/^[0-9a-fA-F]+$/.test(noWs) && noWs.length % 2 === 0) {
    try { out.push(Buffer.from(noWs, 'hex').toString('utf8')); } catch {}
  }
  // standard base64 (restore '+' that hosts turn into spaces)
  const b64 = raw.replace(/ /g, '+').replace(/[\r\n\t]+/g, '');
  try { out.push(Buffer.from(b64, 'base64').toString('utf8')); } catch {}
  // base64url -> standard base64
  try { out.push(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch {}
  return out;
}

function loadInlineCredentials() {
  for (const text of decodeCandidates(config.googleCredentialsB64)) {
    if (!text || !text.trim().startsWith('{')) continue;
    try {
      const creds = JSON.parse(text);
      if (creds.private_key && creds.private_key.includes('\\n')) {
        creds.private_key = creds.private_key.replace(/\\n/g, '\n');
      }
      if (creds.client_email && creds.private_key) return creds; // looks valid
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    'Could not parse service-account credentials. The value in GOOGLE_CREDENTIALS_B64 / ' +
      'GOOGLE_CREDENTIALS_JSON appears incomplete or altered by the host. Paste the COMPLETE ' +
      'raw JSON (GOOGLE_CREDENTIALS_JSON) — that is the most reliable — or the full base64.'
  );
}

export function getGoogleAuth() {
  if (cached) return cached;
  if (hasOAuth) {
    const client = new google.auth.OAuth2(config.oauth.clientId, config.oauth.clientSecret);
    client.setCredentials({ refresh_token: config.oauth.refreshToken });
    cached = client;
  } else if (config.googleCredentialsB64) {
    // Inline service-account JSON — deployment-friendly, no key file needed.
    cached = new google.auth.GoogleAuth({ credentials: loadInlineCredentials(), scopes: SCOPES });
  } else {
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS (service-account key file).
    cached = new google.auth.GoogleAuth({ scopes: SCOPES });
  }
  return cached;
}

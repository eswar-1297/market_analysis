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

// Parse inline service-account credentials robustly — tolerant of the common
// ways env values get mangled on hosting platforms.
function loadInlineCredentials() {
  let raw = config.googleCredentialsB64.trim();
  // Strip accidental surrounding quotes some platforms add.
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  // Raw JSON pasted directly, or base64 — auto-detect.
  let text;
  if (raw.startsWith('{')) {
    text = raw;
  } else {
    // Some hosts turn base64 '+' into ' ' (URL/form decoding) and insert line
    // breaks — undo both before decoding, and support base64url ('-' '_').
    const clean = raw
      .replace(/[\r\n\t]+/g, '')
      .replace(/ /g, '+')
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    text = Buffer.from(clean, 'base64').toString('utf8');
  }
  let creds;
  try {
    creds = JSON.parse(text);
  } catch (e) {
    throw new Error(
      'Could not parse service-account credentials. Set GOOGLE_CREDENTIALS_B64 to the ' +
        'COMPLETE base64 of the JSON key (or GOOGLE_CREDENTIALS_JSON to the raw JSON). ' +
        'Original error: ' + e.message
    );
  }
  // If raw JSON was used, the private key may have escaped newlines — fix them.
  if (creds.private_key && creds.private_key.includes('\\n')) {
    creds.private_key = creds.private_key.replace(/\\n/g, '\n');
  }
  return creds;
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

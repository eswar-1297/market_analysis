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

export function getGoogleAuth() {
  if (cached) return cached;
  if (hasOAuth) {
    const client = new google.auth.OAuth2(config.oauth.clientId, config.oauth.clientSecret);
    client.setCredentials({ refresh_token: config.oauth.refreshToken });
    cached = client;
  } else if (config.googleCredentialsB64) {
    // Inline service-account JSON (base64) — deployment-friendly, no key file.
    const creds = JSON.parse(Buffer.from(config.googleCredentialsB64, 'base64').toString('utf8'));
    cached = new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
  } else {
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS (service-account key file).
    cached = new google.auth.GoogleAuth({ scopes: SCOPES });
  }
  return cached;
}

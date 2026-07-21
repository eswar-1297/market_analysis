// One-time OAuth sign-in. Run:  npm run auth
// Signs you into your OWN Google account (which already has view access to
// GA4 + Search Console) and saves a refresh token into .env. No admin needed.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { google } from 'googleapis';
import { config } from './config.js';
import { SCOPES } from './connectors/googleAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '..', '.env');
const PORT = 5555;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;

if (!config.oauth.clientId || !config.oauth.clientSecret) {
  console.error(
    '\n  Missing OAuth client. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET\n' +
      '  in .env first (create an OAuth client of type "Web application" in Google\n' +
      `  Cloud Console, and add this redirect URI:  ${REDIRECT}\n`
  );
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(config.oauth.clientId, config.oauth.clientSecret, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force a refresh_token every time
  scope: SCOPES,
});

function writeRefreshToken(token) {
  let env = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  if (/^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m.test(env)) {
    env = env.replace(/^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m, `GOOGLE_OAUTH_REFRESH_TOKEN=${token}`);
  } else {
    env += `\nGOOGLE_OAUTH_REFRESH_TOKEN=${token}\n`;
  }
  fs.writeFileSync(ENV_FILE, env);
}

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) {
    res.writeHead(404);
    return res.end();
  }
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error('No refresh token returned. Revoke prior access at myaccount.google.com/permissions and retry.');
    }
    writeRefreshToken(tokens.refresh_token);
    res.end('<h2>Success ✔</h2><p>Refresh token saved to .env. You can close this tab and return to the terminal.</p>');
    console.log('\n  ✓ Refresh token saved to .env');
    console.log('  Now run:  npm run check   (should show GA4 + Search Console connected)\n');
  } catch (e) {
    res.end(`Error: ${e.message}`);
    console.error('\n  ✗ ' + e.message + '\n');
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 300);
  }
});

server.listen(PORT, () => {
  console.log('\n  Opening Google sign-in in your browser…');
  console.log('  If it does not open, paste this URL manually:\n');
  console.log('  ' + authUrl + '\n');
  const opener =
    process.platform === 'win32' ? `start "" "${authUrl}"` : process.platform === 'darwin' ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
  exec(opener, () => {});
});

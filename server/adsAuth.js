// One-time Google Ads OAuth sign-in. Run:  npm run ads-auth
// Signs you into the Google account that can see the Ads campaigns and saves a
// GOOGLE_ADS_REFRESH_TOKEN into .env. Needs GOOGLE_ADS_CLIENT_ID and
// GOOGLE_ADS_CLIENT_SECRET set first (a "Desktop app" OAuth client is fine).

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { google } from 'googleapis';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '..', '.env');
const PORT = 5556;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = 'https://www.googleapis.com/auth/adwords';

if (!config.ads.clientId || !config.ads.clientSecret) {
  console.error(
    '\n  Missing OAuth client. Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET\n' +
      '  in .env first (create an OAuth client in Google Cloud Console — type\n' +
      `  "Desktop app" — and add this redirect URI:  ${REDIRECT}\n`
  );
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(config.ads.clientId, config.ads.clientSecret, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force a refresh_token every time
  scope: [SCOPE],
});

function writeRefreshToken(token) {
  let env = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  if (/^GOOGLE_ADS_REFRESH_TOKEN=.*$/m.test(env)) {
    env = env.replace(/^GOOGLE_ADS_REFRESH_TOKEN=.*$/m, `GOOGLE_ADS_REFRESH_TOKEN=${token}`);
  } else {
    env += `\nGOOGLE_ADS_REFRESH_TOKEN=${token}\n`;
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
    res.end('<h2>Success ✔</h2><p>GOOGLE_ADS_REFRESH_TOKEN saved to .env. You can close this tab and return to the terminal.</p>');
    console.log('\n  ✓ GOOGLE_ADS_REFRESH_TOKEN saved to .env');
    console.log('  Make sure these are also set in .env:');
    console.log('    GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID, and (if via a manager) GOOGLE_ADS_LOGIN_CUSTOMER_ID');
    console.log('  Then restart the server:  pm2 restart marketing-dashboard\n');
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
  console.log('  Sign in as the account that can see the Ads campaigns.');
  console.log('  If it does not open, paste this URL manually:\n');
  console.log('  ' + authUrl + '\n');
  const opener =
    process.platform === 'win32' ? `start "" "${authUrl}"` : process.platform === 'darwin' ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
  exec(opener, () => {});
});

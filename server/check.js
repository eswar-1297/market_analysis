// Credential checker. Run `npm run check` after editing .env.
// Tries a real call to each configured source against one real page and
// reports connect / error, so you know exactly what's working.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, sources } from './config.js';
import { toISO } from './services/dates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const combos = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'combinations.json'), 'utf8')
);
const testUrl = combos.combinations[0].pages[0].url;

const end = new Date();
end.setUTCDate(end.getUTCDate() - 2);
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - 6);
const S = toISO(start);
const E = toISO(end);

const ok = (m) => `  \x1b[32m✓\x1b[0m ${m}`;
const bad = (m) => `  \x1b[31m✗\x1b[0m ${m}`;
const skip = (m) => `  \x1b[33m–\x1b[0m ${m}`;

console.log(`\nCredential check — test page: ${testUrl}`);
console.log(`Window: ${S} → ${E}\n`);

async function run() {
  // GA4
  if (sources.ga4) {
    try {
      const { ga4Page } = await import('./connectors/ga4.js');
      const rows = await ga4Page(testUrl, S, E, 'US');
      const total = rows.reduce((a, r) => a + r.sessions, 0);
      console.log(ok(`GA4 connected — property ${config.ga4PropertyId} — ${total} US sessions on test page`));
    } catch (e) {
      console.log(bad(`GA4 failed: ${e.message}`));
    }
  } else {
    console.log(skip('GA4 not configured (set GA4_PROPERTY_ID, then run `npm run auth`)'));
  }

  // Search Console
  if (sources.searchConsole) {
    try {
      const { searchConsolePage } = await import('./connectors/searchConsole.js');
      const rows = await searchConsolePage(testUrl, S, E, 'US');
      const clicks = rows.reduce((a, r) => a + r.clicks, 0);
      console.log(ok(`Search Console connected — ${config.scSiteUrl} — ${clicks} US clicks on test page`));
    } catch (e) {
      console.log(bad(`Search Console failed: ${e.message}`));
    }
  } else {
    console.log(skip('Search Console not configured (set SEARCH_CONSOLE_SITE_URL, then run `npm run auth`)'));
  }

  // PageSpeed
  if (sources.pagespeed) {
    try {
      const { pagespeedPage } = await import('./connectors/pagespeed.js');
      const d = await pagespeedPage(testUrl);
      console.log(ok(`PageSpeed connected — LCP ${d.lcp}ms, INP ${d.inp}ms, CLS ${d.cls} (${d.source} data)`));
    } catch (e) {
      console.log(bad(`PageSpeed failed: ${e.message}`));
    }
  } else {
    console.log(skip('PageSpeed not configured (set PAGESPEED_API_KEY)'));
  }

  // Google Ads
  if (sources.ads) {
    try {
      const { adsPage } = await import('./connectors/googleAds.js');
      const rows = await adsPage(testUrl, S, E, 'US');
      const clicks = rows.reduce((a, r) => a + r.clicks, 0);
      console.log(ok(`Google Ads connected — customer ${config.ads.customerId} — ${clicks} clicks on test page`));
    } catch (e) {
      console.log(bad(`Google Ads failed: ${e.message}`));
    }
  } else {
    console.log(skip('Google Ads not configured (set GOOGLE_ADS_* values)'));
  }

  const liveCount = Object.values(sources).filter(Boolean).length;
  console.log(
    `\n${liveCount === 0 ? '\x1b[33m' : '\x1b[32m'}${liveCount}/4 sources configured\x1b[0m.` +
      ` The dashboard uses real data for connected sources and sample data for the rest.\n`
  );
}

run();

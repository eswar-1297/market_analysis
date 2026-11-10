// Orchestrates data retrieval for a single page across all four sources.
// Every source independently uses REAL data when its credentials exist,
// otherwise deterministic sample data. Live calls that fail fall back to
// sample data and record the error so the UI can flag it.

import { modeFor } from '../config.js';
import { mockPage } from '../connectors/mock.js';
import { ga4Page, ga4PageUsers, ga4PageEngagement } from '../connectors/ga4.js';
import { searchConsolePage } from '../connectors/searchConsole.js';
import { adsPage } from '../connectors/googleAds.js';

// Reduce an error to a short summary — API failures (e.g. Google 502) can carry
// an entire HTML error page as the message; we don't want that in the payload.
function summarizeError(err) {
  const s = String(err?.message || err || '');
  const title = s.match(/<title>([^<]+)<\/title>/i);
  let t = title ? title[1] : s.replace(/<[^>]+>/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > 200 ? t.slice(0, 200) + '…' : t;
}

async function withFallback(source, liveFn, fallback, errors) {
  if (modeFor(source) !== 'live') return { data: fallback, mode: 'sample' };
  try {
    return { data: await liveFn(), mode: 'live' };
  } catch (err) {
    errors[source] = summarizeError(err);
    return { data: fallback, mode: 'sample-fallback' };
  }
}

export async function fetchPageAll(page, start, end, country = 'US', includeViews = false) {
  const url = page.url;
  const sample = mockPage(url, start, end, country);
  const errors = {};

  // Core Web Vitals are deliberately NOT fetched here — those PageSpeed calls
  // are slow (10-30s/page) and would block the whole view. The UI loads CWV
  // lazily per page via /api/cwv instead.
  const [ga4, sc, ads] = await Promise.all([
    withFallback('ga4', () => ga4Page(url, start, end, country), sample.ga4, errors),
    withFallback('searchConsole', () => searchConsolePage(url, start, end, country), sample.searchConsole, errors),
    withFallback('ads', () => adsPage(url, start, end, country), sample.ads, errors),
  ]);

  // Active users + bounce rate — fetched per period for the table + comparison.
  // Both are pagePath-scoped to match GA4's Pages report. `pageSessions` comes
  // along as the bounce-rate weight (see ga4PageUsers); it is never displayed.
  //
  // The two reports stay SEPARATE, each with its own catch: the GA4 Data API
  // rejects a whole report on one bad metric, so merging them would mean a
  // failure in either metric silently blanks both columns at once.
  let activeUsers = null;
  let pageSessions = null;
  let bounceRate = null;
  if (includeViews) {
    const sSessions = sample.ga4.reduce((a, d) => a + d.sessions, 0);
    const sEng = sample.ga4.reduce((a, d) => a + d.engagementRate, 0) / (sample.ga4.length || 1);
    // Users are de-duplicated over the whole period, so a plausible sample value
    // is well below the session total and must NOT scale linearly with the range
    // the way a per-day ratio would.
    const sampleUsers = Math.round(sSessions * 0.35);
    const sampleBounce = Number((1 - sEng).toFixed(3));
    if (modeFor('ga4') === 'live') {
      const [u, e] = await Promise.all([
        ga4PageUsers(url, start, end, country).catch(() => ({
          activeUsers: sampleUsers,
          pageSessions: sSessions,
        })),
        ga4PageEngagement(url, start, end, country).catch(() => ({ bounceRate: sampleBounce })),
      ]);
      activeUsers = u.activeUsers;
      pageSessions = u.pageSessions;
      bounceRate = e.bounceRate;
    } else {
      activeUsers = sampleUsers;
      pageSessions = sSessions;
      bounceRate = sampleBounce;
    }
  }

  return {
    url,
    label: page.label,
    ga4: ga4.data,
    searchConsole: sc.data,
    ads: ads.data,
    activeUsers,
    // Weight for averaging bounce rate across a set of pages. Named apart from
    // the landingPage-scoped `sessions` in the ga4 series above, which counts
    // entries rather than every session that touched the page.
    pageSessions,
    bounceRate,
    modes: { ga4: ga4.mode, searchConsole: sc.mode, ads: ads.mode },
    errors,
  };
}

export async function fetchCombinationPages(pages, start, end, country = 'US', includeViews = false) {
  return Promise.all(pages.map((p) => fetchPageAll(p, start, end, country, includeViews)));
}

// Orchestrates data retrieval for a single page across all four sources.
// Every source independently uses REAL data when its credentials exist,
// otherwise deterministic sample data. Live calls that fail fall back to
// sample data and record the error so the UI can flag it.

import { modeFor } from '../config.js';
import { mockPage } from '../connectors/mock.js';
import { ga4Page, ga4PageViews, ga4PageEngagement } from '../connectors/ga4.js';
import { searchConsolePage } from '../connectors/searchConsole.js';
import { adsPage } from '../connectors/googleAds.js';
import { pageAuthor } from '../connectors/authors.js';

async function withFallback(source, liveFn, fallback, errors) {
  if (modeFor(source) !== 'live') return { data: fallback, mode: 'sample' };
  try {
    return { data: await liveFn(), mode: 'live' };
  } catch (err) {
    errors[source] = err.message || String(err);
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

  // Page views (total pageviews) + bounce rate — fetched per period for the
  // table + comparison. Both are pagePath-scoped to match GA4's Pages report.
  let views = null;
  let bounceRate = null;
  let author = null;
  if (includeViews) {
    const sSessions = sample.ga4.reduce((a, d) => a + d.sessions, 0);
    const sEng = sample.ga4.reduce((a, d) => a + d.engagementRate, 0) / (sample.ga4.length || 1);
    const sampleViews = Math.round(sSessions * 1.4);
    const sampleBounce = Number((1 - sEng).toFixed(3));
    if (modeFor('ga4') === 'live') {
      const [v, e] = await Promise.all([
        ga4PageViews(url, start, end, country).catch(() => sampleViews),
        ga4PageEngagement(url, start, end, country).catch(() => ({ bounceRate: sampleBounce })),
      ]);
      views = v;
      bounceRate = e.bounceRate;
    } else {
      views = sampleViews;
      bounceRate = sampleBounce;
    }
    author = await pageAuthor(url); // scraped once, cached
  }

  return {
    url,
    label: page.label,
    ga4: ga4.data,
    searchConsole: sc.data,
    ads: ads.data,
    views,
    bounceRate,
    author,
    modes: { ga4: ga4.mode, searchConsole: sc.mode, ads: ads.mode },
    errors,
  };
}

export async function fetchCombinationPages(pages, start, end, country = 'US', includeViews = false) {
  return Promise.all(pages.map((p) => fetchPageAll(p, start, end, country, includeViews)));
}

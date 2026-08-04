// Aggregated overview across ALL combinations. Uses a few batch queries (not
// per-page) so the default landing view loads fast:
//   - GA4 (pagePath): views + bounce rate
//   - Search Console (page): clicks, impressions, position
//   - HubSpot: leads (mandatory contacts bucketed by source->destination combo)
// Then rolls each page up to its combination.

import { google } from 'googleapis';
import { config, modeFor } from '../config.js';
import { getGoogleAuth } from '../connectors/googleAuth.js';
import { ga4Country, scCountry, countryWeight } from '../regions.js';
import { mockPage } from '../connectors/mock.js';
import { getLeadsByCombo } from '../connectors/hubspot.js';

const analyticsdata = google.analyticsdata('v1beta');

// GA4 / Search Console occasionally return a transient error (400
// "invalid argument", 429, 5xx) even for a valid query — retry with backoff so
// a momentary hiccup doesn't drop the whole overview to sample data.
async function withRetry(fn, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
  throw lastErr;
}

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
function blankAgg() {
  return { views: 0, clicks: 0, impressions: 0, posW: 0, posI: 0, bounceW: 0, bounceV: 0 };
}
function finalize(combos, agg) {
  return combos.map((c) => {
    const a = agg[c.id] || blankAgg();
    return {
      id: c.id,
      name: c.name,
      pageCount: c.pages.length,
      position: a.posI ? Number((a.posW / a.posI).toFixed(1)) : 0,
      impressions: Math.round(a.impressions),
      clicks: Math.round(a.clicks),
      views: Math.round(a.views),
      bounceRate: a.bounceV ? Number((a.bounceW / a.bounceV).toFixed(3)) : 0,
      leads: 0, // filled in by getOverview from HubSpot
    };
  });
}

export async function overviewLive(combos, start, end, country = 'US') {
  const auth = getGoogleAuth();
  const property = `properties/${config.ga4PropertyId}`;

  // url/path -> combination id maps
  const urlToCombo = {};
  const pathToCombo = {};
  const allPaths = new Set();
  for (const c of combos) {
    for (const pg of c.pages) {
      urlToCombo[pg.url] = c.id;
      const pth = pathOf(pg.url);
      pathToCombo[pth] = c.id;
      allPaths.add(pth);
    }
  }

  const geo = country && country !== 'ALL' ? [{ filter: { fieldName: 'countryId', stringFilter: { matchType: 'EXACT', value: ga4Country(country) } } }] : [];
  const withGeo = (pageFilter) => (geo.length ? { andGroup: { expressions: [pageFilter, ...geo] } } : pageFilter);

  const ga4A = withRetry(() =>
    analyticsdata.properties.runReport({
      auth,
      property,
      requestBody: {
        dateRanges: [{ startDate: start, endDate: end }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'bounceRate' }],
        dimensionFilter: withGeo({ filter: { fieldName: 'pagePath', inListFilter: { values: [...allPaths] } } }),
        limit: 1000,
      },
    })
  );

  // Search Console (one query, filter to our pages in code).
  const webmasters = google.searchconsole({ version: 'v1', auth });
  const scFilters = [{ dimension: 'page', operator: 'includingRegex', expression: '.*' }];
  const cc = country && country !== 'ALL' ? scCountry(country) : null;
  if (cc) scFilters.push({ dimension: 'country', operator: 'equals', expression: cc });
  const scReq = withRetry(() =>
    webmasters.searchanalytics.query({
      siteUrl: config.scSiteUrl,
      requestBody: { startDate: start, endDate: end, dimensions: ['page'], dimensionFilterGroups: [{ filters: scFilters }], rowLimit: 25000 },
    })
  );

  const [aRes, scRes] = await Promise.all([ga4A, scReq]);

  const agg = {};
  const bump = (id) => (agg[id] = agg[id] || blankAgg());

  for (const row of aRes.data.rows || []) {
    const id = pathToCombo[row.dimensionValues[0].value];
    if (!id) continue;
    const a = bump(id);
    const views = Number(row.metricValues[0].value || 0);
    const bounce = Number(row.metricValues[1].value || 0);
    a.views += views;
    a.bounceW += bounce * views;
    a.bounceV += views;
  }
  for (const row of scRes.data.rows || []) {
    const id = urlToCombo[row.keys[0]];
    if (!id) continue;
    const a = bump(id);
    const impr = row.impressions || 0;
    a.clicks += row.clicks || 0;
    a.impressions += impr;
    a.posW += (row.position || 0) * impr;
    a.posI += impr;
  }
  return finalize(combos, agg);
}

export function overviewMock(combos, start, end, country = 'US') {
  const w = countryWeight(country);
  const agg = {};
  for (const c of combos) {
    const a = blankAgg();
    for (const pg of c.pages) {
      const m = mockPage(pg.url, start, end, country);
      const sessions = m.ga4.reduce((s, d) => s + d.sessions, 0);
      const eng = m.ga4.reduce((s, d) => s + d.engagementRate, 0) / (m.ga4.length || 1);
      const clicks = m.searchConsole.reduce((s, d) => s + d.clicks, 0);
      const impr = m.searchConsole.reduce((s, d) => s + d.impressions, 0);
      const posAvg = m.searchConsole.reduce((s, d) => s + d.position, 0) / (m.searchConsole.length || 1);
      const views = Math.round(sessions * 1.4);
      a.views += views;
      a.clicks += clicks;
      a.impressions += impr;
      a.posW += posAvg * impr;
      a.posI += impr;
      a.bounceW += (1 - eng) * views;
      a.bounceV += views;
    }
    agg[c.id] = a;
  }
  return finalize(combos, agg);
}

// See aggregate.js pctChange: counts treat a zero baseline as a multiple
// (0 -> 3 = 300%), rates/averages show no delta when there is no baseline.
function pctChange(cur, prev, lowerIsBetter = false, isRate = false) {
  if (!cur && !prev) return null;
  if (prev === 0 && isRate) return null;
  let pct = prev === 0 ? cur * 100 : ((cur - prev) / prev) * 100;
  pct = Math.round(pct) || 0; // normalize -0 (and NaN) to 0
  const eff = lowerIsBetter ? -pct : pct;
  return { pct, dir: eff > 0 ? 'up' : eff < 0 ? 'down' : 'flat' };
}

// Attach per-combination deltas (current vs a comparison period's rows).
export function withDeltas(curRows, prevRows) {
  const prevById = {};
  for (const r of prevRows) prevById[r.id] = r;
  return curRows.map((r) => {
    const p = prevById[r.id] || {};
    return {
      ...r,
      deltas: {
        position: pctChange(r.position, p.position || 0, true, true), // average
        impressions: pctChange(r.impressions, p.impressions || 0),
        clicks: pctChange(r.clicks, p.clicks || 0),
        views: pctChange(r.views, p.views || 0),
        bounceRate: pctChange(r.bounceRate, p.bounceRate || 0, true, true), // rate
        leads: pctChange(r.leads, p.leads || 0),
        ppcLeads: pctChange(r.ppcLeads, p.ppcLeads || 0),
      },
    };
  });
}

export async function getOverview(combos, start, end, country) {
  // GA4/Search Console rows (views, bounce, clicks, impressions, position).
  let rows;
  let source;
  let gaError;
  if (modeFor('ga4') === 'live') {
    try {
      rows = await overviewLive(combos, start, end, country);
      source = 'live';
    } catch (e) {
      rows = overviewMock(combos, start, end, country);
      source = 'sample-fallback';
      gaError = e.message;
    }
  } else {
    rows = overviewMock(combos, start, end, country);
    source = 'sample';
  }

  // Leads come from HubSpot and fail independently of GA4 — a HubSpot outage
  // must not blank out the Google metrics (and vice-versa).
  const leads = await getLeadsByCombo(combos, start, end, country);
  for (const r of rows) r.leads = Math.round(leads.byId[r.id]?.total || 0);

  return { rows, source, error: gaError, leadsSource: leads.source, leadsError: leads.error };
}

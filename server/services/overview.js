// Aggregated overview across ALL combinations. Uses a few batch queries (not
// per-page) so the default landing view loads fast:
//   - GA4 (pagePath): views + bounce rate
//   - GA4 (landingPage): conversions (key events)
//   - Search Console (page): clicks, impressions, position
// Then rolls each page up to its combination.

import { google } from 'googleapis';
import { config, modeFor } from '../config.js';
import { getGoogleAuth } from '../connectors/googleAuth.js';
import { ga4Country, scCountry, countryWeight } from '../regions.js';
import { mockPage } from '../connectors/mock.js';

const analyticsdata = google.analyticsdata('v1beta');

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
function landingVariants(url) {
  const p = pathOf(url);
  const noSlash = p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  const withSlash = noSlash === '/' ? '/' : noSlash + '/';
  return [...new Set([noSlash, withSlash])];
}

function blankAgg() {
  return { views: 0, clicks: 0, impressions: 0, conversions: 0, posW: 0, posI: 0, bounceW: 0, bounceV: 0 };
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
      conversions: Math.round(a.conversions),
    };
  });
}

export async function overviewLive(combos, start, end, country = 'US') {
  const auth = getGoogleAuth();
  const property = `properties/${config.ga4PropertyId}`;

  // url/path -> combination id maps
  const urlToCombo = {};
  const pathToCombo = {};
  const landingToCombo = {};
  const allPaths = new Set();
  const allLanding = new Set();
  for (const c of combos) {
    for (const pg of c.pages) {
      urlToCombo[pg.url] = c.id;
      const pth = pathOf(pg.url);
      pathToCombo[pth] = c.id;
      allPaths.add(pth);
      for (const v of landingVariants(pg.url)) {
        landingToCombo[v] = c.id;
        allLanding.add(v);
      }
    }
  }

  const geo = country && country !== 'ALL' ? [{ filter: { fieldName: 'countryId', stringFilter: { matchType: 'EXACT', value: ga4Country(country) } } }] : [];
  const withGeo = (pageFilter) => (geo.length ? { andGroup: { expressions: [pageFilter, ...geo] } } : pageFilter);

  const ga4A = analyticsdata.properties.runReport({
    auth,
    property,
    requestBody: {
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'bounceRate' }],
      dimensionFilter: withGeo({ filter: { fieldName: 'pagePath', inListFilter: { values: [...allPaths] } } }),
      limit: 1000,
    },
  });
  const ga4B = analyticsdata.properties.runReport({
    auth,
    property,
    requestBody: {
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'keyEvents' }],
      dimensionFilter: withGeo({ filter: { fieldName: 'landingPage', inListFilter: { values: [...allLanding] } } }),
      limit: 1000,
    },
  });

  // Search Console (one query, filter to our pages in code).
  const webmasters = google.searchconsole({ version: 'v1', auth });
  const scFilters = [{ dimension: 'page', operator: 'includingRegex', expression: '.*' }];
  const cc = country && country !== 'ALL' ? scCountry(country) : null;
  if (cc) scFilters.push({ dimension: 'country', operator: 'equals', expression: cc });
  const scReq = webmasters.searchanalytics.query({
    siteUrl: config.scSiteUrl,
    requestBody: { startDate: start, endDate: end, dimensions: ['page'], dimensionFilterGroups: [{ filters: scFilters }], rowLimit: 25000 },
  });

  const [aRes, bRes, scRes] = await Promise.all([ga4A, ga4B, scReq]);

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
  for (const row of bRes.data.rows || []) {
    const id = landingToCombo[row.dimensionValues[0].value];
    if (!id) continue;
    bump(id).conversions += Number(row.metricValues[0].value || 0);
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
      const conv = m.ga4.reduce((s, d) => s + d.conversions, 0);
      const posAvg = m.searchConsole.reduce((s, d) => s + d.position, 0) / (m.searchConsole.length || 1);
      const views = Math.round(sessions * 1.4);
      a.views += views;
      a.clicks += clicks;
      a.impressions += impr;
      a.conversions += conv;
      a.posW += posAvg * impr;
      a.posI += impr;
      a.bounceW += (1 - eng) * views;
      a.bounceV += views;
    }
    agg[c.id] = a;
  }
  return finalize(combos, agg);
}

function pctChange(cur, prev, lowerIsBetter = false) {
  if (!cur && !prev) return null;
  let pct = prev === 0 ? (cur > 0 ? 100 : 0) : ((cur - prev) / prev) * 100;
  pct = Math.round(pct);
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
        position: pctChange(r.position, p.position || 0, true),
        impressions: pctChange(r.impressions, p.impressions || 0),
        clicks: pctChange(r.clicks, p.clicks || 0),
        views: pctChange(r.views, p.views || 0),
        bounceRate: pctChange(r.bounceRate, p.bounceRate || 0, true),
        conversions: pctChange(r.conversions, p.conversions || 0),
      },
    };
  });
}

export async function getOverview(combos, start, end, country) {
  if (modeFor('ga4') === 'live') {
    try {
      return { rows: await overviewLive(combos, start, end, country), source: 'live' };
    } catch (e) {
      return { rows: overviewMock(combos, start, end, country), source: 'sample-fallback', error: e.message };
    }
  }
  return { rows: overviewMock(combos, start, end, country), source: 'sample' };
}

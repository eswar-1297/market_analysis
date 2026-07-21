// Deterministic sample-data generator.
// Same URL + same date always produces the same numbers, so the dashboard is
// stable across reloads. Each page gets its own base level and its own trend
// direction (some improving, some declining) so the assessment layer is
// meaningful even before real credentials are connected.

import { dateRange } from '../services/dates.js';
import { countryWeight } from '../regions.js';

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Day-of-week seasonality: weekends dip for B2B pages.
function weekdayFactor(dateStr) {
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return dow === 0 || dow === 6 ? 0.55 : 1;
}

const EPOCH = Date.UTC(2020, 0, 1);
function daysSinceEpoch(dateStr) {
  return Math.round((new Date(dateStr + 'T00:00:00Z') - EPOCH) / 86400000);
}

function seededPage(url, dates, opts) {
  // Seed is country-independent so each region is a consistent SHARE of the
  // global total (US ~= 55% of "All regions"), which matches how real geo
  // splits behave and keeps the filter intuitive.
  const rand = mulberry32(hash(url + opts.key));
  const weight = countryWeight(opts.country);
  const base = (opts.min + rand() * (opts.max - opts.min)) * weight;
  // Trend direction per page (-0.5 declining .. +0.5 improving).
  const trendDir = (hash(url + opts.key + 'trend') % 1000) / 1000 - 0.5;
  // Phase so different pages peak at different times.
  const phase = (hash(url + opts.key + 'phase') % 100) / 100 * Math.PI * 2;
  return dates.map((date) => {
    // Trend is a function of ABSOLUTE calendar time, so consecutive periods
    // genuinely differ (real deltas) and each page rises/falls on its own cycle.
    const t = daysSinceEpoch(date);
    const wave = Math.sin(t / 45 + phase); // ~90-day cycle
    const trend = 1 + trendDir * opts.trendStrength * wave;
    const noise = 0.85 + rand() * 0.3;
    const val = base * Math.max(0.2, trend) * weekdayFactor(date) * noise;
    return { date, value: Math.max(0, val) };
  });
}

export function mockPage(url, start, end, country = 'US') {
  const dates = dateRange(start, end);

  const sessions = seededPage(url, dates, { key: 'sessions', min: 20, max: 600, trendStrength: 0.6, country });
  const convRate = 0.008 + (hash(url + 'cvr') % 100) / 100 * 0.03; // 0.8%..3.8%
  const impr = seededPage(url, dates, { key: 'impr', min: 300, max: 8000, trendStrength: 0.5, country });
  const ctr = 0.01 + (hash(url + 'ctr') % 100) / 100 * 0.06; // 1%..7%
  const position = 3 + (hash(url + 'pos') % 100) / 100 * 25; // 3..28
  const adOn = hash(url + 'adon') % 3 !== 0; // ~2/3 of pages run ads

  const ga4 = sessions.map((s) => ({
    date: s.date,
    sessions: Math.round(s.value),
    users: Math.round(s.value * 0.82),
    conversions: Math.round(s.value * convRate),
    engagementRate: Number((0.4 + (hash(url + s.date) % 100) / 100 * 0.5).toFixed(3)),
  }));

  const searchConsole = impr.map((im, i) => {
    const impressions = Math.round(im.value);
    const clicks = Math.round(impressions * ctr);
    return {
      date: im.date,
      impressions,
      clicks,
      ctr: Number((clicks / Math.max(1, impressions)).toFixed(4)),
      position: Number((position + Math.sin(i / 4) * 1.5).toFixed(1)),
    };
  });

  const adsSeries = seededPage(url, dates, { key: 'ads', min: 5, max: 120, trendStrength: 0.4, country });
  const cpc = 2 + (hash(url + 'cpc') % 100) / 100 * 8; // $2..$10
  const ads = adsSeries.map((a) => {
    const clicks = adOn ? Math.round(a.value) : 0;
    return {
      date: a.date,
      clicks,
      impressions: clicks * (8 + (hash(url + a.date) % 6)),
      cost: Number((clicks * cpc).toFixed(2)),
      conversions: Math.round(clicks * convRate * 1.4),
    };
  });

  // Core Web Vitals (field-style values). Some pages "poor" on purpose.
  const lcp = 1500 + (hash(url + 'lcp') % 100) / 100 * 3500; // 1.5s..5s
  const inp = 120 + (hash(url + 'inp') % 100) / 100 * 500; // 120..620ms
  const cls = (hash(url + 'cls') % 100) / 100 * 0.35; // 0..0.35
  const pagespeed = {
    lcp: Math.round(lcp),
    inp: Math.round(inp),
    cls: Number(cls.toFixed(3)),
    performanceScore: Math.round(40 + (hash(url + 'perf') % 100) / 100 * 55),
    source: 'sample',
  };

  return { ga4, searchConsole, ads, pagespeed };
}

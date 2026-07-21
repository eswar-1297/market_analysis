// Google Analytics 4 (Data API v1beta) connector.
// Returns a daily series per page: sessions, users, conversions, engagementRate.
// Uses shared Google auth (OAuth with your account, or a service account).

import { google } from 'googleapis';
import { config } from '../config.js';
import { dateRange } from '../services/dates.js';
import { ga4Country } from '../regions.js';
import { getGoogleAuth } from './googleAuth.js';

const analyticsdata = google.analyticsdata('v1beta');

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

// GA4's `landingPage` dimension strips the trailing slash, while our URLs keep
// it (and some pages differ). Match BOTH variants so nothing is missed.
function landingVariants(url) {
  const p = pathOf(url);
  const noSlash = p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  const withSlash = noSlash === '/' ? '/' : noSlash + '/';
  return [...new Set([noSlash, withSlash])];
}

// Landing-page attribution: metrics are credited to the page a visitor ENTERED
// the site through, which is the correct lens for assessing lead-gen pages.
// `keyEvents` is GA4's current name for what used to be called "conversions".
export async function ga4Page(url, start, end, country = 'US') {
  const pageFilter = {
    filter: { fieldName: 'landingPage', inListFilter: { values: landingVariants(url) } },
  };
  const dimensionFilter =
    country && country !== 'ALL'
      ? {
          andGroup: {
            expressions: [
              pageFilter,
              { filter: { fieldName: 'countryId', stringFilter: { matchType: 'EXACT', value: ga4Country(country) } } },
            ],
          },
        }
      : pageFilter;

  const resp = await analyticsdata.properties.runReport({
    auth: getGoogleAuth(),
    property: `properties/${config.ga4PropertyId}`,
    requestBody: {
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: 'date' }],
      dimensionFilter,
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'keyEvents' },
        { name: 'engagementRate' },
      ],
    },
  });

  // Index API rows by date, then fill every day in range (0 for missing).
  const byDate = {};
  for (const row of resp.data.rows || []) {
    const raw = row.dimensionValues[0].value; // YYYYMMDD
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    byDate[date] = {
      date,
      sessions: Number(row.metricValues[0].value || 0),
      users: Number(row.metricValues[1].value || 0),
      conversions: Number(row.metricValues[2].value || 0), // keyEvents
      engagementRate: Number(Number(row.metricValues[3].value || 0).toFixed(3)),
    };
  }
  return dateRange(start, end).map(
    (date) => byDate[date] || { date, sessions: 0, users: 0, conversions: 0, engagementRate: 0 }
  );
}

// Total page VIEWS for a page (all visits, not just entries) — uses pagePath,
// which keeps the trailing slash our URLs have.
export async function ga4PageViews(url, start, end, country = 'US') {
  const pageFilter = {
    filter: { fieldName: 'pagePath', stringFilter: { matchType: 'EXACT', value: pathOf(url) } },
  };
  const dimensionFilter =
    country && country !== 'ALL'
      ? {
          andGroup: {
            expressions: [
              pageFilter,
              { filter: { fieldName: 'countryId', stringFilter: { matchType: 'EXACT', value: ga4Country(country) } } },
            ],
          },
        }
      : pageFilter;
  const resp = await analyticsdata.properties.runReport({
    auth: getGoogleAuth(),
    property: `properties/${config.ga4PropertyId}`,
    requestBody: {
      dateRanges: [{ startDate: start, endDate: end }],
      metrics: [{ name: 'screenPageViews' }],
      dimensionFilter,
    },
  });
  const row = resp.data.rows && resp.data.rows[0];
  return row ? Number(row.metricValues[0].value || 0) : 0;
}

// PPC leads for a page = paid-search conversions (key events) attributed to
// this landing page. Same "Paid Search" channel the PPC panel uses.
export async function ga4PagePaidLeads(url, start, end, country = 'US') {
  const expressions = [
    { filter: { fieldName: 'landingPage', inListFilter: { values: landingVariants(url) } } },
    { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { matchType: 'EXACT', value: 'Paid Search' } } },
  ];
  if (country && country !== 'ALL') {
    expressions.push({ filter: { fieldName: 'countryId', stringFilter: { matchType: 'EXACT', value: ga4Country(country) } } });
  }
  const resp = await analyticsdata.properties.runReport({
    auth: getGoogleAuth(),
    property: `properties/${config.ga4PropertyId}`,
    requestBody: {
      dateRanges: [{ startDate: start, endDate: end }],
      metrics: [{ name: 'keyEvents' }],
      dimensionFilter: { andGroup: { expressions } },
    },
  });
  const row = resp.data.rows && resp.data.rows[0];
  return row ? Number(row.metricValues[0].value || 0) : 0;
}

// Period-total behaviour metrics for a page, by pagePath — matches GA4's
// "Pages and screens" report (all views of the page, not just entries).
export async function ga4PageEngagement(url, start, end, country = 'US') {
  const pageFilter = { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'EXACT', value: pathOf(url) } } };
  const dimensionFilter =
    country && country !== 'ALL'
      ? {
          andGroup: {
            expressions: [
              pageFilter,
              { filter: { fieldName: 'countryId', stringFilter: { matchType: 'EXACT', value: ga4Country(country) } } },
            ],
          },
        }
      : pageFilter;
  const resp = await analyticsdata.properties.runReport({
    auth: getGoogleAuth(),
    property: `properties/${config.ga4PropertyId}`,
    requestBody: {
      dateRanges: [{ startDate: start, endDate: end }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'bounceRate' },
        { name: 'screenPageViewsPerUser' }, // views per active user
        { name: 'userEngagementDuration' }, // total engagement seconds
      ],
      dimensionFilter,
    },
  });
  const m = resp.data.rows && resp.data.rows[0] ? resp.data.rows[0].metricValues : null;
  return {
    activeUsers: m ? Number(m[0].value || 0) : 0,
    bounceRate: m ? Number(Number(m[1].value || 0).toFixed(3)) : 0,
    viewsPerUser: m ? Number(Number(m[2].value || 0).toFixed(2)) : 0,
    engagementDuration: m ? Number(m[3].value || 0) : 0, // seconds (total)
  };
}

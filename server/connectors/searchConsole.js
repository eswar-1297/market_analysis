// Google Search Console (Search Analytics API) connector.
// Returns a daily series per page: clicks, impressions, ctr, position.

import { google } from 'googleapis';
import { config } from '../config.js';
import { dateRange } from '../services/dates.js';
import { scCountry } from '../regions.js';
import { getGoogleAuth } from './googleAuth.js';

let webmasters;
async function getClient() {
  if (!webmasters) {
    webmasters = google.searchconsole({ version: 'v1', auth: getGoogleAuth() });
  }
  return webmasters;
}

export async function searchConsolePage(url, start, end, country = 'US') {
  const sc = await getClient();
  const filters = [{ dimension: 'page', operator: 'equals', expression: url }];
  const cc = country && country !== 'ALL' ? scCountry(country) : null;
  if (cc) filters.push({ dimension: 'country', operator: 'equals', expression: cc });
  const resp = await sc.searchanalytics.query({
    siteUrl: config.scSiteUrl,
    requestBody: {
      startDate: start,
      endDate: end,
      dimensions: ['date'],
      dimensionFilterGroups: [{ filters }],
      rowLimit: 25000,
    },
  });

  const byDate = {};
  for (const row of resp.data.rows || []) {
    const date = row.keys[0];
    byDate[date] = {
      date,
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: Number((row.ctr || 0).toFixed(4)),
      position: Number((row.position || 0).toFixed(1)),
    };
  }
  return dateRange(start, end).map(
    (date) => byDate[date] || { date, clicks: 0, impressions: 0, ctr: 0, position: 0 }
  );
}

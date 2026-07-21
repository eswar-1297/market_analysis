// PPC / Paid Search data from GA4 (Google Ads is linked to the property, so ad
// spend/clicks/impressions come through without the Google Ads API).
// Spend is campaign-scoped (GA4 can't attribute ad cost per landing page).
// Paid traffic + conversions are attributed per landing page and geo-filterable.

import { google } from 'googleapis';
import { config } from '../config.js';
import { dateRange } from '../services/dates.js';
import { getGoogleAuth } from './googleAuth.js';
import { ga4Country, countryWeight } from '../regions.js';

const analyticsdata = google.analyticsdata('v1beta');
const prop = () => `properties/${config.ga4PropertyId}`;

async function report(requestBody) {
  const resp = await analyticsdata.properties.runReport({ auth: getGoogleAuth(), property: prop(), requestBody });
  return resp.data.rows || [];
}

function isoOf(raw) {
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

// Paid Search channel filter (+ optional country) for page/traffic queries.
function paidFilter(country) {
  const f = [
    { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { matchType: 'EXACT', value: 'Paid Search' } } },
  ];
  if (country && country !== 'ALL') {
    f.push({ filter: { fieldName: 'countryId', stringFilter: { matchType: 'EXACT', value: ga4Country(country) } } });
  }
  return f.length > 1 ? { andGroup: { expressions: f } } : f[0];
}

export async function ppcLive(start, end, country = 'US') {
  // 1) Spend / clicks / impressions by campaign (campaign-scoped; all regions).
  const campRows = await report({
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: 'sessionCampaignName' }],
    metrics: [{ name: 'advertiserAdCost' }, { name: 'advertiserAdClicks' }, { name: 'advertiserAdImpressions' }],
    orderBys: [{ metric: { metricName: 'advertiserAdCost' }, desc: true }],
    limit: 50,
  });
  const campaigns = campRows
    .map((r) => ({
      campaign: r.dimensionValues[0].value,
      cost: Number(Number(r.metricValues[0].value || 0).toFixed(2)),
      clicks: Number(r.metricValues[1].value || 0),
      impressions: Number(r.metricValues[2].value || 0),
    }))
    .filter((c) => c.cost > 0 || c.clicks > 0);

  // 2) Daily spend / clicks trend. Ad-cost metrics must be paired with a
  // campaign dimension, so we add sessionCampaignName and sum across campaigns.
  const spendByDate = {};
  for (const r of await report({
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: 'date' }, { name: 'sessionCampaignName' }],
    metrics: [{ name: 'advertiserAdCost' }, { name: 'advertiserAdClicks' }],
  })) {
    const d = isoOf(r.dimensionValues[0].value);
    const prev = spendByDate[d] || { cost: 0, clicks: 0 };
    prev.cost += Number(r.metricValues[0].value || 0);
    prev.clicks += Number(r.metricValues[1].value || 0);
    spendByDate[d] = prev;
  }

  // 3) Paid-search landing pages: sessions + conversions (geo-filterable).
  const landingPages = (
    await report({
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'sessions' }, { name: 'keyEvents' }],
      dimensionFilter: paidFilter(country),
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 40,
    })
  )
    .map((r) => ({
      page: r.dimensionValues[0].value,
      sessions: Number(r.metricValues[0].value || 0),
      conversions: Number(r.metricValues[1].value || 0),
    }))
    .filter((p) => p.page !== '(not set)');

  // 4) Daily paid traffic + conversions trend (geo-filterable).
  const trafByDate = {};
  for (const r of await report({
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }, { name: 'keyEvents' }],
    dimensionFilter: paidFilter(country),
  })) {
    trafByDate[isoOf(r.dimensionValues[0].value)] = {
      sessions: Number(r.metricValues[0].value || 0),
      conversions: Number(r.metricValues[1].value || 0),
    };
  }

  const dates = dateRange(start, end);
  const trends = {
    spend: dates.map((d) => ({ date: d, value: Number((spendByDate[d]?.cost || 0).toFixed(2)) })),
    clicks: dates.map((d) => ({ date: d, value: spendByDate[d]?.clicks || 0 })),
    sessions: dates.map((d) => ({ date: d, value: trafByDate[d]?.sessions || 0 })),
    conversions: dates.map((d) => ({ date: d, value: trafByDate[d]?.conversions || 0 })),
  };

  const totalSpend = campaigns.reduce((a, c) => a + c.cost, 0);
  const totalClicks = campaigns.reduce((a, c) => a + c.clicks, 0);
  return {
    source: 'live',
    totals: {
      spend: Number(totalSpend.toFixed(2)),
      clicks: totalClicks,
      impressions: campaigns.reduce((a, c) => a + c.impressions, 0),
      cpc: totalClicks ? Number((totalSpend / totalClicks).toFixed(2)) : 0,
      paidSessions: landingPages.reduce((a, p) => a + p.sessions, 0),
      paidConversions: landingPages.reduce((a, p) => a + p.conversions, 0),
    },
    campaigns,
    landingPages,
    trends,
  };
}

// Sample fallback so the panel isn't empty before GA4 is connected.
export function ppcMock(start, end, country = 'US') {
  const w = countryWeight(country);
  const scale = (n) => Math.round(n * w);
  const campaigns = [
    { campaign: 'Microsoft 365 (sample)', cost: 3885, clicks: 900, impressions: 12000 },
    { campaign: 'Google Workspace (sample)', cost: 2767, clicks: 700, impressions: 9000 },
    { campaign: 'Branding (sample)', cost: 2147, clicks: 350, impressions: 487000 },
    { campaign: 'Competitors (sample)', cost: 333, clicks: 54, impressions: 490 },
  ].map((c) => ({ campaign: c.campaign, cost: Number((c.cost * w).toFixed(2)), clicks: scale(c.clicks), impressions: scale(c.impressions) }));

  const dates = dateRange(start, end);
  const wave = (i, base, amp) => Math.max(0, Math.round(base + amp * Math.sin(i / 4)));
  const trends = {
    spend: dates.map((d, i) => ({ date: d, value: Number((wave(i, 330, 120) * w).toFixed(2)) })),
    clicks: dates.map((d, i) => ({ date: d, value: scale(wave(i, 70, 25)) })),
    sessions: dates.map((d, i) => ({ date: d, value: scale(wave(i, 24, 8)) })),
    conversions: dates.map((d, i) => ({ date: d, value: scale(wave(i, 2, 2)) })),
  };
  const landingPages = [
    { page: '/google-workspace-ads', sessions: scale(75), conversions: scale(6) },
    { page: '/dropbox-to-google-workspace-ads', sessions: scale(87), conversions: scale(3) },
    { page: '/slack-to-teams-migration-ads', sessions: scale(39), conversions: scale(6) },
  ];
  const totalSpend = campaigns.reduce((a, c) => a + c.cost, 0);
  const totalClicks = campaigns.reduce((a, c) => a + c.clicks, 0);
  return {
    source: 'sample',
    totals: {
      spend: Number(totalSpend.toFixed(2)),
      clicks: totalClicks,
      impressions: campaigns.reduce((a, c) => a + c.impressions, 0),
      cpc: totalClicks ? Number((totalSpend / totalClicks).toFixed(2)) : 0,
      paidSessions: landingPages.reduce((a, p) => a + p.sessions, 0),
      paidConversions: landingPages.reduce((a, p) => a + p.conversions, 0),
    },
    campaigns,
    landingPages,
    trends,
  };
}

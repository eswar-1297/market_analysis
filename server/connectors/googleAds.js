// Google Ads (PPC) connector.
// Returns a daily series per landing page: clicks, impressions, cost, conversions.
// Ad -> landing-page attribution uses the expanded_landing_page_view resource.

import { GoogleAdsApi } from 'google-ads-api';
import { config } from '../config.js';
import { dateRange } from '../services/dates.js';

let customer;
function getCustomer() {
  if (!customer) {
    const api = new GoogleAdsApi({
      client_id: config.ads.clientId,
      client_secret: config.ads.clientSecret,
      developer_token: config.ads.developerToken,
    });
    customer = api.Customer({
      customer_id: config.ads.customerId,
      login_customer_id: config.ads.loginCustomerId || undefined,
      refresh_token: config.ads.refreshToken,
    });
  }
  return customer;
}

// Note: `country` is accepted for signature parity. Sample data reflects the
// region; live Google Ads geo attribution per landing page needs a
// geographic_view join and is left account-wide for now.
export async function adsPage(url, start, end, country = 'US') {
  const cust = getCustomer();
  const rows = await cust.query(`
    SELECT
      segments.date,
      metrics.clicks,
      metrics.impressions,
      metrics.cost_micros,
      metrics.conversions
    FROM expanded_landing_page_view
    WHERE expanded_landing_page_view.expanded_final_url = '${url.replace(/'/g, "")}'
      AND segments.date BETWEEN '${start}' AND '${end}'
  `);

  const byDate = {};
  for (const r of rows) {
    const date = r.segments.date;
    const prev = byDate[date] || { date, clicks: 0, impressions: 0, cost: 0, conversions: 0 };
    prev.clicks += Number(r.metrics.clicks || 0);
    prev.impressions += Number(r.metrics.impressions || 0);
    prev.cost += Number(r.metrics.cost_micros || 0) / 1e6;
    prev.conversions += Number(r.metrics.conversions || 0);
    byDate[date] = prev;
  }
  return dateRange(start, end).map((date) => {
    const d = byDate[date] || { date, clicks: 0, impressions: 0, cost: 0, conversions: 0 };
    d.cost = Number(d.cost.toFixed(2));
    d.conversions = Number(d.conversions.toFixed(1));
    return d;
  });
}

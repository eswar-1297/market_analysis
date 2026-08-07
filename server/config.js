import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 4000,
  // Public base URL of the deployed app (no trailing slash). Used to build the
  // OAuth issuer/redirect URLs for the /mcp connector. Set PUBLIC_BASE_URL in
  // production, e.g. https://cloudfuzeanalytics.cftools.live
  publicUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${Number(process.env.PORT) || 4000}`).replace(/\/$/, ''),
  ga4PropertyId: (process.env.GA4_PROPERTY_ID || '').trim(),
  googleAppCreds: (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim(),
  // Deployment-friendly: full service-account JSON in one env var — accepts
  // base64 OR raw JSON, via GOOGLE_CREDENTIALS_B64 or GOOGLE_CREDENTIALS_JSON.
  googleCredentialsB64: (process.env.GOOGLE_CREDENTIALS_B64 || process.env.GOOGLE_CREDENTIALS_JSON || '').trim(),
  scSiteUrl: (process.env.SEARCH_CONSOLE_SITE_URL || '').trim(),
  pagespeedApiKey: (process.env.PAGESPEED_API_KEY || '').trim(),
  // Server secret used to sign the app session token + OAuth state. Not a
  // user-facing login anymore (that's Microsoft) — just an internal HMAC key.
  authUser: process.env.DASHBOARD_USER || 'CFMARKETING',
  authPass: process.env.DASHBOARD_PASS || 'CloudFuze@2026',
  // Microsoft (Entra ID) sign-in. Users authenticate with their Microsoft
  // account; only your tenant's users can get in (single-tenant app).
  ms: {
    tenantId: (process.env.MS_TENANT_ID || '').trim(),
    clientId: (process.env.MS_CLIENT_ID || '').trim(),
    clientSecret: (process.env.MS_CLIENT_SECRET || '').trim(),
    // Optional extra guard: comma-separated allowed email domains
    // (e.g. "cloudfuze.com"). Empty = allow anyone in the tenant.
    allowedDomains: (process.env.MS_ALLOWED_DOMAINS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },
  // OAuth "sign in with your own Google account" — used when you have view
  // access but can't grant a service account (see `npm run auth`).
  oauth: {
    clientId: (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim(),
    clientSecret: (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim(),
    refreshToken: (process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim(),
  },
  ads: {
    developerToken: (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim(),
    clientId: (process.env.GOOGLE_ADS_CLIENT_ID || '').trim(),
    clientSecret: (process.env.GOOGLE_ADS_CLIENT_SECRET || '').trim(),
    refreshToken: (process.env.GOOGLE_ADS_REFRESH_TOKEN || '').trim(),
    customerId: (process.env.GOOGLE_ADS_CUSTOMER_ID || '').trim(),
    loginCustomerId: (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').trim(),
  },
  // HubSpot — powers the per-combination "Leads" metric. A private-app access
  // token (Contacts read scope) is all the server needs. The filter values below
  // mirror the "mandatory contacts" business rule: a contact counts as a lead
  // only if it matches ALL four filters (lead source, team, MQL type, create date).
  hubspot: {
    token: (process.env.HUBSPOT_ACCESS_TOKEN || '').trim(),
    // Filter #1 — Lead Source IN
    leadSources: [
      'Manage',
      'Manage and Migrate',
      'Web_Pricing',
      'Chat',
      'Email',
      'Web Contact Form',
      'Webapp_Pricing',
      'Multi channel',
      'Migrate',
      'Personal Web_Pricing',
      'Contact',
      'Free Consultation',
    ],
    // Filter #2 — HubSpot Team IN. Names are resolved to numeric team IDs at
    // runtime via the Teams API. To skip resolution, set HUBSPOT_TEAM_IDS to a
    // comma-separated list of numeric IDs (those win over the names).
    teamNames: ['Account Management Team', 'Large MSP/Enterprise', 'SMB Team'],
    teamIds: (process.env.HUBSPOT_TEAM_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Filter #3 — MQL Type =
    mqlType: 'Business MQL',
    // Contact properties that hold the migration source / destination clouds.
    // Each lead is bucketed into a combination by (sourceProp -> destProp).
    // NB: the SOURCE cloud lives in `source_destination` (its HubSpot label is
    // "Source_Cloud"); there is no property literally named `source_cloud`.
    sourceProp: 'source_destination',
    destProp: 'destination_cloud',
    // Timezone used to interpret the create-date range and to bucket each
    // contact into a calendar day. Eastern Time (handles EDT/EST automatically),
    // NOT the server's local time. Override with HUBSPOT_TIMEZONE if needed.
    timezone: (process.env.HUBSPOT_TIMEZONE || 'America/New_York').trim(),
  },
};

// GA4 + Search Console can authenticate EITHER with a service-account key
// (GOOGLE_APPLICATION_CREDENTIALS) OR with your own Google login via OAuth.
export const hasMsAuth = Boolean(config.ms.tenantId && config.ms.clientId && config.ms.clientSecret);
export const hasServiceAccount = Boolean(config.googleAppCreds || config.googleCredentialsB64);
export const hasOAuth = Boolean(
  config.oauth.clientId && config.oauth.clientSecret && config.oauth.refreshToken
);
const hasGoogleAuth = hasServiceAccount || hasOAuth;

// Which sources have enough credentials to pull REAL data. Everything else
// falls back to deterministic sample data so the dashboard always works.
export const sources = {
  ga4: Boolean(config.ga4PropertyId && hasGoogleAuth),
  searchConsole: Boolean(config.scSiteUrl && hasGoogleAuth),
  pagespeed: Boolean(config.pagespeedApiKey),
  ads: Boolean(
    config.ads.developerToken &&
      config.ads.refreshToken &&
      config.ads.clientId &&
      config.ads.clientSecret &&
      config.ads.customerId
  ),
  hubspot: Boolean(config.hubspot.token),
};

export function modeFor(source) {
  return sources[source] ? 'live' : 'mock';
}

export function overallMode() {
  return Object.values(sources).some(Boolean) ? 'live' : 'mock';
}

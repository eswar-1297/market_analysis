import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 4000,
  ga4PropertyId: (process.env.GA4_PROPERTY_ID || '').trim(),
  googleAppCreds: (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim(),
  // Deployment-friendly: full service-account JSON in one env var — accepts
  // base64 OR raw JSON, via GOOGLE_CREDENTIALS_B64 or GOOGLE_CREDENTIALS_JSON.
  googleCredentialsB64: (process.env.GOOGLE_CREDENTIALS_B64 || process.env.GOOGLE_CREDENTIALS_JSON || '').trim(),
  scSiteUrl: (process.env.SEARCH_CONSOLE_SITE_URL || '').trim(),
  pagespeedApiKey: (process.env.PAGESPEED_API_KEY || '').trim(),
  // Dashboard login (HTTP Basic Auth). Override in .env if desired.
  authUser: process.env.DASHBOARD_USER || 'CFMARKETING',
  authPass: process.env.DASHBOARD_PASS || 'CloudFuze@2026',
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
};

// GA4 + Search Console can authenticate EITHER with a service-account key
// (GOOGLE_APPLICATION_CREDENTIALS) OR with your own Google login via OAuth.
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
};

export function modeFor(source) {
  return sources[source] ? 'live' : 'mock';
}

export function overallMode() {
  return Object.values(sources).some(Boolean) ? 'live' : 'mock';
}

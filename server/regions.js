// Region/country filter. US is the default. "ALL" means no geo filter.
// Each connector maps the code to whatever that API expects.

export const DEFAULT_COUNTRY = 'US';

export const REGIONS = [
  { code: 'US', label: 'United States' },
  { code: 'ALL', label: 'All regions' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'IN', label: 'India' },
  { code: 'DE', label: 'Germany' },
];

// GA4 `countryId` uses ISO-3166-1 alpha-2 (same as our codes) — pass through.
export function ga4Country(code) {
  return code;
}

// Search Console `country` dimension uses ISO-3166-1 alpha-3 (lowercase).
const ALPHA3 = { US: 'usa', GB: 'gbr', CA: 'can', AU: 'aus', IN: 'ind', DE: 'deu' };
export function scCountry(code) {
  return ALPHA3[code] || null;
}

// Sample-data share of the global total attributable to each region, so the
// filter visibly changes the numbers even before real data is connected.
const WEIGHT = { US: 0.55, GB: 0.1, CA: 0.08, AU: 0.05, IN: 0.13, DE: 0.06 };
export function countryWeight(code) {
  if (!code || code === 'ALL') return 1;
  return WEIGHT[code] ?? 0.04;
}

export function isValidCountry(code) {
  return code === 'ALL' || REGIONS.some((r) => r.code === code);
}

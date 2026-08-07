// HubSpot connector — powers the per-combination "Leads" metric.
//
// The main pull mirrors the "mandatory contacts" business rule: a contact is a
// lead only if it matches ALL FOUR filters (combined with AND):
//   1. Lead Source IN   (config.hubspot.leadSources)
//   2. HubSpot Team IN   (config.hubspot.teamNames -> numeric team IDs)
//   3. MQL Type =        (config.hubspot.mqlType, "Business MQL")
//   4. Create date range (only applied when a from/to is passed)
//
// Each matching contact is then bucketed into a dashboard combination by its
// (source_cloud -> destination_cloud) pair, and we return per-combo counts plus
// a daily series (by createdate) so the UI can show totals, trends, and deltas.

import { config, modeFor } from '../config.js';
import { dateRange } from '../services/dates.js';
import { countryWeight } from '../regions.js';
import { etMidnightMs, nextDay, toEtDate } from '../services/datetime.js';

const BASE = 'https://api.hubapi.com';

async function hs(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${config.hubspot.token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HubSpot ${method} ${path} -> ${res.status} ${res.statusText} ${text.slice(0, 300)}`);
  }
  return res.json();
}

// --- Filter #2: resolve team NAMES to numeric team IDs (cached) -------------
let teamIdCache = null;
async function resolveTeamIds() {
  if (config.hubspot.teamIds.length) return config.hubspot.teamIds; // explicit override
  if (teamIdCache) return teamIdCache;
  const data = await hs('/settings/v3/users/teams');
  const wanted = new Set(config.hubspot.teamNames.map((n) => n.toLowerCase().trim()));
  const ids = (data.results || [])
    .filter((t) => wanted.has(String(t.name || '').toLowerCase().trim()))
    .map((t) => String(t.id));
  if (!ids.length) {
    throw new Error(
      `No HubSpot teams matched ${JSON.stringify(config.hubspot.teamNames)} — ` +
        `available: ${(data.results || []).map((t) => t.name).join(', ') || 'none'}`
    );
  }
  teamIdCache = ids;
  return ids;
}

// --- The main pull: contacts matching all four mandatory filters ------------
export async function pullMandatoryContacts({ from, to } = {}) {
  const { leadSources, mqlType, sourceProp, destProp } = config.hubspot;
  const teamIds = await resolveTeamIds();

  const filters = [
    { propertyName: 'lead_source', operator: 'IN', values: leadSources },
    { propertyName: 'hubspot_team_id', operator: 'IN', values: teamIds },
    { propertyName: 'mql_type', operator: 'EQ', value: mqlType },
  ];
  // Filter #4 — create-date window, interpreted in US Eastern Time. Half-open
  // interval [ET-midnight(from), ET-midnight(dayAfter(to))) so the whole `to`
  // day is included. Dropped entirely when no window is passed (all time).
  if (from) filters.push({ propertyName: 'createdate', operator: 'GTE', value: String(etMidnightMs(from)) });
  if (to) filters.push({ propertyName: 'createdate', operator: 'LT', value: String(etMidnightMs(nextDay(to))) });

  const properties = [
    sourceProp,
    destProp,
    'createdate',
    'lead_source',
    'mql_type',
    'hubspot_team_id',
    // Country fields, in resolution-priority order (see contactCountryCode).
    'hs_country_region_code',
    'country',
    'ip_country_code',
  ];
  const out = [];
  let after;
  // HubSpot Search caps at 10k results (100/page). Bound the loop as a backstop.
  for (let page = 0; page < 100; page++) {
    const data = await hs('/crm/v3/objects/contacts/search', {
      method: 'POST',
      body: {
        filterGroups: [{ filters }],
        properties,
        sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }],
        limit: 100,
        ...(after ? { after } : {}),
      },
    });
    for (const r of data.results || []) out.push(r.properties || {});
    after = data.paging?.next?.after;
    if (!after) break;
  }
  return out;
}

// --- Cached raw pull --------------------------------------------------------
// The mandatory-contacts pull is date-range-scoped and NOT combo- or region-
// specific (bucketing/region-filtering happen in memory below). It's also the
// slowest call (HubSpot search is ~1-2s and paginates), and the SAME pull is
// needed by the overview AND every combination for a given range. So cache the
// raw contacts by date range: the range loads once, then every combo reuses it.
const contactsCache = new Map(); // "from|to" -> { at, contacts }
const CONTACTS_TTL_MS = 5 * 60 * 1000;
async function getMandatoryContacts(from, to) {
  const key = `${from || ''}|${to || ''}`;
  const hit = contactsCache.get(key);
  if (hit && Date.now() - hit.at < CONTACTS_TTL_MS) return hit.contacts;
  const contacts = await pullMandatoryContacts({ from, to });
  contactsCache.set(key, { at: Date.now(), contacts });
  return contacts;
}

// --- Bucket contacts into combinations by source_cloud -> destination_cloud -
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// --- Region filter: resolve a contact to an ISO alpha-2 country code ---------
// Free-text country names -> alpha-2, covering the dashboard's regions and
// common variants. Only the selected region needs to resolve; anything else
// simply won't match a specific-region view (and all contacts show under "ALL").
const COUNTRY_NAME_TO_CODE = {
  unitedstates: 'US', usa: 'US', us: 'US', unitedstatesofamerica: 'US', america: 'US',
  unitedkingdom: 'GB', uk: 'GB', greatbritain: 'GB', england: 'GB', britain: 'GB',
  canada: 'CA',
  australia: 'AU',
  india: 'IN',
  germany: 'DE', deutschland: 'DE',
};
function contactCountryCode(p) {
  // 1) HubSpot's normalized alpha-2 code (most reliable when present)
  const hs = String(p.hs_country_region_code || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(hs)) return hs;
  // 2) Free-text country field, mapped by name (highest coverage)
  const byName = COUNTRY_NAME_TO_CODE[norm(p.country)];
  if (byName) return byName;
  // 3) IP-based alpha-2 code (fallback)
  const ip = String(p.ip_country_code || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(ip)) return ip;
  return null;
}

// Common cloud-name variants collapsed to one canonical token. Extend this as
// you discover mismatches in the unmatched-pairs log (see leadsByCombo).
// Keys are the NORMALIZED value (lowercased, non-alphanumerics stripped), so
// casing and spacing variants collapse automatically ("MS Teams", "ms teams",
// "MSTeams" all normalize to "msteams"). Only add entries for genuine synonyms,
// plan names ("Slack Pro"), and observed misspellings — NOT for compound values
// that cram two clouds into one field (e.g. "Slack - Teams"), which are
// ambiguous and left unmatched on purpose.
const ALIAS = {
  // Slack (incl. plan tiers)
  slack: 'slack',
  slackpro: 'slack',
  slackworkspace: 'slack',
  businessslack: 'slack',
  // Microsoft Teams
  teams: 'teams',
  team: 'teams',
  msteams: 'teams',
  microsoftteams: 'teams',
  // A rep pasted the customer's domain with the product in brackets. One-off, but
  // it is unambiguously a Teams destination.
  nposervicescommsteams: 'teams',
  // Microsoft 365 / Office 365
  o365: 'office365',
  office365: 'office365',
  microsoft365: 'office365',
  m365: 'office365',
  ms365: 'office365',
  ms356: 'office365', // typo for MS 365
  '365': 'office365',
  microsoft365commercial: 'office365',
  commercialm365: 'office365',
  microsoft365gcchigh: 'office365',
  // GCC High / Commercial / Government tenants are all Microsoft 365 — these turn
  // up as the two sides of a Microsoft tenant-to-tenant migration.
  gcchighm365: 'office365',
  m365gcchigh: 'office365',
  microsoft365commercialtenant: 'office365',
  microsoft365governmenttenant: 'office365',
  gcctenant: 'office365',
  commercialmicrosoft365: 'office365',
  microsoft365gcc: 'office365',
  m365gcc: 'office365',
  microsoft365tenant: 'office365',
  consolidatedmicrosoft365tenant: 'office365',
  // "Microsoft 365 or other cloud platforms" — an open-ended answer, treated as
  // Microsoft 365 by explicit request.
  microsoft365orothercloudplatforms: 'office365',
  // Google Chat
  googlechat: 'googlechat',
  gchat: 'googlechat',
  // Google Workspace (incl. GWS / GSuite abbreviations and misspellings)
  gsuite: 'googleworkspace',
  gworkspace: 'googleworkspace',
  gws: 'googleworkspace',
  googleworkspace: 'googleworkspace',
  googleworkspce: 'googleworkspace', // observed typo ("Google Workspce")
  googleworksapce: 'googleworkspace', // observed typo
  google: 'googleworkspace', // bare "Google" — reps' shorthand for Google Workspace
  // Google Drive is treated as Google Workspace — Drive leads count under the
  // corresponding "… to Google Workspace" combination.
  gdrive: 'googleworkspace',
  googledrive: 'googleworkspace',
  googledrivemigration: 'googleworkspace', // rep typed the product + "migration"
  // Multi-cloud enquiry: "Google Workspace / Box / Dropbox / Slack". Counted under
  // Google Workspace (the first cloud listed) by explicit request — it therefore
  // does NOT also appear under the Box, Dropbox or Slack combinations.
  googleworkspaceboxdropboxslack: 'googleworkspace',
  googlemydrive: 'googleworkspace',
  googleshareddrive: 'googleworkspace',
  googleshareddrives: 'googleworkspace',
  googledriveshareddrive: 'googleworkspace',
  shareddrive: 'googleworkspace',
  shareddrives: 'googleworkspace',
  googleworkspacestandardgoogledrive: 'googleworkspace',
  // Box
  box: 'box',
  boxbusiness: 'box',
  // Dropbox (incl. plan tiers and misspelling)
  dropbox: 'dropbox',
  dropboxbusiness: 'dropbox',
  dropboxpersonal: 'dropbox',
  dropboxprofessional: 'dropbox',
  dropboxaccount: 'dropbox',
  drobox: 'dropbox', // observed typo
  // Egnyte (incl. server/cloud variants and misspelling)
  egnyte: 'egnyte',
  egnyet: 'egnyte', // observed typo
  egnyteserver: 'egnyte',
  egnytecloud: 'egnyte',
  // Citrix — ShareFile is Citrix's file-share product, so it counts as Citrix.
  sharefile: 'citrix',
  sharefilebusiness: 'citrix',
  citrixsharefile: 'citrix',
  // NFS
  nfs: 'nfs',
  networkfilesystemnfs: 'nfs',
  // SharePoint / OneDrive are Microsoft 365 components, so a lead going to either
  // counts under the corresponding "… to Microsoft 365" combination. The page-level
  // FINE_ALIAS below keeps them apart again, so a SharePoint lead lands on the
  // SharePoint page and a OneDrive lead on the OneDrive page.
  sharepoint: 'office365',
  sharepointonline: 'office365',
  microsoftsharepointonline: 'office365',
  microsoftsharepointonlinegcchigh: 'office365',
  sharepointonlinemicrosoft365: 'office365',
  onedrive: 'office365',
  onedriveforbusiness: 'office365',
  onedrivebusiness: 'office365',
  odfb: 'office365',
};
const canon = (s) => ALIAS[norm(s)] || norm(s);

// --- Fine-grained canon, for attributing a combination's leads to INDIVIDUAL
// pages. The coarse ALIAS above deliberately collapses every Google flavour to
// "googleworkspace" so combination totals stay whole; that's useless for pages,
// because "… to Google Drive", "… to Google Shared Drives" and "… to G Suite"
// are separate articles. This table keeps those apart. A value absent here
// falls through to its normalized form, so it matches no page and stays
// unattributed (see leadsByPage) rather than being guessed into one.
const FINE_ALIAS = {
  // Google, kept distinct
  googledrive: 'gdrive', gdrive: 'gdrive', googlemydrive: 'gdrive', mydrive: 'gdrive',
  googledrivemigration: 'gdrive',
  googleshareddrive: 'gshared', googleshareddrives: 'gshared',
  shareddrive: 'gshared', shareddrives: 'gshared', googledriveshareddrive: 'gshared',
  gsuite: 'gsuite',
  googleworkspace: 'gworkspace', gws: 'gworkspace', gworkspace: 'gworkspace',
  googleworkspce: 'gworkspace', googleworksapce: 'gworkspace',
  // Bare "Google" names no product, so it's generic at page level too.
  google: 'gworkspace',
  // Multi-cloud / open-ended answers: they count towards the combination but name
  // no single product, so at page level they stay generic and claim no page.
  googleworkspaceboxdropboxslack: 'gworkspace',
  microsoft365orothercloudplatforms: 'm365',
  // Microsoft
  onedrive: 'onedrive', onedriveforbusiness: 'onedrive', onedrivebusiness: 'onedrive', odfb: 'onedrive',
  // SharePoint, incl. the variants that bolt the suite name on — they still mean
  // SharePoint Online, so they belong on the SharePoint page.
  sharepoint: 'sharepoint', sharepointonline: 'sharepoint',
  microsoftsharepointonline: 'sharepoint',
  sharepointonlinemicrosoft365: 'sharepoint',
  microsoftsharepointonlinegcchigh: 'sharepoint',
  microsoft365: 'm365', m365: 'm365', ms365: 'm365', ms356: 'm365', office365: 'm365', o365: 'm365', 365: 'm365',
  microsoft365commercial: 'm365', commercialm365: 'm365', microsoft365gcchigh: 'm365',
  gcchighm365: 'm365', m365gcchigh: 'm365',
  microsoft365commercialtenant: 'm365', microsoft365governmenttenant: 'm365',
  gcctenant: 'm365', commercialmicrosoft365: 'm365',
  microsoft365gcc: 'm365', m365gcc: 'm365',
  microsoft365tenant: 'm365', consolidatedmicrosoft365tenant: 'm365',
  teams: 'teams', team: 'teams', msteams: 'teams', microsoftteams: 'teams',
  nposervicescommsteams: 'teams',
  outlook: 'outlook',
  // Google comms / mail
  googlechat: 'gchat', gchat: 'gchat',
  gmail: 'gmail',
  // Everything else
  slack: 'slack', slackpro: 'slack', slackworkspace: 'slack', businessslack: 'slack',
  box: 'box', boxbusiness: 'box',
  dropbox: 'dropbox', dropboxbusiness: 'dropbox', dropboxpersonal: 'dropbox',
  dropboxprofessional: 'dropbox', dropboxaccount: 'dropbox', drobox: 'dropbox',
  egnyte: 'egnyte', egnyet: 'egnyte', egnyteserver: 'egnyte', egnytecloud: 'egnyte',
  sharefile: 'citrix', sharefilebusiness: 'citrix', citrixsharefile: 'citrix', citrix: 'citrix',
  nfs: 'nfs', networkfilesystemnfs: 'nfs',
};
const canonFine = (s) => FINE_ALIAS[norm(s)] || norm(s);

// Does a raw field mention one of a combination's keywords? Used by products that
// aren't a cloud-to-cloud pair (Hyper Link Fixer), where the rep types the need in
// words rather than naming a source and destination platform. "linkedin" is
// stripped first so it can never be read as a "link" mention.
function mentionsKeyword(raw, keywords) {
  const text = String(raw || '').toLowerCase().replace(/linkedin/g, '');
  return keywords.some((k) => text.includes(k.toLowerCase()));
}

// A combination's coarse source/destination sets: explicit sourceCloud/destCloud
// from combinations.json when present, else split the name on " to ".
function comboClouds(c) {
  let src = c.sourceCloud;
  let dst = c.destCloud;
  const keywords = Array.isArray(c.matchKeywords) ? c.matchKeywords : null;
  // Some products aren't a cloud pair at all — they're identified by the lead
  // source the rep picked (SaaS Management = the CF Manage product line).
  const leadSources = Array.isArray(c.matchLeadSources)
    ? new Set(c.matchLeadSources.map((v) => String(v).toLowerCase().trim()))
    : null;
  if (!src || !dst) {
    const m = String(c.name || '').split(/\s+to\s+/i);
    // A keyword- or lead-source-only combination needs no cloud pair at all.
    if (m.length !== 2) {
      if (keywords || leadSources) {
        return { srcSet: new Set(), dstSet: new Set(), sameCloud: false, keywords, leadSources };
      }
      return null; // can't derive — this combo matches nothing
    }
    src = src || m[0];
    dst = dst || m[1];
  }
  return {
    srcSet: new Set([].concat(src).map(canon)),
    dstSet: new Set([].concat(dst).map(canon)),
    // `sameCloud` combinations (Tenant to Tenant) are migrations WITHIN one
    // platform, so the lead's source and destination must be the same cloud.
    // Without this, listing several clouds would also match every cross-cloud
    // pairing between them (e.g. Microsoft 365 -> Google Workspace).
    sameCloud: Boolean(c.sameCloud),
    keywords,
    leadSources,
  };
}

// Does a lead belong to this combination? Raw values are passed in as well as the
// canonical ones, because keyword matching reads the text the rep actually typed.
function comboMatches(sets, cs, cd, rawSrc, rawDst, leadSource) {
  // Lead source identifies the product outright, whatever clouds were typed.
  if (sets.leadSources && sets.leadSources.has(String(leadSource || '').toLowerCase().trim())) {
    return true;
  }
  // Keyword match on EITHER field wins on its own — the lead named a need, not a pair.
  if (sets.keywords && (mentionsKeyword(rawSrc, sets.keywords) || mentionsKeyword(rawDst, sets.keywords))) {
    return true;
  }
  if (sets.sameCloud && cs !== cd) return false;
  return sets.srcSet.has(cs) && sets.dstSet.has(cd);
}

// Build a (source, destination) -> comboId matcher.
function buildMatcher(combos) {
  const table = [];
  for (const c of combos) {
    const sets = comboClouds(c);
    if (sets) table.push({ id: c.id, ...sets });
  }
  // Lead-source combinations are checked LAST, as a fallback. If a "Manage" lead
  // names a real source and destination, it belongs to that migration combination;
  // only leads whose clouds match nothing (blank, "N/A", an unsupported pair like
  // Asana -> Zoho) fall through to the product combination.
  table.sort((a, b) => (a.leadSources ? 1 : 0) - (b.leadSources ? 1 : 0));
  return (sourceCloud, destCloud, leadSource) => {
    const cs = canon(sourceCloud);
    const cd = canon(destCloud);
    for (const t of table) if (comboMatches(t, cs, cd, sourceCloud, destCloud, leadSource)) return t.id;
    return null;
  };
}

function zeroSeries(start, end) {
  return dateRange(start, end).map((date) => ({ date, value: 0 }));
}

// Live: pull contacts, bucket by combo, build per-combo total + daily series.
// `country` (ISO alpha-2, or 'ALL'/null) filters leads to that region.
async function leadsByComboLive(combos, start, end, country) {
  const contacts = await getMandatoryContacts(start, end);
  const match = buildMatcher(combos);
  const { sourceProp, destProp } = config.hubspot;
  const region = country && country !== 'ALL' ? country : null;

  const byId = {};
  for (const c of combos) byId[c.id] = { total: 0, series: zeroSeries(start, end), byDate: {} };

  // Product combinations matched by lead source (SaaS Management = CF Manage) are
  // ADDITIVE, not exclusive: a "Manage" lead that also names a real migration route
  // is genuinely both, so it is counted under the route AND under the product.
  // Consequence: summing leads across combinations can exceed the number of
  // distinct contacts, by design.
  const productCombos = combos
    .filter((c) => Array.isArray(c.matchLeadSources))
    .map((c) => ({ id: c.id, set: new Set(c.matchLeadSources.map((v) => String(v).toLowerCase().trim())) }));

  const unmatched = {}; // "source -> dest" -> count, to help you extend ALIAS/overrides
  let considered = 0;
  let matched = 0;
  for (const p of contacts) {
    if (region && contactCountryCode(p) !== region) continue; // outside selected region
    considered++;
    const id = match(p[sourceProp], p[destProp], p.lead_source);
    const ls = String(p.lead_source || '').toLowerCase().trim();
    // Every product combination whose lead sources include this contact, minus the
    // one already picked as the primary match (don't count it twice in one combo).
    const targets = [id, ...productCombos.filter((e) => e.set.has(ls) && e.id !== id).map((e) => e.id)].filter(Boolean);
    if (!targets.length) {
      const key = `${p[sourceProp] || '∅'} -> ${p[destProp] || '∅'}`;
      unmatched[key] = (unmatched[key] || 0) + 1;
      continue;
    }
    matched++;
    const day = toEtDate(p.createdate); // US Eastern calendar day
    for (const target of targets) {
      const bucket = byId[target];
      if (!bucket) continue;
      bucket.total++;
      if (day) bucket.byDate[day] = (bucket.byDate[day] || 0) + 1;
    }
  }
  // Fold per-date counts into the zero-filled series.
  for (const id of Object.keys(byId)) {
    const b = byId[id];
    for (const point of b.series) point.value = b.byDate[point.date] || 0;
    delete b.byDate;
  }

  const unmatchedList = Object.entries(unmatched).sort((a, b) => b[1] - a[1]);
  if (unmatchedList.length) {
    console.warn(
      `[hubspot] ${considered} mandatory contacts${region ? ` in ${region}` : ''}, ${matched} matched a combo. ` +
        `Unmatched source->destination pairs (add aliases or per-combo sourceCloud/destCloud to map them):`
    );
    for (const [pair, n] of unmatchedList.slice(0, 25)) console.warn(`  ${n.toString().padStart(5)}  ${pair}`);
  }
  return { byId, source: 'live', contactsTotal: considered, matched };
}

// --- Per-page lead attribution ----------------------------------------------
// Splits ONE combination's leads across its individual pages, using each page's
// fine-grained sourceCloud/destCloud from combinations.json.
//
// Rules (all deliberate — see the notes in the dashboard README):
//   * Only leads that already belong to this combination are considered, so page
//     counts can never exceed the combination total.
//   * A lead is attributed only when it matches EXACTLY ONE page. If two pages
//     declare the same pair (e.g. two "Dropbox -> OneDrive" articles) the lead is
//     ambiguous and stays unattributed rather than being guessed or split.
//   * Leads whose destination is generic for the combination ("Google Workspace"
//     for a combo whose pages are Drive / Shared Drives / G Suite) match no page
//     and stay unattributed.
//   * Pages with no declared pair (ad pages, Hyper Link Fixer, SaaS Management)
//     get null — rendered as "—", meaning "not attributable", not "zero".
// Returns { byUrl, attributed, unattributed, total }.
// `allCombos` is required for correct ownership: a lead belongs to exactly ONE
// combination (first match wins, lead-source products first), and without the
// full list this function would happily count a lead that another combination
// already owns — e.g. a "Manage" lead that also names Slack -> Google Chat.
export async function getLeadsByPage(combo, start, end, country, allCombos = null) {
  const pages = combo.pages || [];
  // A page is attributable if it declares a cloud pair, or (for product pages that
  // aren't a migration route) the lead sources that belong to it.
  const hasPair = (p) => Boolean(p.sourceCloud && p.destCloud);
  const pageLeadSources = (p) =>
    Array.isArray(p.matchLeadSources)
      ? new Set(p.matchLeadSources.map((v) => String(v).toLowerCase().trim()))
      : null;
  const mappable = pages.filter((p) => hasPair(p) || pageLeadSources(p));
  const byUrl = {};
  for (const p of pages) byUrl[p.url] = mappable.includes(p) ? 0 : null;

  if (modeFor('hubspot') !== 'live') {
    // Sample mode: spread the mock combo total round-robin over mappable pages
    // so the column isn't blank when there are no credentials.
    const total = leadsByComboMock([combo], start, end, country).byId[combo.id].total;
    mappable.forEach((p, i) => {
      byUrl[p.url] = Math.floor(total / mappable.length) + (i < total % mappable.length ? 1 : 0);
    });
    return { byUrl, attributed: total, unattributed: 0, total };
  }

  const sets = comboClouds(combo);
  if (!sets) return { byUrl, attributed: 0, unattributed: 0, total: 0 };

  const contacts = await getMandatoryContacts(start, end);
  const { sourceProp, destProp } = config.hubspot;
  const region = country && country !== 'ALL' ? country : null;
  // Same bucketing the overview uses, so both views agree on who owns a lead.
  const owner = allCombos ? buildMatcher(allCombos) : null;

  // Fine-grained (source, dest) -> set of page urls; >1 page means ambiguous.
  // A Set, not an array: one page may list several spellings that collapse to the
  // same fine token (e.g. "Google Drive" and "Google My Drive"), and that must
  // not make the page look like two competing candidates.
  const fine = new Map();
  const byLeadSource = new Map(); // lead source -> set of page urls
  for (const p of mappable) {
    const ls = pageLeadSources(p);
    if (ls) {
      for (const v of ls) {
        if (!byLeadSource.has(v)) byLeadSource.set(v, new Set());
        byLeadSource.get(v).add(p.url);
      }
    }
    if (!hasPair(p)) continue;
    for (const s of [].concat(p.sourceCloud)) {
      for (const d of [].concat(p.destCloud)) {
        const k = `${canonFine(s)}|${canonFine(d)}`;
        if (!fine.has(k)) fine.set(k, new Set());
        fine.get(k).add(p.url);
      }
    }
  }

  let total = 0;
  let attributed = 0;
  for (const p of contacts) {
    if (region && contactCountryCode(p) !== region) continue;
    // Must belong to this combination first (coarse match).
    if (!comboMatches(sets, canon(p[sourceProp]), canon(p[destProp]), p[sourceProp], p[destProp], p.lead_source))
      continue;
    // A product combination (matched by lead source) is additive — it keeps its own
    // leads even when a migration combination also owns them. Everything else must
    // be the single owner, so a lead is never counted twice among the routes.
    const ownedByLeadSource =
      sets.leadSources && sets.leadSources.has(String(p.lead_source || '').toLowerCase().trim());
    if (owner && !ownedByLeadSource && owner(p[sourceProp], p[destProp], p.lead_source) !== combo.id) continue;
    total++;
    // Lead source decides first, for product pages that aren't a migration route.
    const urls =
      byLeadSource.get(String(p.lead_source || '').toLowerCase().trim()) ||
      fine.get(`${canonFine(p[sourceProp])}|${canonFine(p[destProp])}`);
    if (urls && urls.size === 1) {
      byUrl[[...urls][0]]++;
      attributed++;
    }
  }
  return { byUrl, attributed, unattributed: total - attributed, total };
}

// Mock: deterministic per-combo lead counts so sample mode still works.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function leadsByComboMock(combos, start, end, country) {
  const dates = dateRange(start, end);
  const w = countryWeight(country); // region's share of the global total (ALL => 1)
  const byId = {};
  for (const c of combos) {
    // Base daily rate 0..~4 leads, seeded by combo id (stable across reloads).
    const rate = (hash(c.id + 'leads') % 100) / 100 * 4 * w;
    let total = 0;
    const series = dates.map((date) => {
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      const weekend = dow === 0 || dow === 6 ? 0.4 : 1;
      const jitter = (hash(c.id + date) % 100) / 100;
      const value = Math.round(rate * weekend * (0.5 + jitter));
      total += value;
      return { date, value };
    });
    byId[c.id] = { total, series };
  }
  return { byId, source: 'sample' };
}

// Public entry: live when a token is configured, otherwise sample data. A live
// failure falls back to sample data and records the error (same pattern as GA4).
// `country` (ISO alpha-2, or 'ALL'/null) filters leads to that region.
export async function getLeadsByCombo(combos, start, end, country) {
  if (modeFor('hubspot') !== 'live') return leadsByComboMock(combos, start, end, country);
  try {
    return await leadsByComboLive(combos, start, end, country);
  } catch (e) {
    console.error('[hubspot] live leads pull failed, using sample data:', e.message);
    return { ...leadsByComboMock(combos, start, end, country), source: 'sample-fallback', error: e.message };
  }
}

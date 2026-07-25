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

  const properties = [sourceProp, destProp, 'createdate', 'lead_source', 'mql_type', 'hubspot_team_id'];
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

// --- Bucket contacts into combinations by source_cloud -> destination_cloud -
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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
  // Google Chat
  googlechat: 'googlechat',
  gchat: 'googlechat',
  // Google Workspace (incl. GWS / GSuite abbreviations and misspellings)
  gsuite: 'googleworkspace',
  gworkspace: 'googleworkspace',
  gws: 'googleworkspace',
  googleworkspace: 'googleworkspace',
  googleworkspce: 'googleworkspace', // combos.json typo ("Google Workspce")
  googleworksapce: 'googleworkspace', // observed typo
  // Google Drive is treated as Google Workspace — Drive leads count under the
  // corresponding "… to Google Workspace" combination.
  gdrive: 'googleworkspace',
  googledrive: 'googleworkspace',
  googlemydrive: 'googleworkspace',
  googleshareddrive: 'googleworkspace',
  googledriveshareddrive: 'googleworkspace',
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
  // SharePoint / OneDrive — not combo endpoints today, but normalized so future
  // combos (and the unmatched log) stay clean.
  sharepointonline: 'sharepoint',
  odfb: 'onedrive',
  onedrivebusiness: 'onedrive',
};
const canon = (s) => ALIAS[norm(s)] || norm(s);

// Build a (source, destination) -> comboId matcher. A combo's source/destination
// come from explicit `sourceCloud`/`destCloud` fields in combinations.json if
// present, otherwise from splitting its name on " to " (e.g. "Box to Teams").
function buildMatcher(combos) {
  const table = [];
  for (const c of combos) {
    let src = c.sourceCloud;
    let dst = c.destCloud;
    if (!src || !dst) {
      const m = String(c.name || '').split(/\s+to\s+/i);
      if (m.length !== 2) continue; // can't derive — skip (won't match by name)
      src = src || m[0];
      dst = dst || m[1];
    }
    const srcSet = new Set([].concat(src).map(canon));
    const dstSet = new Set([].concat(dst).map(canon));
    table.push({ id: c.id, srcSet, dstSet });
  }
  return (sourceCloud, destCloud) => {
    const cs = canon(sourceCloud);
    const cd = canon(destCloud);
    for (const t of table) if (t.srcSet.has(cs) && t.dstSet.has(cd)) return t.id;
    return null;
  };
}

function zeroSeries(start, end) {
  return dateRange(start, end).map((date) => ({ date, value: 0 }));
}

// Live: pull contacts, bucket by combo, build per-combo total + daily series.
async function leadsByComboLive(combos, start, end) {
  const contacts = await pullMandatoryContacts({ from: start, to: end });
  const match = buildMatcher(combos);
  const { sourceProp, destProp } = config.hubspot;

  const byId = {};
  for (const c of combos) byId[c.id] = { total: 0, series: zeroSeries(start, end), byDate: {} };

  const unmatched = {}; // "source -> dest" -> count, to help you extend ALIAS/overrides
  let matched = 0;
  for (const p of contacts) {
    const id = match(p[sourceProp], p[destProp]);
    if (!id) {
      const key = `${p[sourceProp] || '∅'} -> ${p[destProp] || '∅'}`;
      unmatched[key] = (unmatched[key] || 0) + 1;
      continue;
    }
    matched++;
    const bucket = byId[id];
    bucket.total++;
    const day = toEtDate(p.createdate); // US Eastern calendar day
    if (day) bucket.byDate[day] = (bucket.byDate[day] || 0) + 1;
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
      `[hubspot] ${contacts.length} mandatory contacts, ${matched} matched a combo. ` +
        `Unmatched source->destination pairs (add aliases or per-combo sourceCloud/destCloud to map them):`
    );
    for (const [pair, n] of unmatchedList.slice(0, 25)) console.warn(`  ${n.toString().padStart(5)}  ${pair}`);
  }
  return { byId, source: 'live', contactsTotal: contacts.length, matched };
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
function leadsByComboMock(combos, start, end) {
  const dates = dateRange(start, end);
  const byId = {};
  for (const c of combos) {
    // Base daily rate 0..~4 leads, seeded by combo id (stable across reloads).
    const rate = (hash(c.id + 'leads') % 100) / 100 * 4;
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
export async function getLeadsByCombo(combos, start, end) {
  if (modeFor('hubspot') !== 'live') return leadsByComboMock(combos, start, end);
  try {
    return await leadsByComboLive(combos, start, end);
  } catch (e) {
    console.error('[hubspot] live leads pull failed, using sample data:', e.message);
    return { ...leadsByComboMock(combos, start, end), source: 'sample-fallback', error: e.message };
  }
}

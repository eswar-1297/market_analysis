// Team attribution — purely a client-side display/grouping layer. The API still
// reports one `author` string per combination (data/combinations.json); this maps
// that name to one of the two content teams and, where the roster says so,
// re-attributes it to a different display name.
//
// Rules (as given by the business):
//  - Migrate team: Pankaj Rai, Preksha, Bhuvaneswari.
//  - Manage team: Rashmi Ramesh, Aayushi — but only for content Aayushi wrote
//    FROM 2026-11-04 onward (the day she moved onto Manage). Anything of hers
//    from before that date is retroactively Pankaj's (Migrate).
//  - Any author not on either roster rolls up under Pankaj Rai (Migrate) — this
//    covers legacy site authors (Adhithyan, Abhishek Chakraborty, Bhavani Asok,
//    Saranya Ponugoti, Sremala, Tejeswini Devaraj) and anyone new/unrecognized.
//
// The underlying data has no per-article publish date, so `publishedAt` is
// optional — pass it when/if that becomes available. Without it, Aayushi's
// authorship is treated as pre-cutover (Pankaj / Migrate), which matches the
// two combinations she's currently credited for today (both migration guides,
// written before the Manage/Migrate split existed).

export const TEAMS = { MANAGE: 'Manage', MIGRATE: 'Migrate' };

const AAYUSHI_CUTOVER = Date.parse('2026-11-04T00:00:00Z');
const AAYUSHI_NAMES = new Set(['aayushi', 'ayushi']);

const MANAGE_ROSTER = new Set(['rashmi ramesh']);
const MIGRATE_ROSTER = new Set([
  'pankaj rai',
  'preksha',
  'preksha joshi',
  'bhuvaneswari',
  'bhuvaneswari gireesh',
]);

const PANKAJ = 'Pankaj Rai';

// Resolve a raw `author` string (as stored on a combination) to who it should
// actually be credited to and which team that falls under. Returns null for no
// author (unattributed content, e.g. the PPC group).
export function resolveAuthorship(rawAuthor, publishedAt) {
  const name = String(rawAuthor || '').trim();
  if (!name) return null;
  const key = name.toLowerCase();

  if (AAYUSHI_NAMES.has(key)) {
    const ts = publishedAt ? Date.parse(publishedAt) : NaN;
    const isPostSwitch = Number.isFinite(ts) && ts >= AAYUSHI_CUTOVER;
    return isPostSwitch
      ? { displayName: 'Aayushi', team: TEAMS.MANAGE }
      : { displayName: PANKAJ, team: TEAMS.MIGRATE };
  }
  if (MANAGE_ROSTER.has(key)) return { displayName: name, team: TEAMS.MANAGE };
  if (MIGRATE_ROSTER.has(key)) return { displayName: name, team: TEAMS.MIGRATE };
  // Unrecognized author — folds into Pankaj / Migrate.
  return { displayName: PANKAJ, team: TEAMS.MIGRATE };
}

// Team for a combination object (from /api/combinations, which carries `author`).
export function teamForCombo(combo) {
  return resolveAuthorship(combo?.author)?.team || null;
}

// Buckets the server's raw author list (/api/authors-index) into the two teams
// for display. Each entry keeps the RAW name for querying (the API's
// /api/author?name= is keyed on the exact stored author string) alongside a
// label that reflects re-attribution — e.g. Aayushi's pre-cutover combinations
// read "Pankaj Rai (from Ayushi)" rather than silently becoming indistinguishable
// from his own byline.
export function groupAuthorsByTeam(authorsList) {
  const groups = { [TEAMS.MIGRATE]: [], [TEAMS.MANAGE]: [] };
  for (const a of authorsList || []) {
    const r = resolveAuthorship(a.name);
    if (!r) continue;
    const label = r.displayName === a.name ? a.name : `${r.displayName} (from ${a.name})`;
    groups[r.team].push({ raw: a.name, label, displayName: r.displayName, pageCount: a.pageCount });
  }
  return groups;
}

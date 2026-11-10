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

// Display roster — the named individuals on each team, in the proper-cased form
// the UI shows. Always rendered in the sidebar (even at 0 pages), so a team
// member who hasn't been credited for anything yet still appears.
export const MIGRATE_ROSTER_NAMES = ['Pankaj Rai', 'Preksha', 'Bhuvaneswari'];
export const MANAGE_ROSTER_NAMES = ['Rashmi Ramesh', 'Aayushi'];

const AAYUSHI_CUTOVER = Date.parse('2026-11-04T00:00:00Z');
const AAYUSHI_NAMES = new Set(['aayushi', 'ayushi']);

const MANAGE_ROSTER = new Set(MANAGE_ROSTER_NAMES.map((n) => n.toLowerCase()));
const MIGRATE_ROSTER = new Set([
  ...MIGRATE_ROSTER_NAMES.map((n) => n.toLowerCase()),
  'preksha joshi',
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

// Sidebar team rosters — always the full named team, not just whoever already
// has content. A member with nothing published yet still shows up (0 pages)
// rather than being invisible until their first article lands. Each entry's
// `raw` is only set when the server's author index has an EXACT match for that
// name — content re-attributed from someone else (e.g. Aayushi's pre-cutover
// work, now credited to Pankaj) is folded into his own count, never called out
// as a separate "(from X)" entry.
export function groupAuthorsByTeam(authorsList) {
  const byName = new Map((authorsList || []).map((a) => [a.name.toLowerCase(), a]));
  const build = (names) =>
    names.map((name) => {
      const match = byName.get(name.toLowerCase());
      return { raw: match ? match.name : name, displayName: name, label: name, pageCount: match?.pageCount || 0 };
    });
  return {
    [TEAMS.MIGRATE]: build(MIGRATE_ROSTER_NAMES),
    [TEAMS.MANAGE]: build(MANAGE_ROSTER_NAMES),
  };
}

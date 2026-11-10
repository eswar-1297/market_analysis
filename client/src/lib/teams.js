// Team presentation helpers.
//
// The attribution RULES live on the server (server/attribution.js) and are applied
// per article before anything reaches the browser: /api/combinations reports the
// authors of each combination's pages, and /api/authors-index reports the roster
// with each member's team. Nothing here re-derives who wrote what — duplicating
// those rules in two languages is how the two ends drift apart.
//
// What stays here is purely how teams are drawn: their order, and the CSS class
// that gives each one its colour.

export const TEAMS = { MANAGE: 'Manage', MIGRATE: 'Migrate' };

// Display order wherever both teams appear.
export const TEAM_ORDER = [TEAMS.MIGRATE, TEAMS.MANAGE];

// CSS modifier for a team ("migrate" / "manage"), used by the dots, pills and
// tile accents. Unknown or absent teams fall back to the neutral style.
export const teamClass = (team) => (team ? String(team).toLowerCase() : 'neutral');

// The team a combination belongs to, as reported by the server. A combination
// whose pages span both teams reports both; the first is used for its accent.
export function teamForCombo(combo) {
  return combo?.teams?.[0] || null;
}

// Group the roster from /api/authors-index by team, preserving the server's order
// within each team. Members with nothing published yet are included at zero — a
// writer who has not been credited for a tracked page still belongs on the list.
export function groupAuthorsByTeam(authorsList) {
  const groups = { [TEAMS.MIGRATE]: [], [TEAMS.MANAGE]: [] };
  for (const a of authorsList || []) {
    if (!groups[a.team]) continue;
    groups[a.team].push(a);
  }
  return groups;
}

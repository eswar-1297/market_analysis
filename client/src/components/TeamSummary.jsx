import { TEAM_ORDER, teamClass } from '../lib/teams.js';

// Per-team output, counted from the authorship the server has already resolved
// per article (/api/authors-index + the authors on each combination).
//
// Deliberately NOT leads/clicks/views: those metrics exist per COMBINATION, and a
// combination's articles can be written by both teams — several are. Splitting a
// combination's leads between teams would mean inventing a share, and charging the
// whole figure to whichever team happens to be listed first overstates one and
// zeroes the other. Article and combination counts are exact, so those are what
// this reports; the per-combination numbers live in the tiles below, where they
// are true.
export default function TeamSummary({ authorsList, combos }) {
  const byTeam = Object.fromEntries(
    TEAM_ORDER.map((team) => {
      const people = (authorsList || []).filter((a) => a.team === team);
      const articles = people.reduce((n, a) => n + (a.pageCount || 0), 0);
      const names = new Set(people.map((a) => a.name));
      const combinations = (combos || []).filter(
        (c) => !c.excludeFromOverview && (c.authors || []).some((a) => names.has(a.name))
      ).length;
      // Busiest first, and only people who actually have credited articles.
      const contributors = [...people].filter((a) => a.pageCount > 0).sort((a, b) => b.pageCount - a.pageCount);
      return [team, { people, contributors, articles, combinations }];
    })
  );

  return (
    <div className="grid team-cards">
      {TEAM_ORDER.map((team) => {
        const t = byTeam[team];
        return (
          <div className={`card team-card ${teamClass(team)}`} key={team}>
            <div className="team-card-head">
              <span className={`team-dot ${teamClass(team)}`} />
              <span className="team-card-label">{team} team</span>
              <span className="team-card-count">
                {t.people.length} {t.people.length === 1 ? 'person' : 'people'}
              </span>
            </div>

            <div className="team-card-stats">
              <div className="team-stat">
                <span className="value">{t.articles}</span>
                <span className="k">Articles</span>
              </div>
              <div className="team-stat">
                <span className="value">{t.combinations}</span>
                <span className="k">Combinations</span>
              </div>
            </div>

            <div className="team-card-people" data-hj-suppress>
              {t.contributors.map((a) => (
                <span className="team-person" key={a.name}>
                  {a.name}
                  <span className="team-person-count">{a.pageCount}</span>
                </span>
              ))}
              {!t.contributors.length && <span className="team-person-none">No credited articles yet</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

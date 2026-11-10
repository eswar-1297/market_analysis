import { TEAMS, teamForCombo } from '../lib/teams.js';

const fmt = (n) => (n == null ? '—' : n >= 1000 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));

const CARDS = [
  { key: TEAMS.MIGRATE, label: 'Migrate team', tone: 'migrate' },
  { key: TEAMS.MANAGE, label: 'Manage team', tone: 'manage' },
];

// Rolls the all-combinations overview up by team (Manage vs Migrate), using the
// author -> team mapping in lib/teams.js. Purely a client-side aggregation over
// data the API already returns — no backend involvement.
export default function TeamSummary({ rows, combos }) {
  const comboById = new Map(combos.map((c) => [c.id, c]));
  const totals = {
    [TEAMS.MIGRATE]: { leads: 0, ppcLeads: 0, clicks: 0, views: 0, combos: 0 },
    [TEAMS.MANAGE]: { leads: 0, ppcLeads: 0, clicks: 0, views: 0, combos: 0 },
  };

  for (const r of rows) {
    const combo = comboById.get(r.id);
    const team = combo ? teamForCombo(combo) : null;
    if (!team) continue;
    const t = totals[team];
    t.leads += r.leads || 0;
    t.ppcLeads += r.ppcLeads || 0;
    t.clicks += r.clicks || 0;
    t.views += r.views || 0;
    t.combos += 1;
  }

  return (
    <div className="grid team-cards">
      {CARDS.map((c) => {
        const t = totals[c.key];
        return (
          <div className={`card team-card ${c.tone}`} key={c.key}>
            <div className="team-card-head">
              <span className={`team-dot ${c.tone}`} />
              <span className="team-card-label">{c.label}</span>
              <span className="team-card-count">
                {t.combos} combination{t.combos !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="team-card-stats">
              <div className="team-stat">
                <span className="value">{fmt(t.leads + t.ppcLeads)}</span>
                <span className="k">Total leads</span>
              </div>
              <div className="team-stat">
                <span className="value">{fmt(t.clicks)}</span>
                <span className="k">Organic clicks</span>
              </div>
              <div className="team-stat">
                <span className="value">{fmt(t.views)}</span>
                <span className="k">Views</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

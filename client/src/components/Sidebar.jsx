import { useMemo, useState } from 'react';
import { TEAMS, teamForCombo, groupAuthorsByTeam } from '../lib/teams.js';

const TEAM_ORDER = [TEAMS.MIGRATE, TEAMS.MANAGE];

function ComboRow({ combo, active, onClick }) {
  const team = teamForCombo(combo);
  return (
    <button
      type="button"
      className={`combo-item${active ? ' active' : ''}`}
      onClick={onClick}
      aria-label={`${combo.name} — ${combo.pageCount} page${combo.pageCount !== 1 ? 's' : ''}`}
    >
      <span className={`dot ${team ? team.toLowerCase() : 'neutral'}`} />
      <span className="combo-item-body">
        <span className="name">{combo.name}</span>
        <span className="meta">
          {combo.pageCount} page{combo.pageCount !== 1 ? 's' : ''}
        </span>
      </span>
    </button>
  );
}

export default function Sidebar({
  combos,
  selectedId,
  overviewMode,
  authorMode,
  selectedAuthor,
  authorsList,
  meta,
  onSelectCombo,
  onSelectAuthor,
}) {
  const [q, setQ] = useState('');

  const realCombos = useMemo(() => combos.filter((c) => !c.excludeFromOverview), [combos]);
  const ppcCombos = useMemo(() => combos.filter((c) => c.excludeFromOverview), [combos]);

  const query = q.trim().toLowerCase();
  const matches = (c) => !query || c.name.toLowerCase().includes(query);

  const byTeam = useMemo(() => {
    const out = { [TEAMS.MIGRATE]: [], [TEAMS.MANAGE]: [] };
    for (const c of realCombos) {
      const team = teamForCombo(c);
      if (team && out[team]) out[team].push(c);
    }
    return out;
  }, [realCombos]);

  const authorGroups = useMemo(() => groupAuthorsByTeam(authorsList), [authorsList]);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          Cloud<span>Fuze</span>
        </div>
        <div className="brand-sub">Marketing Dashboard</div>
      </div>

      <nav className="side-nav">
        <button
          type="button"
          className={`side-link${overviewMode ? ' active' : ''}`}
          onClick={() => onSelectCombo('__all__')}
        >
          <span className="side-link-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="15" height="15">
              <rect x="1" y="1" width="6" height="6" rx="1.4" fill="currentColor" />
              <rect x="9" y="1" width="6" height="6" rx="1.4" fill="currentColor" opacity="0.55" />
              <rect x="1" y="9" width="6" height="6" rx="1.4" fill="currentColor" opacity="0.55" />
              <rect x="9" y="9" width="6" height="6" rx="1.4" fill="currentColor" />
            </svg>
          </span>
          All combinations
          <span className="side-link-count">{realCombos.length}</span>
        </button>
      </nav>

      <div className="sidebar-search">
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" className="sidebar-search-icon">
          <circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 10l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          className="search"
          placeholder="Search combinations…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="sidebar-scroll">
        {TEAM_ORDER.map((team) => {
          const teamCombos = byTeam[team].filter(matches);
          const authors = authorGroups[team] || [];
          if (!teamCombos.length && query) return null;
          return (
            <div className="team-group" key={team}>
              <div className={`team-heading ${team.toLowerCase()}`}>
                <span className={`team-dot ${team.toLowerCase()}`} />
                {team} team
                <span className="team-heading-count">{byTeam[team].length}</span>
              </div>

              {authors.length > 0 && !query && (
                <div className="author-chips" data-hj-suppress>
                  {authors.map((a) => (
                    <button
                      key={a.raw}
                      type="button"
                      className={`author-chip${authorMode && selectedAuthor === a.raw ? ' active' : ''}`}
                      title={`${a.label} — ${a.pageCount} page${a.pageCount !== 1 ? 's' : ''}`}
                      onClick={() => onSelectAuthor(a.raw)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="combo-group-list">
                {teamCombos.map((c) => (
                  <ComboRow
                    key={c.id}
                    combo={c}
                    active={!overviewMode && !authorMode && c.id === selectedId}
                    onClick={() => onSelectCombo(c.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {ppcCombos.filter(matches).length > 0 && (
          <div className="team-group">
            <div className="team-heading ppc">
              <span className="team-dot ppc" />
              Paid Search (PPC)
            </div>
            <div className="combo-group-list">
              {ppcCombos.filter(matches).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`combo-item${c.id === selectedId ? ' active' : ''}`}
                  onClick={() => onSelectCombo(c.id)}
                  aria-label={`${c.name} — All campaigns, Google Ads`}
                >
                  <span className="dot ppc" />
                  <span className="combo-item-body">
                    <span className="name">{c.name}</span>
                    <span className="meta">All campaigns · Google Ads</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="sidebar-foot">
        {meta ? `${meta.combinationCount} combinations · ${meta.pageCount} pages` : ' '}
      </div>
    </aside>
  );
}

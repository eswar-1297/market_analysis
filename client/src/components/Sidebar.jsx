import { useMemo, useState } from 'react';
import { TEAM_ORDER, teamClass, teamForCombo, groupAuthorsByTeam } from '../lib/teams.js';

function ComboRow({ combo, active, onClick }) {
  const team = teamForCombo(combo);
  return (
    <button
      type="button"
      className={`combo-item${active ? ' active' : ''}`}
      onClick={onClick}
      aria-label={`${combo.name} — ${combo.pageCount} page${combo.pageCount !== 1 ? 's' : ''}`}
    >
      <span className={`dot ${teamClass(team)}`} />
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

  // Grouped by team, with an explicit bucket for combinations that belong to
  // neither — a combination made only of unbylined pages has no team, and
  // dropping it would quietly remove it from the only navigation there is.
  const { byTeam, teamless } = useMemo(() => {
    const out = Object.fromEntries(TEAM_ORDER.map((t) => [t, []]));
    const rest = [];
    for (const c of realCombos) {
      const team = teamForCombo(c);
      if (team && out[team]) out[team].push(c);
      else rest.push(c);
    }
    return { byTeam: out, teamless: rest };
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
                      key={a.name}
                      type="button"
                      className={`author-chip${authorMode && selectedAuthor === a.name ? ' active' : ''}${
                        a.pageCount ? '' : ' empty'
                      }`}
                      title={`${a.name} — ${a.pageCount} page${a.pageCount !== 1 ? 's' : ''}`}
                      onClick={() => onSelectAuthor(a.name)}
                    >
                      {a.name}
                      <span className="author-chip-count">{a.pageCount}</span>
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

        {teamless.filter(matches).length > 0 && (
          <div className="team-group">
            <div className="team-heading">
              <span className="team-dot" />
              Unattributed
              <span className="team-heading-count">{teamless.length}</span>
            </div>
            <div className="combo-group-list">
              {teamless.filter(matches).map((c) => (
                <ComboRow
                  key={c.id}
                  combo={c}
                  active={!overviewMode && !authorMode && c.id === selectedId}
                  onClick={() => onSelectCombo(c.id)}
                />
              ))}
            </div>
          </div>
        )}

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

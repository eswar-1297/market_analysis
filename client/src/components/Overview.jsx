import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import PerfRefresh from './PerfRefresh.jsx';
import PerfCell from './PerfCell.jsx';
import { pollDelay } from '../perfPoll.js';
import { sortRows } from '../rangeFilter.js';
import { TEAMS, teamClass, teamForCombo } from '../lib/teams.js';

// Mobile and desktop are separate, non-comparable PageSpeed measurements.
const PROFILES = ['mobile', 'desktop'];
const titleCase = (s) => `${s[0].toUpperCase()}${s.slice(1)}`;

const fmt = (n) => (n == null ? '—' : n >= 1000 ? (n / 1e3).toFixed(1) + 'k' : String(n));

function Delta({ d }) {
  if (!d) return null;
  const arrow = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '';
  return (
    <span className={`tile-delta ${d.dir}`}>
      {arrow ? arrow + ' ' : ''}
      {d.pct > 0 ? '+' : ''}
      {d.pct}%
    </span>
  );
}

function Stat({ label, value, display, delta, compare }) {
  return (
    <div className="tile-stat-cell">
      <div className="tile-stat-val">
        {display ?? fmt(value)}
        {compare && <Delta d={delta} />}
      </div>
      <div className="tile-stat-label">{label}</div>
    </div>
  );
}

// All combinations at a glance, as a tile grid. Click a tile to drill in.
export default function Overview({ rows, combos, onOpen, compare = false }) {
  // Average performance per combination, from the daily pre-measured snapshot —
  // so this normally resolves on the first request instead of running a live
  // PageSpeed call per page.
  // One request per combination returns BOTH profiles, so a single poll drives
  // both scores. undefined = still loading.
  const [perf, setPerf] = useState({}); // id -> { [strategy]: { score, at, stale, error } }
  const live = useRef({ cancelled: false, timers: [] });
  const [sort, setSort] = useState({ key: 'leads', dir: 'desc' });
  const [teamFilter, setTeamFilter] = useState('all'); // 'all' | TEAMS.MIGRATE | TEAMS.MANAGE

  const loadPerf = useCallback((id, { force = false } = {}) => {
    setPerf((s) => ({ ...s, [id]: undefined }));
    const step = (attempt) => {
      api
        .comboPerf(id, force && attempt === 0)
        .then((d) => {
          if (live.current.cancelled) return;
          if (d.anyPending) {
            live.current.timers.push(setTimeout(() => step(attempt + 1), pollDelay(attempt, 4000)));
            return;
          }
          const byProfile = {};
          for (const s of PROFILES) {
            const r = d.strategies?.[s];
            byProfile[s] = {
              score: r && r.status === 'ready' ? r.perf ?? null : null,
              at: r?.measuredAt ?? null,
              stale: r?.stale ? r.staleReason || true : false,
              error: r?.status === 'failed' ? r.error || 'PageSpeed returned no score' : null,
            };
          }
          setPerf((s) => ({ ...s, [id]: byProfile }));
        })
        .catch((err) => {
          if (live.current.cancelled) return;
          const msg = err.message || 'request failed';
          setPerf((s) => ({
            ...s,
            [id]: Object.fromEntries(PROFILES.map((p) => [p, { score: null, at: null, stale: false, error: msg }])),
          }));
        });
    };
    step(0);
  }, []);

  useEffect(() => {
    const bag = { cancelled: false, timers: [] };
    live.current = bag;
    setPerf({});
    for (const r of rows) loadPerf(r.id);
    return () => {
      bag.cancelled = true;
      bag.timers.forEach(clearTimeout);
    };
  }, [rows, loadPerf]);

  const refreshAllPerf = () => {
    for (const r of rows) loadPerf(r.id, { force: true });
  };
  const at = (id, s) => perf[id]?.[s];
  const perfBusy = rows.some((r) => perf[r.id] === undefined);
  const perfStaleAny = rows.flatMap((r) => PROFILES.map((s) => at(r.id, s)?.stale)).find(Boolean) ?? false;
  const perfMeasuredAt = rows
    .flatMap((r) => PROFILES.map((s) => at(r.id, s)?.at))
    .reduce((a, t) => (t && (a == null || t > a) ? t : a), null);

  const comboById = useMemo(() => new Map(combos.map((c) => [c.id, c])), [combos]);

  const sortCols = [
    { key: 'name', label: 'Name', get: (r) => r.name },
    { key: 'leads', label: 'Leads', get: (r) => (r.leads || 0) + (r.ppcLeads || 0) },
    { key: 'clicks', label: 'Organic clicks', get: (r) => r.clicks },
    { key: 'impressions', label: 'Impressions', get: (r) => r.impressions },
    { key: 'position', label: 'Avg. position', get: (r) => r.position },
    { key: 'activeUsers', label: 'Active users', get: (r) => r.activeUsers },
    { key: 'bounceRate', label: 'Bounce rate', get: (r) => r.bounceRate },
    ...PROFILES.map((s) => ({
      key: `perf_${s}`,
      label: `Perf. ${titleCase(s)}`,
      get: (r) => at(r.id, s)?.score,
    })),
  ];

  const byTeam = useMemo(() => {
    if (teamFilter === 'all') return rows;
    return rows.filter((r) => teamForCombo(comboById.get(r.id)) === teamFilter);
  }, [rows, teamFilter, comboById]);

  const visible = useMemo(
    () => sortRows(byTeam, sort, sortCols),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byTeam, sort, perf]
  );
  const toggleSort = (key) => setSort({ key, dir: key === 'name' ? 'asc' : 'desc' });

  const teamCounts = useMemo(() => {
    const out = { [TEAMS.MIGRATE]: 0, [TEAMS.MANAGE]: 0 };
    for (const r of rows) {
      const t = teamForCombo(comboById.get(r.id));
      if (t) out[t] += 1;
    }
    return out;
  }, [rows, comboById]);

  return (
    <div>
      <div className="tiles-toolbar">
        <div className="team-filter">
          <button type="button" className={`team-filter-btn${teamFilter === 'all' ? ' active' : ''}`} onClick={() => setTeamFilter('all')}>
            All <span className="count">{rows.length}</span>
          </button>
          <button
            type="button"
            className={`team-filter-btn migrate${teamFilter === TEAMS.MIGRATE ? ' active' : ''}`}
            onClick={() => setTeamFilter(TEAMS.MIGRATE)}
          >
            <span className="team-dot migrate" /> Migrate <span className="count">{teamCounts[TEAMS.MIGRATE]}</span>
          </button>
          <button
            type="button"
            className={`team-filter-btn manage${teamFilter === TEAMS.MANAGE ? ' active' : ''}`}
            onClick={() => setTeamFilter(TEAMS.MANAGE)}
          >
            <span className="team-dot manage" /> Manage <span className="count">{teamCounts[TEAMS.MANAGE]}</span>
          </button>
        </div>

        <div className="tiles-sort">
          <PerfRefresh
            inHeader
            measuredAt={perfMeasuredAt}
            strategy={PROFILES.join(' + ')}
            scope={`all ${rows.length} combinations on mobile and desktop — takes many minutes`}
            busy={perfBusy}
            stale={perfStaleAny}
            onClick={refreshAllPerf}
          />
          <label>Sort by</label>
          <select value={sort.key} onChange={(e) => toggleSort(e.target.value)}>
            {sortCols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <button type="button" className="sort-dir-btn" onClick={() => setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))}>
            {sort.dir === 'asc' ? '▲ Lowest first' : '▼ Highest first'}
          </button>
        </div>
      </div>

      <div className="combo-tiles">
        {visible.map((r) => {
          const combo = comboById.get(r.id);
          // Authorship is resolved server-side, per article. A combination can
          // span several writers, so show the main one and say how many others.
          const authors = combo?.authors || [];
          const team = teamForCombo(combo);
          const dl = r.deltas || {};
          const totalLeads = (r.leads || 0) + (r.ppcLeads || 0);
          return (
            <div
              key={r.id}
              className={`combo-tile ${teamClass(team)}`}
              onClick={() => onOpen(r.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(r.id)}
            >
              <div className="tile-head">
                <span className="tile-name">{r.name}</span>
                <span className="tile-pages">{r.pageCount} page{r.pageCount !== 1 ? 's' : ''}</span>
              </div>

              {authors.length > 0 && (
                <div className="tile-meta">
                  <span className={`team-dot ${teamClass(team)}`} />
                  <span className="tile-author" data-hj-suppress>
                    {authors[0].name}
                    {authors.length > 1 && (
                      <span
                        className="tile-author-more"
                        title={authors.map((a) => `${a.name} (${a.pageCount})`).join(', ')}
                      >
                        {' '}+{authors.length - 1}
                      </span>
                    )}
                  </span>
                </div>
              )}

              <div className="tile-leads">
                <span className="tile-leads-value">{fmt(totalLeads)}</span>
                <span className="tile-leads-label">total leads</span>
                {compare && <Delta d={dl.leads} />}
                {r.ppcLeads > 0 && <span className="tile-ppc-chip">{r.ppcLeads} PPC</span>}
              </div>

              {/* Search Console, then GA4, then PageSpeed — the same grouping
                  the page table uses. The two performance scores share one cell
                  so the grid stays three across and each row of the tile maps to
                  one data source. */}
              <div className="tile-stats-grid">
                <Stat label="Clicks" value={r.clicks} delta={dl.clicks} compare={compare} />
                <Stat label="Impressions" value={r.impressions} delta={dl.impressions} compare={compare} />
                <Stat label="Position" value={r.position} display={r.position || '—'} delta={dl.position} compare={compare} />
                <Stat label="Active users" value={r.activeUsers} delta={dl.activeUsers} compare={compare} />
                <Stat
                  label="Bounce"
                  value={r.bounceRate}
                  display={r.bounceRate ? Math.round(r.bounceRate * 100) + '%' : '—'}
                  delta={dl.bounceRate}
                  compare={compare}
                />
                <div className="tile-stat-cell">
                  {/* The whole tile drills into the combination, so the refresh
                      control must not navigate. */}
                  <div className="tile-stat-val perf-wrap" onClick={(e) => e.stopPropagation()}>
                    {PROFILES.map((s, i) => (
                      <span key={s} className="perf-pair-item">
                        {i > 0 && <span className="perf-pair-sep">/</span>}
                        <PerfCell score={at(r.id, s)?.score} error={at(r.id, s)?.error} strategy={s} />
                      </span>
                    ))}
                    {perf[r.id] !== undefined && (
                      <PerfRefresh
                        measuredAt={perfMeasuredAt}
                        strategy={PROFILES.join(' + ')}
                        scope="this combination, on mobile and desktop"
                        stale={PROFILES.map((s) => at(r.id, s)?.stale).find(Boolean) ?? false}
                        onClick={() => loadPerf(r.id, { force: true })}
                      />
                    )}
                  </div>
                  <div className="tile-stat-label">Perf. M / D</div>
                </div>
              </div>
            </div>
          );
        })}
        {!visible.length && <div className="empty">No combinations match this filter.</div>}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import PerfRefresh from './PerfRefresh.jsx';
import PerfCell from './PerfCell.jsx';
import { pollDelay } from '../perfPoll.js';
import { sortRows } from '../rangeFilter.js';
import { TEAMS, teamForCombo, resolveAuthorship } from '../lib/teams.js';

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
  const [perf, setPerf] = useState({}); // id -> score | null; undefined = loading
  const [perfAt, setPerfAt] = useState({}); // id -> when that score was measured
  const [perfStale, setPerfStale] = useState({}); // id -> re-measure failed, showing the old score
  const [perfError, setPerfError] = useState({}); // id -> why there is no score at all
  const [strategy, setStrategy] = useState(null); // 'desktop' | 'mobile', per the server
  const live = useRef({ cancelled: false, timers: [] });
  const [sort, setSort] = useState({ key: 'leads', dir: 'desc' });
  const [teamFilter, setTeamFilter] = useState('all'); // 'all' | TEAMS.MIGRATE | TEAMS.MANAGE

  const loadPerf = useCallback((id, { force = false } = {}) => {
    setPerf((s) => ({ ...s, [id]: undefined }));
    setPerfError((e) => ({ ...e, [id]: null }));
    const step = (attempt) => {
      api
        .comboPerf(id, force && attempt === 0)
        .then((d) => {
          if (live.current.cancelled) return;
          if (d.status === 'pending') {
            live.current.timers.push(setTimeout(() => step(attempt + 1), pollDelay(attempt, 4000)));
            return;
          }
          if (d.strategy) setStrategy(d.strategy);
          setPerfAt((t) => ({ ...t, [id]: d.measuredAt ?? null }));
          setPerfStale((f) => ({ ...f, [id]: d.stale ? d.staleReason || true : false }));
          setPerfError((e) => ({
            ...e,
            [id]: d.status === 'failed' ? d.error || 'PageSpeed returned no score' : null,
          }));
          setPerf((s) => ({ ...s, [id]: d.perf ?? null }));
        })
        .catch((err) => {
          if (live.current.cancelled) return;
          setPerfError((e) => ({ ...e, [id]: err.message || 'request failed' }));
          setPerf((s) => ({ ...s, [id]: null }));
        });
    };
    step(0);
  }, []);

  useEffect(() => {
    const bag = { cancelled: false, timers: [] };
    live.current = bag;
    setPerf({});
    setPerfAt({});
    setPerfStale({});
    setPerfError({});
    for (const r of rows) loadPerf(r.id);
    return () => {
      bag.cancelled = true;
      bag.timers.forEach(clearTimeout);
    };
  }, [rows, loadPerf]);

  const refreshAllPerf = () => {
    for (const r of rows) loadPerf(r.id, { force: true });
  };
  const perfBusy = rows.some((r) => perf[r.id] === undefined);
  const perfStaleAny = rows.map((r) => perfStale[r.id]).find(Boolean) ?? false;
  const perfMeasuredAt = Object.values(perfAt).reduce((a, t) => (t && (a == null || t > a) ? t : a), null);

  const comboById = useMemo(() => new Map(combos.map((c) => [c.id, c])), [combos]);

  const sortCols = [
    { key: 'name', label: 'Name', get: (r) => r.name },
    { key: 'leads', label: 'Leads', get: (r) => (r.leads || 0) + (r.ppcLeads || 0) },
    { key: 'position', label: 'Avg. position', get: (r) => r.position },
    { key: 'impressions', label: 'Impressions', get: (r) => r.impressions },
    { key: 'clicks', label: 'Organic clicks', get: (r) => r.clicks },
    { key: 'views', label: 'Views', get: (r) => r.views },
    { key: 'bounceRate', label: 'Bounce rate', get: (r) => r.bounceRate },
    { key: 'perf', label: 'Perf.', get: (r) => perf[r.id] },
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
            strategy={strategy}
            scope={`all ${rows.length} combinations — takes several minutes`}
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
          const authorship = combo?.author ? resolveAuthorship(combo.author) : null;
          const team = authorship?.team;
          const dl = r.deltas || {};
          const totalLeads = (r.leads || 0) + (r.ppcLeads || 0);
          return (
            <div
              key={r.id}
              className={`combo-tile${team ? ` ${team.toLowerCase()}` : ''}`}
              onClick={() => onOpen(r.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(r.id)}
            >
              <div className="tile-head">
                <span className="tile-name">{r.name}</span>
                <span className="tile-pages">{r.pageCount} page{r.pageCount !== 1 ? 's' : ''}</span>
              </div>

              {authorship && (
                <div className="tile-meta">
                  <span className={`team-dot ${team.toLowerCase()}`} />
                  <span className="tile-author" data-hj-suppress>
                    {authorship.displayName}
                  </span>
                </div>
              )}

              <div className="tile-leads">
                <span className="tile-leads-value">{fmt(totalLeads)}</span>
                <span className="tile-leads-label">total leads</span>
                {compare && <Delta d={dl.leads} />}
                {r.ppcLeads > 0 && <span className="tile-ppc-chip">{r.ppcLeads} PPC</span>}
              </div>

              <div className="tile-stats-grid">
                <Stat label="Position" value={r.position} display={r.position || '—'} delta={dl.position} compare={compare} />
                <Stat label="Impressions" value={r.impressions} delta={dl.impressions} compare={compare} />
                <Stat label="Clicks" value={r.clicks} delta={dl.clicks} compare={compare} />
                <Stat label="Views" value={r.views} delta={dl.views} compare={compare} />
                <Stat
                  label="Bounce"
                  value={r.bounceRate}
                  display={r.bounceRate ? Math.round(r.bounceRate * 100) + '%' : '—'}
                  delta={dl.bounceRate}
                  compare={compare}
                />
                <div className="tile-stat-cell">
                  <div className="tile-stat-val perf-wrap" onClick={(e) => e.stopPropagation()}>
                    <PerfCell score={perf[r.id]} error={perfError[r.id]} />
                    {perf[r.id] !== undefined && (
                      <PerfRefresh
                        measuredAt={perfAt[r.id]}
                        strategy={strategy}
                        scope="this combination"
                        stale={perfStale[r.id]}
                        onClick={() => loadPerf(r.id, { force: true })}
                      />
                    )}
                  </div>
                  <div className="tile-stat-label">Perf.</div>
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import ColumnFilter from './ColumnFilter.jsx';
import PerfRefresh from './PerfRefresh.jsx';
import { makeRanges, fmtRound, inRange, nextSort, sortRows } from '../rangeFilter.js';

const fmt = (n) => (n == null ? '—' : n >= 1000 ? (n / 1e3).toFixed(1) + 'k' : String(n));

function Delta({ d }) {
  if (!d) return null;
  // Flat cells show just "0%" — no leading arrow (an em-dash before "0%" reads
  // like a minus sign, i.e. "-0%").
  const arrow = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '';
  return (
    <div className={`cell-delta ${d.dir}`}>
      {arrow ? arrow + ' ' : ''}
      {d.pct > 0 ? '+' : ''}
      {d.pct}%
    </div>
  );
}

function Cell({ value, delta, display, compare }) {
  return (
    <td>
      <div className="cell-val">{display ?? fmt(value)}</div>
      {compare && <Delta d={delta} />}
    </td>
  );
}

// All combinations at a glance. Click a row to drill into that combination.
export default function Overview({ rows, onOpen, compare = false }) {
  // Average performance per combination, from the daily pre-measured snapshot —
  // so this normally resolves on the first request instead of running a live
  // PageSpeed call per page.
  const [perf, setPerf] = useState({}); // id -> score | null; undefined = loading
  const [perfAt, setPerfAt] = useState({}); // id -> when that score was measured
  const [perfStale, setPerfStale] = useState({}); // id -> re-measure failed, showing the old score
  const [strategy, setStrategy] = useState(null); // 'desktop' | 'mobile', per the server
  // Shared cancel/timer bag for the in-flight polls, so a date/region change stops
  // them — including polls a row's own refresh button started.
  const live = useRef({ cancelled: false, timers: [] });
  const [filters, setFilters] = useState({}); // colKey -> { lo, hi, idx } | undefined
  const [sort, setSort] = useState(null); // { key, dir: 'asc' | 'desc' } | null

  // Load ONE combination's average. Normally answered from the daily snapshot at
  // once; when pages have to be measured the server replies "pending" rather than
  // holding the request open, so we poll and that one cell spins.
  // `force` re-measures that combination's pages — a row's own button calls it for
  // one row, the header button for every row. Only the FIRST request forces; a poll
  // that kept asking would restart the measurement every 4s and never settle.
  const loadPerf = useCallback((id, { force = false } = {}) => {
    setPerf((s) => ({ ...s, [id]: undefined }));
    const step = (attempt) => {
      api
        .comboPerf(id, force && attempt === 0)
        .then((d) => {
          if (live.current.cancelled) return;
          if (d.status === 'pending' && attempt < 150) {
            live.current.timers.push(setTimeout(() => step(attempt + 1), 4000));
            return;
          }
          if (d.strategy) setStrategy(d.strategy);
          setPerfAt((t) => ({ ...t, [id]: d.measuredAt ?? null }));
          setPerfStale((f) => ({ ...f, [id]: d.stale ? d.staleReason || true : false }));
          setPerf((s) => ({ ...s, [id]: d.status === 'pending' ? null : d.perf ?? null }));
        })
        .catch(() => !live.current.cancelled && setPerf((s) => ({ ...s, [id]: null })));
    };
    step(0);
  }, []);

  useEffect(() => {
    const bag = { cancelled: false, timers: [] };
    live.current = bag;
    setPerf({});
    setPerfAt({});
    setPerfStale({});
    for (const r of rows) loadPerf(r.id);
    return () => {
      bag.cancelled = true;
      bag.timers.forEach(clearTimeout);
    };
  }, [rows, loadPerf]);

  // Header button: re-measure every combination in the table. That's every page on
  // the site at ~20s each, four at a time, so it runs for several minutes — the
  // tooltip says so, and each row's cell spins until its own average lands.
  const refreshAllPerf = () => {
    for (const r of rows) loadPerf(r.id, { force: true });
  };
  const perfBusy = rows.some((r) => perf[r.id] === undefined);
  const perfStaleAny = rows.map((r) => perfStale[r.id]).find(Boolean) ?? false;
  // Newest reading on screen, for the button's "measured …" tooltip.
  const perfMeasuredAt = Object.values(perfAt).reduce((a, t) => (t && (a == null || t > a) ? t : a), null);

  // Numeric columns that get a range filter on their header (in header order).
  const cols = [
    { key: 'position', label: 'Avg. position', get: (r) => r.position, format: (v) => String(Math.round(v)) },
    { key: 'impressions', label: 'Impressions', get: (r) => r.impressions, format: fmtRound },
    { key: 'clicks', label: 'Organic clicks', get: (r) => r.clicks, format: fmtRound },
    { key: 'views', label: 'Views', get: (r) => r.views, format: fmtRound },
    { key: 'bounceRate', label: 'Bounce rate', get: (r) => r.bounceRate, format: (v) => Math.round(v * 100) + '%' },
    { key: 'leads', label: 'Organic Leads', get: (r) => r.leads, format: (v) => String(Math.round(v)) },
    { key: 'ppcLeads', label: 'PPC Leads', get: (r) => r.ppcLeads, format: (v) => String(Math.round(v)) },
    { key: 'perf', label: 'Perf.', get: (r) => perf[r.id], format: (v) => String(Math.round(v)) },
  ];

  // Range options per column, derived from the current data (recomputed as perf
  // scores stream in).
  const ranges = useMemo(() => {
    const out = {};
    for (const c of cols) out[c.key] = makeRanges(rows.map(c.get), c.format);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, perf]);

  // Apply the selected range filters. Rows with a missing value for a filtered
  // column (e.g. perf still loading) are kept rather than hidden.
  const filtered = useMemo(() => {
    return rows.filter((r) => cols.every((c) => inRange(c.get(r), filters[c.key])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filters, perf]);

  const anyFilter = Object.values(filters).some(Boolean);

  // The name column sorts alphabetically but has no range to filter on, so it
  // lives outside `cols`.
  const nameCol = { key: 'name', label: 'Combination', get: (r) => r.name };

  // Sorting runs after filtering, on whatever is visible. `sort === null` leaves
  // the server's own ordering intact.
  const visible = useMemo(
    () => sortRows(filtered, sort, [nameCol, ...cols]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, sort, perf]
  );
  const toggleSort = (key) => setSort((s) => nextSort(s, key));
  const sortDir = (key) => (sort?.key === key ? sort.dir : null);
  const sortLabel = sort && [nameCol, ...cols].find((c) => c.key === sort.key)?.label;

  return (
    <div>
      {(anyFilter || sort) && (
        <div className="filter-summary">
          {anyFilter && <span>Showing {visible.length} of {rows.length}</span>}
          {sort && (
            <span>
              Sorted by {sortLabel} — {sort.dir === 'asc' ? 'lowest first' : 'highest first'}
            </span>
          )}
          {anyFilter && (
            <button type="button" className="filter-clear" onClick={() => setFilters({})}>
              Clear filters
            </button>
          )}
          {sort && (
            <button type="button" className="filter-clear" onClick={() => setSort(null)}>
              Reset sort
            </button>
          )}
        </div>
      )}
      <div className="table-card">
        <table className="fixed-table">
          <thead>
            <tr>
              <th>
                <ColumnFilter label={nameCol.label} sort={sortDir(nameCol.key)} onSort={() => toggleSort(nameCol.key)} />
              </th>
              {cols.map((c) => (
                <th key={c.key}>
                  <ColumnFilter
                    label={c.label}
                    options={ranges[c.key]}
                    value={filters[c.key]?.idx ?? null}
                    onChange={(idx) =>
                      setFilters((f) => ({
                        ...f,
                        [c.key]: idx == null ? undefined : { ...ranges[c.key][idx], idx },
                      }))
                    }
                    sort={sortDir(c.key)}
                    onSort={() => toggleSort(c.key)}
                    action={
                      c.key === 'perf' ? (
                        <PerfRefresh
                          inHeader
                          measuredAt={perfMeasuredAt}
                          strategy={strategy}
                          scope={`all ${rows.length} combinations — takes several minutes`}
                          busy={perfBusy}
                          stale={perfStaleAny}
                          onClick={refreshAllPerf}
                        />
                      ) : null
                    }
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const dl = r.deltas || {};
              return (
                <tr key={r.id} className="clickable-row" onClick={() => onOpen(r.id)}>
                  <td>
                    <span className="combo-link">{r.name}</span>{' '}
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>({r.pageCount})</span>
                  </td>
                  <Cell value={r.position} delta={dl.position} display={r.position || '—'} compare={compare} />
                  <Cell value={r.impressions} delta={dl.impressions} compare={compare} />
                  <Cell value={r.clicks} delta={dl.clicks} compare={compare} />
                  <Cell value={r.views} delta={dl.views} compare={compare} />
                  <Cell
                    value={r.bounceRate}
                    delta={dl.bounceRate}
                    display={r.bounceRate ? Math.round(r.bounceRate * 100) + '%' : '—'}
                    compare={compare}
                  />
                  <Cell value={r.leads} delta={dl.leads} compare={compare} />
                  <Cell value={r.ppcLeads} delta={dl.ppcLeads} compare={compare} />
                  {/* Each row re-measures on its own — refreshing one combination
                      shouldn't re-measure every other combination's pages too. */}
                  <td>
                    <span className="perf-cell">
                      {perf[r.id] === undefined ? (
                        <span className="spinner" />
                      ) : (
                        <>
                          {perf[r.id] != null ? (
                            <span className={perf[r.id] < 97 ? 'perf-low' : ''}>{perf[r.id]}</span>
                          ) : (
                            '—'
                          )}
                          <PerfRefresh
                            measuredAt={perfAt[r.id]}
                            strategy={strategy}
                            scope="this combination"
                            stale={perfStale[r.id]}
                            onClick={() => loadPerf(r.id, { force: true })}
                          />
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr>
                <td colSpan={9} style={{ color: 'var(--muted)', textAlign: 'center', padding: '18px' }}>
                  No combinations match the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

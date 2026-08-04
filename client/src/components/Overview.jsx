import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import ColumnFilter from './ColumnFilter.jsx';
import { makeRanges, fmtRound, inRange } from '../rangeFilter.js';

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
  // Average performance per combination — loaded lazily (slow PageSpeed calls).
  const [perf, setPerf] = useState({}); // id -> score | null; undefined = loading
  const [filters, setFilters] = useState({}); // colKey -> { lo, hi, idx } | undefined

  useEffect(() => {
    let cancelled = false;
    setPerf({});
    for (const r of rows) {
      api
        .comboPerf(r.id)
        .then((d) => !cancelled && setPerf((s) => ({ ...s, [r.id]: d.perf })))
        .catch(() => !cancelled && setPerf((s) => ({ ...s, [r.id]: null })));
    }
    return () => {
      cancelled = true;
    };
  }, [rows]);

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

  return (
    <div>
      {anyFilter && (
        <div className="filter-summary">
          Showing {filtered.length} of {rows.length}
          <button type="button" className="filter-clear" onClick={() => setFilters({})}>
            Clear filters
          </button>
        </div>
      )}
      <div className="table-card">
        <table className="fixed-table">
          <thead>
            <tr>
              <th>Combination</th>
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
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
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
                  <td>
                    {perf[r.id] === undefined ? (
                      <span className="spinner" />
                    ) : perf[r.id] != null ? (
                      <span className={perf[r.id] < 97 ? 'perf-low' : ''}>{perf[r.id]}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
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

import { useEffect, useState } from 'react';
import { api } from '../api.js';

const fmt = (n) => (n == null ? '—' : n >= 1000 ? (n / 1e3).toFixed(1) + 'k' : String(n));

function Delta({ d }) {
  if (!d) return null;
  const arrow = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '—';
  return (
    <div className={`cell-delta ${d.dir}`}>
      {arrow} {d.pct > 0 ? '+' : ''}
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

  return (
    <div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Combination</th>
              <th>Avg. position</th>
              <th>Impressions</th>
              <th>Organic clicks</th>
              <th>Views</th>
              <th>Bounce rate</th>
              <th>Conversions</th>
              <th>Perf.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
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
                  <Cell value={r.conversions} delta={dl.conversions} compare={compare} />
                  <td>{perf[r.id] === undefined ? <span className="spinner" /> : perf[r.id] != null ? perf[r.id] : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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

// A metric cell: current value on top, % change vs previous period beneath
// (the delta only shows when comparison is toggled on).
function Metric({ value, delta, display, compare }) {
  return (
    <td>
      <div className="cell-val">{display ?? fmt(value)}</div>
      {compare && <Delta d={delta} />}
    </td>
  );
}

export default function PageTable({ pages, compare = true }) {
  // Performance score loads lazily per page (slow PageSpeed call), so the table
  // renders instantly and the Perf. cell fills in when ready.
  const [perf, setPerf] = useState({}); // url -> score | null (failed); undefined = loading

  useEffect(() => {
    let cancelled = false;
    setPerf({});
    for (const p of pages) {
      api
        .cwv(p.url)
        .then((d) => !cancelled && setPerf((s) => ({ ...s, [p.url]: d.performanceScore })))
        .catch(() => !cancelled && setPerf((s) => ({ ...s, [p.url]: null })));
    }
    return () => {
      cancelled = true;
    };
  }, [pages]);

  return (
    <div>
      <div className="section-title">Pages ({pages.length})</div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Page</th>
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
            {pages.map((p) => {
              const dl = p.deltas || {};
              const score = perf[p.url];
              return (
                <tr key={p.url}>
                  <td>
                    <a href={p.url} target="_blank" rel="noreferrer" title={p.url}>
                      {p.label}
                    </a>
                  </td>
                  <Metric value={p.position} delta={dl.position} display={p.position || '—'} compare={compare} />
                  <Metric value={p.impressions} delta={dl.impressions} compare={compare} />
                  <Metric value={p.clicks} delta={dl.clicks} compare={compare} />
                  <Metric value={p.views} delta={dl.views} compare={compare} />
                  <Metric
                    value={p.bounceRate}
                    delta={dl.bounceRate}
                    display={p.bounceRate != null ? Math.round(p.bounceRate * 100) + '%' : '—'}
                    compare={compare}
                  />
                  <Metric value={p.conversions} delta={dl.conversions} compare={compare} />
                  <td>{score === undefined ? <span className="spinner" /> : score != null ? score : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

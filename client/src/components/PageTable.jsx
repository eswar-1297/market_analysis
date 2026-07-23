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
            {pages.length > 1 && (() => {
              // Cumulative row at the bottom: sums for counts, impression-weighted
              // position, view-weighted bounce rate, average performance.
              const t = pages.reduce(
                (a, p) => {
                  a.impressions += p.impressions || 0;
                  a.clicks += p.clicks || 0;
                  a.views += p.views || 0;
                  a.conversions += p.conversions || 0;
                  a.posW += (p.position || 0) * (p.impressions || 0);
                  a.posI += p.impressions || 0;
                  a.bounceW += (p.bounceRate || 0) * (p.views || 0);
                  a.bounceV += p.views || 0;
                  return a;
                },
                { impressions: 0, clicks: 0, views: 0, conversions: 0, posW: 0, posI: 0, bounceW: 0, bounceV: 0 }
              );
              const scores = pages.map((p) => perf[p.url]).filter((s) => typeof s === 'number');
              const anyPerfLoaded = pages.some((p) => perf[p.url] !== undefined);
              return (
                <tr className="total-row">
                  <td></td>
                  <td>{t.posI ? (t.posW / t.posI).toFixed(1) : '—'}</td>
                  <td>{fmt(t.impressions)}</td>
                  <td>{fmt(t.clicks)}</td>
                  <td>{fmt(t.views)}</td>
                  <td>{t.bounceV ? Math.round((t.bounceW / t.bounceV) * 100) + '%' : '—'}</td>
                  <td>{fmt(t.conversions)}</td>
                  <td>
                    {!anyPerfLoaded ? <span className="spinner" /> : scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : '—'}
                  </td>
                </tr>
              );
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}

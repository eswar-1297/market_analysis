import { useEffect, useState } from 'react';
import { api } from '../api.js';

const fmt = (n) => (n == null ? '—' : n >= 1000 ? (n / 1e3).toFixed(1) + 'k' : String(n));

// seconds -> "1m 23s" / "45s"
function fmtDuration(s) {
  if (s == null) return '—';
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

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
  const [cwv, setCwv] = useState({}); // url -> data | null (failed); undefined = loading

  useEffect(() => {
    let cancelled = false;
    setCwv({});
    for (const p of pages) {
      api
        .cwv(p.url)
        .then((d) => !cancelled && setCwv((c) => ({ ...c, [p.url]: d })))
        .catch(() => !cancelled && setCwv((c) => ({ ...c, [p.url]: null })));
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
              <th>Views</th>
              <th>Active users</th>
              <th>Bounce rate</th>
              <th>Views / active user</th>
              <th>Avg. engagement / user</th>
              <th>Conversions</th>
              <th>PPC leads</th>
              <th>Organic clicks</th>
              <th>Impressions</th>
              <th>Avg. position</th>
              <th>Perf.</th>
              <th>Core Web Vitals</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => {
              const cv = cwv[p.url];
              const dl = p.deltas || {};
              return (
                <tr key={p.url}>
                  <td>
                    <a href={p.url} target="_blank" rel="noreferrer" title={p.url}>
                      {p.label}
                    </a>
                  </td>
                  <Metric value={p.views} delta={dl.views} compare={compare} />
                  <Metric value={p.activeUsers} delta={dl.activeUsers} compare={compare} />
                  <Metric
                    value={p.bounceRate}
                    delta={dl.bounceRate}
                    display={p.bounceRate != null ? Math.round(p.bounceRate * 100) + '%' : '—'}
                    compare={compare}
                  />
                  <Metric
                    value={p.viewsPerUser}
                    delta={dl.viewsPerUser}
                    display={p.viewsPerUser != null ? p.viewsPerUser.toFixed(1) : '—'}
                    compare={compare}
                  />
                  <Metric
                    value={p.engagementPerUser}
                    delta={dl.engagementPerUser}
                    display={fmtDuration(p.engagementPerUser)}
                    compare={compare}
                  />
                  <Metric value={p.conversions} delta={dl.conversions} compare={compare} />
                  <Metric value={p.ppcLeads} delta={dl.ppcLeads} compare={compare} />
                  <Metric value={p.clicks} delta={dl.clicks} compare={compare} />
                  <Metric value={p.impressions} delta={dl.impressions} compare={compare} />
                  <Metric value={p.position} delta={dl.position} display={p.position || '—'} compare={compare} />
                  <td>{cv === undefined ? <span className="spinner" /> : cv ? cv.performanceScore : '—'}</td>
                  <td>
                    {cv === undefined ? (
                      <span className="spinner" />
                    ) : cv ? (
                      <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        LCP {(cv.lcp.value / 1000).toFixed(1)}s · INP {cv.inp.value}ms · CLS {cv.cls.value}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

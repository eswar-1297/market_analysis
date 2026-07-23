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

function Metric({ value, delta, display, compare }) {
  return (
    <td>
      <div className="cell-val">{display ?? fmt(value)}</div>
      {compare && <Delta d={delta} />}
    </td>
  );
}

export default function PageTable({ pages, compare = true, authorsByPage = {}, authors = [] }) {
  const [perf, setPerf] = useState({}); // url -> score | null; undefined = loading
  const [authorFilter, setAuthorFilter] = useState('all');

  // Reset the author filter when switching combinations.
  useEffect(() => setAuthorFilter('all'), [pages]);

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

  const shown =
    authorFilter === 'all' ? pages : pages.filter((p) => (authorsByPage[p.url] || '') === authorFilter);

  return (
    <div>
      <div className="pages-head">
        <div className="section-title" style={{ margin: 0 }}>
          Pages ({shown.length}
          {authorFilter !== 'all' ? ` of ${pages.length}` : ''})
        </div>
        {authors.length > 1 && (
          <label className="author-filter">
            <span>Author</span>
            <select value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)}>
              <option value="all">All authors</option>
              {authors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

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
            {shown.map((p) => {
              const dl = p.deltas || {};
              const score = perf[p.url];
              const author = authorsByPage[p.url];
              return (
                <tr key={p.url}>
                  <td>
                    <a href={p.url} target="_blank" rel="noreferrer" title={p.url}>
                      {p.label}
                    </a>
                    {author && <div className="page-author">✍ {author}</div>}
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
            {!shown.length && (
              <tr>
                <td colSpan={8} style={{ color: 'var(--muted)' }}>
                  No pages by this author.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

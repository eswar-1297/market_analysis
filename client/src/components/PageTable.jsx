import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
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

// Sum/weight a set of page rows: totals for counts, impression-weighted
// position, view-weighted bounce rate.
function aggregate(rows) {
  return rows.reduce(
    (a, p) => {
      a.impressions += p.impressions || 0;
      a.clicks += p.clicks || 0;
      a.views += p.views || 0;
      a.posW += (p.position || 0) * (p.impressions || 0);
      a.posI += p.impressions || 0;
      a.bounceW += (p.bounceRate || 0) * (p.views || 0);
      a.bounceV += p.views || 0;
      return a;
    },
    { impressions: 0, clicks: 0, views: 0, posW: 0, posI: 0, bounceW: 0, bounceV: 0 }
  );
}

// A cumulative summary row for a group (Organic / PPC) or the overall total.
// The group's leads total sits in the dedicated Leads column, with a
// growth/decline % beneath it when a comparison delta is provided.
function SummaryRow({ label, cls, rows, perfCells, leadsValue, leadsDelta }) {
  const t = aggregate(rows);
  return (
    <tr className={cls}>
      <td>{label && <span className="cmp-label">{label}</span>}</td>
      <td className="lead-cell">
        {leadsValue != null && (
          <>
            <div className="cell-val">{fmt(leadsValue)}</div>
            {leadsDelta && <Delta d={leadsDelta} />}
          </>
        )}
      </td>
      <td>{t.posI ? (t.posW / t.posI).toFixed(1) : '—'}</td>
      <td>{fmt(t.impressions)}</td>
      <td>{fmt(t.clicks)}</td>
      <td>{fmt(t.views)}</td>
      <td>{t.bounceV ? Math.round((t.bounceW / t.bounceV) * 100) + '%' : '—'}</td>
      <td>{perfCells}</td>
    </tr>
  );
}

export default function PageTable({ pages: allPages, compare = true, leads, leadsDeltas }) {
  // Performance score loads lazily per page (slow PageSpeed call), so the table
  // renders instantly and the Perf. cell fills in when ready.
  const [perf, setPerf] = useState({}); // url -> score | null (failed); undefined = loading
  const [filters, setFilters] = useState({}); // colKey -> { lo, hi, idx } | undefined

  useEffect(() => {
    let cancelled = false;
    setPerf({});
    for (const p of allPages) {
      api
        .cwv(p.url)
        .then((d) => !cancelled && setPerf((s) => ({ ...s, [p.url]: d.performanceScore })))
        .catch(() => !cancelled && setPerf((s) => ({ ...s, [p.url]: null })));
    }
    return () => {
      cancelled = true;
    };
  }, [allPages]);

  // Per-column range filters (same UI/logic as the overview table). Leads isn't
  // a per-page metric, so it has no filter.
  const filterCols = [
    { key: 'position', get: (p) => p.position, format: (v) => String(Math.round(v)) },
    { key: 'impressions', get: (p) => p.impressions, format: fmtRound },
    { key: 'clicks', get: (p) => p.clicks, format: fmtRound },
    { key: 'views', get: (p) => p.views, format: fmtRound },
    { key: 'bounceRate', get: (p) => p.bounceRate, format: (v) => Math.round(v * 100) + '%' },
    { key: 'perf', get: (p) => perf[p.url], format: (v) => String(Math.round(v)) },
  ];
  const ranges = useMemo(() => {
    const out = {};
    for (const c of filterCols) out[c.key] = makeRanges(allPages.map(c.get), c.format);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPages, perf]);
  const pages = useMemo(
    () => allPages.filter((p) => filterCols.every((c) => inRange(c.get(p), filters[c.key]))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allPages, filters, perf]
  );
  const anyFilter = Object.values(filters).some(Boolean);

  const organicPages = pages.filter((p) => !p.ppc);
  const ppcPages = pages.filter((p) => p.ppc);
  const hasBoth = organicPages.length > 0 && ppcPages.length > 0;

  // Render a performance score, colored red when below 97 (needs attention).
  const renderPerf = (score) => {
    if (score === undefined) return <span className="spinner" />;
    if (score == null) return '—';
    return <span className={score < 97 ? 'perf-low' : ''}>{score}</span>;
  };

  // Average performance score across a set of pages (lazy — spinner until at
  // least one page's score has loaded).
  const groupPerf = (rows) => {
    const sc = rows.map((p) => perf[p.url]).filter((s) => typeof s === 'number');
    const anyLoaded = rows.some((p) => perf[p.url] !== undefined);
    if (!anyLoaded) return <span className="spinner" />;
    return renderPerf(sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null);
  };

  const renderRow = (p, cls = '') => {
    const dl = p.deltas || {};
    const score = perf[p.url];
    return (
      <tr key={p.url} className={cls}>
        <td>
          <a href={p.url} target="_blank" rel="noreferrer" title={p.url}>
            {p.label}
          </a>
          {p.ppc && <span className="chan-badge ppc">PPC</span>}
          {p.author && <span className="page-author">{p.author}</span>}
        </td>
        <td className="lead-cell" />
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
        <td>{renderPerf(score)}</td>
      </tr>
    );
  };

  return (
    <div>
      {anyFilter && (
        <div className="filter-summary">
          Showing {pages.length} of {allPages.length} pages
          <button type="button" className="filter-clear" onClick={() => setFilters({})}>
            Clear filters
          </button>
        </div>
      )}
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Page</th>
              <th>Leads</th>
              <th>Avg. position</th>
              <th>Impressions</th>
              <th>Organic clicks</th>
              <th>Views</th>
              <th>Bounce rate</th>
              <th>Perf.</th>
            </tr>
            <tr className="filter-row">
              <td />
              <td />
              {filterCols.map((c) => (
                <td key={c.key}>
                  {ranges[c.key].length > 0 && (
                    <select
                      className="col-filter"
                      value={filters[c.key]?.idx ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setFilters((f) => ({ ...f, [c.key]: v === '' ? undefined : { ...ranges[c.key][+v], idx: +v } }));
                      }}
                    >
                      <option value="">All</option>
                      {ranges[c.key].map((rg, i) => (
                        <option key={i} value={i}>
                          {rg.label}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {!pages.length ? (
              <tr>
                <td colSpan={8} style={{ color: 'var(--muted)', textAlign: 'center', padding: '18px' }}>
                  No pages match the selected filters.
                </td>
              </tr>
            ) : hasBoth ? (
              <>
                {/* Organic group: pages + cumulative subtotal (blue accent) */}
                {organicPages.map((p) => renderRow(p, 'grp-org'))}
                <SummaryRow cls="group-total grp-org" rows={organicPages} perfCells={groupPerf(organicPages)} leadsValue={leads?.organic ?? 0} leadsDelta={leadsDeltas?.organic} />

                {/* Gap between the two groups */}
                <tr className="grp-gap"><td colSpan={8} /></tr>

                {/* PPC group: pages + cumulative subtotal (amber accent) */}
                {ppcPages.map((p) => renderRow(p, 'grp-ppc'))}
                <SummaryRow cls="group-total ppc grp-ppc" rows={ppcPages} perfCells={groupPerf(ppcPages)} leadsValue={leads?.ppc ?? 0} leadsDelta={leadsDeltas?.ppc} />

                {/* Grand total across both groups (organic + PPC) */}
                <SummaryRow cls="total-row" label="Total" rows={pages} perfCells={groupPerf(pages)} leadsValue={(leads?.organic ?? 0) + (leads?.ppc ?? 0)} leadsDelta={leadsDeltas?.total} />
              </>
            ) : (
              <>
                {pages.map((p) => renderRow(p))}
                {pages.length > 1 && (
                  <SummaryRow cls="total-row" label="Total" rows={pages} perfCells={groupPerf(pages)} leadsValue={leads ? (leads.organic ?? 0) + (leads.ppc ?? 0) : null} leadsDelta={leadsDeltas?.total} />
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

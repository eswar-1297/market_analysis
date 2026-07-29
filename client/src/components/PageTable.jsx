import { useEffect, useState } from 'react';
import { api } from '../api.js';

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
// Optionally shows that group's leads total as a chip in the label cell, with a
// growth/decline % beside it when a comparison delta is provided.
function SummaryRow({ label, cls, count, rows, perfCells, leadsValue, leadsDelta }) {
  const t = aggregate(rows);
  return (
    <tr className={cls}>
      <td>
        {label && <span className="cmp-label">{label}</span>}
        {count != null && <span className="cmp-count">{count} page{count !== 1 ? 's' : ''}</span>}
        {leadsValue != null && (
          <span className="leads-chip">
            {fmt(leadsValue)} leads
            {leadsDelta && (
              <span className={`chip-delta ${leadsDelta.dir}`}>
                {leadsDelta.dir === 'up' ? '▲' : leadsDelta.dir === 'down' ? '▼' : ''} {leadsDelta.pct > 0 ? '+' : ''}
                {leadsDelta.pct}%
              </span>
            )}
          </span>
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

export default function PageTable({ pages, compare = true, leads, leadsDeltas }) {
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

  const organicPages = pages.filter((p) => !p.ppc);
  const ppcPages = pages.filter((p) => p.ppc);
  const hasBoth = organicPages.length > 0 && ppcPages.length > 0;

  // Average performance score across a set of pages (lazy — shows a spinner
  // until at least one page's score has loaded).
  const groupPerf = (rows) => {
    const sc = rows.map((p) => perf[p.url]).filter((s) => typeof s === 'number');
    const anyLoaded = rows.some((p) => perf[p.url] !== undefined);
    return !anyLoaded ? <span className="spinner" /> : sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : '—';
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
        <td>{score === undefined ? <span className="spinner" /> : score != null ? score : '—'}</td>
      </tr>
    );
  };

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
              <th>Perf.</th>
            </tr>
          </thead>
          <tbody>
            {hasBoth ? (
              <>
                {/* Organic group: pages + cumulative subtotal (blue accent) */}
                {organicPages.map((p) => renderRow(p, 'grp-org'))}
                <SummaryRow cls="group-total grp-org" label="Organic total" rows={organicPages} perfCells={groupPerf(organicPages)} leadsValue={leads?.organic ?? 0} leadsDelta={leadsDeltas?.organic} />

                {/* Gap between the two groups */}
                <tr className="grp-gap"><td colSpan={7} /></tr>

                {/* PPC group: pages + cumulative subtotal (amber accent) */}
                {ppcPages.map((p) => renderRow(p, 'grp-ppc'))}
                <SummaryRow cls="group-total ppc grp-ppc" label="PPC total" rows={ppcPages} perfCells={groupPerf(ppcPages)} leadsValue={leads?.ppc ?? 0} leadsDelta={leadsDeltas?.ppc} />

                {/* Grand total across both groups (organic + PPC) */}
                <SummaryRow cls="total-row" label="Total" rows={pages} perfCells={groupPerf(pages)} leadsValue={(leads?.organic ?? 0) + (leads?.ppc ?? 0)} leadsDelta={leadsDeltas?.total} />
              </>
            ) : (
              <>
                {pages.map((p) => renderRow(p))}
                {pages.length > 1 && (
                  <SummaryRow cls="total-row" label="Total" rows={pages} perfCells={groupPerf(pages)} leadsValue={leads?.organic ?? 0} leadsDelta={leadsDeltas?.organic} />
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

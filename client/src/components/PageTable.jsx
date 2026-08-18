import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import ColumnFilter from './ColumnFilter.jsx';
import PerfRefresh from './PerfRefresh.jsx';
import PerfCell from './PerfCell.jsx';
import { pollDelay } from '../perfPoll.js';
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

export default function PageTable({ pages: allPages, compare = true, leadsDeltas }) {
  // Performance scores are pre-measured server-side once a day, so this normally
  // resolves on the first request; the cell still fills in asynchronously because
  // a page added since the last run has to be measured on the spot.
  const [perf, setPerf] = useState({}); // url -> score | null (failed); undefined = loading
  const [perfAt, setPerfAt] = useState({}); // url -> when that score was measured
  const [perfStale, setPerfStale] = useState({}); // url -> re-measure failed, showing the old score
  const [perfError, setPerfError] = useState({}); // url -> why there is no score at all
  const [strategy, setStrategy] = useState(null); // 'desktop' | 'mobile', per the server
  // Shared cancel/timer bag for the in-flight polls, so unmounting or switching
  // combination stops them — including polls a row's own refresh button started.
  const live = useRef({ cancelled: false, timers: [] });
  const [filters, setFilters] = useState({}); // colKey -> { lo, hi, idx } | undefined
  const [sort, setSort] = useState(null); // { key, dir: 'asc' | 'desc' } | null

  // Load ONE page's score. Normally the server answers from the daily snapshot at
  // once; when it has to measure, it replies "pending" instead of holding the
  // request open for ~20s, so we poll until the reading lands and that one cell
  // spins while the rest of the table is already on screen.
  // `force` is the row's own refresh button: it re-measures just this page. Only
  // the FIRST request forces — a poll that kept asking would start a new
  // measurement every 3s and never settle.
  const loadPerf = useCallback((url, { force = false } = {}) => {
    setPerf((s) => ({ ...s, [url]: undefined }));
    setPerfError((e) => ({ ...e, [url]: null }));
    const step = (attempt) => {
      api
        .cwv(url, force && attempt === 0)
        .then((d) => {
          if (live.current.cancelled) return;
          // No attempt limit, deliberately — see the same loop in Overview.jsx:
          // a cold snapshot outlasts any fixed count, and giving up wrote a "—"
          // that read as a failure. The server ends a pending state itself, and
          // pollDelay eases the interval off while we wait.
          if (d.status === 'pending') {
            live.current.timers.push(setTimeout(() => step(attempt + 1), pollDelay(attempt)));
            return;
          }
          if (d.strategy) setStrategy(d.strategy);
          setPerfAt((t) => ({ ...t, [url]: d.measuredAt ?? null }));
          setPerfStale((f) => ({ ...f, [url]: d.stale ? d.staleReason || true : false }));
          setPerfError((e) => ({
            ...e,
            [url]: d.status === 'failed' ? d.error || 'PageSpeed returned no score' : null,
          }));
          setPerf((s) => ({ ...s, [url]: d.performanceScore ?? null }));
        })
        .catch((err) => {
          if (live.current.cancelled) return;
          setPerfError((e) => ({ ...e, [url]: err.message || 'request failed' }));
          setPerf((s) => ({ ...s, [url]: null }));
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
    for (const p of allPages) loadPerf(p.url);
    return () => {
      bag.cancelled = true;
      bag.timers.forEach(clearTimeout);
    };
  }, [allPages, loadPerf]);

  // Re-measure every page in THIS combination — the table only ever shows one, so
  // the reach of the button is exactly the combination the user has open.
  const refreshPerf = () => {
    for (const p of allPages) loadPerf(p.url, { force: true });
  };
  const perfBusy = allPages.some((p) => perf[p.url] === undefined);
  // PageSpeed does fail a page from time to time; when it does the server serves
  // the previous reading, and the button says so rather than looking like a no-op.
  const perfStaleAny = allPages.map((p) => perfStale[p.url]).find(Boolean) ?? false;
  // Newest reading on screen, for the button's "measured …" tooltip.
  const perfMeasuredAt = Object.values(perfAt).reduce((a, t) => (t && (a == null || t > a) ? t : a), null);

  // Page leads sits in its own column (second), so it's declared separately from
  // the metric columns but filters through exactly the same machinery.
  const leadsCol = { key: 'leads', label: 'Page leads', get: (p) => p.leads, format: (v) => String(Math.round(v)) };

  // Per-column range filters, applied from the column headers (same UI/logic as
  // the overview table).
  const filterCols = [
    { key: 'position', label: 'Avg. position', get: (p) => p.position, format: (v) => String(Math.round(v)) },
    { key: 'impressions', label: 'Impressions', get: (p) => p.impressions, format: fmtRound },
    { key: 'clicks', label: 'Organic clicks', get: (p) => p.clicks, format: fmtRound },
    { key: 'views', label: 'Views', get: (p) => p.views, format: fmtRound },
    { key: 'bounceRate', label: 'Bounce rate', get: (p) => p.bounceRate, format: (v) => Math.round(v * 100) + '%' },
    { key: 'perf', label: 'Perf.', get: (p) => perf[p.url], format: (v) => String(Math.round(v)) },
  ];
  const allFilterCols = [leadsCol, ...filterCols];
  const ranges = useMemo(() => {
    const out = {};
    for (const c of allFilterCols) out[c.key] = makeRanges(allPages.map(c.get), c.format);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPages, perf]);

  // The page name sorts alphabetically but has no range to filter on, so it sits
  // outside the filterable columns.
  const pageCol = { key: 'label', label: 'Page', get: (p) => p.label };

  // Filter first, then sort what's left. `sort === null` keeps the server's own
  // ordering. Sorting happens before the organic/PPC split, so each group ends
  // up ordered by the chosen column with its subtotal row still beneath it.
  const pages = useMemo(() => {
    const kept = allPages.filter((p) => allFilterCols.every((c) => inRange(c.get(p), filters[c.key])));
    return sortRows(kept, sort, [pageCol, ...allFilterCols]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPages, filters, sort, perf]);
  const anyFilter = Object.values(filters).some(Boolean);
  const toggleSort = (key) => setSort((s) => nextSort(s, key));
  const sortDir = (key) => (sort?.key === key ? sort.dir : null);
  const sortLabel = sort && [pageCol, ...allFilterCols].find((c) => c.key === sort.key)?.label;

  // Lead subtotals come from the rows currently VISIBLE, so they always equal the
  // Page leads column above them — including when filters hide rows. The figure
  // beside the title stays the combination's full total and is unaffected.
  const sumLeads = (rows) => rows.reduce((s, p) => s + (p.leads || 0), 0);

  const organicPages = pages.filter((p) => !p.ppc);
  const ppcPages = pages.filter((p) => p.ppc);
  const hasBoth = organicPages.length > 0 && ppcPages.length > 0;

  // Render one page's score. `error` distinguishes a page PageSpeed could not
  // measure from one that is merely still being measured — both are a dash
  // otherwise.
  const renderPerf = (score, error) => <PerfCell score={score} error={error} />;

  // Average performance score across a set of pages (lazy — spinner until at
  // least one page's score has loaded).
  const groupPerf = (rows) => {
    const sc = rows.map((p) => perf[p.url]).filter((s) => typeof s === 'number');
    const anyLoaded = rows.some((p) => perf[p.url] !== undefined);
    if (!anyLoaded) return renderPerf(undefined);
    if (sc.length) return renderPerf(Math.round(sc.reduce((a, b) => a + b, 0) / sc.length));
    // Every page in the group resolved without a score — surface one of the
    // reasons rather than an unexplained dash on the summary row.
    return renderPerf(null, rows.map((p) => perfError[p.url]).find(Boolean));
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
        </td>
        {/* Leads attributed to this specific page by its source->destination
            pair. null = the page has no pair (ad pages), so "—" not "0". */}
        <td className="lead-cell">
          {p.leads == null ? (
            <span className="lead-na">—</span>
          ) : (
            <>
              <div className="cell-val">{fmt(p.leads)}</div>
              {compare && <Delta d={dl.leads} />}
            </>
          )}
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
        <td>{renderPerf(score, perfError[p.url])}</td>
      </tr>
    );
  };

  return (
    <div>
      {(anyFilter || sort) && (
        <div className="filter-summary">
          {anyFilter && (
            <span>
              Showing {pages.length} of {allPages.length} pages
            </span>
          )}
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
                <ColumnFilter label={pageCol.label} sort={sortDir(pageCol.key)} onSort={() => toggleSort(pageCol.key)} />
              </th>
              {/* "Page leads" first, then the metric columns — click a field name
                  to sort by it, the funnel to filter it. Page leads are the leads
                  attributed to that specific page, which can total less than the
                  title's figure. */}
              {allFilterCols.map((c) => (
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
                          scope="this combination's pages"
                          busy={perfBusy}
                          stale={perfStaleAny}
                          onClick={refreshPerf}
                        />
                      ) : null
                    }
                  />
                </th>
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
                <SummaryRow cls="group-total grp-org" rows={organicPages} perfCells={groupPerf(organicPages)} leadsValue={sumLeads(organicPages)} leadsDelta={anyFilter ? null : leadsDeltas?.organic} />

                {/* Gap between the two groups */}
                <tr className="grp-gap"><td colSpan={8} /></tr>

                {/* PPC group: pages + cumulative subtotal (amber accent) */}
                {ppcPages.map((p) => renderRow(p, 'grp-ppc'))}
                <SummaryRow cls="group-total ppc grp-ppc" rows={ppcPages} perfCells={groupPerf(ppcPages)} leadsValue={sumLeads(ppcPages)} leadsDelta={anyFilter ? null : leadsDeltas?.ppc} />

                {/* Grand total across both groups (organic + PPC) */}
                <SummaryRow cls="total-row" label="Total" rows={pages} perfCells={groupPerf(pages)} leadsValue={sumLeads(pages)} leadsDelta={anyFilter ? null : leadsDeltas?.total} />
              </>
            ) : (
              <>
                {pages.map((p) => renderRow(p))}
                {pages.length > 1 && (
                  <SummaryRow cls="total-row" label="Total" rows={pages} perfCells={groupPerf(pages)} leadsValue={sumLeads(pages)} leadsDelta={anyFilter ? null : leadsDeltas?.total} />
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

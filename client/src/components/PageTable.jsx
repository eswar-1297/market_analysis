import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import ColumnFilter from './ColumnFilter.jsx';
import PerfRefresh from './PerfRefresh.jsx';
import PerfCell from './PerfCell.jsx';
import { pollDelay } from '../perfPoll.js';
import { makeRanges, fmtRound, inRange, nextSort, sortRows } from '../rangeFilter.js';

// Mobile and desktop are separate, non-comparable PageSpeed measurements, so the
// table carries a column for each. Order matters only for display.
const PROFILES = ['mobile', 'desktop'];
const titleCase = (s) => `${s[0].toUpperCase()}${s.slice(1)}`;

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
// position, session-weighted bounce rate.
//
// Bounce rate is weighted by SESSIONS, not by active users: GA4's bounceRate is
// session-scoped (1 - engaged sessions / sessions), so sessions is its exact
// denominator. Users are de-duplicated over the period, which would weight a
// page with many returning visitors the same as a page with one-time visitors.
function aggregate(rows) {
  return rows.reduce(
    (a, p) => {
      a.impressions += p.impressions || 0;
      a.clicks += p.clicks || 0;
      a.activeUsers += p.activeUsers || 0;
      a.posW += (p.position || 0) * (p.impressions || 0);
      a.posI += p.impressions || 0;
      a.bounceW += (p.bounceRate || 0) * (p.pageSessions || 0);
      a.bounceS += p.pageSessions || 0;
      return a;
    },
    { impressions: 0, clicks: 0, activeUsers: 0, posW: 0, posI: 0, bounceW: 0, bounceS: 0 }
  );
}

// A cumulative summary row for a group (Organic / PPC) or the overall total.
// The cells are positional and must stay in the same order as the header — see
// COLUMN ORDER in PageTable below.
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
      <td>{fmt(t.clicks)}</td>
      <td>{fmt(t.impressions)}</td>
      <td>{t.posI ? (t.posW / t.posI).toFixed(1) : '—'}</td>
      <td>{fmt(t.activeUsers)}</td>
      <td>{t.bounceS ? Math.round((t.bounceW / t.bounceS) * 100) + '%' : '—'}</td>
      {PROFILES.map((s) => (
        <td key={s}>{perfCells[s]}</td>
      ))}
    </tr>
  );
}

export default function PageTable({ pages: allPages, compare = true, leadsDeltas }) {
  // Performance scores are pre-measured server-side once a day, so this normally
  // resolves on the first request; the cell still fills in asynchronously because
  // a page added since the last run has to be measured on the spot.
  //
  // One request per URL returns BOTH profiles, so a single poll drives both
  // columns — there is no second timer to cancel and no shared "which profile is
  // this?" state to flap between them.
  //   perf[url] === undefined        -> still loading, both cells spin
  //   perf[url][s].score === null    -> that profile has no score
  const [perf, setPerf] = useState({}); // url -> { [strategy]: { score, at, stale, error } }
  // Shared cancel/timer bag for the in-flight polls, so unmounting or switching
  // combination stops them — including polls a row's own refresh button started.
  const live = useRef({ cancelled: false, timers: [] });
  const [filters, setFilters] = useState({}); // colKey -> { lo, hi, idx } | undefined
  const [sort, setSort] = useState(null); // { key, dir: 'asc' | 'desc' } | null

  // Load one page's scores. Normally the server answers from the daily snapshot
  // at once; when it has to measure, it replies with anyPending instead of
  // holding the request open, so we poll until both profiles land.
  // `force` is the row's own refresh button: it re-measures just this page. Only
  // the FIRST request forces — a poll that kept asking would start a new
  // measurement every few seconds and never settle.
  const loadPerf = useCallback((url, { force = false } = {}) => {
    setPerf((s) => ({ ...s, [url]: undefined }));
    const step = (attempt) => {
      api
        .cwv(url, force && attempt === 0)
        .then((d) => {
          if (live.current.cancelled) return;
          // No attempt limit, deliberately — see the same loop in Overview.jsx:
          // a cold snapshot outlasts any fixed count, and giving up wrote a "—"
          // that read as a failure. The server ends a pending state itself, and
          // pollDelay eases the interval off while we wait.
          if (d.anyPending) {
            live.current.timers.push(setTimeout(() => step(attempt + 1), pollDelay(attempt)));
            return;
          }
          const byProfile = {};
          for (const s of PROFILES) {
            const r = d.strategies?.[s];
            byProfile[s] = {
              score: r && r.status === 'ready' ? r.performanceScore ?? null : null,
              at: r?.measuredAt ?? null,
              stale: r?.stale ? r.staleReason || true : false,
              error: r?.status === 'failed' ? r.error || 'PageSpeed returned no score' : null,
            };
          }
          setPerf((s) => ({ ...s, [url]: byProfile }));
        })
        .catch((err) => {
          if (live.current.cancelled) return;
          const msg = err.message || 'request failed';
          setPerf((s) => ({
            ...s,
            [url]: Object.fromEntries(PROFILES.map((p) => [p, { score: null, at: null, stale: false, error: msg }])),
          }));
        });
    };
    step(0);
  }, []);

  useEffect(() => {
    const bag = { cancelled: false, timers: [] };
    live.current = bag;
    setPerf({});
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
  const at = (url, s) => perf[url]?.[s];
  // PageSpeed does fail a page from time to time; when it does the server serves
  // the previous reading, and the button says so rather than looking like a no-op.
  const perfStaleAny = allPages.flatMap((p) => PROFILES.map((s) => at(p.url, s)?.stale)).find(Boolean) ?? false;
  // Newest reading on screen, for the button's "measured …" tooltip.
  const perfMeasuredAt = allPages
    .flatMap((p) => PROFILES.map((s) => at(p.url, s)?.at))
    .reduce((a, t) => (t && (a == null || t > a) ? t : a), null);

  // ---- COLUMN ORDER ---------------------------------------------------------
  // Page | Page leads | Clicks | Impressions | Avg. position | Active users |
  // Bounce rate | Perf (Mobile) | Perf (Desktop)
  //
  // Grouped by source so the eye can scan one system at a time: Search Console,
  // then GA4, then PageSpeed. Everything below derives from this array, so a
  // column added here flows into the header, the filters and the sort — but
  // SummaryRow's cells are positional and must be kept in step by hand.
  const leadsCol = { key: 'leads', label: 'Page leads', get: (p) => p.leads, format: (v) => String(Math.round(v)) };
  const filterCols = [
    { key: 'clicks', label: 'Organic clicks', get: (p) => p.clicks, format: fmtRound },
    { key: 'impressions', label: 'Impressions', get: (p) => p.impressions, format: fmtRound },
    { key: 'position', label: 'Avg. position', get: (p) => p.position, format: (v) => String(Math.round(v)) },
    { key: 'activeUsers', label: 'Active users', get: (p) => p.activeUsers, format: fmtRound },
    { key: 'bounceRate', label: 'Bounce rate', get: (p) => p.bounceRate, format: (v) => Math.round(v * 100) + '%' },
    ...PROFILES.map((s) => ({
      key: `perf_${s}`,
      label: `Perf. ${titleCase(s)}`,
      strategy: s,
      get: (p) => at(p.url, s)?.score,
      format: (v) => String(Math.round(v)),
    })),
  ];
  const allFilterCols = [leadsCol, ...filterCols];
  // The one source of truth for how wide a full-width row is.
  const COL_COUNT = 1 + allFilterCols.length;

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

  // Average performance across a set of pages, per profile (lazy — spinner until
  // at least one page's score has loaded).
  const groupPerf = (rows) =>
    Object.fromEntries(
      PROFILES.map((s) => {
        const anyLoaded = rows.some((p) => perf[p.url] !== undefined);
        if (!anyLoaded) return [s, <PerfCell key={s} score={undefined} strategy={s} />];
        const sc = rows.map((p) => at(p.url, s)?.score).filter((v) => typeof v === 'number');
        if (sc.length) {
          return [s, <PerfCell key={s} score={Math.round(sc.reduce((a, b) => a + b, 0) / sc.length)} strategy={s} />];
        }
        // Every page in the group resolved without a score — surface one of the
        // reasons rather than an unexplained dash on the summary row.
        return [s, <PerfCell key={s} score={null} error={rows.map((p) => at(p.url, s)?.error).find(Boolean)} strategy={s} />];
      })
    );

  const renderRow = (p, cls = '') => {
    const dl = p.deltas || {};
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
        <Metric value={p.clicks} delta={dl.clicks} compare={compare} />
        <Metric value={p.impressions} delta={dl.impressions} compare={compare} />
        <Metric value={p.position} delta={dl.position} display={p.position || '—'} compare={compare} />
        <Metric value={p.activeUsers} delta={dl.activeUsers} compare={compare} />
        <Metric
          value={p.bounceRate}
          delta={dl.bounceRate}
          display={p.bounceRate != null ? Math.round(p.bounceRate * 100) + '%' : '—'}
          compare={compare}
        />
        {PROFILES.map((s) => (
          <td key={s}>
            <PerfCell score={at(p.url, s)?.score} error={at(p.url, s)?.error} strategy={s} />
          </td>
        ))}
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
              {/* Click a field name to sort by it, the funnel to filter it. Page
                  leads are the leads attributed to that specific page, which can
                  total less than the title's figure. */}
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
                      // One refresh control, on the first perf column: a
                      // measurement re-runs both profiles together, so a button
                      // per column would just be two ways to start the same work.
                      c.key === `perf_${PROFILES[0]}` ? (
                        <PerfRefresh
                          inHeader
                          measuredAt={perfMeasuredAt}
                          strategy={PROFILES.join(' + ')}
                          scope="this combination's pages, on mobile and desktop"
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
                <td colSpan={COL_COUNT} style={{ color: 'var(--muted)', textAlign: 'center', padding: '18px' }}>
                  No pages match the selected filters.
                </td>
              </tr>
            ) : hasBoth ? (
              <>
                {/* Organic group: pages + cumulative subtotal (blue accent) */}
                {organicPages.map((p) => renderRow(p, 'grp-org'))}
                <SummaryRow cls="group-total grp-org" rows={organicPages} perfCells={groupPerf(organicPages)} leadsValue={sumLeads(organicPages)} leadsDelta={anyFilter ? null : leadsDeltas?.organic} />

                {/* Gap between the two groups */}
                <tr className="grp-gap"><td colSpan={COL_COUNT} /></tr>

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

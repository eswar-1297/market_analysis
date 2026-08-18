// Refresh control for the Perf. column. Scores are pre-measured server-side once
// a day (07:00 by default), so the column loads from that snapshot instantly; this
// is the escape hatch for re-measuring on demand.
// Its reach is always ONE combination's pages — in the header of a combination's
// table it re-measures that combination, and on an overview row it re-measures
// that row's combination. A measurement costs ~20s per page, so nothing here ever
// re-measures the whole site.
// It doesn't animate while working: the cells swap to spinners, which is enough.
export default function PerfRefresh({
  measuredAt,
  strategy,
  scope = 'this page',
  busy = false,
  stale = false,
  onClick,
  inHeader = false,
}) {
  const when = measuredAt
    ? new Date(measuredAt).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
  // Naming the profile keeps the number unambiguous against pagespeed.web.dev,
  // where desktop and mobile are separate (and not comparable) measurements.
  const profile = strategy ? `${strategy.charAt(0).toUpperCase()}${strategy.slice(1)}` : '';
  const title = busy
    ? `Measuring ${profile ? profile.toLowerCase() + ' ' : ''}performance…`
    : [
        profile ? `${profile} performance` : 'Performance',
        when ? `measured ${when}` : null,
        // PageSpeed refuses a page now and then. Saying so — with the reason when
        // the server gave one — beats leaving an unchanged number that reads as a
        // click that did nothing. (`stale` is the reason string, or just true.)
        stale
          ? `last re-measure failed${typeof stale === 'string' ? ` (${stale})` : ''}, showing the stored reading`
          : null,
        `click to re-measure ${scope}`,
      ]
        .filter(Boolean)
        .join(' — ');

  return (
    <button
      type="button"
      className={`perf-refresh${inHeader ? ' in-header' : ''}${busy ? ' busy' : ''}${stale && !busy ? ' stale' : ''}`}
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={(e) => {
        // Overview rows are clickable (they drill into the combination) — the
        // refresh must not also navigate.
        e.stopPropagation();
        onClick();
      }}
    >
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
        {/* Circular arrow: three-quarter ring plus an arrowhead at the top right. */}
        <path d="M13 8a5 5 0 1 1-1.9-3.9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M13.4 1.6v3.2h-3.2z" fill="currentColor" />
      </svg>
    </button>
  );
}

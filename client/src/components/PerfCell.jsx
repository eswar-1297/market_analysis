// The Perf. column's value, in one place so the overview and the page table can't
// drift apart on what a given state looks like. Three states:
//   undefined  still measuring        -> spinner
//   number     the score              -> the number, red below 97
//   null       no score               -> an em-dash
// The last one is why this exists: "still measuring" and "measurement failed"
// both used to end up as a bare "—", so a page that was merely queued behind a
// cold snapshot looked exactly like a page PageSpeed had refused. A failure now
// carries its reason in the tooltip and is marked as one.
// PageSpeed's own wording for a timeout ("The operation was aborted due to
// timeout") describes our abort, not the page, and reads like a bug report. Say
// what it means for the reader instead.
function reason(error) {
  if (!error) return null;
  return /abort|timeout/i.test(error) ? 'PageSpeed did not finish in time' : error;
}

// Scores below this are shown in red. Mobile scores run structurally lower than
// desktop, so if the two ever need different thresholds this is the one place to
// split; today the business rule is a single 97 for both.
export const PERF_RED_BELOW = 97;

export default function PerfCell({ score, error, strategy }) {
  const label = strategy ? `${strategy[0].toUpperCase()}${strategy.slice(1)}` : null;
  if (score === undefined) {
    return <span className="spinner" title={label ? `Measuring ${label.toLowerCase()}…` : 'Measuring…'} />;
  }
  if (score == null) {
    const why = reason(error);
    const title = why ? `Could not measure${label ? ` (${label})` : ''} — ${why}` : undefined;
    return (
      <span className={why ? 'perf-failed' : undefined} title={title}>
        —
      </span>
    );
  }
  return (
    <span className={score < PERF_RED_BELOW ? 'perf-low' : ''} title={label ? `${label} performance` : undefined}>
      {score}
    </span>
  );
}

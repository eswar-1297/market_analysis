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

export default function PerfCell({ score, error }) {
  if (score === undefined) return <span className="spinner" title="Measuring…" />;
  if (score == null) {
    const why = reason(error);
    return (
      <span className={why ? 'perf-failed' : undefined} title={why ? `Could not measure — ${why}` : undefined}>
        —
      </span>
    );
  }
  return <span className={score < 97 ? 'perf-low' : ''}>{score}</span>;
}

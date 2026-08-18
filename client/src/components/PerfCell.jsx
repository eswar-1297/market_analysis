// The Perf. column's value, in one place so the overview and the page table can't
// drift apart on what a given state looks like. Three states:
//   undefined  still measuring        -> spinner
//   number     the score              -> the number, red below 97
//   null       no score               -> an em-dash
// The last one is why this exists: "still measuring" and "measurement failed"
// both used to end up as a bare "—", so a page that was merely queued behind a
// cold snapshot looked exactly like a page PageSpeed had refused. A failure now
// carries its reason in the tooltip and is marked as one.
export default function PerfCell({ score, error }) {
  if (score === undefined) return <span className="spinner" title="Measuring…" />;
  if (score == null) {
    return (
      <span
        className={error ? 'perf-failed' : undefined}
        title={error ? `Could not measure — ${error}` : undefined}
      >
        —
      </span>
    );
  }
  return <span className={score < 97 ? 'perf-low' : ''}>{score}</span>;
}

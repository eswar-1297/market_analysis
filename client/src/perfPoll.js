// Poll pacing for the Perf. column.
//
// The server never holds a connection open for a ~20s PageSpeed call — it replies
// "pending" and the client asks again. How often to ask is the trade-off here:
// the common case is a warm snapshot that answers on the FIRST request, so the
// early polls stay responsive; the expensive case is a cold snapshot (the first
// boot after a deploy, when every page has to be measured at ~20s each) which can
// run for many minutes, so the interval eases off rather than sending hundreds of
// requests per row.
const MAX_POLL_MS = 15000;

export function pollDelay(attempt, base = 3000) {
  return Math.min(base + attempt * 1000, MAX_POLL_MS);
}

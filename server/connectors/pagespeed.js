// PageSpeed Insights / CrUX connector - real Core Web Vitals (field data).
// Returns a single point-in-time reading per page: LCP (ms), INP (ms),
// CLS (score), and Lighthouse performance score.
//
// These calls are SLOW — 15-55s each, and there are ~55 pages. Measuring on demand
// meant every visit re-ran the lot, so the Perf. column sat spinning for minutes.
// Instead scores are PRE-MEASURED once a day (07:00 local by default) and served
// from that snapshot:
//   * `schedulePagespeedRefresh` re-measures every page at the daily hour, and
//     also on boot when the stored snapshot predates the last scheduled run (cold
//     start, or the server was down at 07:00).
//   * `pagespeedSnapshot` answers instantly from the snapshot. It only fetches
//     when a page has no usable score at all, or when the user explicitly asks
//     for a re-measure (`{ force: true }` — the Perf. refresh button).
//   * it never waits: a fetch in progress reports "pending" with the previous
//     score attached, so the client keeps showing a number and polls for the new
//     one. Nothing holds a connection open for 20s (a reverse proxy turns that
//     into a 502).
//   * de-duplicated per URL, and globally capped, so a 50-row table can't fire 50
//     simultaneous PageSpeed calls.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '..', '..', 'data', '.cache', 'pagespeed.json');

// When a stored score counts as due for replacement. This is NOT how long it stays
// on screen — a reading is served until something better replaces it. It only
// decides what the warm-up re-measures. Comfortably longer than a day so a missed
// 07:00 run doesn't re-measure the whole site on the next boot.
const SNAPSHOT_TTL = 36 * 60 * 60 * 1000;
// Any measurement deadline is guesswork, and guessing low is what made the column
// flap: the original 25s sat under the median (measured across the site a call
// takes 15s-55s, median ~30s, p90 ~48s), so half of all measurements were aborted
// seconds before they would have returned. Nothing waits on this — the request
// returns "pending" at once and the client polls — so the ceiling can be generous.
const FETCH_TIMEOUT_MS = 120000;
// Paid landing pages are the heavy ones (43-55s observed) and get NO measurement
// deadline. This guard is not a budget: it exists only so a wedged socket cannot
// keep a URL in `inflight` for ever, which would stop the daily run from ever
// re-measuring that page again.
const WEDGE_GUARD_MS = 10 * 60 * 1000;

// URLs to measure without a deadline, supplied by the server (it owns the rule for
// which pages are paid). A getter, not a list, so pages added to combinations.json
// are picked up without a restart.
let unlimitedUrls = () => new Set();
export function setUnlimitedUrls(getUrls) {
  unlimitedUrls = () => {
    try {
      return new Set(getUrls());
    } catch {
      return new Set();
    }
  };
}
// Desktop or mobile. PageSpeed treats these as two separate measurements, so a
// stored score is only comparable to others taken with the SAME profile — hence
// it's recorded alongside every reading and checked on load.
const STRATEGY = config.pagespeedStrategy;
const MAX_CONCURRENT = 4; // PageSpeed is rate-limited; queue the rest
// After a failed measurement, don't try that page again for a while. Without this
// a URL PageSpeed refuses gets re-fetched on every 3s poll, which is both useless
// and the fastest way to get rate-limited.
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

const cache = new Map(); // url -> { at: ms, data, strategy }
const inflight = new Map(); // url -> Promise, so concurrent asks share one call
// url -> { at, message } for the most recent failed fetch, cleared by a success.
// Kept (rather than consumed on read) so a reading can be reported as stale for as
// long as the newest attempt to replace it is a failure.
const lastError = new Map();
const forced = new Set(); // urls the user asked to re-measure, until it lands

// --- disk persistence -------------------------------------------------------
(function loadFromDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    let dropped = 0;
    for (const [url, entry] of Object.entries(raw)) {
      if (!entry || typeof entry.at !== 'number' || !entry.data) continue;
      // A score measured under the other profile is not a stale version of this
      // one — it's a different number. Discard it so the page is re-measured
      // instead of the column mixing desktop and mobile readings.
      if (entry.strategy !== STRATEGY) {
        dropped++;
        continue;
      }
      cache.set(url, entry);
    }
    if (cache.size) console.log(`[pagespeed] loaded ${cache.size} cached ${STRATEGY} score(s) from disk`);
    if (dropped) console.log(`[pagespeed] discarded ${dropped} score(s) from a different profile — will re-measure for ${STRATEGY}`);
  } catch {
    /* no cache yet (or unreadable) — start empty */
  }
})();

let saveTimer = null;
function saveSoon() {
  // Debounced: a warm-up writes ~50 entries in quick succession.
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)));
    } catch (e) {
      console.warn('[pagespeed] could not write cache file:', e.message);
    }
  }, 2000);
  saveTimer.unref?.(); // never hold the process open just for a cache write
}

function percentile(metric) {
  return metric && typeof metric.percentile === 'number' ? metric.percentile : null;
}

async function fetchFresh(url) {
  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  api.searchParams.set('url', url);
  api.searchParams.set('category', 'performance');
  api.searchParams.set('strategy', STRATEGY);
  if (config.pagespeedApiKey) api.searchParams.set('key', config.pagespeedApiKey);

  const budget = unlimitedUrls().has(url) ? WEDGE_GUARD_MS : FETCH_TIMEOUT_MS;
  const res = await fetch(api, { signal: AbortSignal.timeout(budget) });
  if (!res.ok) throw new Error(`PageSpeed ${res.status}`);
  const json = await res.json();

  const field = json.loadingExperience?.metrics || {};
  const lab = json.lighthouseResult?.audits || {};
  const data = {
    // Prefer CrUX field data; fall back to lab metrics when field is missing.
    lcp: percentile(field.LARGEST_CONTENTFUL_PAINT_MS) ?? Math.round(lab['largest-contentful-paint']?.numericValue ?? 0),
    inp:
      percentile(field.INTERACTION_TO_NEXT_PAINT) ??
      percentile(field.FIRST_INPUT_DELAY_MS) ??
      Math.round(lab['interactive']?.numericValue ?? 0),
    cls:
      (percentile(field.CUMULATIVE_LAYOUT_SHIFT_SCORE) ?? 0) / 100 ||
      Number(lab['cumulative-layout-shift']?.numericValue ?? 0),
    performanceScore: Math.round((json.lighthouseResult?.categories?.performance?.score ?? 0) * 100),
    source: json.loadingExperience?.metrics ? 'field' : 'lab',
  };
  data.cls = Number(data.cls.toFixed(3));
  return data;
}

// --- global concurrency gate -------------------------------------------------
let running = 0;
const queue = [];
function runQueued(fn) {
  return new Promise((resolve, reject) => {
    const start = () => {
      running++;
      fn().then(resolve, reject).finally(() => {
        running--;
        const next = queue.shift();
        if (next) next();
      });
    };
    if (running < MAX_CONCURRENT) start();
    else queue.push(start);
  });
}

// One in-flight fetch per URL; stores and persists on success.
function refresh(url) {
  const existing = inflight.get(url);
  if (existing) return existing;
  const p = runQueued(() => fetchFresh(url))
    .then((data) => {
      cache.set(url, { at: Date.now(), data, strategy: STRATEGY });
      lastError.delete(url); // a good reading supersedes any earlier failure
      saveSoon();
      return data;
    })
    .catch((e) => {
      lastError.set(url, { at: Date.now(), message: e.message });
      throw e;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

// Non-blocking read, used by the Perf. column. Returns immediately:
//   { status: 'ready', data, at }  a stored score (`at` = when it was measured)
//   { status: 'pending' }          nothing stored yet and a measurement is running
//   { status: 'failed', error }    nothing stored and the measurement errored
//
// THE RULE: once a score has appeared in the column it stays there. A stored
// reading is served for as long as we have one — there is no expiry that takes a
// number back off the screen and replaces it with a spinner or a dash. Only two
// things ever change a displayed score: the daily run, which swaps the value in
// the background, and the refresh button. 'pending' and 'failed' are therefore
// reachable only for a page that has never been measured successfully at all.
//
// `{ force: true }` is the refresh button, and the single exception: the user
// asked for a new number, so it reports 'pending' until the NEW reading lands
// rather than handing back the old one as ready and looking like a no-op click.
export function pagespeedSnapshot(url, { force = false } = {}) {
  const hit = cache.get(url);
  const err = lastError.get(url);

  if (force && !forced.has(url)) {
    forced.add(url);
    refresh(url)
      .catch(() => {})
      .finally(() => forced.delete(url));
  }
  if (forced.has(url)) return { status: 'pending', previous: hit?.data ?? null, at: hit?.at ?? null };

  if (hit) {
    // A failure recorded AFTER this reading means we tried to replace it and
    // couldn't. Flag it: an unchanged number with no explanation reads as a
    // refresh click that did nothing.
    const failedSince = Boolean(err && err.at > hit.at);
    return {
      status: 'ready',
      data: hit.data,
      at: hit.at,
      stale: failedSince,
      staleReason: failedSince ? err.message : null,
    };
  }

  // Never measured. Report a recent failure as a failure — the column shows "—"
  // with the reason — instead of starting another fetch. Checking this BEFORE
  // refreshing is what stops a failing URL being re-fetched on every poll.
  if (err && !inflight.has(url) && Date.now() - err.at < FAILURE_COOLDOWN_MS) {
    return { status: 'failed', error: err.message };
  }

  const p = refresh(url);
  p.catch(() => {}); // handled by the poller; don't crash on an unhandled rejection
  return { status: 'pending', previous: null, at: null };
}

// Blocking read — still used anywhere a score is needed as part of a response.
export async function pagespeedPage(url) {
  const hit = cache.get(url);
  if (!hit) return refresh(url); // cold — nothing to serve but the live call
  // Same rule as pagespeedSnapshot: always hand back what we have. If it predates
  // the snapshot window, replace it behind the scenes — nobody should wait ~30s
  // for a number that barely moves, and a failed refresh just keeps the old value.
  if (Date.now() - hit.at >= SNAPSHOT_TTL) refresh(url).catch(() => {});
  return hit.data;
}

// When the most recent scheduled run was (today's if it has passed, else
// yesterday's). Anything measured before this is due for a refresh.
function lastScheduledRun(hour) {
  const at = new Date();
  at.setHours(hour, 0, 0, 0);
  if (at.getTime() > Date.now()) at.setDate(at.getDate() - 1);
  return at.getTime();
}

// Newest measurement in the snapshot, so /api/meta can report how current the
// Perf. column is.
export function pagespeedSnapshotInfo() {
  let newest = null;
  for (const entry of cache.values()) if (!newest || entry.at > newest) newest = entry.at;
  return { pages: cache.size, measuredAt: newest, strategy: STRATEGY };
}

// Pre-measure every page once a day at `hour` local time. `getUrls` is called at
// run time, not now, so pages added to combinations.json later are picked up
// without a restart.
export function schedulePagespeedRefresh(getUrls, hour) {
  const msUntilRun = () => {
    const next = new Date();
    next.setHours(hour, 0, 0, 0);
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
    return next.getTime() - Date.now();
  };

  const run = () => {
    console.log(`[pagespeed] daily ${String(hour).padStart(2, '0')}:00 refresh starting`);
    warmPagespeedCache(getUrls(), { staleBefore: Date.now() });
    // Re-arm from the clock rather than on a fixed 24h interval, so a DST shift
    // can't drift the run an hour off.
    setTimeout(run, msUntilRun()).unref?.();
  };

  const wait = msUntilRun();
  setTimeout(run, wait).unref?.();
  console.log(
    `[pagespeed] daily ${STRATEGY} refresh scheduled for ${String(hour).padStart(2, '0')}:00 ` +
      `(in ${Math.round(wait / 60000)} min)`
  );

  // Cold start, or the server was down at the scheduled hour: bring the snapshot
  // up to date now, at low concurrency, so the first visitor isn't the one paying
  // for the measurement.
  warmPagespeedCache(getUrls(), { concurrency: 2, staleBefore: lastScheduledRun(hour) });
}

// Populate the snapshot in the background at low concurrency. `staleBefore` is
// the cutoff: any page measured before it gets re-measured (pass Date.now() to
// refresh everything, or the last scheduled run to only fill in what's missing).
export function warmPagespeedCache(urls, { concurrency = 3, staleBefore = null } = {}) {
  const cutoff = staleBefore ?? Date.now() - SNAPSHOT_TTL;
  const todo = [...new Set(urls)].filter((u) => {
    const hit = cache.get(u);
    return !hit || hit.at < cutoff;
  });
  if (!todo.length) return;
  console.log(`[pagespeed] warming ${todo.length} page(s) in the background…`);
  runWarm(todo, concurrency, true);
}

// Measure a list of pages, `concurrency` at a time. PageSpeed fails a page often
// enough to matter (rate limits, a slow render), so failures are collected and
// retried once — without that, a page that merely blipped shows "—" until the next
// daily run.
function runWarm(list, concurrency, allowRetry) {
  const failed = [];
  let i = 0;
  let done = 0;
  const next = () => {
    if (i >= list.length) return Promise.resolve();
    const url = list[i++];
    return refresh(url)
      .catch(() => failed.push(url)) // one bad page must not stop the warm-up
      .then(() => {
        if (++done === list.length) {
          if (failed.length && allowRetry) {
            console.log(`[pagespeed] retrying ${failed.length} page(s) that failed`);
            runWarm(failed, concurrency, false);
          } else {
            console.log(
              `[pagespeed] warm-up complete` +
                (failed.length ? ` — ${failed.length} page(s) still failing, will retry at the next run` : '')
            );
          }
        }
        return next();
      });
  };
  for (let w = 0; w < Math.min(concurrency, list.length); w++) next();
}

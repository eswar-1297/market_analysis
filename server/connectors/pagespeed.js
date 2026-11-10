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
// flap: the original 25s sat under the median, so half of all measurements were
// aborted seconds before they would have returned. Nothing waits on this — the
// request returns "pending" at once and the client polls — so the ceiling can be
// generous.
//
// Raised from 120s when mobile was added. The last desktop snapshot shows a
// low-median/fat-tail distribution (median call ~10s, mean ~22s) with a handful
// of pages past 120s, and mobile renders are slower still — at the old ceiling
// those pages abort on both the first attempt and the retry, leaving a permanent
// "—" in the mobile column.
const FETCH_TIMEOUT_MS = 240000;
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
// PageSpeed treats mobile and desktop as two separate measurements whose numbers
// are NOT comparable, so both are measured and stored independently and every
// reading records which profile produced it. A score is only ever shown under the
// profile it was taken with.
export const STRATEGIES = ['mobile', 'desktop'];
// The profile used where a single number is still required (server/check.js, and
// the figure /api/meta reports). Configurable, defaults to desktop.
const PRIMARY = STRATEGIES.includes(config.pagespeedStrategy) ? config.pagespeedStrategy : 'desktop';

// Every per-URL map below is keyed by (url, strategy), never by url alone —
// otherwise one profile's reading, failure or in-flight call would be handed to
// the other. The separator cannot occur in a strategy name, so the key splits
// back unambiguously.
const ck = (url, strategy) => `${strategy}::${url}`;

const MAX_CONCURRENT = 6; // PageSpeed is rate-limited; queue the rest
// After a failed measurement, don't try that page again for a while. Without this
// a URL PageSpeed refuses gets re-fetched on every 3s poll, which is both useless
// and the fastest way to get rate-limited.
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

const cache = new Map(); // ck -> { at: ms, data, strategy }
const inflight = new Map(); // ck -> Promise, so concurrent asks share one call
// ck -> { at, message } for the most recent failed fetch, cleared by a success.
// Kept (rather than consumed on read) so a reading can be reported as stale for as
// long as the newest attempt to replace it is a failure.
const lastError = new Map();
const forced = new Set(); // cks the user asked to re-measure, until they land

// --- disk persistence -------------------------------------------------------
(function loadFromDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    // v2 is keyed by `${strategy}::${url}`. v1 was keyed by url alone, back when
    // only one profile was measured; each of its entries still records the
    // profile it was taken with, so it is re-filed under that profile rather
    // than thrown away. An entry with no strategy cannot be placed safely —
    // guessing would risk showing a desktop number under the mobile heading —
    // so it is dropped and re-measured.
    const entries = raw && raw.version === 2 ? raw.entries || {} : raw || {};
    const byStrategy = {};
    let dropped = 0;
    for (const [key, entry] of Object.entries(entries)) {
      if (!entry || typeof entry.at !== 'number' || !entry.data) continue;
      if (!STRATEGIES.includes(entry.strategy)) {
        dropped++;
        continue;
      }
      // Re-derive the key so a v1 file lands in the v2 layout.
      const url = key.includes('::') ? key.slice(key.indexOf('::') + 2) : key;
      cache.set(ck(url, entry.strategy), entry);
      byStrategy[entry.strategy] = (byStrategy[entry.strategy] || 0) + 1;
    }
    if (cache.size) {
      const summary = STRATEGIES.map((s) => `${byStrategy[s] || 0} ${s}`).join(', ');
      console.log(`[pagespeed] loaded ${cache.size} cached score(s) from disk (${summary})`);
    }
    if (dropped) console.log(`[pagespeed] discarded ${dropped} score(s) with no usable profile — will re-measure`);
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
      fs.writeFileSync(CACHE_FILE, JSON.stringify({ version: 2, entries: Object.fromEntries(cache) }));
    } catch (e) {
      console.warn('[pagespeed] could not write cache file:', e.message);
    }
  }, 2000);
  saveTimer.unref?.(); // never hold the process open just for a cache write
}

function percentile(metric) {
  return metric && typeof metric.percentile === 'number' ? metric.percentile : null;
}

async function fetchFresh(url, strategy) {
  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  api.searchParams.set('url', url);
  api.searchParams.set('category', 'performance');
  api.searchParams.set('strategy', strategy);
  if (config.pagespeedApiKey) api.searchParams.set('key', config.pagespeedApiKey);

  const budget = unlimitedUrls().has(url) ? WEDGE_GUARD_MS : FETCH_TIMEOUT_MS;
  // One deadline covering the response body as well as the connection: a
  // Lighthouse payload is multi-MB, and a signal passed only to fetch() leaves
  // the body read able to hang indefinitely.
  const signal = AbortSignal.timeout(budget);
  const res = await fetch(api, { signal });
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

// One in-flight fetch per (url, strategy); stores and persists on success.
function refresh(url, strategy) {
  const key = ck(url, strategy);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = runQueued(() => fetchFresh(url, strategy))
    .then((data) => {
      cache.set(key, { at: Date.now(), data, strategy });
      lastError.delete(key); // a good reading supersedes any earlier failure
      saveSoon();
      return data;
    })
    .catch((e) => {
      lastError.set(key, { at: Date.now(), message: e.message });
      throw e;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
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
export function pagespeedSnapshot(url, { force = false, strategy = PRIMARY } = {}) {
  const key = ck(url, strategy);
  const hit = cache.get(key);
  const err = lastError.get(key);

  if (force && !forced.has(key)) {
    forced.add(key);
    refresh(url, strategy)
      .catch(() => {})
      .finally(() => forced.delete(key));
  }
  if (forced.has(key)) {
    return { status: 'pending', strategy, previous: hit?.data ?? null, at: hit?.at ?? null };
  }

  if (hit) {
    // A failure recorded AFTER this reading means we tried to replace it and
    // couldn't. Flag it: an unchanged number with no explanation reads as a
    // refresh click that did nothing.
    const failedSince = Boolean(err && err.at > hit.at);
    return {
      status: 'ready',
      strategy,
      data: hit.data,
      at: hit.at,
      stale: failedSince,
      staleReason: failedSince ? err.message : null,
    };
  }

  // Never measured. Report a recent failure as a failure — the column shows "—"
  // with the reason — instead of starting another fetch. Checking this BEFORE
  // refreshing is what stops a failing URL being re-fetched on every poll.
  if (err && !inflight.has(key) && Date.now() - err.at < FAILURE_COOLDOWN_MS) {
    return { status: 'failed', strategy, error: err.message };
  }

  const p = refresh(url, strategy);
  p.catch(() => {}); // handled by the poller; don't crash on an unhandled rejection
  return { status: 'pending', strategy, previous: null, at: null };
}

// Every profile's state for one page, which is what the Perf. columns render.
export function pagespeedSnapshotAll(url, { force = false } = {}) {
  return Object.fromEntries(STRATEGIES.map((s) => [s, pagespeedSnapshot(url, { force, strategy: s })]));
}

// Blocking read — still used anywhere a score is needed as part of a response.
export async function pagespeedPage(url, strategy = PRIMARY) {
  const key = ck(url, strategy);
  const hit = cache.get(key);
  if (!hit) return refresh(url, strategy); // cold — nothing to serve but the live call
  // Same rule as pagespeedSnapshot: always hand back what we have. If it predates
  // the snapshot window, replace it behind the scenes — nobody should wait ~30s
  // for a number that barely moves, and a failed refresh just keeps the old value.
  if (Date.now() - hit.at >= SNAPSHOT_TTL) refresh(url, strategy).catch(() => {});
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
  const byStrategy = {};
  let newest = null;
  for (const entry of cache.values()) {
    if (!newest || entry.at > newest) newest = entry.at;
    const s = (byStrategy[entry.strategy] = byStrategy[entry.strategy] || { pages: 0, measuredAt: null });
    s.pages++;
    if (!s.measuredAt || entry.at > s.measuredAt) s.measuredAt = entry.at;
  }
  // `pages`/`measuredAt` describe the PRIMARY profile, so the headline figure
  // stays a page count rather than a measurement count now that each page is
  // measured twice. Per-profile detail sits alongside it.
  const primary = byStrategy[PRIMARY] || { pages: 0, measuredAt: null };
  return {
    pages: primary.pages,
    measuredAt: primary.measuredAt ?? newest,
    strategy: PRIMARY,
    strategies: STRATEGIES,
    byStrategy,
  };
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
    `[pagespeed] daily ${STRATEGIES.join(' + ')} refresh scheduled for ${String(hour).padStart(2, '0')}:00 ` +
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
  // De-duplicate URLs BEFORE pairing them with profiles. The caller's list
  // repeats any page that sits in more than one combination, and expanding
  // first would measure those twice per profile. Composite string keys keep
  // the pairs de-duplicable; objects would compare by reference and dedupe
  // nothing.
  const todo = [];
  for (const u of new Set(urls)) {
    for (const s of STRATEGIES) {
      const hit = cache.get(ck(u, s));
      if (!hit || hit.at < cutoff) todo.push(ck(u, s));
    }
  }
  if (!todo.length) return;
  console.log(`[pagespeed] warming ${todo.length} measurement(s) across ${STRATEGIES.join(' + ')} in the background…`);
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
    // Entries are `${strategy}::${url}` composite keys.
    const key = list[i++];
    const sep = key.indexOf('::');
    const strategy = key.slice(0, sep);
    const url = key.slice(sep + 2);
    return refresh(url, strategy)
      .catch(() => failed.push(key)) // one bad page must not stop the warm-up
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

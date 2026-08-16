// PageSpeed Insights / CrUX connector - real Core Web Vitals (field data).
// Returns a single point-in-time reading per page: LCP (ms), INP (ms),
// CLS (score), and Lighthouse performance score.
//
// These calls are SLOW — ~20s each, and there are ~50 pages. The Perf. column is
// meant to be a LIVE reading, so scores are fetched fresh per visit rather than
// served from a long-lived cache. To keep that from blocking anything:
//   * `pagespeedLive` never waits — it kicks off the fetch and reports "pending",
//     so the HTTP request returns instantly and the client polls. Nothing holds a
//     connection open for 20s (which is what a reverse proxy turns into a 502).
//   * a short FRESH_WINDOW means the rows of one page view share a single fetch,
//     while a later visit gets a genuinely new reading.
//   * de-duplicated per URL, and globally capped, so opening a table with 50 rows
//     doesn't fire 50 simultaneous PageSpeed calls.
//   * the disk cache is kept only as a FALLBACK: if a live fetch fails, the last
//     known score is shown rather than a dash.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '..', '..', 'data', '.cache', 'pagespeed.json');

const TTL = 6 * 60 * 60 * 1000; // fallback window: how long a stored score stays usable
const FRESH_WINDOW_MS = 2 * 60 * 1000; // a reading counts as "live" for one page view
const FETCH_TIMEOUT_MS = 25000;
const MAX_CONCURRENT = 4; // PageSpeed is rate-limited; queue the rest

const cache = new Map(); // url -> { at: ms, data }
const inflight = new Map(); // url -> Promise, so concurrent asks share one call
const lastError = new Map(); // url -> message from the most recent failed live fetch

// --- disk persistence -------------------------------------------------------
(function loadFromDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    for (const [url, entry] of Object.entries(raw)) {
      if (entry && typeof entry.at === 'number' && entry.data) cache.set(url, entry);
    }
    if (cache.size) console.log(`[pagespeed] loaded ${cache.size} cached page score(s) from disk`);
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
  api.searchParams.set('strategy', 'mobile');
  if (config.pagespeedApiKey) api.searchParams.set('key', config.pagespeedApiKey);

  const res = await fetch(api, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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
      cache.set(url, { at: Date.now(), data });
      saveSoon();
      return data;
    })
    .catch((e) => {
      lastError.set(url, e.message);
      throw e;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

// Non-blocking live read, used by the Perf. column. Returns immediately:
//   { status: 'ready', data }     a live reading from this page view
//   { status: 'pending', stale }  a fetch is under way; `stale` is the last known
//                                 score (or null) so the caller can decide
// The caller polls until it goes 'ready'. `failed` means the live fetch errored
// and there is no stored score to fall back on.
export function pagespeedLive(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < FRESH_WINDOW_MS) return { status: 'ready', data: hit.data };
  const p = refresh(url);
  p.catch(() => {}); // handled by the poller; don't crash on an unhandled rejection
  if (lastError.get(url) && !inflight.has(url)) {
    const err = lastError.get(url);
    lastError.delete(url);
    if (hit && Date.now() - hit.at < TTL) return { status: 'ready', data: hit.data, stale: true };
    return { status: 'failed', error: err };
  }
  return { status: 'pending', stale: hit && Date.now() - hit.at < TTL ? hit.data : null };
}

// Blocking read — still used anywhere a score is needed as part of a response.
export async function pagespeedPage(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.data; // fresh
  if (hit) {
    // Stale: hand back the previous reading immediately and refresh behind the
    // scenes — nobody should wait 20s for a number that barely moves. A failed
    // background refresh just keeps the stale value.
    refresh(url).catch(() => {});
    return hit.data;
  }
  return refresh(url); // cold — nothing to serve but the live call
}

// Populate the cache in the background at low concurrency. Called on boot so the
// slow first fetch happens before anyone opens a combination, not during it.
export function warmPagespeedCache(urls, concurrency = 3) {
  const todo = [...new Set(urls)].filter((u) => {
    const hit = cache.get(u);
    return !hit || Date.now() - hit.at >= TTL;
  });
  if (!todo.length) return;
  console.log(`[pagespeed] warming ${todo.length} page(s) in the background…`);
  let i = 0;
  let done = 0;
  const next = () => {
    if (i >= todo.length) return Promise.resolve();
    const url = todo[i++];
    return refresh(url)
      .catch(() => {}) // one bad page must not stop the warm-up
      .then(() => {
        if (++done === todo.length) console.log('[pagespeed] warm-up complete');
        return next();
      });
  };
  for (let w = 0; w < Math.min(concurrency, todo.length); w++) next();
}

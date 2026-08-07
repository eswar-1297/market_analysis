// PageSpeed Insights / CrUX connector - real Core Web Vitals (field data).
// Returns a single point-in-time reading per page: LCP (ms), INP (ms),
// CLS (score), and Lighthouse performance score.
//
// These calls are SLOW — ~20s each, and there are ~50 pages — so caching is the
// whole game here:
//   * on disk, so a deploy or `pm2 restart` doesn't throw away hours of warm
//     entries and leave every page cold again (an in-process Map alone did);
//   * stale-while-revalidate, so an expired entry is served instantly and
//     refreshed in the background instead of blocking a request for 20s;
//   * de-duplicated, so N rows asking for the same URL at once cause one call;
//   * warmed on boot (see warmPagespeedCache), so the first visitor after a
//     deploy doesn't pay for the cold fetch either.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '..', '..', 'data', '.cache', 'pagespeed.json');

const TTL = 6 * 60 * 60 * 1000; // entries newer than this are served as-is
const FETCH_TIMEOUT_MS = 25000; // stay under a typical 30s reverse-proxy read timeout

const cache = new Map(); // url -> { at: ms, data }
const inflight = new Map(); // url -> Promise, so concurrent asks share one call

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

// One in-flight fetch per URL; stores and persists on success.
function refresh(url) {
  const existing = inflight.get(url);
  if (existing) return existing;
  const p = fetchFresh(url)
    .then((data) => {
      cache.set(url, { at: Date.now(), data });
      saveSoon();
      return data;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

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

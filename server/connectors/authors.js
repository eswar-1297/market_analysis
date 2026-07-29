// Extracts the article author from each page's HTML (<meta name="author">).
// The author is a nice-to-have shown beside each page, so it must NEVER hold up
// a response: we use a short timeout, no retry, and cache BOTH hits and misses
// (misses briefly) so a slow/blocked page can't stall every combination visit.

const cache = new Map(); // url -> { at, name }
const HIT_TTL = 24 * 60 * 60 * 1000; // successes: authorship rarely changes
const MISS_TTL = 10 * 60 * 1000; // failures: retry occasionally, but not every visit
const FETCH_TIMEOUT_MS = 4000;

async function fetchAuthorOnce(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'Mozilla/5.0 (CloudFuze Marketing Dashboard)' },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m =
    html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']author["']/i) ||
    html.match(/"author":\s*\{\s*"name":\s*"([^"]+)"/i);
  return m ? m[1].trim() : null;
}

export async function pageAuthor(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < (hit.name ? HIT_TTL : MISS_TTL)) return hit.name;
  let name = null;
  try {
    name = await fetchAuthorOnce(url); // single attempt, short timeout — no retry
  } catch {
    name = null;
  }
  // Cache misses too (short TTL) so a slow/blocked page isn't re-scraped every visit.
  cache.set(url, { at: Date.now(), name });
  return name;
}

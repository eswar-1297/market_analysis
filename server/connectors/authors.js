// Extracts the article author from each page's HTML (<meta name="author">).
// Cached in-process for 24h since authorship rarely changes.

const cache = new Map(); // url -> { at, name }
const TTL = 24 * 60 * 60 * 1000;

async function fetchAuthorOnce(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
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
  if (hit && Date.now() - hit.at < TTL) return hit.name; // only successes are cached
  let name = null;
  try {
    name = await fetchAuthorOnce(url);
    if (!name) name = await fetchAuthorOnce(url); // one retry for transient hiccups
  } catch {
    name = null;
  }
  // Cache ONLY successful lookups, so a transient failure doesn't stick for 24h.
  if (name) cache.set(url, { at: Date.now(), name });
  return name;
}

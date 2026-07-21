// Extracts the article author from each page's HTML (<meta name="author">).
// Cached in-process for 24h since authorship rarely changes.

const cache = new Map(); // url -> { at, name }
const TTL = 24 * 60 * 60 * 1000;

export async function pageAuthor(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.name;
  let name = null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'user-agent': 'Mozilla/5.0 (CloudFuze Marketing Dashboard)' },
    });
    if (res.ok) {
      const html = await res.text();
      const m =
        html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']author["']/i) ||
        html.match(/"author":\{"name":"([^"]+)"/i);
      if (m) name = m[1].trim();
    }
  } catch {
    name = null;
  }
  cache.set(url, { at: Date.now(), name });
  return name;
}

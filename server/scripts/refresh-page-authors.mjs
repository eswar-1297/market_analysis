// Regenerates data/page-authors.json — the per-article authorship the dashboard
// attributes pages by. Run it when new articles are published:
//
//     npm run refresh:authors
//
// Source of truth is the live site's WordPress REST API, which reports each post's
// byline and publish date directly. That beats inferring authorship per
// combination (which was wrong on 23 of 43 pages) and beats scraping archive HTML
// (whose "related posts" chrome leaks other authors' links into the listing).
//
// Only POSTS have bylines. The PPC ad and landing pages the dashboard also tracks
// are WordPress *pages*, carry no author, and are deliberately absent from this
// file — attribution.js maps "no entry" to "no byline", which is what they are.
//
// This never runs at boot. The dashboard must start, and keep serving, when
// cloudfuze.com is unreachable, so the committed file is what it reads and this
// script is the only thing that touches the network.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', '..', 'data', 'page-authors.json');

const API = 'https://www.cloudfuze.com/wp-json/wp/v2/posts';
const UA = 'CloudFuze-Marketing-Dashboard/1.0 (authorship refresh)';
const PER_PAGE = 100;
const MAX_PAGES = 40; // generous backstop; the walk stops on a short page

// Lookups must hit exactly, so both sides of the comparison get the same
// treatment: https, no query/fragment, one trailing slash, lower case.
export function normalizeUrl(u) {
  return String(u || '')
    .trim()
    .replace(/^http:/i, 'https:')
    .replace(/[?#].*$/, '')
    .replace(/\/?$/, '/')
    .toLowerCase();
}

async function getJson(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 2500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function main() {
  const posts = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `${API}?per_page=${PER_PAGE}&page=${page}&_embed=author` +
      `&_fields=link,date,modified,author,_links,_embedded`;
    const batch = await getJson(url);
    if (!Array.isArray(batch) || batch.length === 0) break;
    posts.push(...batch);
    process.stderr.write(`  page ${page}: +${batch.length} (total ${posts.length})\n`);
    if (batch.length < PER_PAGE) break;
  }

  if (!posts.length) throw new Error('WordPress returned no posts — refusing to overwrite with an empty file.');

  const pages = {};
  let missingAuthor = 0;
  for (const p of posts) {
    const a = p._embedded?.author?.[0];
    if (!a?.name) {
      missingAuthor++;
      continue;
    }
    pages[normalizeUrl(p.link)] = {
      author: a.name,
      slug: a.slug || null,
      // Site-local publish date. attribution.js compares only the YYYY-MM-DD part,
      // so the team-change cutovers land on the calendar day the business means.
      publishedAt: p.date,
    };
  }

  const count = Object.keys(pages).length;
  // A run that suddenly collapses is far more likely to be an API problem than a
  // site that deleted its archive, and overwriting would silently re-attribute
  // every article to Pankaj via the unknown-author rule.
  if (fs.existsSync(OUT) && !process.argv.includes('--force')) {
    const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const prevCount = Object.keys(prev.pages || {}).length;
    if (prevCount > 50 && count < prevCount * 0.8) {
      throw new Error(
        `Refusing to overwrite: got ${count} posts but the existing file has ${prevCount}. ` +
          `That looks like an API failure, not a real change. Re-run, or pass --force if the drop is genuine.`
      );
    }
  }

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), source: 'wp-json/wp/v2/posts', count, pages },
      null,
      2
    ) + '\n'
  );

  console.log(`\nWrote ${count} article bylines to data/page-authors.json`);
  if (missingAuthor) console.log(`(${missingAuthor} post(s) had no embedded author and were skipped)`);
}

main().catch((e) => {
  console.error(`\nAuthorship refresh failed: ${e.message}`);
  console.error('data/page-authors.json was left unchanged.');
  process.exit(1);
});

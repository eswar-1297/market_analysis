import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, sources, overallMode, modeFor } from './config.js';
import { ppcLive, ppcMock } from './connectors/ga4Ppc.js';
import { pagespeedPage } from './connectors/pagespeed.js';
import { mockPage } from './connectors/mock.js';
import { pageAuthor } from './connectors/authors.js';
import { previousPeriod, toISO } from './services/dates.js';
import { fetchCombinationPages } from './services/fetchData.js';
import { aggregateCombination } from './services/aggregate.js';
import { REGIONS, DEFAULT_COUNTRY, isValidCountry } from './regions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const COMBOS_FILE = path.join(DATA_DIR, 'combinations.json');
const OWNERS_FILE = path.join(DATA_DIR, 'owners.json');

function loadCombinations() {
  const base = JSON.parse(fs.readFileSync(COMBOS_FILE, 'utf8'));
  let owners = {};
  if (fs.existsSync(OWNERS_FILE)) owners = JSON.parse(fs.readFileSync(OWNERS_FILE, 'utf8'));
  for (const c of base.combinations) {
    if (owners[c.id]) c.owners = { ...c.owners, ...owners[c.id] };
  }
  return base;
}

function saveOwners(id, owners) {
  let all = {};
  if (fs.existsSync(OWNERS_FILE)) all = JSON.parse(fs.readFileSync(OWNERS_FILE, 'utf8'));
  all[id] = owners;
  fs.writeFileSync(OWNERS_FILE, JSON.stringify(all, null, 2));
}

// Default window: last 28 days ending 2 days ago (GA4/Search Console lag a day+).
function defaultRange() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27);
  return { start: toISO(start), end: toISO(end) };
}

const app = express();
app.use(cors());
app.use(express.json());

// --- Login: verify credentials, hand back a token the client stores ---
const validTokens = new Set();
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === config.authUser && password === config.authPass) {
    const token = crypto.randomUUID();
    validTokens.add(token);
    return res.json({ token });
  }
  return res.status(401).json({ error: 'Invalid username or password' });
});

// Everything else under /api requires a valid token (login above is exempt).
app.use('/api', (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Bearer' && validTokens.has(token)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
});

app.get('/api/meta', (req, res) => {
  const data = loadCombinations();
  res.json({
    site: data.site,
    dataMode: overallMode(),
    sources,
    combinationCount: data.combinations.length,
    pageCount: data.combinations.reduce((a, c) => a + c.pages.length, 0),
    defaultRange: defaultRange(),
    regions: REGIONS,
    defaultCountry: DEFAULT_COUNTRY,
  });
});

app.get('/api/combinations', (req, res) => {
  const data = loadCombinations();
  res.json(
    data.combinations.map((c) => ({
      id: c.id,
      name: c.name,
      pageCount: c.pages.length,
      owners: c.owners,
    }))
  );
});

app.get('/api/combinations/:id', async (req, res) => {
  try {
    const data = loadCombinations();
    const combo = data.combinations.find((c) => c.id === req.params.id);
    if (!combo) return res.status(404).json({ error: 'Combination not found' });

    const range = defaultRange();
    const start = req.query.start || range.start;
    const end = req.query.end || range.end;
    const country = isValidCountry(req.query.country) ? req.query.country : DEFAULT_COUNTRY;
    // Current + previous period (for the Google-Analytics-style comparison).
    // Neither fetches CWV (that's lazy via /api/cwv), so both stay fast.
    const prev = previousPeriod(start, end);
    const [currentPages, previousPages] = await Promise.all([
      fetchCombinationPages(combo.pages, start, end, country, true),
      fetchCombinationPages(combo.pages, prev.start, prev.end, country, true),
    ]);
    const result = aggregateCombination(combo, currentPages, previousPages);
    res.json({ ...result, range: { start, end }, previousRange: prev, country, dataMode: overallMode() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Article authors for a combination (scraped from each page, cached). Lazy so
// it doesn't slow the main view; the UI shows them at the top right.
app.get('/api/authors', async (req, res) => {
  const data = loadCombinations();
  const combo = data.combinations.find((c) => c.id === req.query.id);
  if (!combo) return res.status(404).json({ error: 'Combination not found' });
  const byPage = {};
  await Promise.all(
    combo.pages.map(async (p) => {
      byPage[p.url] = await pageAuthor(p.url);
    })
  );
  const authors = [...new Set(Object.values(byPage).filter(Boolean))];
  res.json({ authors, byPage });
});

// Lazy Core Web Vitals for a single page (loaded per-row by the UI so the
// slow PageSpeed call never blocks the main view). Cached 6h in the connector.
function cwvStatus(metric, value) {
  const t = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25] }[metric];
  if (value <= t[0]) return 'good';
  if (value <= t[1]) return 'needs-improvement';
  return 'poor';
}
app.get('/api/cwv', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    let d;
    try {
      d = await pagespeedPage(url);
    } catch {
      d = mockPage(url, '2020-01-01', '2020-01-28').pagespeed;
    }
    const statuses = [cwvStatus('lcp', d.lcp), cwvStatus('inp', d.inp), cwvStatus('cls', d.cls)];
    const overall = statuses.includes('poor') ? 'poor' : statuses.includes('needs-improvement') ? 'needs-improvement' : 'good';
    res.json({
      lcp: { value: d.lcp, status: cwvStatus('lcp', d.lcp) },
      inp: { value: d.inp, status: cwvStatus('inp', d.inp) },
      cls: { value: d.cls, status: cwvStatus('cls', d.cls) },
      performanceScore: d.performanceScore,
      overall,
      source: d.source,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/ppc', async (req, res) => {
  const range = defaultRange();
  const start = req.query.start || range.start;
  const end = req.query.end || range.end;
  const country = isValidCountry(req.query.country) ? req.query.country : DEFAULT_COUNTRY;
  try {
    let data;
    if (modeFor('ga4') === 'live') {
      try {
        data = await ppcLive(start, end, country);
      } catch (e) {
        data = { ...ppcMock(start, end, country), source: 'sample-fallback', error: e.message };
      }
    } else {
      data = ppcMock(start, end, country);
    }
    res.json({ ...data, range: { start, end }, country });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/combinations/:id/owners', (req, res) => {
  const { content = '', seo = '', developer = '' } = req.body || {};
  saveOwners(req.params.id, { content, seo, developer });
  res.json({ ok: true, owners: { content, seo, developer } });
});

// Serve the built React app in production (npm run build -> client/dist).
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(config.port, () => {
  console.log(`\n  CloudFuze Marketing Dashboard API`);
  console.log(`  http://localhost:${config.port}`);
  console.log(`  Data mode: ${overallMode().toUpperCase()}`);
  console.log(
    `  Live sources: ${Object.entries(sources)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ') || 'none (all sample data)'}\n`
  );
});

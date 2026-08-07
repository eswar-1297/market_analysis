import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, sources, overallMode, modeFor, hasMsAuth } from './config.js';
import { ppcLive, ppcMock } from './connectors/ga4Ppc.js';
import { adsLeads } from './connectors/googleAds.js';
import { mountMcp } from './mcp.js';
import { pagespeedPage, warmPagespeedCache } from './connectors/pagespeed.js';
import { mockPage } from './connectors/mock.js';
import { getOverview, withDeltas } from './services/overview.js';
import { getLeadsByCombo, getLeadsByPage } from './connectors/hubspot.js';
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

// Attach PPC leads (Google Ads conversions over each combo's ad pages) to a set
// of overview rows. There are only a handful of ad pages, and each unique page
// is fetched once (cached) even if it appears in multiple combos.
async function attachPpcLeads(rows, combos, ppcUrls, start, end, country) {
  const byId = {};
  for (const c of combos) byId[c.id] = c;
  const cache = new Map(); // url -> conversions (dedupe across combos)
  const leadsFor = (url) => {
    if (!cache.has(url)) cache.set(url, adsLeads(url, start, end, country));
    return cache.get(url);
  };
  await Promise.all(
    rows.map(async (row) => {
      const combo = byId[row.id];
      const pages = (combo?.pages || []).filter((p) => ppcUrls.has(p.url));
      const totals = await Promise.all(pages.map((p) => leadsFor(p.url)));
      row.ppcLeads = Math.round(totals.reduce((s, n) => s + n, 0));
    })
  );
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
// Behind a reverse proxy in production (HTTPS terminated upstream), so req.protocol
// reflects X-Forwarded-Proto — needed to build a correct OAuth redirect URI.
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());

// Read-only MCP endpoint at /mcp (GA4 + Search Console + Google Ads) so Claude
// can answer marketing questions. Mounted BEFORE the /api auth middleware since
// it has its own protection model. (OAuth for org connectors is layered next.)
mountMcp(app, '/mcp');

// --- Auth: Microsoft (Entra ID) sign-in ---
// The app session token is a deterministic HMAC (stays valid across restarts,
// no session store). It's issued only after a successful Microsoft sign-in.
function sessionToken() {
  return crypto
    .createHmac('sha256', config.authPass + '|' + config.authUser)
    .update('cf-session-v1')
    .digest('hex');
}

const msAuthority = () => `https://login.microsoftonline.com/${config.ms.tenantId}`;
// Redirect URI derived from the incoming request, so it's correct both locally
// (http://localhost:4000/...) and in production (https://your-domain/...). Both
// must be registered in the Azure app registration.
const redirectUri = (req) => `${req.protocol}://${req.get('host')}/api/auth/callback`;

// CSRF state: signed with the client secret, valid for 10 minutes (stateless).
function signState() {
  const raw = `${Date.now()}.${crypto.randomBytes(9).toString('hex')}`;
  const sig = crypto.createHmac('sha256', config.ms.clientSecret).update(raw).digest('hex');
  return Buffer.from(`${raw}.${sig}`).toString('base64url');
}
function verifyState(state) {
  try {
    const decoded = Buffer.from(String(state), 'base64url').toString('utf8');
    const i = decoded.lastIndexOf('.');
    const raw = decoded.slice(0, i);
    const sig = decoded.slice(i + 1);
    const expect = crypto.createHmac('sha256', config.ms.clientSecret).update(raw).digest('hex');
    if (sig !== expect) return false;
    return Date.now() - Number(raw.split('.')[0]) < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

// Whether Microsoft login is configured (so the UI can react if it isn't).
app.get('/api/auth/config', (req, res) => res.json({ msEnabled: hasMsAuth }));

// Step 1 — send the user to Microsoft to sign in.
app.get('/api/auth/login', (req, res) => {
  if (!hasMsAuth) return res.status(500).send('Microsoft login is not configured on the server.');
  const params = new URLSearchParams({
    client_id: config.ms.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(req),
    response_mode: 'query',
    scope: 'openid profile email',
    state: signState(),
  });
  res.redirect(`${msAuthority()}/oauth2/v2.0/authorize?${params}`);
});

// Step 2 — Microsoft redirects back here with a code; exchange it, then hand the
// app session token to the SPA via the URL fragment.
app.get('/api/auth/callback', async (req, res) => {
  const fail = (msg) => res.redirect(`/?auth_error=${encodeURIComponent(msg)}`);
  const { code, state, error, error_description } = req.query;
  if (error) return fail(error_description || error);
  if (!code || !verifyState(state)) return fail('Sign-in expired or invalid — please try again.');
  try {
    const body = new URLSearchParams({
      client_id: config.ms.clientId,
      client_secret: config.ms.clientSecret,
      code: String(code),
      redirect_uri: redirectUri(req),
      grant_type: 'authorization_code',
      scope: 'openid profile email',
    });
    const tokenRes = await fetch(`${msAuthority()}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.id_token) throw new Error(tokens.error_description || 'Microsoft token exchange failed.');
    // The id_token came directly from Microsoft over TLS in this server-to-server
    // exchange (authenticated with our client secret), so it's trusted as-is.
    const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
    if (config.ms.allowedDomains.length) {
      const email = String(payload.preferred_username || payload.email || '').toLowerCase();
      const ok = config.ms.allowedDomains.some((d) => email.endsWith('@' + d) || email.endsWith('.' + d));
      if (!ok) return fail('Your Microsoft account is not permitted to access this dashboard.');
    }
    res.redirect(`/#token=${sessionToken()}`);
  } catch (e) {
    fail(e.message || 'Sign-in failed.');
  }
});

// Everything else under /api requires a valid token (login above is exempt).
app.use('/api', (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Bearer' && token === sessionToken()) return next();
  return res.status(401).json({ error: 'Unauthorized' });
});

// Safe credential diagnostic — reveals length/shape, NOT the secret itself.
app.get('/api/credcheck', (req, res) => {
  const v = config.googleCredentialsB64 || '';
  const noWs = v.replace(/\s+/g, '');
  res.json({
    present: Boolean(v),
    length: v.length,
    startsWithBrace: v.trim().startsWith('{'),
    hasSpaces: /\s/.test(v.trim()),
    looksHex: /^[0-9a-fA-F]+$/.test(noWs),
    looksBase64Standard: /^[A-Za-z0-9+/=]+$/.test(noWs),
    looksBase64Url: /[-_]/.test(noWs) && /^[A-Za-z0-9\-_=]+$/.test(noWs),
    first6: v.slice(0, 6),
    last6: v.slice(-6),
  });
});

app.get('/api/meta', (req, res) => {
  const data = loadCombinations();
  res.json({
    site: data.site,
    dataMode: overallMode(),
    sources,
    combinationCount: data.combinations.filter((c) => !c.excludeFromOverview).length,
    pageCount: data.combinations.filter((c) => !c.excludeFromOverview).reduce((a, c) => a + c.pages.length, 0),
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
      author: c.author || null,
      pageCount: c.pages.length,
      owners: c.owners,
      excludeFromOverview: Boolean(c.excludeFromOverview),
    }))
  );
});

// Aggregated overview of ALL combinations (default landing view).
app.get('/api/overview', async (req, res) => {
  try {
    const data = loadCombinations();
    // Groups flagged excludeFromOverview (e.g. the PPC landing-page set) are
    // selectable in the dropdown but are NOT rows here — their pages already
    // live under real combinations, so counting them again would double up.
    const combos = data.combinations.filter((c) => !c.excludeFromOverview);
    const range = defaultRange();
    const start = req.query.start || range.start;
    const end = req.query.end || range.end;
    const country = isValidCountry(req.query.country) ? req.query.country : DEFAULT_COUNTRY;
    const result = await getOverview(combos, start, end, country);
    // PPC leads per combo = Google Ads conversions over that combo's ad (PPC)
    // pages. Attached here so the overview shows organic AND paid leads.
    const ppcUrls = new Set(
      data.combinations.filter((c) => c.excludeFromOverview).flatMap((c) => c.pages.map((p) => p.url))
    );
    await attachPpcLeads(result.rows, combos, ppcUrls, start, end, country);
    // Optional comparison period (cstart/cend, GA-style) → per-combination deltas.
    if (req.query.cstart && req.query.cend) {
      const prev = await getOverview(combos, req.query.cstart, req.query.cend, country);
      await attachPpcLeads(prev.rows, combos, ppcUrls, req.query.cstart, req.query.cend, country);
      result.rows = withDeltas(result.rows, prev.rows);
    }
    res.json({ ...result, range: { start, end }, country, dataMode: overallMode() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
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
    // Only fetch the comparison period when the client asks for it (compare on,
    // via cstart/cend). With compare off — the default — skipping it roughly
    // halves the work (no second round of per-page GA4/Search Console calls).
    const wantCompare = Boolean(req.query.cstart && req.query.cend);
    const prev = wantCompare ? { start: req.query.cstart, end: req.query.cend } : previousPeriod(start, end);
    const [currentPages, curLeads, previousPages, prevLeads] = await Promise.all([
      fetchCombinationPages(combo.pages, start, end, country, true),
      getLeadsByCombo([combo], start, end, country),
      wantCompare ? fetchCombinationPages(combo.pages, prev.start, prev.end, country, true) : Promise.resolve([]),
      wantCompare ? getLeadsByCombo([combo], prev.start, prev.end, country) : Promise.resolve({ byId: {} }),
    ]);
    const leads = {
      current: curLeads.byId[combo.id]?.series || [],
      previous: prevLeads.byId[combo.id]?.series || [],
    };
    const result = aggregateCombination(combo, currentPages, previousPages, leads);
    // Flag which pages are paid (PPC) landing pages vs organic, so the table can
    // distinguish them. Source of truth: pages listed in any excludeFromOverview
    // (PPC) group.
    const ppcUrls = new Set(
      data.combinations.filter((c) => c.excludeFromOverview).flatMap((c) => c.pages.map((p) => p.url))
    );
    result.pages = result.pages.map((p) => ({ ...p, ppc: ppcUrls.has(p.url) }));

    // Google Ads conversions per page — the PPC equivalent of a HubSpot lead.
    const adsConvFor = (pg) => (pg.ads || []).reduce((s, d) => s + (d.conversions || 0), 0);
    const adsByUrl = {};
    for (const pg of currentPages) if (ppcUrls.has(pg.url)) adsByUrl[pg.url] = Math.round(adsConvFor(pg));
    const prevAdsByUrl = {};
    if (wantCompare) {
      for (const pg of previousPages) if (ppcUrls.has(pg.url)) prevAdsByUrl[pg.url] = Math.round(adsConvFor(pg));
    }

    // Per-page leads. Organic pages get their share of this combination's HubSpot
    // leads, split by each page's own source->destination pair; leads that are
    // generic or ambiguous stay unattributed, so the organic column sums to
    // `leadsAttributed` (which can be less than the combination's true total).
    // Paid pages instead show their own Google Ads conversions.
    const pageLeads = await getLeadsByPage(combo, start, end, country);
    // Same attribution over the comparison window, so each page can show its own
    // growth/decline rather than only the subtotal having one.
    const prevPageLeads = wantCompare ? await getLeadsByPage(combo, prev.start, prev.end, country) : null;
    // Leads are a count, so a zero baseline is read as a multiple: 0 -> 3 is 300%.
    const leadsDelta = (cur, was) => {
      if (cur == null || was == null || (!cur && !was)) return null;
      const pct = was === 0 ? cur * 100 : Math.round(((cur - was) / was) * 100) || 0;
      return { pct, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
    };
    result.pages = result.pages.map((p) => {
      const cur = p.ppc ? adsByUrl[p.url] ?? null : pageLeads.byUrl[p.url] ?? null;
      const was = !wantCompare ? null : p.ppc ? prevAdsByUrl[p.url] ?? null : prevPageLeads.byUrl[p.url] ?? null;
      return { ...p, leads: cur, deltas: { ...p.deltas, leads: leadsDelta(cur, was) } };
    });
    result.totals.leadsAttributed = pageLeads.attributed;
    result.totals.leadsUnattributed = pageLeads.unattributed;

    // Combination-level PPC leads = the per-page conversions above, summed, so the
    // paid subtotal always equals the sum of its rows.
    const sumAdsConv = (arr) =>
      arr.filter((pg) => ppcUrls.has(pg.url)).reduce((tot, pg) => tot + adsConvFor(pg), 0);
    result.totals.ppcLeads = Object.values(adsByUrl).reduce((a, b) => a + b, 0);
    result.hasPpcPages = currentPages.some((pg) => ppcUrls.has(pg.url));
    if (wantCompare) {
      // Growth/decline vs the comparison period for organic, PPC, and combined
      // leads — shown next to each leads chip in the page table.
      const mk = (cur, prev) => {
        if (!cur && !prev) return null;
        const pct = prev === 0 ? cur * 100 : Math.round(((cur - prev) / prev) * 100) || 0;
        return { pct, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
      };
      const orgCur = result.totals.leads;
      const orgPrev = Math.round(result.deltas.leads?.previous ?? 0);
      const ppcCur = result.totals.ppcLeads;
      const ppcPrev = Math.round(sumAdsConv(previousPages));
      // The organic subtotal in the table shows ATTRIBUTED leads, so its delta has
      // to compare attributed vs attributed — not the combination's true totals,
      // which is what the title badge uses. (prevPageLeads is computed above.)
      result.leadsDeltas = {
        organic: mk(orgCur, orgPrev),
        attributed: mk(pageLeads.attributed, prevPageLeads.attributed),
        ppc: mk(ppcCur, ppcPrev),
        total: mk(pageLeads.attributed + ppcCur, prevPageLeads.attributed + ppcPrev),
        // For the title badge: every lead the combination produced, organic + paid.
        combined: mk(orgCur + ppcCur, orgPrev + ppcPrev),
      };
    }
    res.json({ ...result, range: { start, end }, previousRange: wantCompare ? prev : null, country, dataMode: overallMode() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Author index: authorship is assigned per combination in combinations.json
// (data/combinations.json -> author), so every page in a combination belongs to
// that combination's author. Grouping is pure config — no page scraping.
// Paid (PPC) landing pages are excluded: they're ad pages, not authored articles,
// so they count towards nobody even when they sit inside an authored combination.
function buildAuthorIndex() {
  const data = loadCombinations();
  const ppcUrls = new Set(
    data.combinations.filter((c) => c.excludeFromOverview).flatMap((c) => c.pages.map((p) => p.url))
  );
  const byAuthor = {};
  for (const c of data.combinations) {
    if (!c.author) continue;
    for (const pg of c.pages) {
      if (ppcUrls.has(pg.url)) continue;
      (byAuthor[c.author] = byAuthor[c.author] || []).push({ url: pg.url, label: pg.label, combo: c.name });
    }
  }
  return { authors: Object.keys(byAuthor).sort(), byAuthor };
}

app.get('/api/authors-index', (req, res) => {
  try {
    const idx = buildAuthorIndex();
    res.json({ authors: idx.authors.map((a) => ({ name: a, pageCount: idx.byAuthor[a].length })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// All pages by a given author (across every combination), with metrics + deltas.
app.get('/api/author', async (req, res) => {
  try {
    const name = req.query.name;
    if (!name) return res.status(400).json({ error: 'name required' });
    const idx = buildAuthorIndex();
    const pages = idx.byAuthor[name] || [];
    const range = defaultRange();
    const start = req.query.start || range.start;
    const end = req.query.end || range.end;
    const country = isValidCountry(req.query.country) ? req.query.country : DEFAULT_COUNTRY;
    if (!pages.length) return res.json({ id: 'author', name, pages: [], range: { start, end }, country });
    const prev =
      req.query.cstart && req.query.cend
        ? { start: req.query.cstart, end: req.query.cend }
        : previousPeriod(start, end);
    const [currentPages, previousPages] = await Promise.all([
      fetchCombinationPages(pages, start, end, country, true),
      fetchCombinationPages(pages, prev.start, prev.end, country, true),
    ]);
    const result = aggregateCombination({ id: 'author', name, owners: {}, pages }, currentPages, previousPages);

    // Per-page leads. Authorship is assigned per combination, so run the very same
    // attribution the combination view uses for each of this author's combinations
    // and merge the results — that way a page shows the identical number in both
    // views. Pages the author doesn't own simply aren't in this map.
    const cfg = loadCombinations();
    const leadsByUrl = {};
    const prevLeadsByUrl = {};
    for (const c of cfg.combinations) {
      if (c.author !== name) continue;
      const [cur, was] = await Promise.all([
        getLeadsByPage(c, start, end, country),
        getLeadsByPage(c, prev.start, prev.end, country),
      ]);
      Object.assign(leadsByUrl, cur.byUrl);
      Object.assign(prevLeadsByUrl, was.byUrl);
    }
    // Leads are a count, so a zero baseline is read as a multiple: 0 -> 3 is 300%.
    const leadsDelta = (cur, was) => {
      if (cur == null || was == null || (!cur && !was)) return null;
      const pct = was === 0 ? cur * 100 : Math.round(((cur - was) / was) * 100) || 0;
      return { pct, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
    };
    result.pages = result.pages.map((p) => ({
      ...p,
      leads: leadsByUrl[p.url] ?? null,
      deltas: { ...p.deltas, leads: leadsDelta(leadsByUrl[p.url] ?? null, prevLeadsByUrl[p.url] ?? null) },
    }));
    // Sum the rows actually shown, so the subtotal always matches the column.
    result.totals.leadsAttributed = result.pages.reduce((s, p) => s + (p.leads || 0), 0);

    res.json({ ...result, range: { start, end }, country, dataMode: overallMode() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
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

// Average performance score for a combination (avg of its pages' PageSpeed
// scores). Lazy per-row on the overview; cached 6h in the connector.
app.get('/api/combo-perf', async (req, res) => {
  try {
    const data = loadCombinations();
    const combo = data.combinations.find((c) => c.id === req.query.id);
    if (!combo) return res.status(404).json({ error: 'Combination not found' });
    const scores = [];
    await Promise.all(
      combo.pages.map(async (pg) => {
        try {
          const d = await pagespeedPage(pg.url);
          if (typeof d.performanceScore === 'number') scores.push(d.performanceScore);
        } catch {
          /* skip page on error */
        }
      })
    );
    const perf = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    res.json({ id: combo.id, perf });
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
  // Hashed assets can cache forever; index.html must NOT be cached so a rebuild
  // always serves the newest bundle (prevents stale UI after redeploys).
  app.use(
    express.static(dist, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    })
  );
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(dist, 'index.html'));
  });
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
  // Core Web Vitals are ~20s per page from PageSpeed, so fetch them in the
  // background now rather than making the first visitor wait per row. Results
  // persist to disk, so this is usually a no-op after the first run.
  if (modeFor('pagespeed') === 'live') {
    try {
      const urls = loadCombinations().combinations.flatMap((c) => c.pages.map((p) => p.url));
      warmPagespeedCache(urls);
    } catch (e) {
      console.warn('[pagespeed] warm-up skipped:', e.message);
    }
  }
});

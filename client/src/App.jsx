import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { api, auth } from './api.js';
import PageTable from './components/PageTable.jsx';
import Overview from './components/Overview.jsx';
import LoginPage from './components/LoginPage.jsx';

function daysBetween(start, end) {
  return Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
}

// The equal-length period immediately before [start, end] — the default compare range.
function previousPeriod(start, end) {
  if (!start || !end) return { start: '', end: '' };
  const s = new Date(start + 'T00:00:00Z');
  const days = daysBetween(start, end);
  const pe = new Date(s);
  pe.setUTCDate(pe.getUTCDate() - 1);
  const ps = new Date(pe);
  ps.setUTCDate(ps.getUTCDate() - (days - 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start: iso(ps), end: iso(pe) };
}

// Leads delta shown next to the title. Accepts either shape: the overview's
// { pct, dir } or the combination detail's { deltaPct, direction, reliable }.
// Flat cells show just the %, no em-dash (it reads like a minus before "0%").
function LeadsDelta({ d }) {
  if (!d) return null;
  if (d.reliable === false) {
    return <span className="delta flat" title="too little data to compare">—</span>;
  }
  const dir = d.dir || d.direction;
  const pct = d.pct ?? d.deltaPct;
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '';
  const sign = pct > 0 ? '+' : '';
  return (
    <span className={`delta ${dir}`}>
      {arrow ? arrow + ' ' : ''}
      {sign}
      {pct}%
    </span>
  );
}

// Live-source errors can be huge HTML bodies (e.g. Google's 502 error page).
// Reduce each to a short, readable summary: prefer the HTML <title>, else strip
// tags and truncate.
function cleanError(msg) {
  const s = String(msg || '');
  const title = s.match(/<title>([^<]+)<\/title>/i);
  let text = title ? title[1] : s.replace(/<[^>]+>/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > 140 ? text.slice(0, 140) + '…' : text;
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [authed, setAuthed] = useState(auth.isAuthed());
  const [meta, setMeta] = useState(null);
  const [combos, setCombos] = useState([]);
  const [detail, setDetail] = useState(null);
  const [overview, setOverview] = useState(null);
  const [authorsList, setAuthorsList] = useState([]);
  const [authorData, setAuthorData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Client-side result cache, keyed by request signature. Makes re-selecting a
  // combination (or toggling Compare) instant — no refetch — and is warmed in
  // the background so any combination is ready by the time it's clicked.
  const dataCache = useRef(new Map());

  const path = location.pathname;
  const comboId = path.startsWith('/c/') ? decodeURIComponent(path.slice(3)) : null;
  const author = searchParams.get('author') || '';
  const authorMode = !comboId && !!author; // "/?author=X" = one writer's pages
  const overviewMode = !comboId && !author; // "/" = all-combinations overview
  const selectedId = comboId;
  const country = searchParams.get('region') || 'US';
  const compare = searchParams.get('cmp') === '1'; // comparison OFF by default
  const start = searchParams.get('start') || meta?.defaultRange.start || '';
  const end = searchParams.get('end') || meta?.defaultRange.end || '';
  const maxDate = meta?.defaultRange.end || '';
  const rangeDays = start && end ? daysBetween(start, end) : 0;
  // Comparison period — custom (GA-style) or defaults to the previous period.
  const prevDefault = previousPeriod(start, end);
  const cstart = searchParams.get('cstart') || prevDefault.start;
  const cend = searchParams.get('cend') || prevDefault.end;

  const go = (id) => {
    const sp = new URLSearchParams(searchParams);
    sp.delete('author'); // choosing a combination clears the author filter
    const qs = sp.toString();
    const p = id === '__all__' ? '/' : `/c/${id}`;
    navigate(qs ? `${p}?${qs}` : p);
  };
  const goAuthor = (name) => {
    const sp = new URLSearchParams(searchParams);
    if (name) sp.set('author', name);
    else sp.delete('author');
    const qs = sp.toString();
    navigate(qs ? `/?${qs}` : '/'); // author view lives at the root path
  };
  const setParam = (key, value) => {
    const sp = new URLSearchParams(searchParams);
    sp.set(key, value);
    setSearchParams(sp, { replace: true });
  };

  // If any request comes back 401, drop to the login page smoothly (no reload).
  useEffect(() => {
    const onUnauth = () => setAuthed(false);
    window.addEventListener('cf-unauthorized', onUnauth);
    return () => window.removeEventListener('cf-unauthorized', onUnauth);
  }, []);

  useEffect(() => {
    if (!authed) return;
    (async () => {
      const [m, list] = await Promise.all([api.meta(), api.combinations()]);
      setMeta(m);
      setCombos(list);
    })().catch((e) => setError(e.message));
  }, [authed]);

  // Author list for the filter dropdown (scrapes once server-side, cached).
  useEffect(() => {
    if (!authed) return;
    api.authorsIndex().then((d) => setAuthorsList(d.authors)).catch(() => {});
  }, [authed]);

  // All-combinations overview (default view).
  useEffect(() => {
    if (!authed || !overviewMode || !start || !end) return;
    const key = `ov|${start}|${end}|${country}|${compare ? cstart : ''}|${compare ? cend : ''}`;
    const cached = dataCache.current.get(key);
    if (cached) {
      setError(null);
      setOverview(cached);
      return; // instant — no reload
    }
    setLoading(true);
    setError(null);
    api
      .overview(start, end, country, compare ? cstart : null, compare ? cend : null)
      .then((d) => {
        dataCache.current.set(key, d);
        setOverview(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [authed, overviewMode, start, end, country, compare, cstart, cend]);

  // One author's pages across all combinations.
  useEffect(() => {
    if (!authed || !authorMode || !start || !end) return;
    const key = `au|${author}|${start}|${end}|${country}|${compare ? cstart : ''}|${compare ? cend : ''}`;
    const cached = dataCache.current.get(key);
    if (cached) {
      setError(null);
      setAuthorData(cached);
      return; // instant — no reload
    }
    setLoading(true);
    setError(null);
    api
      .author(author, start, end, country, compare ? cstart : null, compare ? cend : null)
      .then((d) => {
        dataCache.current.set(key, d);
        setAuthorData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [authed, authorMode, author, start, end, country, compare, cstart, cend]);

  const range = start && end ? { start, end } : null;

  useEffect(() => {
    if (!authed || !selectedId || !range) return;
    const key = `c|${selectedId}|${start}|${end}|${country}|${compare ? cstart : ''}|${compare ? cend : ''}`;
    const cached = dataCache.current.get(key);
    if (cached) {
      setError(null);
      setDetail(cached);
      return; // instant — no reload (previously opened this combo)
    }
    setLoading(true);
    setError(null);
    api
      .combination(selectedId, start, end, country, compare ? cstart : null, compare ? cend : null)
      .then((d) => {
        dataCache.current.set(key, d);
        setDetail(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedId, start, end, country, authed, compare, cstart, cend]);

  const selectedCombo = combos.find((c) => c.id === selectedId);
  // Real source→destination combinations vs. dropdown-only groups (e.g. PPC).
  const realCombos = combos.filter((c) => !c.excludeFromOverview);
  const ppcCombos = combos.filter((c) => c.excludeFromOverview);
  // Leads for the selected combination come straight from the already-loaded
  // overview (it returns leads + delta per combo), so the badge is instant — no
  // wait for the detail fetch. Falls back to the detail response if the overview
  // for these exact params isn't cached (e.g. deep-linked straight to a combo).
  const ovKey = `ov|${start}|${end}|${country}|${compare ? cstart : ''}|${compare ? cend : ''}`;
  const ovRow = comboId ? dataCache.current.get(ovKey)?.rows?.find((r) => r.id === selectedId) : null;
  const detailReady = detail && detail.id === selectedId;
  const hasErrors = detailReady && Object.keys(detail.errors || {}).length > 0;
  const title = comboId ? (selectedCombo ? selectedCombo.name : 'Loading…') : authorMode ? `Author: ${author}` : 'All combinations';
  const regionLabel = meta?.regions.find((r) => r.code === country)?.label || country;
  const pageCount = selectedCombo?.pageCount;

  if (!authed) return <LoginPage onSuccess={() => setAuthed(true)} />;

  return (
    <div className="app-shell">
      <header className="appbar">
        <div className="appbar-top">
          <div className="brand">
            Cloud<span>Fuze</span> Marketing
          </div>
          <div className="appbar-right">
            {meta && (
              <span className={`mode-pill ${meta.dataMode}`}>
                {meta.dataMode === 'live' ? '● Live' : '● Sample'}
              </span>
            )}
            <button
              className="toggle-btn"
              onClick={() => {
                api.logout();
                setAuthed(false);
              }}
              title="Log out"
            >
              Log out
            </button>
          </div>
        </div>

        <div className="appbar-controls">
          <select
            className="combo-select"
            value={comboId ? selectedId : '__all__'}
            onChange={(e) => go(e.target.value)}
            title="Select a view"
          >
            <option value="__all__">All combinations ({realCombos.length})</option>
            {ppcCombos.length > 0 && (
              <optgroup label="Paid (PPC)">
                {ppcCombos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.pageCount})
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Combinations">
              {realCombos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.pageCount})
                </option>
              ))}
            </optgroup>
          </select>

          {authorsList.length > 0 && (
            <select
              className="region-select"
              value={author}
              onChange={(e) => goAuthor(e.target.value)}
              title="Filter by author"
            >
              <option value="">All authors</option>
              {authorsList.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name} ({a.pageCount})
                </option>
              ))}
            </select>
          )}

          {meta && (
            <select
              className="region-select"
              value={country}
              onChange={(e) => setParam('region', e.target.value)}
              title="Filter by region"
            >
              {meta.regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          )}

          {meta && (
            <div className="date-range" title="Pick a date range">
              <input
                type="date"
                className="date-input"
                value={start}
                max={end || maxDate}
                onChange={(e) => e.target.value && setParam('start', e.target.value)}
              />
              <span className="date-sep">→</span>
              <input
                type="date"
                className="date-input"
                value={end}
                min={start}
                max={maxDate}
                onChange={(e) => e.target.value && setParam('end', e.target.value)}
              />
            </div>
          )}

          <button
            className={`toggle-btn ${compare ? 'active' : ''}`}
            onClick={() => setParam('cmp', compare ? '0' : '1')}
            title="Compare against another period"
          >
            ⇄ Compare {compare ? 'on' : 'off'}
          </button>

          {compare && meta && (
            <div className="date-range" title="Compare-to period">
              <span className="date-sep">vs</span>
              <input
                type="date"
                className="date-input"
                value={cstart}
                max={cend || maxDate}
                onChange={(e) => e.target.value && setParam('cstart', e.target.value)}
              />
              <span className="date-sep">→</span>
              <input
                type="date"
                className="date-input"
                value={cend}
                min={cstart}
                max={maxDate}
                onChange={(e) => e.target.value && setParam('cend', e.target.value)}
              />
            </div>
          )}
        </div>
      </header>

      <main className="main">
        <div className="title-row">
          <h1 className="h1">{title}</h1>
        </div>

        {error && <div className="warn-banner">Error: {error}</div>}
        {hasErrors && (
          <div className="warn-banner">
            Some live sources temporarily failed and fell back to sample data:{' '}
            {Object.entries(detail.errors)
              .map(([k, v]) => `${k} — ${cleanError(v)}`)
              .join('; ')}
            . Try refreshing.
          </div>
        )}

        {loading && <div className="loading">Loading data…</div>}

        {!loading && overviewMode && overview && <Overview rows={overview.rows} onOpen={go} compare={compare} />}

        {!loading && authorMode && authorData && (
          authorData.pages.length ? (
            <PageTable pages={authorData.pages} compare={compare} />
          ) : (
            <div className="loading">No pages found for this author.</div>
          )
        )}

        {!loading && comboId && detailReady && (
          <PageTable
            pages={detail.pages}
            compare={compare}
            leads={{ organic: ovRow ? ovRow.leads : detail.totals?.leads, ppc: detail.totals?.ppcLeads }}
            leadsDeltas={compare ? detail.leadsDeltas : null}
          />
        )}
      </main>
    </div>
  );
}

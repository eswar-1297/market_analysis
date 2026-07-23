import { useEffect, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { api, auth } from './api.js';
import PageTable from './components/PageTable.jsx';
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

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [authed, setAuthed] = useState(auth.isAuthed());
  const [meta, setMeta] = useState(null);
  const [combos, setCombos] = useState([]);
  const [detail, setDetail] = useState(null);
  const [authorInfo, setAuthorInfo] = useState(undefined); // {authors, byPage}; undefined = loading
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const path = location.pathname;
  const comboId = path.startsWith('/c/') ? decodeURIComponent(path.slice(3)) : null;
  const selectedId = comboId;
  const country = searchParams.get('region') || 'US';
  const compare = searchParams.get('cmp') !== '0'; // comparison on by default
  const start = searchParams.get('start') || meta?.defaultRange.start || '';
  const end = searchParams.get('end') || meta?.defaultRange.end || '';
  const maxDate = meta?.defaultRange.end || '';
  const rangeDays = start && end ? daysBetween(start, end) : 0;
  // Comparison period — custom (GA-style) or defaults to the previous period.
  const prevDefault = previousPeriod(start, end);
  const cstart = searchParams.get('cstart') || prevDefault.start;
  const cend = searchParams.get('cend') || prevDefault.end;

  const go = (id) => {
    const qs = searchParams.toString();
    navigate(qs ? `/c/${id}?${qs}` : `/c/${id}`);
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

  useEffect(() => {
    if (combos.length && !selectedId && path === '/') {
      const qs = searchParams.toString();
      navigate(qs ? `/c/${combos[0].id}?${qs}` : `/c/${combos[0].id}`, { replace: true });
    }
  }, [combos, selectedId, path]);

  // Article authors for the selected combination (top-right badge).
  useEffect(() => {
    if (!authed || !comboId) {
      setAuthorInfo({ authors: [], byPage: {} });
      return;
    }
    setAuthorInfo(undefined);
    let cancelled = false;
    api
      .authors(comboId)
      .then((d) => !cancelled && setAuthorInfo(d))
      .catch(() => !cancelled && setAuthorInfo({ authors: [], byPage: {} }));
    return () => {
      cancelled = true;
    };
  }, [comboId, authed]);

  const range = start && end ? { start, end } : null;

  useEffect(() => {
    if (!authed || !selectedId || !range) return;
    setLoading(true);
    setError(null);
    api
      .combination(selectedId, start, end, country, compare ? cstart : null, compare ? cend : null)
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedId, start, end, country, authed, compare, cstart, cend]);

  const selectedCombo = combos.find((c) => c.id === selectedId);
  const detailReady = detail && detail.id === selectedId;
  const hasErrors = detailReady && Object.keys(detail.errors || {}).length > 0;
  const title = selectedCombo ? selectedCombo.name : 'Loading…';
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
            value={selectedId || ''}
            onChange={(e) => go(e.target.value)}
            title="Select a combination"
          >
            {combos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.pageCount})
              </option>
            ))}
          </select>

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
          <div className="authors">
            {authorInfo === undefined ? (
              <span className="spinner" />
            ) : authorInfo.authors.length ? (
              <>
                <span className="authors-label">{authorInfo.authors.length > 1 ? 'Authors' : 'Author'}</span>
                <span className="authors-names">✍ {authorInfo.authors.join(', ')}</span>
              </>
            ) : (
              <span className="authors-names" style={{ color: 'var(--muted)' }}>No author found</span>
            )}
          </div>
        </div>

        {error && <div className="warn-banner">Error: {error}</div>}
        {hasErrors && (
          <div className="warn-banner">
            Some live sources failed and fell back to sample data:{' '}
            {Object.entries(detail.errors)
              .map(([k, v]) => `${k} (${v})`)
              .join('; ')}
          </div>
        )}

        {loading && <div className="loading">Loading data…</div>}

        {!loading && detailReady && (
          <PageTable
            pages={detail.pages}
            compare={compare}
            authorsByPage={authorInfo?.byPage || {}}
            authors={authorInfo?.authors || []}
          />
        )}
      </main>
    </div>
  );
}

const TOKEN_KEY = 'cf_token';

export const auth = {
  token: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
  isAuthed: () => Boolean(localStorage.getItem(TOKEN_KEY)),
};

// After Microsoft sign-in, the server redirects back to "/#token=<app-token>".
// Capture it, store it, and strip it from the URL. Runs once on module load,
// before React reads auth state.
(function captureRedirectToken() {
  if (typeof window === 'undefined') return;
  const m = window.location.hash.match(/[#&]token=([^&]+)/);
  if (m) {
    auth.set(decodeURIComponent(m[1]));
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
})();

function headers(extra = {}) {
  const t = auth.token();
  return { ...extra, ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

function onUnauthorized() {
  auth.clear();
  // Tell the app to show the login page — NO full-page reload (avoids loops).
  window.dispatchEvent(new Event('cf-unauthorized'));
}

async function get(url) {
  const res = await fetch(url, { headers: headers() });
  if (res.status === 401) {
    onUnauthorized();
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  logout: () => auth.clear(),
  meta: () => get('/api/meta'),
  combinations: () => get('/api/combinations'),
  overview: (start, end, country, cstart, cend) => {
    const q = new URLSearchParams();
    if (start) q.set('start', start);
    if (end) q.set('end', end);
    if (country) q.set('country', country);
    if (cstart) q.set('cstart', cstart);
    if (cend) q.set('cend', cend);
    const qs = q.toString();
    return get(`/api/overview${qs ? '?' + qs : ''}`);
  },
  combination: (id, start, end, country, cstart, cend) => {
    const q = new URLSearchParams();
    if (start) q.set('start', start);
    if (end) q.set('end', end);
    if (country) q.set('country', country);
    if (cstart) q.set('cstart', cstart);
    if (cend) q.set('cend', cend);
    const qs = q.toString();
    return get(`/api/combinations/${id}${qs ? '?' + qs : ''}`);
  },
  cwv: (url) => get(`/api/cwv?url=${encodeURIComponent(url)}`),
  comboPerf: (id) => get(`/api/combo-perf?id=${encodeURIComponent(id)}`),
  authors: (id) => get(`/api/authors?id=${encodeURIComponent(id)}`),
  authorsIndex: () => get('/api/authors-index'),
  author: (name, start, end, country, cstart, cend) => {
    const q = new URLSearchParams({ name });
    if (start) q.set('start', start);
    if (end) q.set('end', end);
    if (country) q.set('country', country);
    if (cstart) q.set('cstart', cstart);
    if (cend) q.set('cend', cend);
    return get(`/api/author?${q.toString()}`);
  },
  saveOwners: async (id, owners) => {
    const res = await fetch(`/api/combinations/${id}/owners`, {
      method: 'PUT',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(owners),
    });
    if (!res.ok) throw new Error('Failed to save owners');
    return res.json();
  },
};

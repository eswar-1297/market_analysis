const TOKEN_KEY = 'cf_token';
// The signed-in email, kept only to attribute analytics sessions to a person. Not a
// credential: the API authorises on TOKEN_KEY alone and never reads this.
const EMAIL_KEY = 'cf_email';

export const auth = {
  token: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  email: () => localStorage.getItem(EMAIL_KEY) || '',
  setEmail: (e) => localStorage.setItem(EMAIL_KEY, e),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
  },
  isAuthed: () => Boolean(localStorage.getItem(TOKEN_KEY)),
};

// After Microsoft sign-in, the server redirects back to
// "/#token=<app-token>&email=<signed-in-email>". Capture both, store them, and strip the
// fragment from the URL. Runs once on module load, before React reads auth state.
(function captureRedirectToken() {
  if (typeof window === 'undefined') return;
  const hash = window.location.hash;
  const m = hash.match(/[#&]token=([^&]+)/);
  if (m) {
    auth.set(decodeURIComponent(m[1]));
    const e = hash.match(/[#&]email=([^&]+)/);
    // Older deploys redirect without the email; leave whatever is stored alone rather
    // than blanking it, so analytics attribution survives a mixed-version rollout.
    if (e) auth.setEmail(decodeURIComponent(e[1]));
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
  // `refresh` forces a fresh PageSpeed measurement instead of reading the daily
  // pre-measured snapshot (the Perf. column's refresh button).
  cwv: (url, refresh = false) =>
    get(`/api/cwv?url=${encodeURIComponent(url)}${refresh ? '&refresh=1' : ''}`),
  comboPerf: (id, refresh = false) =>
    get(`/api/combo-perf?id=${encodeURIComponent(id)}${refresh ? '&refresh=1' : ''}`),
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

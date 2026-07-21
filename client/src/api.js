const TOKEN_KEY = 'cf_token';

export const auth = {
  token: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
  isAuthed: () => Boolean(localStorage.getItem(TOKEN_KEY)),
};

function headers(extra = {}) {
  const t = auth.token();
  return { ...extra, ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

async function get(url) {
  const res = await fetch(url, { headers: headers() });
  if (res.status === 401) {
    auth.clear();
    window.location.reload(); // token invalid/expired -> back to login
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  login: async (username, password) => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error('Invalid username or password');
    const d = await res.json();
    auth.set(d.token);
    return d;
  },
  logout: () => auth.clear(),
  meta: () => get('/api/meta'),
  combinations: () => get('/api/combinations'),
  combination: (id, start, end, country) => {
    const q = new URLSearchParams();
    if (start) q.set('start', start);
    if (end) q.set('end', end);
    if (country) q.set('country', country);
    const qs = q.toString();
    return get(`/api/combinations/${id}${qs ? '?' + qs : ''}`);
  },
  cwv: (url) => get(`/api/cwv?url=${encodeURIComponent(url)}`),
  authors: (id) => get(`/api/authors?id=${encodeURIComponent(id)}`),
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

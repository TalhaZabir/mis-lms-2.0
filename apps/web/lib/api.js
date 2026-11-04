export const API = process.env.NEXT_PUBLIC_API || 'http://localhost:4000';

function logoutAndRedirect() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('mis_token');
  localStorage.removeItem('mis_user');
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  if (!window.location.pathname.startsWith('/login')) window.location.href = `/login?next=${next}`;
}

export async function apiRaw(path, opts = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mis_token') : null;
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    // Any authenticated 401 means the server-side session was revoked or expired.
    const body = await res.clone().json().catch(() => ({}));
    logoutAndRedirect();
    throw new Error(body.error || 'Session expired — please login again');
  }
  return res;
}

export async function api(path, opts = {}) {
  const res = await apiRaw(path, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
  return res.json();
}

export function saveAuth(token, user) { localStorage.setItem('mis_token', token); localStorage.setItem('mis_user', JSON.stringify(user)); }
export function clearAuth() { localStorage.removeItem('mis_token'); localStorage.removeItem('mis_user'); }
export function getUser() { try { return JSON.parse(localStorage.getItem('mis_user')); } catch { return null; } }
export function getToken() { return localStorage.getItem('mis_token'); }
export const fmtDate = (d) => { try { return new Date(d).toLocaleString(); } catch { return d; } };
export const initials = (n) => (n || '?').split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();

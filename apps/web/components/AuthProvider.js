'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { API, clearAuth } from '../lib/api';
import { ROLE_HOME } from '../lib/roles';

const AuthCtx = createContext({ user: null, loading: true, logout: () => {}, refresh: async () => null });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem('mis_token');
    if (!token) { setUser(null); setLoading(false); return null; }
    try {
      const res = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('expired');
      const me = await res.json();
      localStorage.setItem('mis_user', JSON.stringify(me));
      setUser(me); setLoading(false); return me;
    } catch {
      clearAuth(); setUser(null); setLoading(false); return null;
    }
  }, []);

  useEffect(() => {
    try { const cached = JSON.parse(localStorage.getItem('mis_user')); if (cached) setUser(cached); } catch {}
    refresh();
  }, [refresh]);

  const logout = useCallback(() => { clearAuth(); setUser(null); window.location.href = '/'; }, []);

  const value = useMemo(() => ({ user, loading, logout, refresh, home: user ? ROLE_HOME[user.role] || '/' : '/' }), [user, loading, refresh, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() { return useContext(AuthCtx); }

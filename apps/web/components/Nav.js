'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';
import { api } from '../lib/api';
import { NAV, can } from '../lib/roles';

export function Nav() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const items = NAV.filter(n => can(n.roles, user));

  useEffect(() => {
    let active = true;
    if (!user) {
      setAssistantEnabled(false);
      return undefined;
    }
    api('/ai/status')
      .then((status) => { if (active) setAssistantEnabled(Boolean(status?.enabled)); })
      .catch(() => { if (active) setAssistantEnabled(false); });
    return () => { active = false; };
  }, [user]);

  return (
    <div className="topbar">
      <Link className="brand" href="/"><span className="brand-badge">M</span> MIS LMS – DU</Link>
      <nav className="navlinks" aria-label="Primary">
        {items.map(n => (
          <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>{n.label}</Link>
        ))}
        {assistantEnabled && (
          <Link href="/assistant" className={pathname === '/assistant' ? 'active' : ''}>Assistant</Link>
        )}
      </nav>
      <div className="top-right">
        {user && <GlobalSearch />}
        {user && <NotificationBell />}
        {loading ? <span className="user-pill">…</span> : user ? (
          <>
            <span className="user-pill" title={user.email}>{user.name} · {user.role}</span>
            <button className="btn-gold" onClick={logout}>Logout</button>
          </>
        ) : <Link className="btn-gold" href="/login">Login</Link>}
      </div>
    </div>
  );
}

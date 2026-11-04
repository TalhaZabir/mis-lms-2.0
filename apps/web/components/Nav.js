'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { NAV, can } from '../lib/roles';

export function Nav() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const items = NAV.filter(n => can(n.roles, user));
  return (
    <div className="topbar">
      <Link className="brand" href="/"><span className="brand-badge">M</span> MIS LMS – DU</Link>
      <nav className="navlinks" aria-label="Primary">
        {items.map(n => (
          <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>{n.label}</Link>
        ))}
      </nav>
      <div className="top-right">
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

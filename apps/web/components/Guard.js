'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';

export function Guard({ roles, children, fallback }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(pathname || '/')}`);
    else if (roles && !roles.includes(user.role)) router.replace('/denied');
  }, [user, loading, roles, router, pathname]);

  if (loading) return fallback || <div className="card"><p>Checking access…</p><div className="progress"><div style={{ width: '40%' }} /></div></div>;
  if (!user) return fallback || <div className="card"><p>Redirecting to login…</p></div>;
  if (roles && !roles.includes(user.role)) return fallback || <div className="card"><p>Checking access…</p></div>;
  return children;
}

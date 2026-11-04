'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, fmtDate } from '../lib/api';
import { useAuth } from './AuthProvider';

export function NotificationBell() {
  const { user } = useAuth();
  const router = useRouter();
  const wrapRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [list, unread] = await Promise.all([
        api('/me/notifications?limit=8'),
        api('/me/notifications/unread-count'),
      ]);
      setItems(Array.isArray(list) ? list : []);
      setCount(Number(unread?.count) || 0);
    } catch {
      // The global 401 handler redirects; transient failures keep the last view.
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setCount(0);
      setOpen(false);
      return undefined;
    }
    setLoading(true);
    load().finally(() => setLoading(false));
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [user, load]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  async function openItem(notification) {
    setOpen(false);
    if (!notification.isRead) {
      try {
        await api(`/notifications/${notification.id}/read`, { method: 'PUT', body: '{}' });
        setItems((rows) => rows.map((row) => (row.id === notification.id ? { ...row, isRead: true } : row)));
        setCount((value) => Math.max(0, value - 1));
      } catch {
        // Reading a notification is best-effort; navigation still helps the user.
      }
    }
    if (notification.link && notification.link.startsWith('/')) router.push(notification.link);
  }

  async function markAllRead() {
    try {
      await api('/notifications/read-all', { method: 'PUT', body: '{}' });
      setItems((rows) => rows.map((row) => ({ ...row, isRead: true })));
      setCount(0);
    } catch {
      // Keep the panel usable even if the bulk update fails.
    }
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-btn"
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) load();
        }}
      >
        <span aria-hidden="true">🔔</span>
        {count > 0 && <span className="notif-dot">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <b>Notifications</b>
            {count > 0 && (
              <button type="button" className="btn-sm btn-ghost" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          {loading && !items.length && <p className="notif-empty">Loading…</p>}
          {!loading && !items.length && <p className="notif-empty">No notifications yet.</p>}
          {items.map((notification) => (
            <button
              type="button"
              key={notification.id}
              className={`notif-item${notification.isRead ? '' : ' unread'}`}
              onClick={() => openItem(notification)}
            >
              <b>{notification.title}</b>
              {notification.body && <p>{notification.body}</p>}
              <p style={{ fontSize: 11.5 }}>{fmtDate(notification.createdAt)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

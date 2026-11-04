'use client';
import { useEffect, useState } from 'react';
import { api, fmtDate } from '../../lib/api';
import { Guard } from '../../components/Guard';
import { RESOURCE_ROLES, CURATOR_ROLES } from '../../lib/roles';
import { useAuth } from '../../components/AuthProvider';

const ALL_TABS = ['browse', 'bookmarks', 'queue', 'notifications'];
const CATS = ['ALL', 'COURSE_MAT', 'TOOLS', 'RESEARCH', 'CAREER', 'SCHOLARSHIP', 'EXAM'];

export default function Resources() {
  const { user } = useAuth();
  const TABS = ALL_TABS.filter(t => t !== 'queue' || (user && CURATOR_ROLES.includes(user.role)));
  const [tab, setTab] = useState('browse');
  const [cat, setCat] = useState('ALL');
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState([]);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState('');
  const [sug, setSug] = useState({ title: '', url: '', category: 'COURSE_MAT', description: '' });

  async function load() {
    try {
      setMsg('');
      if (tab === 'browse') setItems(await api(`/resources${cat !== 'ALL' ? `?category=${cat}` : ''}`));
      if (tab === 'bookmarks') setItems(await api('/me/bookmarks'));
      if (tab === 'queue') setItems(await api('/resources/queue'));
      if (tab === 'notifications') setNotes(await api('/me/notifications'));
    } catch (e) { setMsg(e.message + ' — login first'); }
  }
  useEffect(() => { load(); }, [tab, cat]);

  async function suggest() {
    try {
      if (!sug.title || !sug.url) { setMsg('Title + URL required'); return; }
      await api('/resources/suggest', { method: 'POST', body: JSON.stringify(sug) });
      setSug({ title: '', url: '', category: 'COURSE_MAT', description: '' }); setOk('Suggestion sent for faculty review ✅'); load();
    } catch (e) { setMsg(e.message); }
  }

  return (
    <Guard roles={RESOURCE_ROLES}>
    <div>
      <h1 style={{ margin: '4px 0' }}>Resource Corner</h1>
      <p style={{ color: '#64748b' }}>Faculty-verified links · suggest → review → publish · upvote & bookmark the best.</p>
      <div className="tabs">{TABS.map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
        {tab === 'browse' && CATS.map(c => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)} style={{ fontSize: 12 }}>{c}</button>)}
        <button onClick={load}>↻</button>
      </div>
      {msg && <div className="alert-err">{msg}</div>}
      {ok && <div className="alert-ok">{ok}</div>}

      <div className="form-card">
        <b>💡 Suggest a useful link</b>
        <div className="form-row">
          <input placeholder="Title e.g. SQL Practice" value={sug.title} onChange={e => setSug({ ...sug, title: e.target.value })} />
          <input placeholder="https://…" value={sug.url} onChange={e => setSug({ ...sug, url: e.target.value })} />
          <select value={sug.category} onChange={e => setSug({ ...sug, category: e.target.value })}><option>COURSE_MAT</option><option>TOOLS</option><option>RESEARCH</option><option>CAREER</option><option>SCHOLARSHIP</option><option>EXAM</option></select>
        </div>
        <div className="form-row"><input placeholder="Why is it useful? (optional)" value={sug.description} onChange={e => setSug({ ...sug, description: e.target.value })} /><button className="btn" onClick={suggest}>Suggest</button></div>
      </div>

      {tab === 'notifications' ? (
        <div>{notes.map(n => <div className="card" key={n.id} style={{ marginBottom: 8 }}><b>{n.title}</b><p>{n.body}</p><span style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(n.createdAt)}</span> {!n.isRead && <button className="btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={async () => { await api(`/notifications/${n.id}/read`, { method: 'PUT', body: JSON.stringify({}) }); load(); }}>Mark read</button>}</div>)}{!notes.length && <div className="card"><p>No notifications.</p></div>}</div>
      ) : (
        <div className="res-grid">
          {items.map(r => (
            <div className="card" key={r.id}>
              <span className="badge blue">{r.category}</span> {r.isVerified ? <span className="badge green">✓ Verified</span> : <span className="badge gold">Pending</span>} {r.brokenFlag && <span className="badge red">Broken</span>}
              <h3 style={{ marginTop: 8 }}><a href={r.url} target="_blank" style={{ color: '#0a2a5e', textDecoration: 'none' }}>{r.title} ↗</a></h3>
              <p>{r.description || 'No description'}</p>
              <p style={{ fontSize: 12, color: '#64748b' }}>by {r.addedBy?.name || '—'} · 👍 {r._count?.votes ?? ''} </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn-ghost btn-sm" onClick={async () => { try { await api(`/resources/${r.id}/vote`, { method: 'POST', body: JSON.stringify({}) }); load(); } catch (e) { setMsg(e.message); } }}>👍 Upvote</button>
                <button className="btn-ghost btn-sm" onClick={async () => { try { await api(`/resources/${r.id}/bookmark`, { method: 'POST', body: JSON.stringify({}) }); setOk('Bookmarked — see Bookmarks tab'); } catch (e) { setMsg(e.message); } }}>🔖 Save</button>
                <button className="btn-ghost btn-sm" onClick={async () => { if (!confirm('Flag as broken?')) return; await api(`/resources/${r.id}/report-broken`, { method: 'POST', body: JSON.stringify({}) }); load(); }}>⚠️ Broken</button>
                {tab === 'queue' && user && CURATOR_ROLES.includes(user.role) && (
                  <>
                    <button className="btn-green btn-sm" onClick={async () => { await api(`/resources/${r.id}/verify`, { method: 'PUT', body: JSON.stringify({ approve: true }) }); setOk('Verified ✅'); load(); }}>✓ Verify</button>
                    <button className="btn-danger btn-sm" onClick={async () => { if (!confirm('Reject + delete?')) return; await api(`/resources/${r.id}`, { method: 'DELETE' }); load(); }}>Reject</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {tab !== 'notifications' && !items.length && <div className="card" style={{ marginTop: 12 }}><p>No resources in this view yet.</p></div>}
    </div>
    </Guard>
  );
}

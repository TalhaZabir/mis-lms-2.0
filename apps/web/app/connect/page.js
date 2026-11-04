'use client';
import { useEffect, useState } from 'react';
import { api, fmtDate, initials } from '../../lib/api';
import { Guard } from '../../components/Guard';
import { CONNECT_ROLES, MOD_ROLES } from '../../lib/roles';
import { useAuth } from '../../components/AuthProvider';

const ALL_TABS = ['feed', 'directory', 'messages', 'mentorship', 'moderate'];

export default function Connect() {
  const { user } = useAuth();
  const TABS = ALL_TABS.filter(t => t !== 'moderate' || (user && MOD_ROLES.includes(user.role)));
  const [tab, setTab] = useState('feed');
  const [feed, setFeed] = useState([]);
  const [dir, setDir] = useState([]);
  const [convs, setConvs] = useState([]);
  const [cid, setCid] = useState('');
  const [thread, setThread] = useState([]);
  const [reqs, setReqs] = useState([]);
  const [reports, setReports] = useState([]);
  const [msg, setMsg] = useState('');
  const [post, setPost] = useState({ body: '', visibility: 'PROGRAM', type: 'TEXT' });
  const [chat, setChat] = useState('');
  const [cmt, setCmt] = useState({}); // postId -> text

  async function load() {
    try {
      setMsg('');
      if (tab === 'feed') { const f = await api('/feed'); setFeed(f); }
      if (tab === 'directory') setDir(await api('/directory/alumni'));
      if (tab === 'messages') { const c = await api('/me/conversations'); setConvs(c); if (c[0] && !cid) setCid(c[0].id); }
      if (tab === 'mentorship') setReqs(await api('/mentorship/requests'));
      if (tab === 'moderate') setReports(await api('/moderate/reports'));
    } catch (e) { setMsg(e.message + ' — login as student/alumni; moderate needs MODERATOR/ADMIN'); }
  }
  async function loadThread(id) {
    if (!id) return;
    try { setThread(await api(`/conversations/${id}/messages`)); } catch (e) { setMsg(e.message); }
  }
  useEffect(() => { load(); }, [tab]);
  useEffect(() => { if (tab === 'messages' && cid) { const t = setInterval(() => loadThread(cid), 4000); loadThread(cid); return () => clearInterval(t); } }, [cid, tab]);

  async function publish() {
    try {
      if (!post.body.trim()) return;
      await api('/posts', { method: 'POST', body: JSON.stringify(post) });
      setPost({ body: '', visibility: 'PROGRAM', type: 'TEXT' }); load();
    } catch (e) { setMsg(e.message); }
  }
  async function sendChat() {
    try {
      if (!chat.trim() || !cid) return;
      await api(`/conversations/${cid}/messages`, { method: 'POST', body: JSON.stringify({ body: chat }) });
      setChat(''); loadThread(cid);
    } catch (e) { setMsg(e.message); }
  }

  return (
    <Guard roles={CONNECT_ROLES}>
    <div>
      <h1 style={{ margin: '4px 0' }}>MIS Connect</h1>
      <p style={{ color: '#64748b' }}>Feed · Alumni · Mentorship · Chat — BATCH posts hidden from alumni · moderation by students + admin (no faculty).</p>
      <div className="tabs">{TABS.map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}<button onClick={load}>↻</button></div>
      {msg && <div className="alert-err">{msg}</div>}

      {tab === 'feed' && (
        <div>
          <div className="card">
            <b>Share with MIS community</b>
            <textarea placeholder="Ask a question, share an achievement, post a job/internship…" value={post.body} onChange={e => setPost({ ...post, body: e.target.value })} style={{ width: '100%', minHeight: 70, marginTop: 8 }} />
            <div className="form-row">
              <select value={post.visibility} onChange={e => setPost({ ...post, visibility: e.target.value })}><option value="BATCH">Batch only (students)</option><option value="PROGRAM">Program wide</option><option value="ALUMNI_CIRCLE">Alumni circle</option><option value="MIS_PUBLIC">MIS public</option></select>
              <select value={post.type} onChange={e => setPost({ ...post, type: e.target.value })}><option>TEXT</option><option>HELP</option><option>JOB</option><option>EVENT</option></select>
              <button className="btn" onClick={publish}>Post</button>
            </div>
          </div>
          {feed.map(p => (
            <div className="post" key={p.id}>
              <div className="post-head">
                <div className="avatar">{initials(p.author?.name)}</div>
                <div><b>{p.author?.name}</b> <span className="badge blue">{p.author?.role}</span><br /><span style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(p.createdAt)} · {p.visibility} · {p.type}</span></div>
              </div>
              <div style={{ fontSize: 15 }}>{p.body}</div>
              <div className="post-actions">
                <button onClick={async () => { await api(`/posts/${p.id}/like`, { method: 'POST', body: JSON.stringify({}) }); load(); }}>👍 {(p._count?.likes || 0) + ''}</button>
                <button onClick={() => document.getElementById('c-' + p.id)?.focus()}>💬 {(p._count?.comments || 0) + ''}</button>
                <button onClick={async () => { await api(`/posts/${p.id}/save`, { method: 'POST', body: JSON.stringify({}) }); }}>🔖 Save</button>
                <button onClick={async () => { const r = prompt('Report reason (spam/abuse/harassment)?', 'spam'); if (r) { await api(`/posts/${p.id}/report`, { method: 'POST', body: JSON.stringify({ reason: r }) }); alert('Reported to mods'); } }}>🚩 Report</button>
              </div>
              <div className="form-row" style={{ marginTop: 8 }}>
                <input id={'c-' + p.id} placeholder="Write a comment…" value={cmt[p.id] || ''} onChange={e => setCmt({ ...cmt, [p.id]: e.target.value })} />
                <button className="btn-ghost btn-sm" onClick={async () => { if (!cmt[p.id]) return; await api(`/posts/${p.id}/comments`, { method: 'POST', body: JSON.stringify({ body: cmt[p.id] }) }); setCmt({ ...cmt, [p.id]: '' }); load(); }}>Reply</button>
              </div>
            </div>
          ))}
          {!feed.length && <div className="card"><p>No posts yet — be the first to share.</p></div>}
        </div>
      )}

      {tab === 'directory' && (
        <div className="grid">
          {dir.map(a => (
            <div className="card" key={a.userId}>
              <div className="post-head"><div className="avatar">{initials(a.user?.name)}</div><div><b>{a.user?.name}</b><br /><span style={{ fontSize: 12, color: '#64748b' }}>{a.gradBatch} · {a.program}</span></div></div>
              <p>💼 {a.designation || '—'} @ {a.org || '—'}</p>
              <p style={{ fontSize: 13 }}>{a.mentorshipOptIn ? '🌱 Open to mentorship' : '🔕 Not taking mentees'}</p>
              <button className="btn btn-sm" disabled={!a.mentorshipOptIn} onClick={async () => { const m = prompt('Your message to ' + a.user?.name + '?', 'Need guidance on BI career'); if (!m) return; try { await api('/mentorship/requests', { method: 'POST', body: JSON.stringify({ mentorId: a.userId, message: m }) }); alert('Mentorship requested ✅'); } catch (e) { alert(e.message); } }}>{a.mentorshipOptIn ? 'Request mentorship' : 'Unavailable'}</button>
            </div>
          ))}
          {!dir.length && <div className="card"><p>No verified alumni yet.</p></div>}
        </div>
      )}

      {tab === 'messages' && (
        <div className="chat-layout">
          <div className="conv-list">
            <b style={{ fontSize: 13 }}>Conversations ({convs.length})</b>
            {convs.map(c => <div key={c.id} className={'conv-item' + (cid === c.id ? ' on' : '')} onClick={() => setCid(c.id)}><b>{c.title || c.type}</b><br /><span style={{ fontSize: 12, color: '#64748b' }}>{c.type} · {(c.members || []).length} members</span></div>)}
          </div>
          <div className="thread">
            <b>Thread</b>
            <div className="msgs">{thread.map(m => <div key={m.id} className="bubble">{m.body}<div style={{ fontSize: 11, opacity: .7 }}>{fmtDate(m.createdAt)}</div></div>)}{!thread.length && <p style={{ color: '#94a3b8' }}>Select a conversation.</p>}</div>
            <div className="form-row"><input placeholder="Type a message…" value={chat} onChange={e => setChat(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} /><button className="btn" onClick={sendChat}>Send</button></div>
          </div>
        </div>
      )}

      {tab === 'mentorship' && (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="tbl"><thead><tr><th>When</th><th>Message</th><th>Status</th></tr></thead>
            <tbody>{reqs.map(r => <tr key={r.id}><td>{fmtDate(r.createdAt)}</td><td>{r.message} ({r.menteeId.slice(-6)} → {r.mentorId.slice(-6)})</td><td><span className="badge">{r.status}</span></td></tr>)}</tbody></table>
          {!reqs.length && <p style={{ padding: 16 }}>No mentorship requests.</p>}
        </div>
      )}

      {tab === 'moderate' && (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="tbl"><thead><tr><th>Reported post</th><th>Reason</th><th>Action</th></tr></thead>
            <tbody>{reports.map(r => <tr key={r.id}><td style={{ maxWidth: 320 }}>{r.post?.body}</td><td>{r.reason}</td>
              <td><button className="btn-danger btn-sm" onClick={async () => { await api('/moderate/action', { method: 'POST', body: JSON.stringify({ postId: r.postId, reportId: r.id, action: 'HIDE', note: 'Hidden by mod' }) }); load(); }}>Hide</button>{' '}
                <button className="btn-ghost btn-sm" onClick={async () => { await api('/moderate/action', { method: 'POST', body: JSON.stringify({ postId: r.postId, reportId: r.id, action: 'DISMISS' }) }); load(); }}>Dismiss</button></td></tr>)}</tbody></table>
          {!reports.length && <p style={{ padding: 16 }}>Queue clear — no open reports. (Mods: MODERATOR / ADMIN only.)</p>}
        </div>
      )}
    </div>
    </Guard>
  );
}

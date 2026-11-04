'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Guard } from '../../components/Guard';
import { ADMIN_ROLES } from '../../lib/roles';

const TABS = ['programs', 'batches', 'terms', 'courses', 'offerings', 'users'];
const FIELDS = {
  programs: [['code', 'Code e.g. BBA-MIS'], ['name', 'Name'], ['description', 'Description']],
  batches: [['programId', 'Program ID'], ['name', 'Name e.g. BBA 29th'], ['session', 'Session e.g. 2023-24']],
  terms: [['name', 'Name'], ['code', 'Code e.g. FALL-2026'], ['startsAt', 'Starts (YYYY-MM-DD)'], ['endsAt', 'Ends'], ['status', 'DRAFT/ACTIVE/CLOSED']],
  courses: [['code', 'Code e.g. MIS-352'], ['title', 'Title'], ['credits', 'Credits'], ['programId', 'Program ID'], ['description', 'Description']],
  offerings: [['courseId', 'Course ID'], ['termId', 'Term ID'], ['section', 'Section'], ['room', 'Room'], ['routineSlot', 'Routine e.g. Sun 10:00']],
  users: [],
};

export default function Admin() {
  const [tab, setTab] = useState('programs');
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState('');
  const [lookups, setLookups] = useState({ programs: [], terms: [], courses: [] });

  async function load() {
    try {
      setMsg('');
      setRows(await api(`/${tab}`));
      if (!lookups.programs.length) {
        const [p, t, c] = await Promise.all([api('/programs').catch(() => []), api('/terms').catch(() => []), api('/courses').catch(() => [])]);
        setLookups({ programs: p, terms: t, courses: c });
      }
    } catch (e) { setMsg(e.message + ' — login as chairman@mis.du.ac.bd'); }
  }
  useEffect(() => { setForm({}); load(); }, [tab]);

  async function create(e) {
    e.preventDefault();
    try {
      const body = { ...form };
      if (body.credits) body.credits = parseFloat(body.credits);
      ['startsAt', 'endsAt'].forEach(k => { if (body[k]) body[k] = new Date(body[k]).toISOString(); });
      await api(`/${tab}`, { method: 'POST', body: JSON.stringify(body) });
      setForm({}); load();
    } catch (e) { setMsg(e.message); }
  }
  async function del(id) { if (!confirm('Delete?')) return; await api(`/${tab}/${id}`, { method: 'DELETE' }); load(); }

  function cell(r) {
    if (tab === 'programs') return (<><td><b>{r.code}</b></td><td>{r.name}</td><td style={{ color: '#64748b' }}>{r.description}</td></>);
    if (tab === 'batches') return (<><td><b>{r.name}</b></td><td>{r.session}</td><td style={{ color: '#64748b' }}>{r.programId?.slice(-6)}</td></>);
    if (tab === 'terms') return (<><td><b>{r.code}</b></td><td>{r.name}</td><td><span className={`badge ${r.status === 'ACTIVE' ? 'green' : ''}`}>{r.status}</span></td></>);
    if (tab === 'courses') return (<><td><b>{r.code}</b></td><td>{r.title}</td><td>{r.credits}</td></>);
    if (tab === 'offerings') return (<><td><b>{r.course?.code || r.courseId?.slice(-6)}</b></td><td>Sec-{r.section}</td><td>{r.term?.code}</td><td>{r.room || '—'} · {r.routineSlot || ''}</td><td>{r.isLocked ? <span className="badge red">Locked</span> : <span className="badge green">Open</span>}</td></>);
    if (tab === 'users') return (<><td><b>{r.name}</b></td><td>{r.email}</td><td><span className="badge blue">{r.role}</span></td></>);
    return null;
  }

  async function setRole(id, role) { await api(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ role }) }); load(); }
  async function setActive(id, isActive) { await api(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ isActive }) }); load(); }

  return (
    <Guard roles={ADMIN_ROLES}>
    <div>
      <h1 style={{ margin: '4px 0' }}>Academic Structure</h1>
      <p style={{ color: '#64748b' }}>Manage programs, batches, terms, courses and semester offerings for MIS.</p>
      <div className="tabs">{TABS.map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}<button onClick={load}>↻ Refresh</button></div>
      {msg && <div className="alert-err">{msg}</div>}
      {FIELDS[tab].length > 0 && (
        <form className="form-card" onSubmit={create}>
          <b>Create {tab}</b>
          {(tab === 'batches' || tab === 'courses') && lookups.programs.length > 0 && (
            <p style={{ fontSize: 13 }}>Programs: {lookups.programs.map(p => <span key={p.id} className="kbd" style={{ marginRight: 6 }}>{p.code}={p.id.slice(-6)}</span>)}</p>
          )}
          {tab === 'offerings' && <p style={{ fontSize: 13 }}>Courses: {lookups.courses.map(c => <span key={c.id} className="kbd" style={{ marginRight: 6 }}>{c.code}={c.id.slice(-6)}</span>)} · Terms: {lookups.terms.map(t => <span key={t.id} className="kbd" style={{ marginRight: 6 }}>{t.code}={t.id.slice(-6)}</span>)}</p>}
          <div className="form-row">
            {FIELDS[tab].map(([k, ph]) => <input key={k} placeholder={ph} value={form[k] || ''} onChange={e => setForm({ ...form, [k]: e.target.value })} />)}
          </div>
          <div style={{ marginTop: 10 }}><button className="btn">+ Create {tab.slice(0, -1)}</button></div>
        </form>
      )}
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="tbl">
          <thead><tr><th colSpan={8} style={{ fontSize: 14 }}>{rows.length} {tab} {tab === 'offerings' && <span style={{ fontWeight: 400 }}>(use full IDs from hints above)</span>}</th></tr></thead>
          <tbody>
            {rows.map(r => <tr key={r.id}>{cell(r)}<td style={{ whiteSpace: 'nowrap' }}>
              {tab === 'users' ? (
                <>
                  <select value={r.role} onChange={e => setRole(r.id, e.target.value)} style={{ fontSize: 13 }}>
                    {['SUPER_ADMIN', 'ADMIN_STAFF', 'FACULTY', 'TA', 'STUDENT', 'ALUMNI', 'MODERATOR'].map(x => <option key={x} value={x}>{x}</option>)}
                  </select>{' '}
                  <button className="btn-ghost btn-sm" onClick={() => setActive(r.id, !r.isActive)}>{r.isActive ? 'Deactivate' : 'Activate'}</button>
                </>
              ) : <button className="btn-ghost btn-sm" onClick={() => del(r.id)}>Delete</button>}
            </td></tr>)}
          </tbody>
        </table>
        {!rows.length && <p style={{ padding: 16, color: '#64748b' }}>No rows yet.</p>}
      </div>
    </div>
    </Guard>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { api, fmtDate } from '../../lib/api';
import { Guard } from '../../components/Guard';
import { TEACH_ROLES } from '../../lib/roles';

const TABS = ['content', 'assignments', 'quizzes', 'attendance', 'gradebook', 'live'];

export default function Teach() {
  const [offerings, setOfferings] = useState([]);
  const [oid, setOid] = useState('');
  const [tab, setTab] = useState('content');
  const [data, setData] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [gradebook, setGradebook] = useState(null);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState('');
  // forms
  const [modTitle, setModTitle] = useState('');
  const [les, setLes] = useState({ moduleId: '', title: '', kind: 'VIDEO', url: '' });
  const [asg, setAsg] = useState({ title: '', brief: '', dueAt: '', maxMarks: 10 });
  const [quiz, setQuiz] = useState({ title: '', durationMin: 20 });
  const [bank, setBank] = useState({ title: '', q: '' });
  const [gradeItem, setGradeItem] = useState({ name: '', weight: '' });
  const [live, setLive] = useState({ title: '', joinUrl: '', startsAt: '' });
  const [marks, setMarks] = useState({}); // subId -> marks
  const [att, setAtt] = useState({}); // userId -> status
  const [grades, setGrades] = useState({}); // `${itemId}:${userId}` -> marks

  async function init() {
    try { const r = await api('/teach/offerings'); setOfferings(r); if (r[0] && !oid) setOid(r[0].id); }
    catch (e) { setMsg(e.message + ' — login as faculty@mis.du.ac.bd'); }
  }
  async function load() {
    if (!oid) return;
    try {
      setMsg(''); setOk('');
      const [mods, asgs, quizzes, sess, gb, liv, enr] = await Promise.all([
        api(`/offerings/${oid}/modules`).catch(() => []),
        api(`/offerings/${oid}/assignments`).catch(() => []),
        api(`/offerings/${oid}/quizzes`).catch(() => []),
        api(`/offerings/${oid}/attendance`).catch(() => []),
        api(`/offerings/${oid}/gradebook`).catch(() => null),
        api(`/offerings/${oid}/live`).catch(() => []),
        api(`/enrollments?offeringId=${oid}`).catch(() => []),
      ]);
      if (tab === 'content') setData(mods);
      if (tab === 'assignments') setData(asgs);
      if (tab === 'quizzes') setData(quizzes);
      if (tab === 'attendance') setData(sess);
      if (tab === 'gradebook') setGradebook(gb);
      if (tab === 'live') setData(liv);
      setEnrollments(enr);
    } catch (e) { setMsg(e.message); }
  }
  useEffect(() => { init(); }, []);
  useEffect(() => { load(); }, [oid, tab]);

  async function act(fn, okMsg) {
    try { await fn(); setOk(okMsg || 'Saved ✅'); load(); } catch (e) { setMsg(e.message); }
  }

  const off = offerings.find(o => o.id === oid);

  return (
    <Guard roles={TEACH_ROLES}>
    <div>
      <h1 style={{ margin: '4px 0' }}>Teach – Faculty Studio</h1>
      <p style={{ color: '#64748b' }}>{off ? `${off.course?.code} ${off.course?.title} · Sec-${off.section} · ${off.term?.code}` : 'Select an offering to manage content, assessment and classes.'}</p>
      <div className="toolbar">
        <select value={oid} onChange={e => setOid(e.target.value)} style={{ minWidth: 260 }}>
          <option value="">— Select offering —</option>
          {offerings.map(o => <option key={o.id} value={o.id}>{o.course?.code} Sec-{o.section} ({o.term?.code})</option>)}
        </select>
        <button className="btn-ghost btn-sm" onClick={() => { init(); load(); }}>↻ Refresh</button>
      </div>
      <div className="tabs">{TABS.map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      {msg && <div className="alert-err">{msg}</div>}
      {ok && <div className="alert-ok">{ok}</div>}
      {!oid && <div className="card"><p>No offering selected.</p></div>}

      {oid && tab === 'content' && (
        <div className="two">
          <div>
            <div className="form-card">
              <b>+ New module</b>
              <div className="form-row"><input placeholder="Module title e.g. Week 1 – Intro" value={modTitle} onChange={e => setModTitle(e.target.value)} /><button className="btn" onClick={() => act(() => api('/modules', { method: 'POST', body: JSON.stringify({ offeringId: oid, title: modTitle, order: data.length + 1 }) }), 'Module added')} disabled={!modTitle}>Add</button></div>
            </div>
            <div className="form-card">
              <b>+ New lesson</b>
              <div className="form-row">
                <select value={les.moduleId} onChange={e => setLes({ ...les, moduleId: e.target.value })}><option value="">Module…</option>{data.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
                <select value={les.kind} onChange={e => setLes({ ...les, kind: e.target.value })}><option>VIDEO</option><option>PDF</option><option>SLIDE</option><option>LINK</option></select>
              </div>
              <div className="form-row"><input placeholder="Lesson title" value={les.title} onChange={e => setLes({ ...les, title: e.target.value })} /><input placeholder="URL (youtube/pdf/slides)" value={les.url} onChange={e => setLes({ ...les, url: e.target.value })} /></div>
              <div style={{ marginTop: 8 }}><button className="btn" disabled={!les.moduleId || !les.title} onClick={() => act(() => api('/lessons', { method: 'POST', body: JSON.stringify({ ...les, order: 1 }) }), 'Lesson added')}>Add lesson</button></div>
            </div>
          </div>
          <div>
            {data.map(m => (
              <div className="card" key={m.id} style={{ marginBottom: 10 }}>
                <b>📦 {m.title}</b> <button className="btn-ghost btn-sm" style={{ float: 'right' }} onClick={() => act(() => api(`/modules/${m.id}`, { method: 'DELETE' }), 'Deleted')}>Delete</button>
                {(m.lessons || []).map(l => (
                  <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderTop: '1px solid #eef2f7', fontSize: 14 }}>
                    <span className="badge">{l.kind}</span><span style={{ flex: 1 }}><b>{l.title}</b>{l.url && <> · <a href={l.url} target="_blank">Open ↗</a></>}</span>
                    <button className="btn-ghost btn-sm" onClick={() => act(() => api(`/lessons/${l.id}`, { method: 'DELETE' }), 'Deleted')}>✕</button>
                  </div>
                ))}
                {!(m.lessons || []).length && <p style={{ color: '#94a3b8', fontSize: 13 }}>No lessons yet.</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {oid && tab === 'assignments' && (
        <div>
          <div className="form-card">
            <b>+ New assignment</b>
            <div className="form-row">
              <input placeholder="Title e.g. HW1 – ER diagram" value={asg.title} onChange={e => setAsg({ ...asg, title: e.target.value })} />
              <input type="datetime-local" value={asg.dueAt} onChange={e => setAsg({ ...asg, dueAt: e.target.value })} />
              <input placeholder="Max marks" type="text" value={asg.maxMarks} onChange={e => setAsg({ ...asg, maxMarks: e.target.value })} style={{ maxWidth: 120 }} />
            </div>
            <div className="form-row"><input placeholder="Brief / instructions" value={asg.brief} onChange={e => setAsg({ ...asg, brief: e.target.value })} /></div>
            <div style={{ marginTop: 8 }}><button className="btn" disabled={!asg.title || !asg.dueAt} onClick={() => act(() => api('/assignments', { method: 'POST', body: JSON.stringify({ offeringId: oid, title: asg.title, brief: asg.brief, dueAt: new Date(asg.dueAt).toISOString(), maxMarks: parseFloat(asg.maxMarks) || 10 }) }), 'Assignment published')}>Publish</button></div>
          </div>
          {data.map(a => (
            <div className="card" key={a.id} style={{ marginBottom: 10 }}>
              <b>{a.title}</b> <span className="badge blue">Due {fmtDate(a.dueAt)}</span> <span className="badge">Max {a.maxMarks}</span>
              <p>{a.brief}</p>
              <b style={{ fontSize: 13 }}>Submissions ({(a.submissions || []).length})</b>
              <table className="tbl" style={{ marginTop: 6 }}>
                <thead><tr><th>Student</th><th>Answer</th><th>Marks</th><th></th></tr></thead>
                <tbody>{(a.submissions || []).map(s => (
                  <tr key={s.id}><td>{s.userId.slice(-6)}</td><td style={{ maxWidth: 280 }}>{s.body || s.fileUrl || '—'}</td>
                    <td><input style={{ width: 70 }} placeholder={String(s.marks ?? '')} value={marks[s.id] ?? ''} onChange={e => setMarks({ ...marks, [s.id]: e.target.value })} /></td>
                    <td><button className="btn-green btn-sm" onClick={() => act(() => api(`/submissions/${s.id}/grade`, { method: 'PUT', body: JSON.stringify({ marks: parseFloat(marks[s.id]), feedback: 'Graded' }) }), 'Graded')}>Save</button></td></tr>
                ))}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {oid && tab === 'quizzes' && (
        <div>
          <div className="two">
            <div className="form-card"><b>+ New quiz</b>
              <div className="form-row"><input placeholder="Title e.g. CT-1" value={quiz.title} onChange={e => setQuiz({ ...quiz, title: e.target.value })} /><input placeholder="Mins" value={quiz.durationMin} onChange={e => setQuiz({ ...quiz, durationMin: e.target.value })} style={{ maxWidth: 100 }} /></div>
              <div style={{ marginTop: 8 }}><button className="btn" disabled={!quiz.title} onClick={() => act(() => api('/quizzes', { method: 'POST', body: JSON.stringify({ offeringId: oid, title: quiz.title, durationMin: parseInt(quiz.durationMin) || 20 }) }), 'Quiz created')}>Create</button></div>
            </div>
            <div className="form-card"><b>+ Question bank</b>
              <div className="form-row"><input placeholder="Bank title e.g. MIS-352 bank" value={bank.title} onChange={e => setBank({ ...bank, title: e.target.value })} /></div>
              <div className="form-row"><input placeholder='Question JSON: {"kind":"MCQ","stem":"...","options":"[\"a\",\"b\"]","answer":"a"}' value={bank.q} onChange={e => setBank({ ...bank, q: e.target.value })} /></div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button className="btn-ghost" onClick={async () => { try { const b = await api('/banks', { method: 'POST', body: JSON.stringify({ title: bank.title }) }); setOk('Bank ' + b.id.slice(-6) + ' — paste its ID to add questions via API'); } catch (e) { setMsg(e.message); } }}>1️⃣ Create bank</button>
              </div>
            </div>
          </div>
          {data.map(q => <div className="card" key={q.id} style={{ marginBottom: 8 }}><b>📝 {q.title}</b> <span className="badge">{q.durationMin} min</span> <span className="badge green">{(q.attempts || []).length} attempts</span><button className="btn-ghost btn-sm" style={{ float: 'right' }} onClick={() => act(() => api(`/quizzes/${q.id}`, { method: 'DELETE' }), 'Deleted')}>Delete</button></div>)}
        </div>
      )}

      {oid && tab === 'attendance' && (
        <div>
          <div className="form-card"><b>Take attendance</b><p style={{ fontSize: 13 }}>Creates a session with QR token, then mark PRESENT/ABSENT/LATE per student.</p>
            <button className="btn" onClick={() => act(() => api(`/offerings/${oid}/attendance/sessions`, { method: 'POST', body: JSON.stringify({}) }), 'Session opened')}>+ Open session (QR)</button>
          </div>
          {data.map(s => (
            <div className="card" key={s.id} style={{ marginBottom: 8 }}>
              <b>{fmtDate(s.date)}</b> <span className="badge gold">QR {s.qrToken}</span> <span className="badge green">{(s.records || []).filter(r => r.status !== 'ABSENT').length}/{enrollments.length} present</span>
              <div className="form-row" style={{ marginTop: 8 }}>
                {enrollments.map(e => (
                  <label key={e.userId} style={{ fontSize: 13, border: '1px solid #e4e9f2', borderRadius: 8, padding: '6px 8px' }}>{e.user?.name || e.userId.slice(-6)}
                    <select value={att[e.userId] || 'PRESENT'} onChange={ev => setAtt({ ...att, [e.userId]: ev.target.value })} style={{ marginLeft: 6 }}><option>PRESENT</option><option>LATE</option><option>ABSENT</option></select>
                  </label>
                ))}
              </div>
              <button className="btn-green btn-sm" style={{ marginTop: 8 }} onClick={() => act(() => api(`/attendance/sessions/${s.id}/mark`, { method: 'POST', body: JSON.stringify({ records: enrollments.map(e => ({ userId: e.userId, status: att[e.userId] || 'PRESENT' })) }) }), 'Attendance saved')}>Save attendance</button>
            </div>
          ))}
        </div>
      )}

      {oid && tab === 'gradebook' && gradebook && (
        <div>
          <div className="form-card"><b>+ Grade item</b>
            <div className="form-row"><input placeholder="Name e.g. CT / Mid / Final" value={gradeItem.name} onChange={e => setGradeItem({ ...gradeItem, name: e.target.value })} /><input placeholder="Weight e.g. 20" value={gradeItem.weight} onChange={e => setGradeItem({ ...gradeItem, weight: e.target.value })} /><button className="btn" disabled={!gradeItem.name} onClick={() => act(() => api('/grade-items', { method: 'POST', body: JSON.stringify({ offeringId: oid, name: gradeItem.name, weight: parseFloat(gradeItem.weight) || 0 }) }), 'Item added')}>Add</button></div>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Student</th>{gradebook.items.map(i => <th key={i.id}>{i.name} ({i.weight})</th>)}<th>Total</th></tr></thead>
              <tbody>{gradebook.enrollments.map(e => {
                const total = gradebook.items.reduce((s, i) => { const g = i.grades.find(g => g.userId === e.userId); return s + (g?.marks || 0); }, 0);
                return (<tr key={e.userId}><td><b>{e.user?.name}</b><br /><span style={{ fontSize: 12, color: '#64748b' }}>{e.user?.email}</span></td>
                  {gradebook.items.map(i => { const g = i.grades.find(g => g.userId === e.userId); const k = `${i.id}:${e.userId}`;
                    return (<td key={i.id}><input style={{ width: 64 }} placeholder={String(g?.marks ?? '–')} value={grades[k] ?? ''} onChange={ev => setGrades({ ...grades, [k]: ev.target.value })} />
                      <button className="btn-ghost btn-sm" style={{ marginLeft: 4 }} onClick={() => act(() => api('/grades/bulk', { method: 'POST', body: JSON.stringify({ itemId: i.id, grades: [{ userId: e.userId, marks: parseFloat(grades[k]) }] }) }), 'Saved')}>✓</button></td>); })}
                  <td><b>{total}</b></td></tr>);
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      {oid && tab === 'live' && (
        <div>
          <div className="form-card"><b>+ Schedule live class</b>
            <div className="form-row"><input placeholder="Title e.g. DBMS Week-5" value={live.title} onChange={e => setLive({ ...live, title: e.target.value })} /><input placeholder="Zoom/Meet link" value={live.joinUrl} onChange={e => setLive({ ...live, joinUrl: e.target.value })} /><input type="datetime-local" value={live.startsAt} onChange={e => setLive({ ...live, startsAt: e.target.value })} /></div>
            <div style={{ marginTop: 8 }}><button className="btn" disabled={!live.title || !live.joinUrl} onClick={() => act(() => api('/live', { method: 'POST', body: JSON.stringify({ offeringId: oid, title: live.title, joinUrl: live.joinUrl, startsAt: live.startsAt ? new Date(live.startsAt).toISOString() : new Date().toISOString() }) }), 'Live scheduled (+announcement)')}>Schedule</button></div>
          </div>
          {data.map(l => <div className="card" key={l.id} style={{ marginBottom: 8 }}><b>🔴 {l.title}</b> <span className="badge blue">{fmtDate(l.startsAt)}</span><p><a href={l.joinUrl} target="_blank">Join class ↗</a> {l.recordingUrl && <>· <a href={l.recordingUrl} target="_blank">Recording</a></>}</p><button className="btn-ghost btn-sm" onClick={() => act(() => api(`/live/${l.id}`, { method: 'DELETE' }), 'Deleted')}>Delete</button></div>)}
        </div>
      )}
    </div>
    </Guard>
  );
}

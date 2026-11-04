'use client';
import { useEffect, useState } from 'react';
import { api, fmtDate } from '../../lib/api';
import { Guard } from '../../components/Guard';
import { LEARN_ROLES } from '../../lib/roles';

const TABS = ['courses', 'learn', 'assignments', 'quizzes', 'attendance', 'routine', 'results'];

export default function Learn() {
  const [courses, setCourses] = useState([]);
  const [oid, setOid] = useState('');
  const [tab, setTab] = useState('courses');
  const [learn, setLearn] = useState(null);
  const [list, setList] = useState([]);
  const [att, setAtt] = useState(null);
  const [routine, setRoutine] = useState(null);
  const [results, setResults] = useState([]);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState('');
  const [sub, setSub] = useState({ assignmentId: '', body: '' });
  const [attempt, setAttempt] = useState({ quizId: '', answers: '' });

  async function init() {
    try { const r = await api('/me/courses'); setCourses(r); if (r[0] && !oid) setOid(r[0].offeringId); setList(r); }
    catch (e) { setMsg(e.message + ' — login as student@mis.du.ac.bd'); }
  }
  async function load() {
    try {
      setMsg(''); setOk('');
      if (tab === 'courses') setList(await api('/me/courses'));
      if (tab === 'learn' && oid) setLearn(await api(`/offerings/${oid}/learn`));
      if (tab === 'assignments') setList(await api('/me/submissions'));
      if (tab === 'quizzes') setList(await api('/me/attempts'));
      if (tab === 'attendance' && oid) setAtt(await api(`/offerings/${oid}/attendance/me`));
      if (tab === 'routine') setRoutine(await api('/me/routine'));
      if (tab === 'results') setResults(await api('/me/results'));
    } catch (e) { setMsg(e.message); }
  }
  useEffect(() => { init(); }, []);
  useEffect(() => { load(); }, [oid, tab]);

  const off = courses.find(c => c.offeringId === oid);

  return (
    <Guard roles={LEARN_ROLES}>
    <div>
      <h1 style={{ margin: '4px 0' }}>My Learning</h1>
      <p style={{ color: '#64748b' }}>{off ? `${off.offering?.course?.code} · ${off.offering?.course?.title}` : 'Your enrolled courses, dues, attendance and results.'}</p>
      <div className="toolbar">
        <select value={oid} onChange={e => setOid(e.target.value)} style={{ minWidth: 220 }}>
          <option value="">— Select course —</option>
          {courses.map(c => <option key={c.offeringId} value={c.offeringId}>{c.offering?.course?.code} Sec-{c.offering?.section}</option>)}
        </select>
      </div>
      <div className="tabs">{TABS.map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}<button onClick={() => { init(); load(); }}>↻</button></div>
      {msg && <div className="alert-err">{msg}</div>}
      {ok && <div className="alert-ok">{ok}</div>}

      {tab === 'courses' && (
        <div className="grid">
          {list.map(c => (
            <div className="card" key={c.offeringId}>
              <span className="badge blue">{c.offering?.term?.code}</span> <span className="badge green">{c.status}</span>
              <h3 style={{ marginTop: 8 }}>{c.offering?.course?.code} — {c.offering?.course?.title}</h3>
              <p>Sec-{c.offering?.section} · {c.offering?.room} · {c.offering?.routineSlot}</p>
              <p>Faculty: {(c.offering?.faculty || []).map(f => f.user?.name).join(', ') || '—'}</p>
              <button className="btn btn-sm" onClick={() => { setOid(c.offeringId); setTab('learn'); }}>Open course →</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'learn' && learn && (
        <div className="two">
          <div>
            <h3>📦 Modules</h3>
            {learn.modules.map(m => (
              <div className="card" key={m.id} style={{ marginBottom: 10 }}>
                <b>{m.title}</b>
                {(m.lessons || []).map(l => <div key={l.id} style={{ padding: '8px 0', borderTop: '1px solid #eef2f7', fontSize: 14 }}><span className="badge">{l.kind}</span> <b>{l.title}</b> {l.url && <><a href={l.url} target="_blank">Open ↗</a></>} {l.body && <p style={{ color: '#64748b' }}>{l.body}</p>}</div>)}
              </div>
            ))}
            <h3>🔴 Live classes</h3>
            {(learn.live || []).map(l => <div className="card" key={l.id} style={{ marginBottom: 8 }}><b>{l.title}</b> <span className="badge blue">{fmtDate(l.startsAt)}</span><p><a href={l.joinUrl} target="_blank">Join ↗</a></p></div>)}
          </div>
          <div>
            <h3>📝 Due assignments</h3>
            {(learn.assignments || []).map(a => <div className="card" key={a.id} style={{ marginBottom: 8 }}><b>{a.title}</b> <span className="badge gold">Due {fmtDate(a.dueAt)}</span><p>{a.brief}</p><p style={{ fontSize: 13 }}>{a.submissions?.length ? `✅ Submitted${a.submissions[0]?.marks != null ? ` · ${a.submissions[0].marks}/${a.maxMarks}` : ''}` : '⏳ Not submitted'}</p></div>)}
            <h3>📋 Quizzes</h3>
            {(learn.quizzes || []).map(q => <div className="card" key={q.id} style={{ marginBottom: 8 }}><b>{q.title}</b> <span className="badge">{q.durationMin} min</span><p style={{ fontSize: 13 }}>{(q.attempts || []).length ? `Attempted (${q.attempts.length})` : 'Not attempted'}</p></div>)}
          </div>
        </div>
      )}

      {tab === 'assignments' && (
        <div>
          <div className="form-card"><b>Submit assignment</b>
            <div className="form-row">
              <input placeholder="Assignment ID (open Learn tab to copy)" value={sub.assignmentId} onChange={e => setSub({ ...sub, assignmentId: e.target.value })} />
              <input placeholder="Your answer / file link" value={sub.body} onChange={e => setSub({ ...sub, body: e.target.value })} />
              <button className="btn" disabled={!sub.assignmentId} onClick={async () => { try { await api('/submissions', { method: 'POST', body: JSON.stringify({ assignmentId: sub.assignmentId, body: sub.body }) }); setOk('Submitted ✅'); setSub({ assignmentId: '', body: '' }); load(); } catch (e) { setMsg(e.message); } }}>Submit</button>
            </div>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}><table className="tbl"><thead><tr><th>Assignment</th><th>Course</th><th>Answer</th><th>Marks</th><th>When</th></tr></thead>
            <tbody>{list.map(s => <tr key={s.id}><td><b>{s.assignment?.title}</b></td><td>{s.assignment?.offering?.course?.code}</td><td style={{ maxWidth: 260 }}>{s.body || s.fileUrl}</td><td>{s.marks ?? '—'}</td><td>{fmtDate(s.createdAt)}</td></tr>)}</tbody></table></div>
        </div>
      )}

      {tab === 'quizzes' && (
        <div>
          <div className="form-card"><b>Attempt quiz</b>
            <div className="form-row">
              <input placeholder="Quiz ID" value={attempt.quizId} onChange={e => setAttempt({ ...attempt, quizId: e.target.value })} />
              <input placeholder='Answers JSON e.g. {"q1":"a"}' value={attempt.answers} onChange={e => setAttempt({ ...attempt, answers: e.target.value })} />
              <button className="btn" disabled={!attempt.quizId} onClick={async () => { try { let ans = {}; try { ans = JSON.parse(attempt.answers || '{}'); } catch { throw new Error('Invalid answers JSON'); } await api(`/quizzes/${attempt.quizId}/attempt`, { method: 'POST', body: JSON.stringify({ answers: ans }) }); setOk('Attempt recorded ✅'); load(); } catch (e) { setMsg(e.message); } }}>Start / Submit</button>
            </div>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}><table className="tbl"><thead><tr><th>Quiz</th><th>Course</th><th>Score</th><th>When</th></tr></thead>
            <tbody>{list.map(a => <tr key={a.id}><td><b>{a.quiz?.title}</b></td><td>{a.quiz?.offering?.course?.code}</td><td>{a.score ?? '—'}</td><td>{fmtDate(a.createdAt)}</td></tr>)}</tbody></table></div>
        </div>
      )}

      {tab === 'attendance' && att && (
        <div className="card">
          <h3>Attendance — {att.pct}% <span className={`badge ${att.pct >= 60 ? 'green' : 'red'}`}>{att.pct >= 60 ? 'Eligible' : 'Shortage'}</span></h3>
          <div className="progress"><div style={{ width: `${att.pct}%` }} /></div>
          <p style={{ fontSize: 14 }}>{att.present}/{att.total} sessions present · 60% required for exams</p>
          <table className="tbl"><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>{att.sessions.map(s => <tr key={s.id}><td>{fmtDate(s.date)}</td><td>{s.records[0] ? <span className="badge green">{s.records[0].status}</span> : <span className="badge">Not marked</span>}</td></tr>)}</tbody></table>
        </div>
      )}

      {tab === 'routine' && routine && (
        <div className="two">
          <div className="card"><h3>🗓 Weekly routine</h3>{routine.offerings.map(o => <p key={o.id} style={{ fontSize: 14 }}><b>{o.course?.code}</b> Sec-{o.section} · {o.room} · {o.routineSlot}</p>)}</div>
          <div>
            <div className="card"><h3>🔴 Upcoming live</h3>{(routine.live || []).map(l => <p key={l.id} style={{ fontSize: 14 }}><b>{l.title}</b> · {fmtDate(l.startsAt)} · <a href={l.joinUrl} target="_blank">Join</a></p>)}{!routine.live?.length && <p>No upcoming live.</p>}</div>
            <div className="card" style={{ marginTop: 10 }}><h3>⏰ Due soon</h3>{(routine.assignments || []).map(a => <p key={a.id} style={{ fontSize: 14 }}><b>{a.title}</b> · {fmtDate(a.dueAt)}</p>)}</div>
          </div>
        </div>
      )}

      {tab === 'results' && (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="tbl"><thead><tr><th>Course</th><th>Term</th><th>Score</th><th>Grade</th><th>Detail</th></tr></thead>
            <tbody>{results.map((r, i) => <tr key={i}><td><b>{r.course}</b></td><td>{r.term}</td><td>{r.obtained}/{r.totalWeight} ({r.pct}%)</td><td><span className={`badge ${r.grade === 'F' ? 'red' : r.grade === 'IN-PROGRESS' ? '' : 'green'}`}>{r.grade}</span></td><td style={{ fontSize: 12 }}>{(r.details || []).map(d => `${d.item}:${d.marks ?? '–'}/${d.weight}`).join(' · ')}</td></tr>)}</tbody></table>
          {!results.length && <p style={{ padding: 16 }}>No graded items yet — grades appear after faculty publishes.</p>}
        </div>
      )}
    </div>
    </Guard>
  );
}

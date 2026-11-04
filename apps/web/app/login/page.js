'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API, saveAuth } from '../../lib/api';
import { ROLE_HOME } from '../../lib/roles';

const DEMOS = [
  ['Chairman', 'chairman@mis.du.ac.bd'],
  ['Faculty', 'faculty@mis.du.ac.bd'],
  ['Student', 'student@mis.du.ac.bd'],
  ['Alumni', 'alumni@mis.du.ac.bd'],
];

function LoginForm() {
  const [email, setEmail] = useState('student@mis.du.ac.bd');
  const [password, setPassword] = useState('mis123');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const search = useSearchParams();
  async function go(e) {
    e.preventDefault(); setMsg(''); setBusy(true);
    try {
      const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Login failed');
      saveAuth(j.token, j.user);
      const next = search.get('next');
      window.location.href = next && next.startsWith('/') ? next : (ROLE_HOME[j.user.role] || '/');
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="login-wrap">
      <div className="card">
        <span className="badge blue">MIS · DU</span>
        <h2 style={{ margin: '8px 0' }}>Welcome back</h2>
        <p style={{ color: '#64748b', fontSize: 14 }}>Sign in with your MIS account. You will land in your own workspace.</p>
        <form onSubmit={go}>
          <label style={{ fontSize: 13 }}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', margin: '6px 0 12px' }} autoComplete="email" />
          <label style={{ fontSize: 13 }}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', margin: '6px 0 12px' }} autoComplete="current-password" />
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in…' : 'Login'}</button>
        </form>
        {msg && <div className="alert-err">{msg}</div>}
        <div style={{ marginTop: 14 }}>
          <b style={{ fontSize: 13 }}>One-click demo:</b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {DEMOS.map(([label, em]) => <button key={em} type="button" className="btn-ghost btn-sm" onClick={() => setEmail(em)}>{label}</button>)}
          </div>
          <p style={{ fontSize: 12, color: '#64748b' }}>Password for all demos: <span className="kbd">mis123</span> · Student sees Learn/Connect/Resources only · Alumni sees Connect/Resources only.</p>
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense fallback={<div className="card"><p>Loading login…</p></div>}>
      <LoginForm />
    </Suspense>
  );
}

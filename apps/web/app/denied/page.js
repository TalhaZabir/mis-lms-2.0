export const metadata = { title: 'Access denied' };
export default function Denied() {
  return (
    <div className="login-wrap">
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="badge red">403 · No access</span>
        <h2>Not available for your role</h2>
        <p style={{ color: '#64748b' }}>Your account does not have access to that section. This keeps students, faculty, alumni and admins in their own workspaces.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 12 }}>
          <a className="btn" href="/">Go home</a>
          <a className="btn-ghost" href="/login">Switch account</a>
        </div>
      </div>
    </div>
  );
}

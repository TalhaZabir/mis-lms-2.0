export default function NotFound() {
  return (
    <div className="login-wrap">
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="badge blue">404</span>
        <h2>Page not found</h2>
        <p style={{ color: '#64748b' }}>The page you requested does not exist.</p>
        <a className="btn" href="/">Go home</a>
      </div>
    </div>
  );
}

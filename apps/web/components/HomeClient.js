'use client';
import { useAuth } from '../components/AuthProvider';
import { can, ADMIN_ROLES, TEACH_ROLES, LEARN_ROLES, CONNECT_ROLES, RESOURCE_ROLES } from '../lib/roles';

const ALL_CARDS = [
  { t: 'Admin & Structure', d: 'Programs, batches, terms, courses, offerings, enrollments, users.', h: '/admin', roles: ADMIN_ROLES },
  { t: 'Faculty Studio', d: 'Course builder, assignments, quizzes, attendance QR, gradebook, live classes.', h: '/teach', roles: TEACH_ROLES },
  { t: 'My Learning', d: 'Enrolled courses, lessons, submissions, quizzes, routine, results.', h: '/learn', roles: LEARN_ROLES },
  { t: 'MIS Connect', d: 'Feed, alumni directory, mentorship, 1:1 + group chat. Student-led moderation.', h: '/connect', roles: CONNECT_ROLES },
  { t: 'Resource Corner', d: 'Faculty-verified links, upvotes, bookmarks, notifications.', h: '/resources', roles: RESOURCE_ROLES },
];

export default function HomeClient() {
  const { user } = useAuth();
  const cards = ALL_CARDS.filter(c => can(c.roles, user) || (!user && c.h !== '/admin' && c.h !== '/teach'));
  return (
    <div>
      <div className="hero">
        <div>
          <span className="badge gold">University of Dhaka · Dept. of MIS</span>
          <h1>Management Information Systems – Learning Platform</h1>
          <p>BBA / MBA / EMBA / Diploma · Semester offerings · Zoom / Meet live classes · Low-bandwidth friendly</p>
          <div className="hero-stats">
            <div className="stat"><b>4</b>Programs</div>
            <div className="stat"><b>4+</b>Core courses</div>
            <div className="stat"><b>5/5</b>Modules live</div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {user ? <a className="btn-gold" href={cards[0]?.h || '/'}>Continue →</a> : <><a className="btn-gold" href="/login">Get started</a><a className="btn-gold" style={{ background: 'rgba(255,255,255,.2)', color: '#fff' }} href="/login">Student login</a></>}
          </div>
          {user && <p style={{ marginTop: 10, fontSize: 13 }}>Signed in as <b>{user.name}</b> · {user.role} — you only see sections you can access.</p>}
        </div>
        <div className="hero-card">
          {!user ? (
            <>
              <b>Demo access</b> <span className="badge green">pw: mis123</span>
              <table className="tbl" style={{ marginTop: 10 }}>
                <tbody>
                  <tr><td>Chairman</td><td><span className="kbd">chairman@mis.du.ac.bd</span></td></tr>
                  <tr><td>Faculty</td><td><span className="kbd">faculty@mis.du.ac.bd</span></td></tr>
                  <tr><td>Student</td><td><span className="kbd">student@mis.du.ac.bd</span></td></tr>
                  <tr><td>Alumni</td><td><span className="kbd">alumni@mis.du.ac.bd</span></td></tr>
                </tbody>
              </table>
              <p style={{ fontSize: 13 }}>Login once — navigation and cards adapt to your role.</p>
            </>
          ) : (
            <>
              <b>Your workspace</b>
              <p style={{ fontSize: 14 }}>Role: <span className="badge blue">{user.role}</span></p>
              <p style={{ fontSize: 13 }}>Sections below are filtered to what you can access. Restricted areas redirect to /denied and are enforced by the API too.</p>
            </>
          )}
        </div>
      </div>
      <div className="grid">
        {cards.map(c => (
          <div className="card" key={c.t}>
            <span className="badge green">Live ✅</span>
            <h3 style={{ marginTop: 8 }}>{c.t}</h3><p>{c.d}</p>
            <a className="go" href={c.h}>Open →</a>
          </div>
        ))}
      </div>
      {!user && <p style={{ color: '#64748b', fontSize: 13, marginTop: 12 }}>Guests see a limited preview. Admin and Teach are hidden until you login with an authorized role.</p>}
    </div>
  );
}

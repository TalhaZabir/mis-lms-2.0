import './globals.css';
import { AuthProvider } from '../components/AuthProvider';
import { Nav } from '../components/Nav';

export const metadata = {
  title: { default: 'MIS LMS – Dept. of MIS, University of Dhaka', template: '%s · MIS LMS – DU' },
  description: 'Official LMS for Dept. of Management Information Systems, University of Dhaka — BBA / MBA / EMBA / Diploma. Courses, live classes, MIS Connect, resources.',
  manifest: '/manifest.json',
  icons: { icon: '/favicon.svg', apple: '/favicon.svg' },
  openGraph: { title: 'MIS LMS – DU', description: 'Learn, teach, connect — MIS, University of Dhaka.', type: 'website' },
};

export const viewport = { themeColor: '#0a2a5e', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <Nav />
          <div className="wrap">{children}</div>
          <div className="footer">
            Dept. of Management Information Systems, University of Dhaka · BBA / MBA / EMBA / Diploma<br />
            <span style={{ fontSize: 12 }}>Academic use only · Contact Chairman Office for access · v1.0 deploy-ready</span>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}

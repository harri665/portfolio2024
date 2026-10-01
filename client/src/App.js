import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import './App.css';

// The home pages load with the app: each site opens on one, and splitting
// them off would put another request in front of the first paint. Every
// other page is fetched when it's visited, so a home page doesn't download
// the markdown renderer, KaTeX, the video player or the admin panels.
import ArtHomePage from './Components/Homepage/ArtHomePage';
import RootHomePage from './Components/Homepage/RootHomePage';
import CSHomePage from './Components/Homepage/CSHomePage';
import BlogIndex from './Components/Blog/BlogIndex';
import { apiUrl } from './utils/api';
import { detectSiteMode, SITE_MODES } from './utils/siteMode';

const ProjectDetails = lazy(() => import('./Components/ProjectDetails/ProjectDetails'));
const CSProjectDetails = lazy(() => import('./Components/ProjectDetails/CSProjectDetails'));
const AdminApp = lazy(() => import('./Components/Admin/AdminApp'));
const ContactPage = lazy(() => import('./Components/Contact/ContactPage'));
const ColophonPage = lazy(() => import('./Components/Colophon/ColophonPage'));
const GlassPage = lazy(() => import('./Components/Glass/GlassPage'));
const BlogPost = lazy(() => import('./Components/Blog/BlogPost'));

// Shown while a page's code loads: the page colour, a screen tall, so the
// footer doesn't flash up and nothing shifts when the page arrives
function PageFallback() {
  return <div className="min-h-screen bg-bg" />;
}

// The admin panels used to live at /cs-admin, /art-admin, /blog-admin, and so
// on. They're all sections of /admin now; these keep old links working.
const LEGACY_ADMIN_REDIRECTS = [
  ['/cs-admin', '/admin/cs'],
  ['/art-admin', '/admin/art'],
  ['/blog-admin', '/admin/blog'],
  ['/blog-admin/new', '/admin/blog/new'],
  ['/pages-admin', '/admin/pages'],
  ['/comments-admin', '/admin/comments'],
];

function LegacyBlogEditRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/admin/blog/edit/${slug}`} replace />;
}

// A helper component that uses useLocation()
function MainRoutes({ siteMode }) {
  const location = useLocation();

  useEffect(() => {
    // Whenever the path changes, call /api/load
    const host = typeof window !== 'undefined' ? window.location.hostname : 'unknown-host';
    const page = `${host}${location.pathname}`; // e.g. 'cs.harrison-martin.com/'
    fetch(apiUrl(`/load?page=${encodeURIComponent(page)}`))
      .then(async (res) => {
        const contentType = res.headers.get('content-type') || '';
        const bodyText = await res.text();

        if (!res.ok) {
          throw new Error(`Load request failed (${res.status}): ${bodyText.slice(0, 120)}`);
        }

        if (!contentType.includes('application/json')) {
          throw new Error(
            `Load request returned non-JSON (${contentType || 'unknown'}): ${bodyText.slice(0, 120)}`
          );
        }

        return JSON.parse(bodyText);
      })
      // .then((data) => console.log("Load endpoint data:", data))
      .catch((error) => console.error("Error calling /api/load:", error));
  }, [location]);

  const homePageByMode = {
    [SITE_MODES.ROOT]: <RootHomePage />,
    [SITE_MODES.CS]: <CSHomePage />,
    [SITE_MODES.ART]: <ArtHomePage />,
    [SITE_MODES.BLOG]: <BlogIndex />,
  };

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route
          path="/"
          element={homePageByMode[siteMode] || <RootHomePage />}
        />

        {/* Every admin section lives under this one route */}
        <Route path="/admin/*" element={<AdminApp />} />
        {LEGACY_ADMIN_REDIRECTS.map(([from, to]) => (
          <Route key={from} path={from} element={<Navigate to={to} replace />} />
        ))}
        <Route path="/blog-admin/edit/:slug" element={<LegacyBlogEditRedirect />} />

        {siteMode === SITE_MODES.ART && <Route path="/:identifier" element={<ProjectDetails />} />}
        {siteMode === SITE_MODES.CS && <Route path="/:repoName" element={<CSProjectDetails />} />}
        {siteMode === SITE_MODES.BLOG && <Route path="/:slug" element={<BlogPost />} />}
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/colophon" element={<ColophonPage />} />
        <Route path="/glass" element={<GlassPage />} />
        {/* Add more routes here if needed */}
      </Routes>
    </Suspense>
  );
}

export default function App() {
  const siteMode = detectSiteMode();

  return (
    <Router>
      <MainRoutes siteMode={siteMode} />
    </Router>
  );
}

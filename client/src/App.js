import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import './App.css';
import 'highlight.js/styles/atom-one-dark.css';

import ArtHomePage from './Components/Homepage/ArtHomePage';
import RootHomePage from './Components/Homepage/RootHomePage';
import CSHomePage from './Components/Homepage/CSHomePage';
import ProjectDetails from './Components/ProjectDetails/ProjectDetails';
import CSProjectDetails from './Components/ProjectDetails/CSProjectDetails';
import AdminApp from './Components/Admin/AdminApp';
import ContactPage from './Components/Contact/ContactPage';
import BlogIndex from './Components/Blog/BlogIndex';
import BlogPost from './Components/Blog/BlogPost';
import { apiUrl } from './utils/api';
import { detectSiteMode, SITE_MODES } from './utils/siteMode';

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
      {/* Add more routes here if needed */}
    </Routes>
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

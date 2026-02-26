import React, { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom';

import ArtHomePage from './Components/Homepage/ArtHomePage';
import RootHomePage from './Components/Homepage/RootHomePage';
import CSHomePage from './Components/Homepage/CSHomePage';
import ProjectDetails from './Components/ProjectDetails/ProjectDetails';
import LogsViewer from './Components/Admin/Admin';
import ContactPage from './Components/Contact/ContactPage';
import { apiUrl } from './utils/api';
import { detectSiteMode, SITE_MODES } from './utils/siteMode';

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
  };

  return (
    <Routes>
      <Route
        path="/"
        element={homePageByMode[siteMode] || <RootHomePage />}
      />
      <Route path="/projects/:hashId" element={<ProjectDetails />} />
      {/* The /admin route is just a placeholder; you can rename it as needed */}
      <Route path="/admin" element={<AdminLogs />} />
      <Route path="/contact" element={<ContactPage />} />
      {/* Add more routes here if needed */}
    </Routes>
  );
}

// This component fetches logs from the server and passes them to LogsViewer
function AdminLogs() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    // Fetch logs from your server's /api/logs
    fetch(apiUrl('/logs'))
      .then((response) => response.json())
      .then((data) => {
        console.log('Fetched logs:', data);
        setLogs(data);
      })
      .catch((error) => console.error('Error fetching logs:', error));
  }, []);

  // Pass the logs array into LogsViewer
  return <LogsViewer initialLogs={logs} />;
}

export default function App() {
  const siteMode = detectSiteMode();

  return (
    <Router>
      <MainRoutes siteMode={siteMode} />
    </Router>
  );
}

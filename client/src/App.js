import React, { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom';

import Homepage from './Components/Homepage/Homepage';
import RootLandingPage from './Components/Homepage/RootLandingPage';
import CSProjectsPage from './Components/Homepage/CSProjectsPage';
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
      .then((res) => res.json())
      // .then((data) => console.log("Load endpoint data:", data))
      .catch((error) => console.error("Error calling /api/load:", error));
  }, [location]);

  const homepageComponentByMode = {
    [SITE_MODES.ROOT]: <RootLandingPage />,
    [SITE_MODES.CS]: <CSProjectsPage />,
    [SITE_MODES.ART]: <Homepage />,
  };

  return (
    <Routes>
      <Route
        path="/"
        element={homepageComponentByMode[siteMode] || <RootLandingPage />}
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

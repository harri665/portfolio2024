import React, { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom';

import Homepage from './Components/Homepage/Homepage';
import ProjectDetails from './Components/ProjectDetails/ProjectDetails';
import LogsViewer from './Components/Admin/Admin';

// A helper component that uses useLocation()
function MainRoutes() {
  const location = useLocation();

  useEffect(() => {
    // Whenever the path changes, call /api/load
    const page = location.pathname; // e.g. '/', '/projects/abc123'
    fetch(`https://artstation.harrison-martin.com/api/load?page=${encodeURIComponent(page)}`)
      .then((res) => res.json())
      // .then((data) => console.log("Load endpoint data:", data))
      .catch((error) => console.error("Error calling /api/load:", error));
  }, [location]);

  return (
    <Routes>
      <Route path="/" element={<Homepage />} />
      <Route path="/projects/:hashId" element={<ProjectDetails />} />
      {/* The /admin route is just a placeholder; you can rename it as needed */}
      <Route path="/admin" element={<AdminLogs />} />
      {/* Add more routes here if needed */}
    </Routes>
  );
}

// This component fetches logs from the server and passes them to LogsViewer
function AdminLogs() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    // Fetch logs from your server's /api/logs
    fetch('https://artstation.harrison-martin.com/api/logs')
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
  return (
    <Router>
      <MainRoutes />
    </Router>
  );
}

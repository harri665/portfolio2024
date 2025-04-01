import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
// If you need them:
// import { motion } from 'framer-motion';

import Homepage from './Components/Homepage/Homepage';
import ProjectDetails from './Components/ProjectDetails/ProjectDetails';

// A helper component that can use useLocation()
function MainRoutes() {
  const location = useLocation();

  useEffect(() => {
    // Whenever the path changes, call /api/load
    const page = location.pathname; // e.g. '/', '/projects/abc123'
    fetch(`http://localhost:3005/api/load?page=${encodeURIComponent(page)}`)
      .then((res) => res.json())
      .then((data) => console.log("Load endpoint data:", data))
      .catch((error) => console.error("Error calling /api/load:", error));
  }, [location]);

  return (
    <Routes>
      <Route path="/" element={<Homepage />} />
      <Route path="/projects/:hashId" element={<ProjectDetails />} />
      {/* Add other routes as needed */}
    </Routes>
  );
}

export default function App() {
  return (
    <Router>
      <MainRoutes />
    </Router>
  );
}

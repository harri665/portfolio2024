import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { HashRouter  as Router, Route, Routes, Link } from 'react-router-dom';
import ProjectDetails from './Components/ProjectDetails/ProjectDetails';
import Homepage from './Components/Homepage/Homepage';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Homepage />} />
        <Route path="/projects/:hashId" element={<ProjectDetails/>} />
      </Routes>
    </Router>
  );
}


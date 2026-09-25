import React, { useCallback, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  FaChartBar,
  FaComments,
  FaFileCode,
  FaGithub,
  FaImages,
  FaPenNib,
} from 'react-icons/fa';

import { createAdminFetch, useAdminAuth } from './adminAuth';
import BlogPanel from './panels/BlogPanel';
import BlogEditorPanel from './panels/BlogEditorPanel';
import ArtPanel from './panels/ArtPanel';
import CSPanel from './panels/CSPanel';
import PagesPanel from './panels/PagesPanel';
import CommentsPanel from './panels/CommentsPanel';
import LogsPanel from './panels/LogsPanel';

const SECTIONS = [
  { to: '/admin/blog', label: 'Blog Posts', icon: FaPenNib },
  { to: '/admin/comments', label: 'Comments', icon: FaComments },
  { to: '/admin/art', label: 'Art Slugs', icon: FaImages },
  { to: '/admin/cs', label: 'CS Projects', icon: FaGithub },
  { to: '/admin/pages', label: 'Static Pages', icon: FaFileCode },
  { to: '/admin/logs', label: 'Visitor Logs', icon: FaChartBar },
];

function LoginGate({ onLogin }) {
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const ok = await onLogin(keyInput);
      if (!ok) setError('Invalid key.');
    } catch {
      setError('Could not connect to server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl"
      >
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">
          Harrison Martin
        </p>
        <h1 className="mb-6 text-xl font-bold tracking-tight text-white">Site Admin</h1>
        <label
          className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-white/40"
          htmlFor="admin-key"
        >
          Admin Key
        </label>
        <input
          id="admin-key"
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-[#0a84ff]/50"
          placeholder="Enter admin key"
          autoFocus
        />
        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-[#0a84ff] px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(10,132,255,0.3)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}

export default function AdminApp() {
  const { adminKey, authed, login, logout } = useAdminAuth();

  const adminFetch = useMemo(
    () => createAdminFetch(adminKey, logout),
    [adminKey, logout]
  );

  const panelProps = useMemo(
    () => ({ adminKey, adminFetch }),
    [adminKey, adminFetch]
  );

  const handleLogin = useCallback((key) => login(key), [login]);

  if (authed === null) {
    return (
      <div className="min-h-screen bg-[#08090c] text-white">
        <div className="flex min-h-screen items-center justify-center text-sm text-white/35">
          Loading…
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="relative min-h-screen bg-[#08090c] text-white">
        <AdminGlow />
        <div className="relative z-10">
          <LoginGate onLogin={handleLogin} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#08090c] text-white">
      <AdminGlow />

      <div className="relative z-10 mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-8 lg:flex-row">
        {/* Sidebar */}
        <aside className="lg:w-56 lg:shrink-0">
          <div className="mb-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">
              Harrison Martin
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-white">Site Admin</h1>
          </div>

          <nav className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {SECTIONS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  [
                    'flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-[#0a84ff]/12 text-white'
                      : 'text-white/50 hover:bg-white/5 hover:text-white/80',
                  ].join(' ')
                }
              >
                <Icon className="text-xs opacity-70" />
                {label}
              </NavLink>
            ))}
          </nav>

          <button
            onClick={logout}
            className="mt-6 text-xs text-white/30 transition-colors hover:text-white/60"
          >
            Log out
          </button>
        </aside>

        {/* Panel */}
        <main className="min-w-0 flex-1">
          <Routes>
            <Route index element={<Navigate to="/admin/blog" replace />} />
            <Route path="blog" element={<BlogPanel {...panelProps} />} />
            <Route path="blog/new" element={<BlogEditorPanel {...panelProps} />} />
            <Route path="blog/edit/:slug" element={<BlogEditorPanel {...panelProps} />} />
            <Route path="comments" element={<CommentsPanel {...panelProps} />} />
            <Route path="art" element={<ArtPanel {...panelProps} />} />
            <Route path="cs" element={<CSPanel {...panelProps} />} />
            <Route path="pages" element={<PagesPanel {...panelProps} />} />
            <Route path="logs" element={<LogsPanel {...panelProps} />} />
            <Route path="*" element={<Navigate to="/admin/blog" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function AdminGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-[-6rem] top-[8rem] h-80 w-80 rounded-full bg-sky-500/8 blur-3xl" />
      <div className="absolute right-[4%] top-[12rem] h-96 w-96 rounded-full bg-indigo-500/6 blur-3xl" />
      <div className="absolute inset-0 opacity-[0.05] [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.8)_1px,transparent_0)] [background-size:22px_22px]" />
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { FaSave } from 'react-icons/fa';

import SubdomainNav from '../Homepage/SubdomainNav';
import { SITE_MODES } from '../../utils/siteMode';
import { apiUrl } from '../../utils/api';

const STORAGE_KEY = 'art_admin_key';
const ARTSTATION_USERNAME = 'harr1';

function titleToSlug(title) {
  return (title || '').replace(/\s+/g, '-').replace(/[^A-Za-z0-9-]/g, '');
}

function isValidSlug(s) {
  return /^[A-Za-z0-9-]+$/.test(s);
}

export default function ArtAdmin() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(STORAGE_KEY) || '');
  const [authed, setAuthed] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [authError, setAuthError] = useState('');

  const [projects, setProjects] = useState([]);
  const [slugMap, setSlugMap] = useState({}); // hash_id → custom slug string
  const [errors, setErrors] = useState({}); // hash_id → error message
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'ok' | 'error'

  const loadData = useCallback(async (key) => {
    setLoading(true);
    setLoadError('');
    try {
      const [projectsRes, slugsRes] = await Promise.all([
        fetch(apiUrl(`/artstation/${ARTSTATION_USERNAME}`)),
        fetch(apiUrl('/admin/art/slugs'), { headers: { 'x-admin-key': key } }),
      ]);

      if (slugsRes.status === 401) {
        sessionStorage.removeItem(STORAGE_KEY);
        setAdminKey('');
        setAuthed(false);
        return;
      }

      if (projectsRes.ok) {
        const data = await projectsRes.json();
        setProjects(data?.data || []);
      }

      if (slugsRes.ok) {
        setSlugMap(await slugsRes.json());
      }

      setAuthed(true);
    } catch (e) {
      setLoadError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adminKey) loadData(adminKey);
  }, [adminKey, loadData]);

  async function handleAuth(e) {
    e.preventDefault();
    setAuthError('');
    try {
      const r = await fetch(apiUrl('/admin/auth'), {
        method: 'POST',
        headers: { 'x-admin-key': keyInput },
      });
      if (r.ok) {
        sessionStorage.setItem(STORAGE_KEY, keyInput);
        setAdminKey(keyInput);
      } else {
        setAuthError('Invalid key.');
      }
    } catch {
      setAuthError('Could not connect to server.');
    }
  }

  function handleSlugChange(hashId, value) {
    setSlugMap((prev) => ({ ...prev, [hashId]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[hashId];
      return next;
    });
  }

  async function handleSave() {
    const newErrors = {};
    const allCustomSlugs = [];

    for (const project of projects) {
      const raw = (slugMap[project.hash_id] || '').trim();
      if (raw === '') continue;
      if (!isValidSlug(raw)) {
        newErrors[project.hash_id] = 'Only letters, numbers, and hyphens allowed';
        continue;
      }
      if (allCustomSlugs.includes(raw)) {
        newErrors[project.hash_id] = 'Duplicate slug';
        continue;
      }
      allCustomSlugs.push(raw);
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const payload = {};
    for (const project of projects) {
      const raw = (slugMap[project.hash_id] || '').trim();
      if (raw) payload[project.hash_id] = raw;
    }

    setSaving(true);
    setSaveStatus(null);
    try {
      const r = await fetch(apiUrl('/admin/art/slugs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ slugs: payload }),
      });
      setSaveStatus(r.ok ? 'ok' : 'error');
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(null), 3000);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem(STORAGE_KEY);
    setAdminKey('');
    setAuthed(false);
    setProjects([]);
    setSlugMap({});
  }

  if (!authed) {
    return (
      <div className="relative min-h-screen bg-[#08090c] text-white">
        <AdminGlow />
        <SubdomainNav currentMode={SITE_MODES.ART} />
        <div className="flex min-h-screen items-center justify-center px-4">
          <form
            onSubmit={handleAuth}
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl"
          >
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Admin</p>
            <h1 className="mb-6 text-xl font-bold tracking-tight text-white">Art Admin</h1>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-white/40">
              Admin Key
            </label>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-[#0a84ff]/50"
              placeholder="Enter admin key"
              autoFocus
            />
            {authError && <p className="mb-3 text-xs text-red-400">{authError}</p>}
            <button
              type="submit"
              className="w-full rounded-full bg-[#0a84ff] px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(10,132,255,0.3)] transition-opacity hover:opacity-90"
            >
              Unlock
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#08090c] text-white">
      <AdminGlow />
      <SubdomainNav currentMode={SITE_MODES.ART} />

      <div className="relative z-10 mx-auto max-w-4xl px-4 pb-24 pt-24 sm:px-8">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8 flex items-start justify-between"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/35">Admin</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">Art Project Slugs</h1>
            <p className="mt-2 text-sm text-white/45">
              Set a custom URL slug for each project. Leave blank to use the auto-generated title slug.
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="mt-1 shrink-0 text-xs text-white/30 transition-colors hover:text-white/60"
          >
            Log out
          </button>
        </motion.div>

        {/* Save bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur-xl"
        >
          <p className="text-xs text-white/40">
            Slugs must be unique and contain only letters, numbers, and hyphens.
          </p>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#0a84ff] px-5 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(10,132,255,0.3)] disabled:opacity-50"
          >
            <FaSave className="text-xs" />
            {saving ? 'Saving…' : 'Save'}
            {saveStatus === 'ok' && <span className="text-green-300">✓</span>}
            {saveStatus === 'error' && <span className="text-red-300">✗</span>}
          </button>
        </motion.div>

        {/* Project list */}
        {loading && (
          <p className="py-20 text-center text-sm text-white/35">Loading projects…</p>
        )}
        {loadError && (
          <div className="rounded-2xl border border-red-800/40 bg-red-900/10 p-4 text-xs text-red-400">
            {loadError}
          </div>
        )}
        {!loading && !loadError && projects.length === 0 && (
          <p className="py-20 text-center text-sm text-white/35">No projects found.</p>
        )}

        {!loading && !loadError && projects.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl"
          >
            {projects.map((project, i) => {
              const autoSlug = titleToSlug(project.title);
              const customSlug = slugMap[project.hash_id] ?? '';
              const err = errors[project.hash_id];

              return (
                <div
                  key={project.hash_id}
                  className={`flex items-center gap-4 px-5 py-4 ${i < projects.length - 1 ? 'border-b border-white/5' : ''}`}
                >
                  {/* Thumbnail */}
                  {project.cover?.thumb_url && (
                    <img
                      src={project.cover.thumb_url}
                      alt={project.title}
                      className="h-12 w-20 shrink-0 rounded-lg object-cover"
                    />
                  )}

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white/90">{project.title}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-white/30">
                      id: {project.hash_id}
                    </p>
                    {!customSlug && (
                      <p className="mt-0.5 font-mono text-[10px] text-white/25">
                        auto: /{autoSlug}
                      </p>
                    )}
                  </div>

                  {/* Slug input */}
                  <div className="flex w-64 shrink-0 flex-col gap-1">
                    <div className="flex items-center gap-1.5 overflow-hidden rounded-xl border border-white/10 bg-white/5 pr-3 focus-within:border-[#0a84ff]/50">
                      <span className="pl-3 font-mono text-xs text-white/30">/</span>
                      <input
                        type="text"
                        value={customSlug}
                        onChange={(e) => handleSlugChange(project.hash_id, e.target.value)}
                        placeholder={autoSlug}
                        className="flex-1 bg-transparent py-2 font-mono text-xs text-white placeholder-white/20 outline-none"
                      />
                    </div>
                    {err && <p className="pl-1 text-[10px] text-red-400">{err}</p>}
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </div>
    </div>
  );
}

function AdminGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-[-6rem] top-[8rem] h-80 w-80 rounded-full bg-violet-500/8 blur-3xl" />
      <div className="absolute right-[4%] top-[12rem] h-96 w-96 rounded-full bg-pink-500/6 blur-3xl" />
      <div className="absolute inset-0 opacity-[0.05] [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.8)_1px,transparent_0)] [background-size:22px_22px]" />
    </div>
  );
}

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { FaChevronUp, FaChevronDown, FaTimes, FaPlus, FaGithub, FaSave } from 'react-icons/fa';

import SubdomainNav from '../Homepage/SubdomainNav';
import { SITE_MODES } from '../../utils/siteMode';
import { apiUrl } from '../../utils/api';

const GITHUB_USERNAME = 'harri665';
const GH_HEADERS = { Accept: 'application/vnd.github+json' };

export default function CSAdmin() {
  const [allRepos, setAllRepos] = useState([]);
  const [selected, setSelected] = useState([]); // ordered list of repo full_names
  const [customInput, setCustomInput] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'ok' | 'error'
  const [search, setSearch] = useState('');

  // Load all repos + current config in parallel
  useEffect(() => {
    async function load() {
      try {
        const [reposRes, configRes] = await Promise.all([
          fetch(`https://api.github.com/users/${GITHUB_USERNAME}/repos?per_page=100&sort=updated`, { headers: GH_HEADERS }),
          fetch(apiUrl('/cs-config')),
        ]);

        if (reposRes.ok) {
          const repos = await reposRes.json();
          setAllRepos(repos.filter((r) => !r.fork && !r.private));
        }

        if (configRes.ok) {
          const config = await configRes.json();
          setEnabled(config.enabled ?? true);
          setSelected(Array.isArray(config.repoNames) ? config.repoNames : []);
        }
      } finally {
        setLoadingRepos(false);
      }
    }
    load();
  }, []);

  const toggle = useCallback((fullName) => {
    setSelected((prev) =>
      prev.includes(fullName) ? prev.filter((n) => n !== fullName) : [...prev, fullName]
    );
  }, []);

  const moveUp = (index) => {
    if (index === 0) return;
    setSelected((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const moveDown = (index) => {
    setSelected((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  };

  const remove = (index) => setSelected((prev) => prev.filter((_, i) => i !== index));

  const addCustom = () => {
    const trimmed = customInput.trim();
    if (!trimmed || selected.includes(trimmed)) return;
    setSelected((prev) => [...prev, trimmed]);
    setCustomInput('');
  };

  const save = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const res = await fetch(apiUrl('/cs-config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, preserveListedOrder: true, repoNames: selected }),
      });
      setSaveStatus(res.ok ? 'ok' : 'error');
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  const filteredRepos = allRepos.filter((r) =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) || (r.description || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative min-h-screen bg-[#08090c] text-white">
      <AdminGlow />
      <SubdomainNav currentMode={SITE_MODES.CS} />

      <div className="relative z-10 mx-auto max-w-6xl px-4 pb-24 pt-24 sm:px-8">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/35">Admin</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">CS Project Config</h1>
          <p className="mt-2 text-sm text-white/45">Choose which GitHub repos appear on the CS homepage and set their order.</p>
        </motion.div>

        {/* Enable toggle + save */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur-xl"
        >
          <label className="flex cursor-pointer items-center gap-3">
            <div
              onClick={() => setEnabled((v) => !v)}
              className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${enabled ? 'bg-[#0a84ff]' : 'bg-white/15'}`}
            >
              <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm font-medium text-white/80">Whitelist enabled</span>
          </label>

          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-[#0a84ff] px-5 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(10,132,255,0.3)] disabled:opacity-50"
          >
            <FaSave className="text-xs" />
            {saving ? 'Saving…' : 'Save'}
            {saveStatus === 'ok' && <span className="text-green-300">✓</span>}
            {saveStatus === 'error' && <span className="text-red-300">✗</span>}
          </button>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

          {/* Left: all repos */}
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/5 backdrop-blur-xl"
          >
            <div className="border-b border-white/8 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">All Repos</p>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-[#0a84ff]/50"
              />
            </div>

            <div className="flex-1 overflow-y-auto" style={{ maxHeight: '520px' }}>
              {loadingRepos ? (
                <p className="p-6 text-center text-sm text-white/35">Loading repos…</p>
              ) : filteredRepos.length === 0 ? (
                <p className="p-6 text-center text-sm text-white/35">No repos found.</p>
              ) : (
                filteredRepos.map((repo) => {
                  const isActive = selected.includes(repo.name) || selected.includes(repo.full_name);
                  return (
                    <div
                      key={repo.id}
                      onClick={() => toggle(repo.name)}
                      className={`flex cursor-pointer items-start gap-3 border-b border-white/5 px-5 py-3.5 transition-colors hover:bg-white/5 ${isActive ? 'bg-[#0a84ff]/8' : ''}`}
                    >
                      <div className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded border transition-colors ${isActive ? 'border-[#0a84ff] bg-[#0a84ff]' : 'border-white/20 bg-transparent'}`}>
                        {isActive && (
                          <svg viewBox="0 0 12 12" className="h-full w-full p-0.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="1,6 4,9 11,2" />
                          </svg>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white/90">{repo.name}</span>
                          {repo.language && (
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50">{repo.language}</span>
                          )}
                        </div>
                        {repo.description && (
                          <p className="mt-0.5 truncate text-xs text-white/40">{repo.description}</p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>

          {/* Right: ordered active list */}
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.12 }}
            className="flex flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/5 backdrop-blur-xl"
          >
            <div className="border-b border-white/8 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Active Projects</p>
              <p className="mt-1 text-xs text-white/30">{selected.length} selected · drag order = display order</p>
            </div>

            <div className="flex-1 overflow-y-auto" style={{ maxHeight: '440px' }}>
              {selected.length === 0 ? (
                <p className="p-6 text-center text-sm text-white/30">No projects selected.</p>
              ) : (
                selected.map((name, i) => (
                  <div
                    key={name}
                    className="flex items-center gap-2 border-b border-white/5 px-5 py-3"
                  >
                    <span className="w-5 text-center text-xs text-white/25">{i + 1}</span>
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => moveUp(i)} disabled={i === 0} className="text-white/30 disabled:opacity-20 hover:text-white/70">
                        <FaChevronUp className="text-[10px]" />
                      </button>
                      <button onClick={() => moveDown(i)} disabled={i === selected.length - 1} className="text-white/30 disabled:opacity-20 hover:text-white/70">
                        <FaChevronDown className="text-[10px]" />
                      </button>
                    </div>
                    <div className="flex flex-1 items-center gap-2 min-w-0">
                      <FaGithub className="flex-shrink-0 text-xs text-white/30" />
                      <span className="truncate text-sm text-white/85">{name}</span>
                    </div>
                    <button onClick={() => remove(i)} className="flex-shrink-0 text-white/25 hover:text-red-400">
                      <FaTimes className="text-xs" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Add custom repo */}
            <div className="border-t border-white/8 px-5 py-4">
              <p className="mb-2 text-xs text-white/35">Add external repo (owner/repo)</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCustom()}
                  placeholder="e.g. vercel/next.js"
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:border-[#0a84ff]/50"
                />
                <button
                  onClick={addCustom}
                  className="flex-shrink-0 rounded-xl bg-white/8 px-3 py-2 text-white/60 hover:bg-white/15"
                >
                  <FaPlus className="text-xs" />
                </button>
              </div>
            </div>
          </motion.div>
        </div>
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

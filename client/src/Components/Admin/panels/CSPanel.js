import React, { useCallback, useEffect, useState } from 'react';
import { FaChevronDown, FaChevronUp, FaGithub, FaPlus, FaSave, FaTimes } from 'react-icons/fa';

import { apiUrl } from '../../../utils/api';
import { BTN_PRIMARY, Card, CardHeader, PanelHeader, StatusNote } from './ui';

const GITHUB_USERNAME = 'harri665';
const GH_HEADERS = { Accept: 'application/vnd.github+json' };

export default function CSPanel({ adminFetch }) {
  const [allRepos, setAllRepos] = useState([]);
  const [selected, setSelected] = useState([]); // ordered repo names
  const [customInput, setCustomInput] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const [reposRes, configRes] = await Promise.all([
          fetch(
            `https://api.github.com/users/${GITHUB_USERNAME}/repos?per_page=100&sort=updated`,
            { headers: GH_HEADERS }
          ),
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

  async function save() {
    setSaving(true);
    try {
      const r = await adminFetch('/cs-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, preserveListedOrder: true, repoNames: selected }),
      });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setStatus({ type: 'ok', message: 'Project list saved.' });
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
    } finally {
      setSaving(false);
    }
  }

  const filteredRepos = allRepos.filter(
    (r) =>
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.description || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <PanelHeader
        title="CS Projects"
        description="Choose which GitHub repos appear on the CS homepage and set their order."
        actions={
          <button onClick={save} disabled={saving} className={BTN_PRIMARY}>
            <FaSave className="text-xs" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        }
      />

      <StatusNote status={status} />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur-xl">
        <label className="flex cursor-pointer items-center gap-3">
          <span
            onClick={() => setEnabled((v) => !v)}
            className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${
              enabled ? 'bg-[#0a84ff]' : 'bg-white/15'
            }`}
          >
            <span
              className={`absolute top-0.5 block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </span>
          <span className="text-sm font-medium text-white/80">Whitelist enabled</span>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* All repos */}
        <Card className="flex flex-col">
          <div className="border-b border-white/8 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
              All Repos
            </p>
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
                const isActive =
                  selected.includes(repo.name) || selected.includes(repo.full_name);
                return (
                  <div
                    key={repo.id}
                    onClick={() => toggle(repo.name)}
                    className={`flex cursor-pointer items-start gap-3 border-b border-white/5 px-5 py-3.5 transition-colors hover:bg-white/5 ${
                      isActive ? 'bg-[#0a84ff]/8' : ''
                    }`}
                  >
                    <span
                      className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded border transition-colors ${
                        isActive ? 'border-[#0a84ff] bg-[#0a84ff]' : 'border-white/20'
                      }`}
                    >
                      {isActive && (
                        <svg
                          viewBox="0 0 12 12"
                          className="h-full w-full p-0.5 text-white"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="1,6 4,9 11,2" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white/90">{repo.name}</span>
                        {repo.language && (
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50">
                            {repo.language}
                          </span>
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
        </Card>

        {/* Active list */}
        <Card className="flex flex-col">
          <CardHeader
            title="Active Projects"
            meta={`${selected.length} selected · order = display order`}
          />

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
                    <button
                      onClick={() => moveUp(i)}
                      disabled={i === 0}
                      className="text-white/30 hover:text-white/70 disabled:opacity-20"
                    >
                      <FaChevronUp className="text-[10px]" />
                    </button>
                    <button
                      onClick={() => moveDown(i)}
                      disabled={i === selected.length - 1}
                      className="text-white/30 hover:text-white/70 disabled:opacity-20"
                    >
                      <FaChevronDown className="text-[10px]" />
                    </button>
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <FaGithub className="flex-shrink-0 text-xs text-white/30" />
                    <span className="truncate text-sm text-white/85">{name}</span>
                  </div>
                  <button
                    onClick={() => remove(i)}
                    className="flex-shrink-0 text-white/25 hover:text-red-400"
                  >
                    <FaTimes className="text-xs" />
                  </button>
                </div>
              ))
            )}
          </div>

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
        </Card>
      </div>
    </div>
  );
}

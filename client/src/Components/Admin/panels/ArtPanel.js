import React, { useCallback, useEffect, useState } from 'react';
import { FaSave } from 'react-icons/fa';

import { apiUrl } from '../../../utils/api';
import { BTN_PRIMARY, Card, EmptyState, PanelHeader, StatusNote } from './ui';

const ARTSTATION_USERNAME = 'harr1';

function titleToSlug(title) {
  return (title || '').replace(/\s+/g, '-').replace(/[^A-Za-z0-9-]/g, '');
}

function isValidSlug(s) {
  return /^[A-Za-z0-9-]+$/.test(s);
}

export default function ArtPanel({ adminFetch }) {
  const [projects, setProjects] = useState([]);
  const [slugMap, setSlugMap] = useState({}); // hash_id → custom slug
  const [errors, setErrors] = useState({}); // hash_id → message
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projectsRes, slugsRes] = await Promise.all([
        fetch(apiUrl(`/artstation/${ARTSTATION_USERNAME}`)),
        adminFetch('/admin/art/slugs'),
      ]);

      if (projectsRes.ok) {
        const data = await projectsRes.json();
        setProjects(data?.data || []);
      }
      if (slugsRes.ok) setSlugMap(await slugsRes.json());
      setStatus(null);
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
    } finally {
      setLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    load();
  }, [load]);

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
    const seen = [];

    for (const project of projects) {
      const raw = (slugMap[project.hash_id] || '').trim();
      if (!raw) continue;
      if (!isValidSlug(raw)) {
        newErrors[project.hash_id] = 'Letters, numbers, and hyphens only';
        continue;
      }
      if (seen.includes(raw)) {
        newErrors[project.hash_id] = 'Duplicate slug';
        continue;
      }
      seen.push(raw);
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setStatus({ type: 'error', message: 'Fix the highlighted slugs first.' });
      return;
    }

    const payload = {};
    for (const project of projects) {
      const raw = (slugMap[project.hash_id] || '').trim();
      if (raw) payload[project.hash_id] = raw;
    }

    setSaving(true);
    try {
      const r = await adminFetch('/admin/art/slugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs: payload }),
      });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setStatus({ type: 'ok', message: 'Slugs saved.' });
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PanelHeader
        title="Art Project Slugs"
        description="Set a custom URL slug for each art project. Leave blank to use the auto-generated title slug."
        actions={
          <button onClick={handleSave} disabled={saving} className={BTN_PRIMARY}>
            <FaSave className="text-xs" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        }
      />

      <StatusNote status={status} />

      {loading ? (
        <EmptyState>Loading projects…</EmptyState>
      ) : projects.length === 0 ? (
        <EmptyState>No projects found.</EmptyState>
      ) : (
        <Card>
          {projects.map((project, i) => {
            const autoSlug = titleToSlug(project.title);
            const customSlug = slugMap[project.hash_id] ?? '';
            const err = errors[project.hash_id];

            return (
              <div
                key={project.hash_id}
                className={`flex flex-wrap items-center gap-4 px-5 py-4 ${
                  i < projects.length - 1 ? 'border-b border-white/5' : ''
                }`}
              >
                {project.cover?.thumb_url && (
                  <img
                    src={project.cover.thumb_url}
                    alt={project.title}
                    className="h-12 w-20 shrink-0 rounded-lg object-cover"
                  />
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white/90">{project.title}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-white/30">
                    id: {project.hash_id}
                  </p>
                  {!customSlug && (
                    <p className="mt-0.5 font-mono text-[10px] text-white/25">auto: /{autoSlug}</p>
                  )}
                </div>

                <div className="flex w-full shrink-0 flex-col gap-1 sm:w-64">
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
        </Card>
      )}
    </div>
  );
}

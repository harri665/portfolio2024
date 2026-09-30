import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { apiUrl } from '../../../utils/api';
import { BTN_DANGER, Card, EmptyState, PanelHeader, StatusNote } from './ui';

export default function ProjectPagesPanel({ adminFetch }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pagesRes, configRes] = await Promise.all([
        adminFetch('/admin/projects'),
        fetch(apiUrl('/cs-config')),
      ]);
      if (!pagesRes.ok) throw new Error(`Error ${pagesRes.status}`);
      const pages = await pagesRes.json();
      const config = configRes.ok ? await configRes.json() : { repoNames: [] };

      const byRepo = new Map(pages.map((p) => [p.repo.toLowerCase(), p]));
      const listed = (config.repoNames || []).map((name) => name.split('/').pop());
      const listedKeys = new Set(listed.map((r) => r.toLowerCase()));
      setRows([
        ...listed.map((repo) => ({ repo, page: byRepo.get(repo.toLowerCase()) || null, listed: true })),
        ...pages
          .filter((p) => !listedKeys.has(p.repo.toLowerCase()))
          .map((page) => ({ repo: page.repo, page, listed: false })),
      ]);
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

  async function handleDelete(repo) {
    try {
      const r = await adminFetch(`/admin/projects/${encodeURIComponent(repo)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setStatus({ type: 'ok', message: `Deleted the page for ${repo}; it shows its README again.` });
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
    }
    setDeleteConfirm(null);
    load();
  }

  return (
    <div>
      <PanelHeader
        title="Project Pages"
        description="The write-up each CS project shows on cs.harrison-martin.com, in place of its GitHub README. Lead with the outcome; the README keeps the install steps."
      />

      <StatusNote status={status} />

      {loading ? (
        <EmptyState>Loading projects…</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>No projects are listed on the CS site yet (see CS Projects).</EmptyState>
      ) : (
        <Card>
          <div className="hidden grid-cols-[1fr_130px_130px] gap-4 border-b border-white/8 px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-white/35 sm:grid">
            <span>Project</span>
            <span>Shows</span>
            <span>Actions</span>
          </div>

          {rows.map(({ repo, page, listed }) => (
            <div
              key={repo}
              className="grid grid-cols-1 items-center gap-2 border-b border-white/5 px-5 py-3.5 last:border-0 hover:bg-white/[0.02] sm:grid-cols-[1fr_130px_130px] sm:gap-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white/90">{page?.title || repo}</p>
                <p className="truncate font-mono text-[10px] text-white/30">
                  {repo}
                  {!listed && ' · not on the CS site'}
                </p>
              </div>

              <span
                className={[
                  'w-fit rounded-full px-2 py-0.5 text-[10px] font-medium',
                  page?.published
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : page
                      ? 'bg-amber-500/10 text-amber-300'
                      : 'bg-white/8 text-white/40',
                ].join(' ')}
              >
                {page?.published ? 'project page' : page ? 'draft · README' : 'README'}
              </span>

              <div className="flex items-center gap-3">
                <Link
                  to={`/admin/projects/${encodeURIComponent(repo)}`}
                  className="text-xs font-medium text-[#0a84ff]/80 transition-colors hover:text-[#0a84ff]"
                >
                  {page ? 'Edit' : 'Write page'}
                </Link>

                {page &&
                  (deleteConfirm === repo ? (
                    <span className="flex items-center gap-2">
                      <button onClick={() => handleDelete(repo)} className={BTN_DANGER}>
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="text-xs text-white/35 hover:text-white/70"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => setDeleteConfirm(repo)} className={BTN_DANGER}>
                      Delete
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

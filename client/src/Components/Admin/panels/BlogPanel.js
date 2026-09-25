import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  BTN_DANGER,
  BTN_PRIMARY,
  Card,
  EmptyState,
  PanelHeader,
  StatusNote,
} from './ui';

export default function BlogPanel({ adminFetch }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminFetch('/admin/blog/posts');
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setPosts(await r.json());
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

  async function handleDelete(slug) {
    try {
      const r = await adminFetch(`/admin/blog/posts/${slug}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setStatus({ type: 'ok', message: `Deleted ${slug}.` });
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
    }
    setDeleteConfirm(null);
    load();
  }

  return (
    <div>
      <PanelHeader
        title="Blog Posts"
        description="Markdown posts served on blog.harrison-martin.com."
        actions={
          <Link to="/admin/blog/new" className={BTN_PRIMARY}>
            + New Post
          </Link>
        }
      />

      <StatusNote status={status} />

      {loading ? (
        <EmptyState>Loading posts…</EmptyState>
      ) : posts.length === 0 ? (
        <EmptyState>
          No posts yet.{' '}
          <Link to="/admin/blog/new" className="text-[#0a84ff] hover:underline">
            Create your first one.
          </Link>
        </EmptyState>
      ) : (
        <Card>
          <div className="hidden grid-cols-[1fr_110px_90px_130px] gap-4 border-b border-white/8 px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-white/35 sm:grid">
            <span>Title</span>
            <span>Date</span>
            <span>Status</span>
            <span>Actions</span>
          </div>

          {posts.map((post) => (
            <div
              key={post.slug}
              className="grid grid-cols-1 items-center gap-2 border-b border-white/5 px-5 py-3.5 last:border-0 hover:bg-white/[0.02] sm:grid-cols-[1fr_110px_90px_130px] sm:gap-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white/90">{post.title}</p>
                <p className="truncate font-mono text-[10px] text-white/30">{post.slug}</p>
              </div>

              <span className="text-xs text-white/45">{post.date || '—'}</span>

              <span
                className={[
                  'w-fit rounded-full px-2 py-0.5 text-[10px] font-medium',
                  post.published
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : 'bg-white/8 text-white/40',
                ].join(' ')}
              >
                {post.published ? 'published' : 'draft'}
              </span>

              <div className="flex items-center gap-3">
                <Link
                  to={`/admin/blog/edit/${post.slug}`}
                  className="text-xs font-medium text-[#0a84ff]/80 transition-colors hover:text-[#0a84ff]"
                >
                  Edit
                </Link>

                {deleteConfirm === post.slug ? (
                  <span className="flex items-center gap-2">
                    <button onClick={() => handleDelete(post.slug)} className={BTN_DANGER}>
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
                  <button onClick={() => setDeleteConfirm(post.slug)} className={BTN_DANGER}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

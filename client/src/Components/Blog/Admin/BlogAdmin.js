import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import SubdomainNav from '../../Homepage/SubdomainNav';
import { SITE_MODES } from '../../../utils/siteMode';
import { apiUrl } from '../../../utils/api';

const STORAGE_KEY = 'blog_admin_key';

export default function BlogAdmin() {
  const navigate = useNavigate();
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(STORAGE_KEY) || '');
  const [authed, setAuthed] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchPosts = useCallback(async (key) => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(apiUrl('/admin/blog/posts'), {
        headers: { 'x-admin-key': key },
      });
      if (r.status === 401) {
        sessionStorage.removeItem(STORAGE_KEY);
        setAdminKey('');
        setAuthed(false);
        return;
      }
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setPosts(await r.json());
      setAuthed(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adminKey) fetchPosts(adminKey);
  }, [adminKey, fetchPosts]);

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

  async function handleDelete(slug) {
    try {
      await fetch(apiUrl(`/admin/blog/posts/${slug}`), {
        method: 'DELETE',
        headers: { 'x-admin-key': adminKey },
      });
    } catch {}
    setDeleteConfirm(null);
    fetchPosts(adminKey);
  }

  function handleLogout() {
    sessionStorage.removeItem(STORAGE_KEY);
    setAdminKey('');
    setAuthed(false);
    setPosts([]);
  }

  if (!authed) {
    return (
      <div className="houdini-canvas min-h-screen text-white">
        <SubdomainNav currentMode={SITE_MODES.BLOG} />
        <div className="flex min-h-screen items-center justify-center px-4">
          <form
            onSubmit={handleAuth}
            className="w-full max-w-sm rounded-lg border border-[#2e3240] bg-[#1e2128] p-8"
          >
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#e07b39]/70">admin</p>
            <h1 className="mb-6 font-mono text-xl font-bold text-[#d0d4dc]">Blog Admin</h1>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-[#5a6070]">
              Admin Key
            </label>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="mb-4 w-full rounded border border-[#3a3d45] bg-[#252830] px-3 py-2 font-mono text-sm text-[#d0d4dc] outline-none focus:border-[#e07b39]/50"
              placeholder="Enter admin key"
              autoFocus
            />
            {authError && <p className="mb-3 font-mono text-xs text-red-400">{authError}</p>}
            <button
              type="submit"
              className="w-full rounded bg-[#e07b39] px-4 py-2 font-mono text-sm font-semibold text-white transition-colors hover:bg-[#f59a5a]"
            >
              Unlock
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="houdini-canvas min-h-screen text-white">
      <SubdomainNav currentMode={SITE_MODES.BLOG} />
      <main className="mx-auto max-w-5xl px-4 pb-20 pt-24 sm:px-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#e07b39]/70">/ admin</p>
            <h1 className="mt-1 font-mono text-2xl font-bold text-[#d0d4dc]">Blog Posts</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleLogout}
              className="font-mono text-xs text-[#5a6070] transition-colors hover:text-[#9099a8]"
            >
              Log out
            </button>
            <Link
              to="/blog-admin/new"
              className="rounded border border-[#e07b39]/40 bg-[#e07b39]/10 px-4 py-2 font-mono text-xs font-semibold text-[#e07b39] transition-colors hover:bg-[#e07b39]/20"
            >
              + New Post
            </Link>
          </div>
        </div>

        {loading && (
          <div className="py-20 text-center font-mono text-xs text-[#5a6070]">loading…</div>
        )}
        {error && (
          <div className="rounded border border-red-800/40 bg-red-900/10 p-4 font-mono text-xs text-red-400">
            {error}
          </div>
        )}
        {!loading && !error && posts.length === 0 && (
          <div className="rounded-lg border border-[#2e3240] bg-[#1e2128] p-10 text-center font-mono text-xs text-[#5a6070]">
            No posts yet.{' '}
            <Link to="/blog-admin/new" className="text-[#e07b39] hover:text-[#f59a5a]">
              Create your first one.
            </Link>
          </div>
        )}

        {!loading && !error && posts.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-[#2e3240] bg-[#1e2128]">
            <div className="grid grid-cols-[1fr_100px_80px_120px] gap-4 border-b border-[#2e3240] bg-[#252830] px-5 py-2.5 font-mono text-[10px] uppercase tracking-widest text-[#4a5060]">
              <span>Title</span>
              <span>Date</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {posts.map((post) => (
              <div
                key={post.slug}
                className="grid grid-cols-[1fr_100px_80px_120px] items-center gap-4 border-b border-[#2e3240]/50 px-5 py-3 last:border-0 hover:bg-white/[0.015]"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-[#d0d4dc]">{post.title}</p>
                  <p className="font-mono text-[10px] text-[#4a5060]">{post.slug}</p>
                </div>
                <span className="font-mono text-xs text-[#5a6070]">{post.date || '—'}</span>
                <span
                  className={[
                    'w-fit rounded px-2 py-0.5 font-mono text-[10px]',
                    post.published
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-[#3a3d45] text-[#5a6070]',
                  ].join(' ')}
                >
                  {post.published ? 'published' : 'draft'}
                </span>
                <div className="flex items-center gap-3">
                  <Link
                    to={`/blog-admin/edit/${post.slug}`}
                    className="font-mono text-xs text-[#e07b39] transition-colors hover:text-[#f59a5a]"
                  >
                    Edit
                  </Link>
                  {deleteConfirm === post.slug ? (
                    <span className="flex items-center gap-2">
                      <button
                        onClick={() => handleDelete(post.slug)}
                        className="font-mono text-xs text-red-400 hover:text-red-300"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="font-mono text-xs text-[#5a6070] hover:text-[#9099a8]"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(post.slug)}
                      className="font-mono text-xs text-[#5a6070] transition-colors hover:text-red-400"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

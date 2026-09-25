import React, { useCallback, useEffect, useState } from 'react';

import {
  BTN_DANGER,
  BTN_PRIMARY,
  BTN_SUBTLE,
  Card,
  EmptyState,
  PanelHeader,
  StatusNote,
} from './ui';

const SLUG_RE = /^[a-zA-Z0-9_-]+$/;

function defaultTemplate() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Page</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
  </style>
</head>
<body>
  <h1>Hello</h1>
  <p>Edit this page in the admin panel.</p>
</body>
</html>`;
}

export default function PagesPanel({ adminFetch }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [editing, setEditing] = useState(null); // { slug, content, isNew }
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminFetch('/admin/pages');
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setPages(await r.json());
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

  async function openPage(slug) {
    try {
      const r = await adminFetch(`/admin/pages/${slug}`);
      if (!r.ok) throw new Error('Failed to load page');
      const { content } = await r.json();
      setEditing({ slug, content, isNew: false });
      setStatus(null);
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
    }
  }

  async function savePage() {
    if (!editing) return;
    const { slug, content, isNew } = editing;
    if (!SLUG_RE.test(slug)) {
      setStatus({
        type: 'error',
        message: 'Slug must be letters, numbers, hyphens, or underscores only.',
      });
      return;
    }

    setSaving(true);
    try {
      const r = await adminFetch(`/admin/pages/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setStatus({ type: 'ok', message: `Saved /p/${slug}.` });
      if (isNew) {
        await load();
        setEditing((prev) => ({ ...prev, isNew: false }));
      }
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function deletePage(slug) {
    try {
      const r = await adminFetch(`/admin/pages/${slug}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setStatus({ type: 'ok', message: `Deleted /p/${slug}.` });
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
    }
    setDeleteConfirm(null);
    if (editing?.slug === slug) setEditing(null);
    load();
  }

  if (editing) {
    return (
      <div>
        <PanelHeader
          title={editing.isNew ? 'New Page' : `/p/${editing.slug}`}
          actions={
            <>
              <button onClick={() => setEditing(null)} className={BTN_SUBTLE}>
                Back
              </button>
              <button onClick={savePage} disabled={saving} className={BTN_PRIMARY}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        />

        <StatusNote status={status} />

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-white/8 px-5 py-3">
            {editing.isNew ? (
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-white/40">/p/</span>
                <input
                  value={editing.slug}
                  onChange={(e) => setEditing((prev) => ({ ...prev, slug: e.target.value }))}
                  placeholder="page-slug"
                  className="w-56 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs text-white placeholder-white/25 outline-none focus:border-[#0a84ff]/50"
                />
              </span>
            ) : (
              <a
                href={`/p/${editing.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#0a84ff] hover:underline"
              >
                Preview /p/{editing.slug} ↗
              </a>
            )}

            {!editing.isNew && (
              <button
                onClick={() => setDeleteConfirm(editing.slug)}
                className={`ml-auto ${BTN_DANGER}`}
              >
                Delete page
              </button>
            )}
          </div>

          {deleteConfirm === editing.slug && (
            <div className="flex items-center gap-3 border-b border-white/8 bg-red-500/5 px-5 py-3">
              <span className="text-xs text-red-300">Delete /p/{editing.slug}?</span>
              <button onClick={() => deletePage(editing.slug)} className={BTN_DANGER}>
                Confirm
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="text-xs text-white/35 hover:text-white/70"
              >
                Cancel
              </button>
            </div>
          )}

          <textarea
            value={editing.content}
            onChange={(e) => setEditing((prev) => ({ ...prev, content: e.target.value }))}
            className="w-full resize-none bg-[#0d0f14] px-5 py-4 font-mono text-xs text-[#c8ccd4] outline-none"
            style={{ minHeight: '560px' }}
            spellCheck={false}
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PanelHeader
        title="Static Pages"
        description="Raw HTML pages served at /p/<slug>."
        actions={
          <button
            onClick={() => {
              setEditing({ slug: '', content: defaultTemplate(), isNew: true });
              setStatus(null);
            }}
            className={BTN_PRIMARY}
          >
            + New Page
          </button>
        }
      />

      <StatusNote status={status} />

      {loading ? (
        <EmptyState>Loading pages…</EmptyState>
      ) : pages.length === 0 ? (
        <EmptyState>No pages yet.</EmptyState>
      ) : (
        <Card>
          {pages.map(({ slug }, i) => (
            <div
              key={slug}
              className={`flex flex-wrap items-center gap-3 px-5 py-3.5 ${
                i < pages.length - 1 ? 'border-b border-white/5' : ''
              }`}
            >
              <button
                onClick={() => openPage(slug)}
                className="flex-1 text-left font-mono text-sm text-white/85 transition-colors hover:text-[#0a84ff]"
              >
                /p/{slug}
              </button>

              <a
                href={`/p/${slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-white/40 hover:text-white/70"
              >
                Preview ↗
              </a>

              {deleteConfirm === slug ? (
                <span className="flex items-center gap-2">
                  <button onClick={() => deletePage(slug)} className={BTN_DANGER}>
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
                <button onClick={() => setDeleteConfirm(slug)} className={BTN_DANGER}>
                  Delete
                </button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

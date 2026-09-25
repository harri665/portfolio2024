import React, { useCallback, useEffect, useState } from 'react';

import {
  BTN_DANGER,
  BTN_PRIMARY,
  BTN_SUBTLE,
  Card,
  CardHeader,
  EmptyState,
  Field,
  INPUT,
  PanelHeader,
  StatusNote,
} from './ui';

// <input type="datetime-local"> wants local wall-clock time with no zone, so
// shift the UTC instant by the viewer's offset on the way in and back out.
function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function localInputToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function formatTimestamp(value) {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

export default function CommentsPanel({ adminFetch }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);

  const [editing, setEditing] = useState(null); // { commentId, name, body, createdAt }
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminFetch('/admin/comments');
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setThreads(await r.json());
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

  function startEdit(comment) {
    setEditing({
      commentId: comment.id,
      name: comment.name,
      body: comment.body,
      createdAt: isoToLocalInput(comment.createdAt),
    });
    setDeleteConfirm(null);
  }

  async function saveEdit(thread) {
    if (!editing) return;

    const createdAt = localInputToIso(editing.createdAt);
    if (editing.createdAt && !createdAt) {
      setStatus({ type: 'error', message: 'That date is not valid.' });
      return;
    }

    setSaving(true);
    try {
      const r = await adminFetch(
        `/admin/comments/${thread.type}/${encodeURIComponent(thread.id)}/${editing.commentId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editing.name,
            body: editing.body,
            ...(createdAt ? { createdAt } : {}),
          }),
        }
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Error ${r.status}`);

      setEditing(null);
      setStatus({ type: 'ok', message: 'Comment updated.' });
      await load();
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(thread, comment) {
    try {
      const r = await adminFetch(
        `/admin/comments/${thread.type}/${encodeURIComponent(thread.id)}/${comment.id}`,
        { method: 'DELETE' }
      );
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const { removed } = await r.json().catch(() => ({}));
      setStatus({
        type: 'ok',
        message: removed > 1 ? `Deleted comment and ${removed - 1} repl${removed === 2 ? 'y' : 'ies'}.` : 'Comment deleted.',
      });
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
    }
    setDeleteConfirm(null);
    load();
  }

  const total = threads.reduce((sum, t) => sum + t.comments.length, 0);

  return (
    <div>
      <PanelHeader
        title="Comments"
        description="Every comment across the blog, art, and cs pages. You can edit the author, the text, and the posted time."
        actions={
          <button onClick={load} className={BTN_SUBTLE}>
            Refresh
          </button>
        }
      />

      <StatusNote status={status} />

      {loading ? (
        <EmptyState>Loading comments…</EmptyState>
      ) : threads.length === 0 ? (
        <EmptyState>No comments yet.</EmptyState>
      ) : (
        <>
          <p className="mb-4 text-xs text-white/30">
            {total} comment{total === 1 ? '' : 's'} across {threads.length} thread
            {threads.length === 1 ? '' : 's'}
          </p>

          <div className="space-y-5">
            {threads.map((thread) => (
              <Card key={thread.key}>
                <CardHeader
                  title={
                    <>
                      <span className="text-[#0a84ff]">{thread.type}</span> / {thread.id}
                    </>
                  }
                  meta={`${thread.comments.length}`}
                />

                <div className="divide-y divide-white/5">
                  {thread.comments.map((c) => {
                    const isEditing = editing?.commentId === c.id;

                    return (
                      <div key={c.id} className={`px-5 py-4 ${c.parentId ? 'bg-white/[0.02]' : ''}`}>
                        {isEditing ? (
                          <div className="space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field label="Author">
                                <input
                                  value={editing.name}
                                  onChange={(e) =>
                                    setEditing((p) => ({ ...p, name: e.target.value }))
                                  }
                                  className={INPUT}
                                  maxLength={60}
                                />
                              </Field>
                              <Field label="Posted at">
                                <input
                                  type="datetime-local"
                                  value={editing.createdAt}
                                  onChange={(e) =>
                                    setEditing((p) => ({ ...p, createdAt: e.target.value }))
                                  }
                                  className={`${INPUT} [color-scheme:dark]`}
                                />
                              </Field>
                            </div>

                            <Field label="Comment">
                              <textarea
                                value={editing.body}
                                rows={4}
                                maxLength={2000}
                                onChange={(e) =>
                                  setEditing((p) => ({ ...p, body: e.target.value }))
                                }
                                className={`${INPUT} resize-y`}
                              />
                            </Field>

                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => saveEdit(thread)}
                                disabled={saving}
                                className={BTN_PRIMARY}
                              >
                                {saving ? 'Saving…' : 'Save changes'}
                              </button>
                              <button onClick={() => setEditing(null)} className={BTN_SUBTLE}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="text-sm font-semibold text-white">
                                {c.parentId && (
                                  <span className="mr-2 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/40">
                                    reply
                                  </span>
                                )}
                                {c.name}
                              </span>
                              <span className="text-xs text-white/30">
                                {formatTimestamp(c.createdAt)}
                                {c.editedAt ? ' · edited' : ''}
                                {c.ip ? ` · ${c.ip}` : ''}
                              </span>
                            </div>

                            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/70">
                              {c.body}
                            </p>

                            <div className="mt-3 flex items-center gap-4">
                              <button
                                onClick={() => startEdit(c)}
                                className="text-xs font-medium text-[#0a84ff]/80 transition-colors hover:text-[#0a84ff]"
                              >
                                Edit
                              </button>

                              {deleteConfirm === c.id ? (
                                <span className="flex items-center gap-3">
                                  <button
                                    onClick={() => handleDelete(thread, c)}
                                    className={BTN_DANGER}
                                  >
                                    {c.parentId ? 'Confirm delete' : 'Confirm (removes replies)'}
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirm(null)}
                                    className="text-xs text-white/35 hover:text-white/70"
                                  >
                                    Cancel
                                  </button>
                                </span>
                              ) : (
                                <button
                                  onClick={() => setDeleteConfirm(c.id)}
                                  className={BTN_DANGER}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

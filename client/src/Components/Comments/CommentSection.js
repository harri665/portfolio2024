import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { apiUrl } from '../../utils/api';
import { getCommenterName, setCommenterName } from '../../utils/commenterIdentity';

const MAX_NAME = 60;
const MAX_BODY = 2000;

const STYLE = {
  section: 'border-t border-line/9 pt-10',
  heading: 'text-xl font-semibold tracking-tight text-ink',
  count: 'ml-2 font-normal text-ink-3',
  body: 'mt-6',
  label: 'mb-1.5 block text-sm font-medium text-ink-2',
  input:
    'w-full rounded-field border border-line/12 bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent/60',
  button:
    'rounded-full bg-accent px-5 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-50',
  subtleButton: 'text-sm text-ink-3 transition-colors hover:text-ink',
  counter: 'text-xs tabular-nums text-ink-3',
  error: 'text-sm text-red-300',
  empty: 'text-sm text-ink-3',
  divider: 'border-t border-line/9 pt-5',
  replyRail: 'border-l border-line/12 pl-4',
  author: 'text-sm font-semibold text-ink',
  timestamp: 'text-xs text-ink-3',
  text: 'mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-2',
};

function formatTimestamp(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildThread(comments) {
  const roots = comments.filter((c) => !c.parentId);
  const repliesByParent = comments.reduce((acc, c) => {
    if (!c.parentId) return acc;
    (acc[c.parentId] = acc[c.parentId] || []).push(c);
    return acc;
  }, {});

  const byDate = (a, b) => (a.createdAt || '').localeCompare(b.createdAt || '');

  return roots
    .slice()
    .sort(byDate)
    .map((root) => ({
      ...root,
      replies: (repliesByParent[root.id] || []).slice().sort(byDate),
    }));
}

function CommentForm({
  s,
  name,
  onNameChange,
  body,
  onBodyChange,
  website,
  onWebsiteChange,
  onSubmit,
  submitting,
  error,
  submitLabel,
  placeholder,
  onCancel,
  autoFocus,
  idPrefix,
}) {
  return (
    <form onSubmit={onSubmit}>
      <div className="mb-4">
        <label className={s.label} htmlFor={`${idPrefix}-name`}>
          Name
        </label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          value={name}
          maxLength={MAX_NAME}
          onChange={(e) => onNameChange(e.target.value)}
          className={s.input}
          placeholder="Your name"
        />
      </div>

      <div className="mb-3">
        <label className={s.label} htmlFor={`${idPrefix}-body`}>
          Comment
        </label>
        <textarea
          id={`${idPrefix}-body`}
          value={body}
          rows={4}
          maxLength={MAX_BODY}
          onChange={(e) => onBodyChange(e.target.value)}
          className={`${s.input} resize-y`}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
      </div>

      {/* honeypot */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={website}
        onChange={(e) => onWebsiteChange(e.target.value)}
        className="hidden"
        aria-hidden="true"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={s.counter}>
          {body.length}/{MAX_BODY}
        </span>
        <div className="flex items-center gap-4">
          {onCancel && (
            <button type="button" onClick={onCancel} className={s.subtleButton}>
              Cancel
            </button>
          )}
          <button type="submit" className={s.button} disabled={submitting}>
            {submitting ? 'Posting…' : submitLabel}
          </button>
        </div>
      </div>

      {error && <p className={`mt-3 ${s.error}`}>{error}</p>}
    </form>
  );
}

export default function CommentSection({ type, id }) {
  const s = STYLE;

  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [name, setName] = useState(getCommenterName);
  const [body, setBody] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const [replyTo, setReplyTo] = useState(null);
  const [replyBody, setReplyBody] = useState('');
  const [replyError, setReplyError] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);

  const endpoint = useCallback(
    () => apiUrl(`/comments/${type}/${encodeURIComponent(id)}`),
    [type, id]
  );

  useEffect(() => {
    if (!id) return undefined;

    const controller = new AbortController();
    setLoading(true);
    setLoadError('');

    fetch(endpoint(), { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json();
      })
      .then(setComments)
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setLoadError('Could not load comments.');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [endpoint, id]);

  const thread = useMemo(() => buildThread(comments), [comments]);

  async function post({ parentId, text }) {
    const trimmedName = name.trim();
    const trimmedBody = text.trim();

    if (!trimmedName || !trimmedBody) {
      throw new Error('Add your name and a comment first.');
    }

    const r = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: trimmedName,
        body: trimmedBody,
        parentId: parentId || undefined,
        website,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);

    setComments((prev) => [...prev, data]);
    setCommenterName(trimmedName);
    return data;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await post({ text: body });
      setBody('');
    } catch (err) {
      setSubmitError(err.message || 'Could not post your comment.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReplySubmit(e) {
    e.preventDefault();
    if (replySubmitting) return;
    setReplySubmitting(true);
    setReplyError('');
    try {
      await post({ parentId: replyTo, text: replyBody });
      setReplyBody('');
      setReplyTo(null);
    } catch (err) {
      setReplyError(err.message || 'Could not post your reply.');
    } finally {
      setReplySubmitting(false);
    }
  }

  function openReply(commentId) {
    setReplyTo(commentId);
    setReplyBody('');
    setReplyError('');
  }

  if (!id) return null;

  function renderComment(comment) {
    return (
      <div key={comment.id}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className={s.author}>{comment.name}</span>
          <span className={s.timestamp}>
            {formatTimestamp(comment.createdAt)}
          </span>
        </div>
        <p className={s.text}>{comment.body}</p>

        <div className="mt-2">
          <button
            type="button"
            onClick={() => openReply(comment.id)}
            className={s.subtleButton}
          >
            Reply
          </button>
        </div>

        {replyTo === comment.id && (
          <div className={`mt-4 ${s.replyRail}`}>
            <CommentForm
              s={s}
              idPrefix={`reply-${comment.id}`}
              name={name}
              onNameChange={setName}
              body={replyBody}
              onBodyChange={setReplyBody}
              website={website}
              onWebsiteChange={setWebsite}
              onSubmit={handleReplySubmit}
              submitting={replySubmitting}
              error={replyError}
              submitLabel="Post reply"
              placeholder={`Reply to ${comment.name}…`}
              onCancel={() => setReplyTo(null)}
              autoFocus
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <section className={s.section}>
      <h2 className={s.heading}>
        Comments
        {comments.length > 0 && <span className={s.count}>{comments.length}</span>}
      </h2>

      <div className={s.body}>
        {loading ? (
          <p className={s.empty}>Loading comments…</p>
        ) : loadError ? (
          <p className={s.error}>{loadError}</p>
        ) : thread.length === 0 ? (
          <p className={s.empty}>No comments yet.</p>
        ) : (
          <div className="space-y-4">
            {thread.map((comment) => (
              <div key={comment.id} className={s.divider}>
                {renderComment(comment)}

                {comment.replies.length > 0 && (
                  <div className={`mt-4 space-y-4 ${s.replyRail}`}>
                    {comment.replies.map((reply) => renderComment(reply))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-8">
          <CommentForm
            s={s}
            idPrefix="comment"
            name={name}
            onNameChange={setName}
            body={body}
            onBodyChange={setBody}
            website={website}
            onWebsiteChange={setWebsite}
            onSubmit={handleSubmit}
            submitting={submitting}
            error={submitError}
            submitLabel="Post comment"
            placeholder="Say something…"
          />
        </div>
      </div>
    </section>
  );
}

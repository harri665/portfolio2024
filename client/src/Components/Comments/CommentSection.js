import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';

import { apiUrl } from '../../utils/api';
import { getCommenterName, setCommenterName } from '../../utils/commenterIdentity';

const MAX_NAME = 60;
const MAX_BODY = 2000;

// Two looks: the Houdini node panels on the blog, and the glass cards used by
// the art and cs project pages.
const VARIANTS = {
  houdini: {
    section: 'rounded-lg border border-[#2e3240] bg-[#1e2128] overflow-hidden',
    header:
      'flex items-center gap-2 border-b border-[#2e3240] bg-[#252830] px-5 py-2.5',
    headerDot: 'h-1.5 w-1.5 rounded-full bg-[#e07b39]',
    headerText:
      'font-mono text-[10px] uppercase tracking-widest text-[#4a5060]',
    body: 'px-5 py-6 sm:px-8',
    label:
      'mb-1 block font-mono text-[10px] uppercase tracking-widest text-[#5a6070]',
    input:
      'w-full rounded border border-[#3a3d45] bg-[#252830] px-3 py-2 font-mono text-sm text-[#d0d4dc] outline-none transition-colors focus:border-[#e07b39]/50',
    button:
      'rounded bg-[#e07b39] px-4 py-2 font-mono text-sm font-semibold text-white transition-colors hover:bg-[#f59a5a] disabled:cursor-not-allowed disabled:opacity-50',
    subtleButton:
      'font-mono text-[10px] uppercase tracking-widest text-[#5a6070] transition-colors hover:text-[#e07b39]',
    counter: 'font-mono text-[10px] text-[#4a5060]',
    error: 'font-mono text-xs text-red-400',
    empty: 'font-mono text-xs text-[#5a6070]',
    divider: 'border-t border-[#2e3240] pt-4',
    replyRail: 'border-l border-[#2e3240] pl-4',
    author: 'font-mono text-sm font-semibold text-[#d0d4dc]',
    timestamp: 'font-mono text-[10px] text-[#4a5060]',
    text: 'mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#a8adb8]',
  },
  glass: {
    section:
      'rounded-[1.75rem] border border-white/10 bg-white/5 shadow-[0_18px_45px_rgba(0,0,0,0.28)] backdrop-blur-xl overflow-hidden',
    header: 'flex items-center gap-2 border-b border-white/10 px-6 py-4',
    headerDot: 'h-1.5 w-1.5 rounded-full bg-[#0a84ff]',
    headerText:
      'text-xs font-semibold uppercase tracking-[0.2em] text-white/45',
    body: 'px-6 py-6 sm:px-8',
    label:
      'mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-white/45',
    input:
      'w-full rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-[#0a84ff]/60',
    button:
      'rounded-full bg-[#0a84ff] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(10,132,255,0.32)] transition-colors hover:bg-[#2997ff] disabled:cursor-not-allowed disabled:opacity-50',
    subtleButton:
      'text-xs font-semibold uppercase tracking-[0.15em] text-white/40 transition-colors hover:text-[#0a84ff]',
    counter: 'text-xs text-white/35',
    error: 'text-xs text-red-300',
    empty: 'text-sm text-white/40',
    divider: 'border-t border-white/10 pt-4',
    replyRail: 'border-l border-white/10 pl-4',
    author: 'text-sm font-semibold text-white',
    timestamp: 'text-xs text-white/35',
    text: 'mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/70',
  },
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

// Flat list -> top-level comments each carrying their replies, both in post order.
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

      {/* Honeypot — hidden from people, tempting to bots */}
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

export default function CommentSection({ type, id, variant = 'glass' }) {
  const s = VARIANTS[variant] || VARIANTS.glass;

  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [name, setName] = useState(getCommenterName);
  const [body, setBody] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Reply composer — only one open at a time
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

  // The divider lives on the wrapper below, so the body itself is unstyled.
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
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={s.section}
    >
      <div className={s.header}>
        <div className={s.headerDot} />
        <span className={s.headerText}>
          comments{comments.length > 0 ? ` (${comments.length})` : ''}
        </span>
      </div>

      <div className={s.body}>
        {loading ? (
          <p className={s.empty}>loading comments…</p>
        ) : loadError ? (
          <p className={s.error}>{loadError}</p>
        ) : thread.length === 0 ? (
          <p className={s.empty}>No comments yet — be the first.</p>
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
    </motion.section>
  );
}

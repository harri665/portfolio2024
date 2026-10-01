import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { mediaUrl } from '../../../utils/mediaUrl';
import { ImageLibrary, MarkdownEditor, uploadImage } from './markdownEditing';
import {
  BTN_PRIMARY,
  BTN_SUBTLE,
  Card,
  CardHeader,
  Field,
  INPUT,
  PanelHeader,
  StatusNote,
} from './ui';

// the story goes in the blog post, this is just results + decisions
const STARTER = `One or two sentences on the result: what it does, for whom, and how well (a number if there is one).

## What I built

## Key decisions

- **Decision.** Why, and what it bought.

## Outcome
`;

const EMPTY = {
  title: '',
  tagline: '',
  role: '',
  timeline: '',
  stack: '',
  live: '',
  blog: '',
  cover: '',
  video: '',
  published: true,
  privateRepo: false,
};

export default function ProjectPageEditorPanel({ adminFetch }) {
  const { repo } = useParams();
  const navigate = useNavigate();
  const editorRef = useRef(null);

  const [fields, setFields] = useState(EMPTY);
  const [content, setContent] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');

  useEffect(() => {
    setLoading(true);
    adminFetch(`/admin/projects/${encodeURIComponent(repo)}`)
      .then(async (r) => {
        if (r.status === 404) {
          setIsNew(true);
          setFields(EMPTY);
          setContent(STARTER);
          return;
        }
        if (!r.ok) throw new Error(`Error ${r.status}`);
        const { meta, content: c } = await r.json();
        setIsNew(false);
        setFields({ ...EMPTY, ...meta, stack: (meta.stack || []).join(', ') });
        setContent(c);
      })
      .catch((e) => setStatus({ type: 'error', message: e.message }))
      .finally(() => setLoading(false));
  }, [repo, adminFetch]);

  const set = (key) => (e) =>
    setFields((prev) => ({
      ...prev,
      [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));

  async function handleCoverUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus('uploading…');
    try {
      const filename = await uploadImage(adminFetch, file);
      setFields((prev) => ({ ...prev, cover: filename }));
      setUploadStatus(`✓ ${filename}`);
    } catch (err) {
      setUploadStatus(`error: ${err.message}`);
    }
  }

  async function handleSave() {
    if (!fields.title.trim()) {
      setStatus({ type: 'error', message: 'Title is required.' });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const r = await adminFetch(`/admin/projects/${encodeURIComponent(repo)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...fields,
          stack: fields.stack.split(',').map((t) => t.trim()).filter(Boolean),
          content,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Error ${r.status}`);
      }
      navigate('/admin/projects');
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="py-16 text-center text-sm text-white/35">Loading page…</p>;
  }

  return (
    <div>
      <PanelHeader
        title={isNew ? `New page: ${repo}` : `Edit page: ${repo}`}
        description="Written for someone skimming several projects: the result first, your role, the choices that mattered. The README keeps install steps; the blog post keeps the story."
        actions={
          <>
            <Link to="/admin/projects" className={BTN_SUBTLE}>
              Cancel
            </Link>
            <button onClick={handleSave} disabled={saving} className={BTN_PRIMARY}>
              {saving ? 'Saving…' : 'Save Page'}
            </button>
          </>
        }
      />

      <StatusNote status={status} />

      <Card className="mb-4">
        <CardHeader title="Summary" />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <Field label="Title">
            <input value={fields.title} onChange={set('title')} className={INPUT} placeholder="Relight" />
          </Field>

          <Field label="Role" hint="What you did on it">
            <input
              value={fields.role}
              onChange={set('role')}
              className={INPUT}
              placeholder="Solo: research, training pipeline, viewer"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Tagline" hint="The outcome in one line; also the card text and link preview">
              <input
                value={fields.tagline}
                onChange={set('tagline')}
                className={INPUT}
                placeholder="Relights a path-traced scene in the browser in 5 ms per light"
              />
            </Field>
          </div>

          <Field label="Timeline">
            <input value={fields.timeline} onChange={set('timeline')} className={INPUT} placeholder="Sep 2026 · 2 weeks" />
          </Field>

          <Field label="Stack (comma-separated)">
            <input
              value={fields.stack}
              onChange={set('stack')}
              className={INPUT}
              placeholder="WebGPU, PyTorch, React"
            />
          </Field>

          <Field label="Live demo URL" hint="Defaults to the repo's website field">
            <input value={fields.live} onChange={set('live')} className={INPUT} placeholder="https://…" />
          </Field>

          <Field label="Blog post URL">
            <input
              value={fields.blog}
              onChange={set('blog')}
              className={INPUT}
              placeholder="https://blog.harrison-martin.com/…"
            />
          </Field>

          <Field label="Cover image" hint="A library filename or a full URL">
            <input value={fields.cover} onChange={set('cover')} className={`${INPUT} mb-2`} placeholder="relight-cover.png" />
            <span className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] text-white/60 transition-colors hover:text-white">
                Upload image
                <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
              </label>
              {uploadStatus && (
                <span
                  className={`text-[10px] ${
                    uploadStatus.startsWith('error') ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {uploadStatus}
                </span>
              )}
            </span>
          </Field>

          <Field label="Hero video" hint="Optional .mp4 URL; plays in place of the cover">
            <input value={fields.video} onChange={set('video')} className={INPUT} placeholder="https://…/demo.mp4" />
          </Field>

          {fields.cover && (
            <div className="sm:col-span-2">
              <img
                src={mediaUrl(fields.cover)}
                alt="Cover preview"
                className="max-h-56 rounded-xl border border-white/10 object-cover"
              />
            </div>
          )}

          <Field label="Status">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={fields.published}
                onChange={set('published')}
                className="accent-[#0a84ff]"
              />
              <span className="text-xs text-white/70">Published (unchecked shows the README)</span>
            </label>
            <label className="mt-2 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={fields.privateRepo}
                onChange={set('privateRepo')}
                className="accent-[#0a84ff]"
              />
              <span className="text-xs text-white/70">Private repo (no GitHub link; listed from this page)</span>
            </label>
          </Field>
        </div>
      </Card>

      <ImageLibrary
        adminFetch={adminFetch}
        onInsert={(text) => editorRef.current?.insert(text)}
        onError={(err) => setStatus({ type: 'error', message: err.message })}
      />

      <MarkdownEditor
        ref={editorRef}
        value={content}
        onChange={setContent}
        placeholder="Write the project page in Markdown…"
      />
    </div>
  );
}

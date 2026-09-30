import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

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

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function BlogEditorPanel({ adminFetch }) {
  const { slug: editSlug } = useParams();
  const navigate = useNavigate();
  const isNew = !editSlug;

  const editorRef = useRef(null);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');

  const [slug, setSlug] = useState('');
  const [slugLocked, setSlugLocked] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [tags, setTags] = useState('');
  const [description, setDescription] = useState('');
  const [cover, setCover] = useState('');
  const [published, setPublished] = useState(true);
  const [content, setContent] = useState('');

  useEffect(() => {
    if (isNew) return;

    adminFetch(`/admin/blog/posts/${editSlug}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json();
      })
      .then(({ meta, content: c }) => {
        setTitle(meta.title);
        setSlug(editSlug);
        setSlugLocked(true);
        setDate(meta.date || '');
        setTags((meta.tags || []).join(', '));
        setDescription(meta.description || '');
        setCover(meta.cover || '');
        setPublished(meta.published !== false);
        setContent(c);
      })
      .catch((e) => setStatus({ type: 'error', message: e.message }))
      .finally(() => setLoading(false));
  }, [editSlug, isNew, adminFetch]);

  async function handleCoverUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus('uploading…');
    try {
      const filename = await uploadImage(adminFetch, file);
      setCover(filename);
      setUploadStatus(`✓ ${filename}`);
    } catch (err) {
      setUploadStatus(`error: ${err.message}`);
    }
  }

  function handleTitleChange(v) {
    setTitle(v);
    if (isNew && !slugLocked) setSlug(slugify(v));
  }

  async function handleSave() {
    if (!title.trim()) {
      setStatus({ type: 'error', message: 'Title is required.' });
      return;
    }
    if (!slug.trim() || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
      setStatus({
        type: 'error',
        message: 'Slug must only contain letters, numbers, hyphens, and underscores.',
      });
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      const r = await adminFetch(
        isNew ? '/admin/blog/posts' : `/admin/blog/posts/${slug}`,
        {
          method: isNew ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug,
            title,
            date,
            tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
            description,
            cover: cover || undefined,
            published,
            content,
          }),
        }
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Error ${r.status}`);
      }
      navigate('/admin/blog');
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="py-16 text-center text-sm text-white/35">Loading post…</p>;
  }

  return (
    <div>
      <PanelHeader
        title={isNew ? 'New Post' : 'Edit Post'}
        actions={
          <>
            <Link to="/admin/blog" className={BTN_SUBTLE}>
              Cancel
            </Link>
            <button onClick={handleSave} disabled={saving} className={BTN_PRIMARY}>
              {saving ? 'Saving…' : 'Save Post'}
            </button>
          </>
        }
      />

      <StatusNote status={status} />

      {/* Metadata */}
      <Card className="mb-4">
        <CardHeader title="Metadata" />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className={INPUT}
              placeholder="Post title"
            />
          </Field>

          <Field label={`Slug${!isNew ? ' (locked)' : ''}`}>
            <div className="flex gap-2">
              <input
                value={slug}
                onChange={(e) => {
                  if (!slugLocked) setSlug(e.target.value);
                }}
                readOnly={slugLocked}
                className={`${INPUT} flex-1 ${slugLocked ? 'cursor-not-allowed opacity-50' : ''}`}
                placeholder="post-slug"
              />
              {isNew && (
                <button
                  onClick={() => setSlugLocked((l) => !l)}
                  className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 text-[10px] text-white/50 hover:text-white/80"
                >
                  {slugLocked ? 'Unlock' : 'Lock'}
                </button>
              )}
            </div>
          </Field>

          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${INPUT} [color-scheme:dark]`}
            />
          </Field>

          <Field label="Tags (comma-separated)">
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className={INPUT}
              placeholder="houdini, vex, tutorial"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Description">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={INPUT}
                placeholder="Short description shown in the post list"
              />
            </Field>
          </div>

          <Field label="Cover image">
            <input
              value={cover}
              onChange={(e) => setCover(e.target.value)}
              className={`${INPUT} mb-2`}
              placeholder="filename.jpg"
            />
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

          <Field label="Status">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
                className="accent-[#0a84ff]"
              />
              <span className="text-xs text-white/70">Published</span>
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
        placeholder="Write your post in Markdown…"
      />
    </div>
  );
}

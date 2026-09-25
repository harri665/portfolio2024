import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeRaw from 'rehype-raw';

import { apiUrl, getApiBaseUrl } from '../../../utils/api';
import { remarkWikiLinks } from '../../Blog/plugins/remarkWikiLinks';
import { rehypeCallouts } from '../../Blog/plugins/rehypeCallouts';
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

  const contentRef = useRef(null);

  const [tab, setTab] = useState('write');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [images, setImages] = useState([]);
  const [imageUploading, setImageUploading] = useState(false);

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
    adminFetch('/admin/blog/images')
      .then((r) => (r.ok ? r.json() : []))
      .then(setImages)
      .catch(() => {});

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

  function insertAtCursor(text) {
    const ta = contentRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setContent(content.slice(0, start) + text + content.slice(end));
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + text.length;
      ta.focus();
    });
  }

  async function uploadImage(file) {
    const fd = new FormData();
    fd.append('image', file);
    const r = await adminFetch('/admin/blog/images', { method: 'POST', body: fd });
    if (!r.ok) throw new Error('Upload failed');
    const { filename } = await r.json();
    return filename;
  }

  async function handleLibraryUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageUploading(true);
    try {
      const filename = await uploadImage(file);
      setImages((prev) => [...new Set([...prev, filename])].sort());
      e.target.value = '';
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setImageUploading(false);
    }
  }

  async function handleCoverUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus('uploading…');
    try {
      const filename = await uploadImage(file);
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

      {/* Image library */}
      <Card className="mb-4">
        <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Images</p>
          <label
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-[10px] text-white/60 transition-colors hover:text-white ${
              imageUploading ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            {imageUploading ? 'uploading…' : '+ Upload'}
            <input type="file" accept="image/*" className="hidden" onChange={handleLibraryUpload} />
          </label>
        </div>

        {images.length === 0 ? (
          <p className="px-5 py-4 text-[10px] text-white/30">No images uploaded yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {images.map((img) => (
              <div
                key={img}
                className="overflow-hidden rounded-xl border border-white/10 bg-white/5"
              >
                <img
                  src={apiUrl(`/blog/images/${encodeURIComponent(img)}`)}
                  alt={img}
                  className="h-20 w-full object-cover"
                />
                <div className="p-1.5">
                  <p className="truncate font-mono text-[9px] text-white/40" title={img}>
                    {img}
                  </p>
                  <button
                    onClick={() => insertAtCursor(`![[${img}]]`)}
                    className="mt-1 w-full rounded bg-[#0a84ff]/12 px-2 py-0.5 text-[9px] text-[#0a84ff] transition-colors hover:bg-[#0a84ff]/20"
                  >
                    Insert
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Content */}
      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Content</p>
          <div className="flex gap-1">
            {['write', 'preview'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={[
                  'rounded-lg px-3 py-1 text-[10px] capitalize transition-colors',
                  tab === t ? 'bg-[#0a84ff]/15 text-[#0a84ff]' : 'text-white/40 hover:text-white/70',
                ].join(' ')}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {tab === 'write' ? (
          <textarea
            ref={contentRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full resize-none bg-[#0d0f14] px-5 py-4 font-mono text-sm text-[#c8ccd4] outline-none"
            style={{ minHeight: '520px' }}
            placeholder="Write your post in Markdown…"
            spellCheck={false}
          />
        ) : (
          <div className="blog-prose px-5 py-6 sm:px-8" style={{ minHeight: '520px' }}>
            {content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm, [remarkWikiLinks, { apiBase: getApiBaseUrl() }]]}
                rehypePlugins={[rehypeCallouts, rehypeSlug, rehypeHighlight, rehypeRaw]}
              >
                {content}
              </ReactMarkdown>
            ) : (
              <p className="text-xs text-white/30">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

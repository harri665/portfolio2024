import React, { useState, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeRaw from 'rehype-raw';
import SubdomainNav from '../../Homepage/SubdomainNav';
import { SITE_MODES } from '../../../utils/siteMode';
import { apiUrl, getApiBaseUrl } from '../../../utils/api';
import { remarkWikiLinks } from '../plugins/remarkWikiLinks';
import { rehypeCallouts } from '../plugins/rehypeCallouts';

const STORAGE_KEY = 'blog_admin_key';

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const INPUT_CLS =
  'w-full rounded border border-[#3a3d45] bg-[#252830] px-3 py-2 font-mono text-sm text-[#d0d4dc] outline-none focus:border-[#e07b39]/50 transition-colors';

export default function BlogPostEditor() {
  const { slug: editSlug } = useParams();
  const navigate = useNavigate();
  const isNew = !editSlug;

  const adminKey = sessionStorage.getItem(STORAGE_KEY) || '';

  const contentRef = useRef(null);

  const [tab, setTab] = useState('write');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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
    if (!adminKey) { navigate('/blog-admin'); return; }
    fetch(apiUrl('/admin/blog/images'), { headers: { 'x-admin-key': adminKey } })
      .then((r) => r.ok ? r.json() : [])
      .then(setImages)
      .catch(() => {});
    if (!isNew) {
      fetch(apiUrl(`/admin/blog/posts/${editSlug}`), {
        headers: { 'x-admin-key': adminKey },
      })
        .then((r) => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json(); })
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
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [editSlug, isNew, adminKey, navigate]);

  function insertAtCursor(text) {
    const ta = contentRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = content.slice(0, start) + text + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + text.length;
      ta.focus();
    });
  }

  async function handleLibraryUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageUploading(true);
    const fd = new FormData();
    fd.append('image', file);
    try {
      const r = await fetch(apiUrl('/admin/blog/images'), {
        method: 'POST',
        headers: { 'x-admin-key': adminKey },
        body: fd,
      });
      if (!r.ok) throw new Error('Upload failed');
      const { filename } = await r.json();
      setImages((prev) => [...new Set([...prev, filename])].sort());
      e.target.value = '';
    } catch {}
    setImageUploading(false);
  }

  function handleTitleChange(v) {
    setTitle(v);
    if (isNew && !slugLocked) setSlug(slugify(v));
  }

  async function handleSave() {
    if (!title.trim()) { setError('Title is required.'); return; }
    if (!slug.trim() || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
      setError('Slug must only contain letters, numbers, hyphens, and underscores.');
      return;
    }
    setSaving(true);
    setError('');
    const body = JSON.stringify({
      slug,
      title,
      date,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      description,
      cover: cover || undefined,
      published,
      content,
    });
    try {
      const url = isNew ? apiUrl('/admin/blog/posts') : apiUrl(`/admin/blog/posts/${slug}`);
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
        body,
      });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error || `Error ${r.status}`);
      }
      navigate('/blog-admin');
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus('uploading…');
    const fd = new FormData();
    fd.append('image', file);
    try {
      const r = await fetch(apiUrl('/admin/blog/images'), {
        method: 'POST',
        headers: { 'x-admin-key': adminKey },
        body: fd,
      });
      if (!r.ok) throw new Error('Upload failed');
      const { filename } = await r.json();
      setCover(filename);
      setUploadStatus(`✓ ${filename}`);
    } catch (e) {
      setUploadStatus(`error: ${e.message}`);
    }
  }

  if (!adminKey) return null;

  if (loading) {
    return (
      <div className="houdini-canvas min-h-screen text-white">
        <SubdomainNav currentMode={SITE_MODES.BLOG} />
        <div className="flex min-h-screen items-center justify-center font-mono text-xs text-[#5a6070]">
          loading…
        </div>
      </div>
    );
  }

  return (
    <div className="houdini-canvas min-h-screen text-white">
      <SubdomainNav currentMode={SITE_MODES.BLOG} />
      <main className="mx-auto max-w-5xl px-4 pb-20 pt-24 sm:px-8">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#e07b39]/70">/ admin</p>
            <h1 className="mt-1 font-mono text-2xl font-bold text-[#d0d4dc]">
              {isNew ? 'New Post' : 'Edit Post'}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/blog-admin"
              className="font-mono text-xs text-[#5a6070] transition-colors hover:text-[#9099a8]"
            >
              ← Cancel
            </Link>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded border border-[#e07b39]/40 bg-[#e07b39]/10 px-4 py-2 font-mono text-xs font-semibold text-[#e07b39] transition-colors hover:bg-[#e07b39]/20 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Post'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-800/40 bg-red-900/10 px-4 py-2.5 font-mono text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Metadata panel */}
        <div className="mb-4 overflow-hidden rounded-lg border border-[#2e3240] bg-[#1e2128]">
          <div className="flex items-center gap-2 border-b border-[#2e3240] bg-[#252830] px-5 py-2.5">
            <div className="h-1.5 w-1.5 rounded-full bg-[#e07b39]" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-[#4a5060]">metadata</span>
          </div>
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <Field label="Title">
              <input
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                className={INPUT_CLS}
                placeholder="Post title"
              />
            </Field>

            <Field label={`Slug${!isNew ? ' (locked)' : ''}`}>
              <div className="flex gap-2">
                <input
                  value={slug}
                  onChange={(e) => { if (!slugLocked) setSlug(e.target.value); }}
                  readOnly={slugLocked}
                  className={`${INPUT_CLS} flex-1 ${slugLocked ? 'cursor-not-allowed opacity-50' : ''}`}
                  placeholder="post-slug"
                />
                {isNew && (
                  <button
                    onClick={() => setSlugLocked((l) => !l)}
                    className="rounded border border-[#3a3d45] bg-[#252830] px-2.5 font-mono text-[10px] text-[#5a6070] hover:text-[#9099a8]"
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
                className={INPUT_CLS}
              />
            </Field>

            <Field label="Tags (comma-separated)">
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className={INPUT_CLS}
                placeholder="houdini, vex, tutorial"
              />
            </Field>

            <Field label="Description" className="sm:col-span-2">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={INPUT_CLS}
                placeholder="Short description shown in post list"
              />
            </Field>

            <Field label="Cover image">
              <input
                value={cover}
                onChange={(e) => setCover(e.target.value)}
                className={`${INPUT_CLS} mb-2`}
                placeholder="filename.jpg"
              />
              <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-[#3a3d45] bg-[#252830] px-3 py-1.5 font-mono text-[10px] text-[#9099a8] transition-colors hover:text-white">
                Upload image
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
              {uploadStatus && (
                <span className={`ml-3 font-mono text-[10px] ${uploadStatus.startsWith('error') ? 'text-red-400' : 'text-emerald-400'}`}>
                  {uploadStatus}
                </span>
              )}
            </Field>

            <Field label="Status">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={published}
                  onChange={(e) => setPublished(e.target.checked)}
                  className="accent-[#e07b39]"
                />
                <span className="font-mono text-xs text-[#9099a8]">Published</span>
              </label>
            </Field>
          </div>
        </div>

        {/* Image library panel */}
        <div className="mb-4 overflow-hidden rounded-lg border border-[#2e3240] bg-[#1e2128]">
          <div className="flex items-center justify-between border-b border-[#2e3240] bg-[#252830] px-5 py-2.5">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-[#3a3d45]" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#4a5060]">images</span>
            </div>
            <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded border border-[#3a3d45] bg-[#252830] px-3 py-1 font-mono text-[10px] text-[#9099a8] transition-colors hover:text-white ${imageUploading ? 'opacity-50 pointer-events-none' : ''}`}>
              {imageUploading ? 'uploading…' : '+ Upload'}
              <input type="file" accept="image/*" className="hidden" onChange={handleLibraryUpload} />
            </label>
          </div>
          {images.length === 0 ? (
            <p className="px-5 py-4 font-mono text-[10px] text-[#4a5060]">No images uploaded yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {images.map((img) => (
                <div key={img} className="group relative overflow-hidden rounded border border-[#2e3240] bg-[#252830]">
                  <img
                    src={apiUrl(`/blog/images/${encodeURIComponent(img)}`)}
                    alt={img}
                    className="h-20 w-full object-cover"
                  />
                  <div className="p-1.5">
                    <p className="truncate font-mono text-[9px] text-[#5a6070]" title={img}>{img}</p>
                    <button
                      onClick={() => insertAtCursor(`![[${img}]]`)}
                      className="mt-1 w-full rounded bg-[#e07b39]/10 px-2 py-0.5 font-mono text-[9px] text-[#e07b39] transition-colors hover:bg-[#e07b39]/20"
                    >
                      Insert
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Content panel */}
        <div className="overflow-hidden rounded-lg border border-[#2e3240] bg-[#1e2128]">
          <div className="flex items-center justify-between border-b border-[#2e3240] bg-[#252830] px-5 py-2.5">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-[#3a3d45]" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#4a5060]">content</span>
            </div>
            <div className="flex gap-1">
              {['write', 'preview'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={[
                    'rounded px-3 py-1 font-mono text-[10px] capitalize transition-colors',
                    tab === t
                      ? 'bg-[#e07b39]/15 text-[#e07b39]'
                      : 'text-[#5a6070] hover:text-[#9099a8]',
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
              className="w-full resize-none bg-[#16181e] px-5 py-4 font-mono text-sm text-[#c8ccd4] outline-none"
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
                <p className="font-mono text-xs text-[#4a5060]">Nothing to preview yet.</p>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-[#5a6070]">
        {label}
      </label>
      {children}
    </div>
  );
}

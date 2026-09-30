import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import rehypeRaw from 'rehype-raw';
import 'katex/dist/katex.min.css';

import { apiUrl, getApiBaseUrl } from '../../../utils/api';
import { remarkWikiLinks } from '../../Blog/plugins/remarkWikiLinks';
import { rehypeCallouts } from '../../Blog/plugins/rehypeCallouts';
import { Card } from './ui';

// The pieces the blog and project-page editors share: one image library
// (served from /blog/images) and a markdown pane that previews the way the
// published pages render.

export async function uploadImage(adminFetch, file) {
  const fd = new FormData();
  fd.append('image', file);
  const r = await adminFetch('/admin/blog/images', { method: 'POST', body: fd });
  if (!r.ok) throw new Error('Upload failed');
  const { filename } = await r.json();
  return filename;
}

export function ImageLibrary({ adminFetch, onInsert, onError }) {
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    adminFetch('/admin/blog/images')
      .then((r) => (r.ok ? r.json() : []))
      .then(setImages)
      .catch(() => {});
  }, [adminFetch]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const filename = await uploadImage(adminFetch, file);
      setImages((prev) => [...new Set([...prev, filename])].sort());
      e.target.value = '';
    } catch (err) {
      onError?.(err);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Images</p>
        <label
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-[10px] text-white/60 transition-colors hover:text-white ${
            uploading ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          {uploading ? 'uploading…' : '+ Upload'}
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </label>
      </div>

      {images.length === 0 ? (
        <p className="px-5 py-4 text-[10px] text-white/30">No images uploaded yet.</p>
      ) : (
        <div className="grid max-h-80 grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {images.map((img) => (
            <div key={img} className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
              <img
                src={apiUrl(`/blog/images/${encodeURIComponent(img)}`)}
                alt={img}
                loading="lazy"
                className="h-20 w-full object-cover"
              />
              <div className="p-1.5">
                <p className="truncate font-mono text-[9px] text-white/40" title={img}>
                  {img}
                </p>
                <button
                  onClick={() => onInsert(`![[${img}]]`)}
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
  );
}

// A write/preview pane. The ref's insert(text) puts text at the cursor, for
// the image library's Insert buttons.
export const MarkdownEditor = forwardRef(function MarkdownEditor(
  { value, onChange, placeholder },
  ref
) {
  const textareaRef = useRef(null);
  const [tab, setTab] = useState('write');

  useImperativeHandle(ref, () => ({
    insert(text) {
      const ta = textareaRef.current;
      if (!ta) {
        onChange(value + text);
        return;
      }
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      onChange(value.slice(0, start) + text + value.slice(end));
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + text.length;
        ta.focus();
      });
    },
  }));

  return (
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
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full resize-none bg-[#0d0f14] px-5 py-4 font-mono text-sm text-[#c8ccd4] outline-none"
          style={{ minHeight: '520px' }}
          placeholder={placeholder}
          spellCheck={false}
        />
      ) : (
        <div className="prose-doc prose-reading px-5 py-6 sm:px-8" style={{ minHeight: '520px' }}>
          {value ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath, [remarkWikiLinks, { apiBase: getApiBaseUrl() }]]}
              rehypePlugins={[rehypeCallouts, rehypeSlug, rehypeKatex, rehypeHighlight, rehypeRaw]}
            >
              {value}
            </ReactMarkdown>
          ) : (
            <p className="text-xs text-white/30">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </Card>
  );
});

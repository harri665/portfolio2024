import React, { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../../utils/api';

const STORAGE_KEY = 'pages_admin_key';
const SLUG_RE = /^[a-zA-Z0-9_-]+$/;

export default function PagesAdmin() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(STORAGE_KEY) || '');
  const [authed, setAuthed] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [authError, setAuthError] = useState('');

  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Editor state
  const [editing, setEditing] = useState(null); // { slug, content, isNew }
  const [saveStatus, setSaveStatus] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchPages = useCallback(async (key) => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(apiUrl('/admin/pages'), { headers: { 'x-admin-key': key } });
      if (r.status === 401) { setAuthed(false); sessionStorage.removeItem(STORAGE_KEY); return; }
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setPages(await r.json());
      setAuthed(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (adminKey) fetchPages(adminKey); }, [adminKey, fetchPages]);

  async function handleAuth(e) {
    e.preventDefault();
    setAuthError('');
    try {
      const r = await fetch(apiUrl('/admin/auth'), { method: 'POST', headers: { 'x-admin-key': keyInput } });
      if (r.ok) { sessionStorage.setItem(STORAGE_KEY, keyInput); setAdminKey(keyInput); }
      else setAuthError('Invalid key.');
    } catch { setAuthError('Could not connect to server.'); }
  }

  async function openPage(slug) {
    const r = await fetch(apiUrl(`/admin/pages/${slug}`), { headers: { 'x-admin-key': adminKey } });
    if (!r.ok) { setError('Failed to load page'); return; }
    const { content } = await r.json();
    setEditing({ slug, content, isNew: false });
    setSaveStatus('');
  }

  function newPage() {
    setEditing({ slug: '', content: defaultTemplate(), isNew: true });
    setSaveStatus('');
  }

  async function savePage() {
    if (!editing) return;
    const { slug, content, isNew } = editing;
    if (!SLUG_RE.test(slug)) { setSaveStatus('Slug must be letters, numbers, hyphens or underscores only.'); return; }
    setSaveStatus('Saving...');
    try {
      const r = await fetch(apiUrl(`/admin/pages/${slug}`), {
        method: 'PUT',
        headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setSaveStatus('Saved.');
      if (isNew) { await fetchPages(adminKey); setEditing(prev => ({ ...prev, isNew: false })); }
    } catch (e) {
      setSaveStatus(`Save failed: ${e.message}`);
    }
  }

  async function deletePage(slug) {
    await fetch(apiUrl(`/admin/pages/${slug}`), { method: 'DELETE', headers: { 'x-admin-key': adminKey } });
    setDeleteConfirm(null);
    if (editing?.slug === slug) setEditing(null);
    fetchPages(adminKey);
  }

  if (!authed) {
    return (
      <div style={styles.center}>
        <form onSubmit={handleAuth} style={styles.authForm}>
          <h2>Pages Admin</h2>
          <input
            type="password"
            placeholder="Admin key"
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            style={styles.input}
          />
          <button type="submit" style={styles.btn}>Login</button>
          {authError && <p style={styles.error}>{authError}</p>}
        </form>
      </div>
    );
  }

  if (editing) {
    return (
      <div style={styles.editorWrap}>
        <div style={styles.editorToolbar}>
          <button onClick={() => setEditing(null)} style={styles.btnSmall}>← Back</button>
          {editing.isNew ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>/p/</span>
              <input
                value={editing.slug}
                onChange={e => setEditing(prev => ({ ...prev, slug: e.target.value }))}
                placeholder="page-slug"
                style={{ ...styles.input, width: 200, margin: 0 }}
              />
            </span>
          ) : (
            <span>
              /p/<strong>{editing.slug}</strong>{' '}
              <a href={`/p/${editing.slug}`} target="_blank" rel="noreferrer" style={styles.link}>[preview]</a>
            </span>
          )}
          <button onClick={savePage} style={styles.btnPrimary}>Save</button>
          {!editing.isNew && (
            <button onClick={() => setDeleteConfirm(editing.slug)} style={styles.btnDanger}>Delete</button>
          )}
          {saveStatus && <span style={styles.status}>{saveStatus}</span>}
        </div>
        <textarea
          value={editing.content}
          onChange={e => setEditing(prev => ({ ...prev, content: e.target.value }))}
          style={styles.editor}
          spellCheck={false}
        />
        {deleteConfirm && (
          <div style={styles.overlay}>
            <div style={styles.dialog}>
              <p>Delete <strong>/p/{deleteConfirm}</strong>?</p>
              <button onClick={() => deletePage(deleteConfirm)} style={styles.btnDanger}>Delete</button>
              <button onClick={() => setDeleteConfirm(null)} style={styles.btnSmall}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <h2 style={{ margin: 0 }}>Static Pages</h2>
        <button onClick={newPage} style={styles.btnPrimary}>+ New Page</button>
      </div>
      {loading && <p>Loading...</p>}
      {error && <p style={styles.error}>{error}</p>}
      {!loading && pages.length === 0 && <p style={{ color: '#888' }}>No pages yet.</p>}
      <ul style={styles.list}>
        {pages.map(({ slug }) => (
          <li key={slug} style={styles.listItem}>
            <button onClick={() => openPage(slug)} style={styles.pageBtn}>/p/{slug}</button>
            <span style={{ display: 'flex', gap: 8 }}>
              <a href={`/p/${slug}`} target="_blank" rel="noreferrer" style={styles.link}>Preview</a>
              <button onClick={() => setDeleteConfirm(slug)} style={styles.btnDanger}>Delete</button>
            </span>
            {deleteConfirm === slug && (
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={styles.error}>Confirm delete?</span>
                <button onClick={() => deletePage(slug)} style={styles.btnDanger}>Yes</button>
                <button onClick={() => setDeleteConfirm(null)} style={styles.btnSmall}>No</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  <script>
    console.log('Page loaded');
  </script>
</body>
</html>`;
}

const styles = {
  center: { display: 'flex', justifyContent: 'center', paddingTop: '4rem' },
  authForm: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 260 },
  wrap: { maxWidth: 700, margin: '2rem auto', padding: '0 1rem' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  list: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  listItem: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 },
  pageBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#0066cc', flexGrow: 1, textAlign: 'left' },
  editorWrap: { display: 'flex', flexDirection: 'column', height: '100vh' },
  editorToolbar: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderBottom: '1px solid #ddd', flexWrap: 'wrap' },
  editor: { flex: 1, fontFamily: 'monospace', fontSize: 13, padding: 12, border: 'none', outline: 'none', resize: 'none' },
  input: { padding: '6px 10px', borderRadius: 4, border: '1px solid #ccc', fontSize: 14 },
  btn: { padding: '6px 14px', borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer', fontSize: 14 },
  btnSmall: { padding: '4px 10px', borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer', fontSize: 13 },
  btnPrimary: { padding: '6px 14px', borderRadius: 4, border: 'none', background: '#0066cc', color: '#fff', cursor: 'pointer', fontSize: 14 },
  btnDanger: { padding: '4px 10px', borderRadius: 4, border: 'none', background: '#cc2200', color: '#fff', cursor: 'pointer', fontSize: 13 },
  error: { color: '#cc2200', margin: 0 },
  status: { color: '#666', fontSize: 13 },
  link: { color: '#0066cc', fontSize: 13 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  dialog: { background: '#fff', padding: 24, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12 },
};

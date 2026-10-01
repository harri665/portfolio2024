// project write-ups, one markdown file per repo in projects/. shown instead of the readme
// when there is one. privateRepo pages stand in for repos visitors can't open

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const REPO_NAME = /^[A-Za-z0-9._-]+$/;
const VIDEO_EXT = /\.(mp4|webm|mov)(?:[?#]|$)/i;

export function isProjectPageName(name) {
  return REPO_NAME.test(String(name || '')) && !String(name).startsWith('.');
}

function list(value) {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function normalizeMeta(data, repo) {
  return {
    repo,
    title: data.title || '',
    tagline: data.tagline || '',
    role: data.role || '',
    timeline: data.timeline || '',
    stack: list(data.stack),
    live: data.live || '',
    blog: data.blog || '',
    cover: data.cover || '',
    video: data.video || '',
    published: data.published !== false,
    privateRepo: data.privateRepo === true,
  };
}

export function projectPageMedia(meta) {
  const url = meta?.cover || meta?.video;
  if (!url) return null;
  return { url, type: !meta.cover || VIDEO_EXT.test(url) ? 'video' : 'image' };
}

export function createProjectPages(dir) {
  // repo names don't always match the file's case
  function fileFor(repo) {
    if (!isProjectPageName(repo) || !fs.existsSync(dir)) return null;
    const wanted = `${repo}.md`.toLowerCase();
    const found = fs.readdirSync(dir).find((f) => f.toLowerCase() === wanted);
    return found ? path.join(dir, found) : null;
  }

  function read(repo, { includeDrafts = false } = {}) {
    const file = fileFor(repo);
    if (!file) return null;
    const { data, content } = matter(fs.readFileSync(file, 'utf-8'));
    const meta = normalizeMeta(data, path.basename(file, '.md'));
    if (!meta.published && !includeDrafts) return null;
    return { meta, content };
  }

  function listAll() {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => read(path.basename(f, '.md'), { includeDrafts: true })?.meta)
      .filter(Boolean)
      .sort((a, b) => a.repo.localeCompare(b.repo));
  }

  function write(repo, fields, content) {
    if (!isProjectPageName(repo)) throw new Error('Invalid repository name');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const meta = normalizeMeta(fields, repo);
    // only write fields that are set so the files stay readable. published always goes in, missing = true
    const frontmatter = Object.fromEntries(
      Object.entries(meta).filter(([key, value]) => {
        if (key === 'repo') return false;
        if (Array.isArray(value)) return value.length > 0;
        return value !== '' && (value !== false || key === 'published');
      })
    );
    const file = fileFor(repo) || path.join(dir, `${repo}.md`);
    fs.writeFileSync(file, matter.stringify(content || '', frontmatter), 'utf-8');
    return meta;
  }

  function remove(repo) {
    const file = fileFor(repo);
    if (!file) return false;
    fs.unlinkSync(file);
    return true;
  }

  return { read, listAll, write, remove };
}

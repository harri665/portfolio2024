// title + preview media from a readme, in one place so the cards, project page and og tags agree

const LEADING_H1 = /^\s*#\s+(.+?)\s*#*\s*$/;
const VIDEO_EXT = /\.(mp4|webm|mov)(?:[?#]|$)/i;

function plainText(markdown) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')       // images and badges
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // links keep their text
    .replace(/<[^>]+>/g, '')                    // inline HTML
    .replace(/[*_`]/g, '')
    .trim();
}

export function readmeTitle(markdown) {
  if (!markdown) return null;
  const firstLine = markdown.trimStart().split('\n', 1)[0];
  const match = firstLine.match(LEADING_H1);
  const text = match ? plainText(match[1]) : '';
  return text && text.length <= 60 ? text : null;
}

// HEAD = default branch
function resolveRepoUrl(src, fullName) {
  if (/^https?:\/\//i.test(src)) {
    return src.replace(
      /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//,
      'https://raw.githubusercontent.com/$1/'
    );
  }
  return `https://raw.githubusercontent.com/${fullName}/HEAD/${src.replace(/^\.?\//, '')}`;
}

export function readmeMedia(markdown, fullName) {
  if (!markdown) return null;

  const src =
    markdown.match(/!\[[^\]]*\]\(([^)\s]+)/)?.[1] ||
    markdown.match(/<video[^>]+src=["']([^"']+)["']/i)?.[1] ||
    markdown.match(/<source[^>]+src=["']([^"']+\.mp4[^"']*)["']/i)?.[1] ||
    markdown.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ||
    markdown.match(/<img[^>]+src=([^\s>]+)/i)?.[1];

  if (!src) return null;
  const url = resolveRepoUrl(src, fullName);
  return { url, type: VIDEO_EXT.test(url) ? 'video' : 'image' };
}

export function prettyRepoName(name) {
  return String(name || '').replace(/[-_]+/g, ' ').trim();
}

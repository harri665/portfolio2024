// What a CS page needs from a README besides its text: the title written for
// people ("# OpenGL Star Simulation" rather than the repo's
// "OpenGL-Star-Simulation") and the first image or video to preview it with.
// Worked out here once, so the cards, the project page and the link previews
// all agree.

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

// The README's first line, when it is a level-one heading short enough to be a
// title rather than a tagline
export function readmeTitle(markdown) {
  if (!markdown) return null;
  const firstLine = markdown.trimStart().split('\n', 1)[0];
  const match = firstLine.match(LEADING_H1);
  const text = match ? plainText(match[1]) : '';
  return text && text.length <= 60 ? text : null;
}

// README paths are relative to the repo root; HEAD is its default branch
function resolveRepoUrl(src, fullName) {
  if (/^https?:\/\//i.test(src)) {
    return src.replace(
      /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//,
      'https://raw.githubusercontent.com/$1/'
    );
  }
  return `https://raw.githubusercontent.com/${fullName}/HEAD/${src.replace(/^\.?\//, '')}`;
}

// The first image or video in the README, as { url, type }
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

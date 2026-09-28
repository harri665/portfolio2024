// Repos are named for git ("OpenGL-Star-Simulation"); their READMEs usually
// open with the name written for people. The server works that title out
// (server/repoMeta.js); these are the pieces the pages still need themselves.

const LEADING_H1 = /^\s*#\s+.+$/;

export function prettyRepoName(name) {
  return String(name || '').replace(/[-_]+/g, ' ').trim();
}

// The README without its opening heading, for a page that already shows that
// heading as its title
export function withoutLeadingHeading(markdown) {
  const trimmed = String(markdown || '').trimStart();
  const firstLine = trimmed.split('\n', 1)[0];
  return LEADING_H1.test(firstLine) ? trimmed.slice(firstLine.length).replace(/^\r?\n/, '') : markdown;
}

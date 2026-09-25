// Remembers the name someone comments under.
//
// blog/cs/art are separate subdomains, so localStorage alone would make people
// retype their name on each one. A cookie set on the registrable parent domain
// is shared across all of them; localStorage is the fallback for localhost and
// for browsers that refuse the cookie.

const COOKIE_NAME = 'commenter_name';
const STORAGE_KEY = 'comment_author_name';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

// harrison-martin.com from blog.harrison-martin.com; null for localhost and
// bare hostnames, where a domain-scoped cookie isn't meaningful.
function parentDomain() {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  if (/^[\d.]+$/.test(host) || host.endsWith('localhost') || !host.includes('.')) {
    return null;
  }
  return host.split('.').slice(-2).join('.');
}

function readCookie() {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`)
  );
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

export function getCommenterName() {
  const fromCookie = readCookie();
  if (fromCookie) return fromCookie;
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setCommenterName(name) {
  const value = (name || '').trim();
  if (!value) return;

  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* private browsing — the cookie below may still work */
  }

  if (typeof document === 'undefined') return;
  const domain = parentDomain();
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'path=/',
    `max-age=${ONE_YEAR_SECONDS}`,
    'SameSite=Lax',
  ];
  if (domain) parts.push(`domain=.${domain}`);
  if (window.location.protocol === 'https:') parts.push('Secure');

  try {
    document.cookie = parts.join('; ');
  } catch {
    /* localStorage above already covers this origin */
  }
}

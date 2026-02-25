export const SITE_MODES = {
  ROOT: 'root',
  CS: 'cs',
  ART: 'art',
};

const SITE_MODE_VALUES = new Set(Object.values(SITE_MODES));

function normalizeMode(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function normalizeHostname(hostname) {
  return (hostname || '').toLowerCase();
}

function getLocalhostSubdomain(hostname) {
  const normalized = normalizeHostname(hostname);

  if (!normalized.endsWith('.localhost')) {
    return '';
  }

  return normalized.split('.')[0];
}

export function detectSiteMode() {
  if (typeof window === 'undefined') {
    return SITE_MODES.ROOT;
  }

  const params = new URLSearchParams(window.location.search);
  const override = normalizeMode(params.get('site'));

  if (SITE_MODE_VALUES.has(override)) {
    return override;
  }

  const hostname = normalizeHostname(window.location.hostname);
  const localhostSubdomain = getLocalhostSubdomain(hostname);

  if (localhostSubdomain === 'cs') {
    return SITE_MODES.CS;
  }

  if (localhostSubdomain === 'art' || localhostSubdomain === 'artstation') {
    return SITE_MODES.ART;
  }

  if (hostname.startsWith('cs.')) {
    return SITE_MODES.CS;
  }

  if (hostname.startsWith('art.') || hostname.startsWith('artstation.')) {
    return SITE_MODES.ART;
  }

  return SITE_MODES.ROOT;
}

export function getSiteHref(mode) {
  if (typeof window === 'undefined') {
    return '/';
  }

  const normalizedMode = SITE_MODE_VALUES.has(normalizeMode(mode))
    ? normalizeMode(mode)
    : SITE_MODES.ROOT;

  const hostname = normalizeHostname(window.location.hostname);
  const isLocalhost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.localhost');

  if (isLocalhost) {
    const origin = window.location.origin;

    if (normalizedMode === SITE_MODES.ROOT) {
      return origin;
    }

    return `${origin}/?site=${normalizedMode}`;
  }

  const productionHosts = {
    [SITE_MODES.ROOT]: 'https://harrison-martin.com',
    [SITE_MODES.CS]: 'https://cs.harrison-martin.com',
    [SITE_MODES.ART]: 'https://art.harrison-martin.com',
  };

  return productionHosts[normalizedMode] || productionHosts[SITE_MODES.ROOT];
}

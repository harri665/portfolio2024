const DEFAULT_PROD_API_BASE = 'https://art.harrison-martin.com/api';
const DEFAULT_DEV_API_BASE = 'http://localhost:3005/api';

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

export function getApiBaseUrl() {
  const envBaseUrl = process.env.REACT_APP_API_BASE_URL;

  if (envBaseUrl) {
    return stripTrailingSlash(envBaseUrl);
  }

  if (process.env.NODE_ENV === 'development') {
    return DEFAULT_DEV_API_BASE;
  }

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname.toLowerCase();
    const isArtHost =
      hostname.startsWith('art.') ||
      hostname.startsWith('artstation.');

    if (isArtHost) {
      return `${window.location.protocol}//${window.location.host}/api`;
    }
  }

  return DEFAULT_PROD_API_BASE;
}

export function apiUrl(pathname = '') {
  const base = getApiBaseUrl();

  if (!pathname) {
    return base;
  }

  return pathname.startsWith('/') ? `${base}${pathname}` : `${base}/${pathname}`;
}

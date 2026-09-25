import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../../utils/api';

const STORAGE_KEY = 'admin_key';

// Each admin page used to keep its own key under its own name. Carry those
// over once so the unified panel doesn't ask for the key again.
const LEGACY_KEYS = ['blog_admin_key', 'art_admin_key', 'pages_admin_key'];

function readStoredKey() {
  try {
    const current = sessionStorage.getItem(STORAGE_KEY);
    if (current) return current;

    for (const legacy of LEGACY_KEYS) {
      const value = sessionStorage.getItem(legacy);
      if (value) {
        sessionStorage.setItem(STORAGE_KEY, value);
        LEGACY_KEYS.forEach((k) => sessionStorage.removeItem(k));
        return value;
      }
    }
  } catch {
    /* sessionStorage unavailable — the login form still works */
  }
  return '';
}

export function useAdminAuth() {
  const [adminKey, setAdminKey] = useState(readStoredKey);
  // null while we haven't checked a stored key yet
  const [authed, setAuthed] = useState(null);

  useEffect(() => {
    if (!adminKey) {
      setAuthed(false);
      return undefined;
    }

    let cancelled = false;
    fetch(apiUrl('/admin/auth'), {
      method: 'POST',
      headers: { 'x-admin-key': adminKey },
    })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) {
          setAuthed(true);
        } else {
          try {
            sessionStorage.removeItem(STORAGE_KEY);
          } catch {
            /* nothing to clear */
          }
          setAdminKey('');
          setAuthed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setAuthed(false);
      });

    return () => {
      cancelled = true;
    };
  }, [adminKey]);

  const login = useCallback(async (key) => {
    const r = await fetch(apiUrl('/admin/auth'), {
      method: 'POST',
      headers: { 'x-admin-key': key },
    });
    if (!r.ok) return false;
    try {
      sessionStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* key stays in memory for this tab */
    }
    setAdminKey(key);
    return true;
  }, []);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      LEGACY_KEYS.forEach((k) => sessionStorage.removeItem(k));
    } catch {
      /* nothing to clear */
    }
    setAdminKey('');
    setAuthed(false);
  }, []);

  return { adminKey, authed, login, logout };
}

// Every panel talks to the API through this, so a revoked key logs the whole
// panel out instead of leaving one section silently broken.
export function createAdminFetch(adminKey, onUnauthorized) {
  return async function adminFetch(pathname, options = {}) {
    const headers = { ...(options.headers || {}), 'x-admin-key': adminKey };
    const r = await fetch(apiUrl(pathname), { ...options, headers });
    if (r.status === 401) {
      onUnauthorized?.();
      throw new Error('Session expired — please log in again.');
    }
    return r;
  };
}

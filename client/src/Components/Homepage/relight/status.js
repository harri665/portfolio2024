import { useSyncExternalStore } from 'react';

// What the relit room is running on, for the page to show (RelightStatus).
// The backdrop lives inside the three.js canvas, far from the page's own
// components, so it publishes here and they subscribe.
//
// phase: 'idle' (not mounted), 'loading', 'running' or 'failed', with the
// rest of the fields set by RelightBackdrop while running.

let snapshot = { phase: 'idle' };
let key = JSON.stringify(snapshot);
const listeners = new Set();

export function setRelightStatus(next) {
  const nextKey = JSON.stringify(next);
  if (nextKey === key) {
    return;
  }
  snapshot = next;
  key = nextKey;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => snapshot;

export function useRelightStatus() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

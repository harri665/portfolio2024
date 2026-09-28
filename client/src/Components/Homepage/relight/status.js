import { useSyncExternalStore } from 'react';

// the backdrop lives inside the three.js canvas, so it publishes here and the page subscribes

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

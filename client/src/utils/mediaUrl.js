import { apiUrl } from './api';

// Project pages name their pictures the way blog posts do: a filename in the
// blog's image library, or a full URL for media hosted elsewhere
export function mediaUrl(value) {
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : apiUrl(`/blog/images/${encodeURIComponent(value)}`);
}

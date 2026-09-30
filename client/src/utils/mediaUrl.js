import { apiUrl } from './api';

// filename in the blog image library or a full url
export function mediaUrl(value) {
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : apiUrl(`/blog/images/${encodeURIComponent(value)}`);
}

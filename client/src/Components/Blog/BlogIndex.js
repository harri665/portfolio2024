import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../utils/api';
import SubdomainNav from '../Homepage/SubdomainNav';
import { SITE_MODES } from '../../utils/siteMode';
import Container from '../ui/Container';
import SectionIntro from '../ui/SectionIntro';
import Tag from '../ui/Tag';
import BlogCard from './BlogCard';
import { NetworkPath, nodeColor } from './network';

export default function BlogIndex() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTag, setActiveTag] = useState(null);

  useEffect(() => {
    fetch(apiUrl('/blog/posts'))
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load posts (${r.status})`);
        return r.json();
      })
      .then(setPosts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const allTags = [...new Set(posts.flatMap((p) => p.tags))].sort();
  const visiblePosts = activeTag
    ? posts.filter((p) => p.tags.includes(activeTag))
    : posts;

  return (
    <div className="network-grid relative min-h-screen text-ink">
      <SubdomainNav currentMode={SITE_MODES.BLOG} />
      <SectionIntro title="Blog" />

      <Container as="main" className="pb-24">
        <NetworkPath>
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag">
              <Tag as="button" type="button" active={activeTag === null} onClick={() => setActiveTag(null)}>
                All
              </Tag>
              {allTags.map((tag) => (
                <Tag
                  key={tag}
                  as="button"
                  type="button"
                  active={activeTag === tag}
                  onClick={() => setActiveTag(tag === activeTag ? null : tag)}
                  className="gap-1.5"
                >
                  {/* chips double as a legend for the node colours */}
                  <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: nodeColor(tag) }} />
                  {tag}
                </Tag>
              ))}
            </div>
          )}
        </NetworkPath>

        {loading && <p className="py-10 text-sm text-ink-3">Loading posts…</p>}
        {error && <p className="py-10 text-sm text-red-300">{error}</p>}

        {!loading && !error && visiblePosts.length === 0 && (
          <p className="py-10 text-sm text-ink-3">
            {activeTag ? `No posts tagged “${activeTag}” yet.` : 'No posts yet.'}
          </p>
        )}

        {!loading && !error && visiblePosts.length > 0 && (
          <ol className="mt-10 grid grid-cols-1 gap-8 px-2 md:grid-cols-2 xl:grid-cols-3">
            {visiblePosts.map((post) => (
              <li key={post.slug}>
                <BlogCard post={post} />
              </li>
            ))}
          </ol>
        )}
      </Container>
    </div>
  );
}

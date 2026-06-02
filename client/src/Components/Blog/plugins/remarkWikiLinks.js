import { visit } from 'unist-util-visit';

// obsidian [[slug]], [[slug|label]] and ![[image.png]]
export function remarkWikiLinks({ apiBase = '' } = {}) {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || index == null) return;

      const regex = /(!?)\[\[([^\]]+)\]\]/g;
      const parts = [];
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(node.value)) !== null) {
        const [full, bang, inner] = match;

        if (match.index > lastIndex) {
          parts.push({ type: 'text', value: node.value.slice(lastIndex, match.index) });
        }

        if (bang === '!') {
          const filename = inner.trim();
          parts.push({
            type: 'html',
            value: `<img src="${apiBase}/blog/images/${encodeURIComponent(filename)}" alt="${filename}" class="blog-wiki-image" />`,
          });
        } else {
          const [slugRaw, labelRaw] = inner.split('|');
          const slug = slugRaw.trim();
          const label = labelRaw ? labelRaw.trim() : slug;
          parts.push({
            type: 'html',
            value: `<a href="/${encodeURIComponent(slug)}" class="blog-wiki-link">${label}</a>`,
          });
        }

        lastIndex = match.index + full.length;
      }

      if (parts.length === 0) return;

      if (lastIndex < node.value.length) {
        parts.push({ type: 'text', value: node.value.slice(lastIndex) });
      }

      parent.children.splice(index, 1, ...parts);
    });
  };
}

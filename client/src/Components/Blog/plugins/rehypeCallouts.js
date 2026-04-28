import { visit } from 'unist-util-visit';

const CALLOUT_TYPES = {
  NOTE:    { color: 'sky',    icon: 'ℹ' },
  TIP:     { color: 'emerald', icon: '✦' },
  WARNING: { color: 'amber',  icon: '⚠' },
  DANGER:  { color: 'red',    icon: '✕' },
};

// Transforms Obsidian callout blockquotes:
//   > [!NOTE] Optional Title
//   > Content
// into styled <div> elements.
export function rehypeCallouts() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'blockquote') return;

      const firstPara = node.children?.find(
        (c) => c.type === 'element' && c.tagName === 'p'
      );
      if (!firstPara) return;

      const firstText = firstPara.children?.find((c) => c.type === 'text');
      if (!firstText) return;

      const match = firstText.value.match(/^\[!(NOTE|TIP|WARNING|DANGER)\](?:\s+(.+))?/i);
      if (!match) return;

      const type = match[1].toUpperCase();
      const customTitle = match[2] || null;
      const { color, icon } = CALLOUT_TYPES[type] || CALLOUT_TYPES.NOTE;

      // Remove the [!TYPE] token from the first paragraph
      firstText.value = firstText.value.replace(match[0], '').trimStart();
      if (!firstText.value && firstPara.children.length === 1) {
        node.children = node.children.filter((c) => c !== firstPara);
      }

      const title = customTitle || type.charAt(0) + type.slice(1).toLowerCase();

      node.tagName = 'div';
      node.properties = {
        ...node.properties,
        className: [`callout callout-${color}`],
        'data-callout': type,
      };

      node.children = [
        {
          type: 'element',
          tagName: 'div',
          properties: { className: ['callout-header'] },
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['callout-icon'] },
              children: [{ type: 'text', value: icon }],
            },
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['callout-title'] },
              children: [{ type: 'text', value: title }],
            },
          ],
        },
        {
          type: 'element',
          tagName: 'div',
          properties: { className: ['callout-body'] },
          children: node.children,
        },
      ];
    });
  };
}

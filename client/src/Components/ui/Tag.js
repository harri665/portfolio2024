import React from 'react';

export default function Tag({ as: As = 'span', active = false, className = '', children, ...props }) {
  return (
    <As
      className={[
        'inline-flex items-center rounded-chip border px-2 py-0.5 text-xs transition-colors',
        active
          ? 'border-accent/50 bg-accent/12 text-accent'
          : 'border-line/12 text-ink-2',
        As === 'button' && !active ? 'hover:border-line/25 hover:text-ink' : '',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </As>
  );
}

import React from 'react';

// The page column. Its padding mirrors the nav's (outer gutter, then the
// pill's inner padding), so page content lines up under the wordmark at
// every width.
export default function Container({ as: As = 'div', className = '', children, ...props }) {
  return (
    <div className="px-3 sm:px-6">
      <As className={`mx-auto w-full max-w-7xl px-5 sm:px-6 ${className}`} {...props}>
        {children}
      </As>
    </div>
  );
}

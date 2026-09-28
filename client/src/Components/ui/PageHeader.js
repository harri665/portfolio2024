import React from 'react';
import { Link } from 'react-router-dom';

// The top of every project and post page: a way back, the title, a line of
// facts. `back` is { label, to } for a route or { label, href } for another
// section's site. Empty `meta` entries are skipped.
export default function PageHeader({ back, title, meta = [], className = '', children }) {
  const facts = meta.filter(Boolean);

  return (
    <header className={className}>
      {back && <BackLink {...back} />}

      {title && (
        <h1 className="mt-8 max-w-4xl text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
          {title}
        </h1>
      )}

      {facts.length > 0 && (
        <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-3">
          {facts.map((fact, i) => (
            <span key={i}>{fact}</span>
          ))}
        </p>
      )}

      {children}
    </header>
  );
}

function BackLink({ label, to, href }) {
  const className = 'inline-flex items-center gap-1.5 text-sm text-ink-3 transition-colors hover:text-ink';
  const content = (
    <>
      <span aria-hidden="true">←</span>
      {label}
    </>
  );

  return to ? (
    <Link to={to} className={className}>{content}</Link>
  ) : (
    <a href={href} className={className}>{content}</a>
  );
}

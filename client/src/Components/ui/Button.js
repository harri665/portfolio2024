import React from 'react';
import { Link } from 'react-router-dom';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const VARIANTS = {
  // one per view max
  primary: 'bg-accent text-on-accent hover:bg-accent/85',
  secondary: 'border border-line/16 text-ink hover:bg-line/6',
};

const SIZES = {
  md: 'px-5 py-2.5 text-sm',
  sm: 'px-4 py-1.5 text-sm',
};

export default function Button({
  variant = 'secondary',
  size = 'md',
  to,
  href,
  className = '',
  children,
  ...props
}) {
  const classes = `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`;

  if (to) {
    return (
      <Link to={to} className={classes} {...props}>
        {children}
      </Link>
    );
  }

  if (href) {
    return (
      <a href={href} className={classes} {...props}>
        {children}
      </a>
    );
  }

  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  );
}

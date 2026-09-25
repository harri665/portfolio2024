import React from 'react';
import { motion } from 'framer-motion';

export const INPUT =
  'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/25 outline-none transition-colors focus:border-[#0a84ff]/50';

export const BTN_PRIMARY =
  'inline-flex shrink-0 items-center gap-2 rounded-full bg-[#0a84ff] px-5 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(10,132,255,0.3)] transition-opacity hover:opacity-90 disabled:opacity-50';

export const BTN_SUBTLE =
  'inline-flex shrink-0 items-center gap-2 rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm font-medium text-white/75 transition-colors hover:bg-white/10 disabled:opacity-50';

export const BTN_DANGER =
  'text-xs font-medium text-red-400/80 transition-colors hover:text-red-400';

export function PanelHeader({ title, description, actions }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mb-6 flex flex-wrap items-start justify-between gap-4"
    >
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h2>
        {description && <p className="mt-2 max-w-2xl text-sm text-white/45">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
    </motion.div>
  );
}

export function Card({ className = '', children }) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, meta }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">{title}</p>
      {meta && <span className="text-xs text-white/30">{meta}</span>}
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-white/40">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-white/25">{hint}</span>}
    </label>
  );
}

export function StatusNote({ status }) {
  if (!status) return null;
  const tone =
    status.type === 'error'
      ? 'border-red-800/40 bg-red-900/10 text-red-400'
      : 'border-emerald-700/40 bg-emerald-900/10 text-emerald-300';
  return (
    <div className={`mb-4 rounded-xl border px-4 py-2.5 text-xs ${tone}`}>{status.message}</div>
  );
}

export function EmptyState({ children }) {
  return <p className="py-16 text-center text-sm text-white/30">{children}</p>;
}

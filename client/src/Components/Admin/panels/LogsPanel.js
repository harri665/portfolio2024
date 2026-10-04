import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { BTN_SUBTLE, Card, CardHeader, EmptyState, PanelHeader, StatusNote } from './ui';
import { VERDICTS, isPerson, judgeVisitor } from './visitorJudge';

const TONE = {
  emerald: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  teal: 'border-teal-400/25 bg-teal-400/10 text-teal-200',
  slate: 'border-white/15 bg-white/5 text-white/55',
  amber: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  rose: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
  violet: 'border-violet-400/25 bg-violet-400/10 text-violet-200',
};

const FILTERS = [
  { key: 'all', label: 'Everyone', test: (v) => v !== 'test' },
  { key: 'people', label: 'People', test: isPerson },
  { key: 'bots', label: 'Bots', test: (v) => v === 'bot' || v === 'likely-bot' },
  { key: 'unknown', label: 'Unknown', test: (v) => v === 'unknown' },
  { key: 'tests', label: 'Tests', test: (v) => v === 'test' },
];

function describeLocation(location) {
  if (!location) return null;
  if (location.status === 'fail') return location.message || 'lookup failed';
  return [location.city, location.regionName, location.country].filter(Boolean).join(', ') || null;
}

const seconds = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`);

function VerdictBadge({ verdict, score }) {
  const { label, tone } = VERDICTS[verdict];
  return (
    <span className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>
      {label}
      {verdict !== 'test' && <span className="ml-1.5 opacity-60">{score > 0 ? `+${score}` : score}</span>}
    </span>
  );
}

// ~38ms = late at the 30fps floor
const HELD_LATE_PCT = 5;

// full ~41dB vs path traced, reasonable ~39-40dB
function relightTier(r) {
  if (r.phase === 'failed') return 'failed';
  const small = !!r.network && r.network !== '128x4';
  if (!small && r.moving <= 2) return 'full';
  if ((!small && r.moving <= 4) || (small && r.moving <= 2)) return 'reasonable';
  return 'basic';
}

const TIERS = ['full', 'reasonable', 'basic', 'failed'];
const TIER_COLOR = {
  full: 'text-emerald-300/80',
  reasonable: 'text-sky-300/80',
  basic: 'text-amber-300/80',
  failed: 'text-rose-300/80',
};

const ordinal = (n) => (n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
const everyPx = (s) => (s <= 1 ? 'every pixel' : `every ${ordinal(s)} pixel`);

function describeRelight(r) {
  if (r.phase === 'failed') {
    return `no room: ${r.reason || 'failed'}${r.gpu ? ` · ${r.gpu}` : ''}`;
  }
  const backend = r.backend === 'webgpu' ? `WebGPU${r.half ? ' f16' : ''}` : 'WebGL';
  return [
    `${backend} · ${r.network || '128x4'} · ${r.size} px${r.kernel ? ` · ${r.kernel}` : ''}`,
    r.cost != null ? `${r.cost} ms a light` : 'not timed',
    `moving ${everyPx(r.moving)}, resting ${everyPx(r.resting)}`,
    r.frameRate != null ? `${r.frameRate} fps, ${r.latePct}% late` : null,
    r.gpu,
    [r.screen, r.cores && `${r.cores} cores`, r.memory && `${r.memory} GB`].filter(Boolean).join(', '),
  ]
    .filter(Boolean)
    .join(' · ');
}

function RelightSummary({ entries }) {
  const reports = entries.filter((log) => log.relight).map((log) => log.relight);
  if (!reports.length) {
    return null;
  }
  const pct = (n, of = reports.length) => `${Math.round((n / of) * 100)}%`;
  const running = reports.filter((r) => r.phase !== 'failed');
  const held = running.filter((r) => r.latePct != null && r.latePct <= HELD_LATE_PCT).length;
  const webgpu = running.filter((r) => r.backend === 'webgpu').length;
  return (
    <Card className="mb-6">
      <CardHeader title="Relit room, people only" meta={`${reports.length} visit${reports.length === 1 ? '' : 's'}`} />
      <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-4">
        {TIERS.map((tier) => {
          const n = reports.filter((r) => relightTier(r) === tier).length;
          return (
            <div key={tier}>
              <p className={`text-lg font-semibold ${TIER_COLOR[tier]}`}>{pct(n)}</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-white/35">
                {tier} ({n})
              </p>
            </div>
          );
        })}
      </div>
      <p className="border-t border-white/8 px-5 py-3 text-xs text-white/40">
        {running.length
          ? `${pct(held, running.length)} of the rooms that ran held 30 fps (under ${HELD_LATE_PCT}% of frames late) · ${pct(webgpu, running.length)} on WebGPU`
          : 'No room ran yet'}
      </p>
    </Card>
  );
}

function Visitor({ visitor, open, onToggle }) {
  const { ip, entries, newest, verdict, score, reasons, judged } = visitor;
  const where = describeLocation(entries[0].location);
  const isp = entries[0].location?.isp;
  return (
    <Card>
      <button
        onClick={onToggle}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="text-xs text-white/30">{open ? '▾' : '▸'}</span>
          <VerdictBadge verdict={verdict} score={score} />
          <span className="font-mono text-sm text-white/85">{ip}</span>
          {where && <span className="text-xs text-white/45">{where}</span>}
          {isp && <span className="truncate text-xs text-white/30">{isp}</span>}
        </span>
        <span className="flex items-center gap-3 text-xs text-white/35">
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/40">
            {entries.length} view{entries.length === 1 ? '' : 's'}
          </span>
          {new Date(newest).toLocaleString()}
        </span>
      </button>

      {open && (
        <div className="border-t border-white/8">
          <div className="flex flex-wrap gap-2 px-5 py-3">
            {reasons.map((r) => (
              <span
                key={r.text}
                className={`rounded-md border px-2 py-1 text-[10px] ${
                  r.weight > 0 ? TONE.emerald : r.weight < 0 ? TONE.rose : TONE.slate
                }`}
              >
                {r.weight > 0 ? `+${r.weight}` : r.weight < 0 ? r.weight : '·'} {r.text}
              </span>
            ))}
          </div>
          <div className="divide-y divide-white/5 border-t border-white/5">
            {judged.map(({ log, verdict: v, score: s }, i) => (
              <Entry key={`${log.timestamp}-${i}`} log={log} verdict={v} score={s} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Entry({ log, verdict, score }) {
  const v = log.visitor;
  const input = v
    ? [
        [v.moves, 'moves'],
        [v.clicks, 'clicks'],
        [v.touches, 'touches'],
        [v.scrolls, 'scrolls'],
        [v.keys, 'keys'],
      ]
        .filter(([n]) => n > 0)
        .map(([n, what]) => `${n} ${what}`)
        .join(', ') || 'no input'
    : null;
  return (
    <div className="px-5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <VerdictBadge verdict={verdict} score={score} />
          <span className="truncate font-mono text-xs text-white/70">{log.pageAccessed}</span>
        </span>
        <span className="text-[10px] text-white/30">{new Date(log.timestamp).toLocaleString()}</span>
      </div>
      <p className="mt-1 text-[10px] text-white/35">
        {[log.device, log.browser, log.platform].filter(Boolean).join(' · ')}
        {v && ` — ${input} · ${seconds(v.dwellMs)} on the page${v.screen ? ` · ${v.screen}` : ''}`}
      </p>
      {log.relight && (
        <p className="mt-1 text-[10px] text-white/45">
          <span className={TIER_COLOR[relightTier(log.relight)]}>Relit room, {relightTier(log.relight)}</span>
          {' — '}
          {describeRelight(log.relight)}
        </p>
      )}
      <p className="mt-1 truncate text-[10px] text-white/20" title={log.userAgent}>
        {log.userAgent}
      </p>
    </div>
  );
}

export default function LogsPanel({ adminFetch }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminFetch('/logs');
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const data = await r.json();
      setLogs(Array.isArray(data) ? data : []);
      setStatus(null);
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
    } finally {
      setLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const visitors = useMemo(() => {
    const byIp = logs.reduce((acc, log) => {
      const ip = log.ip || 'Unknown IP';
      (acc[ip] = acc[ip] || []).push(log);
      return acc;
    }, {});
    return Object.entries(byIp)
      .map(([ip, entries]) => {
        const sorted = [...entries].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return { ip, entries: sorted, newest: sorted[0]?.timestamp, ...judgeVisitor(sorted) };
      })
      .sort((a, b) => new Date(b.newest) - new Date(a.newest));
  }, [logs]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, visitors.filter((v) => f.test(v.verdict)).length])),
    [visitors]
  );
  const shown = visitors.filter((v) => FILTERS.find((f) => f.key === filter).test(v.verdict));
  const people = visitors.filter((v) => isPerson(v.verdict));
  const real = visitors.filter((v) => v.verdict !== 'test');
  const views = (list) => list.reduce((n, v) => n + v.entries.length, 0);
  const pct = (n) => (real.length ? `${Math.round((n / real.length) * 100)}%` : '—');

  return (
    <div>
      <PanelHeader
        title="Visitor Logs"
        description="Page views by address, each judged a person or a bot from its user agent, request, address and what the page saw."
        actions={
          <button onClick={load} className={BTN_SUBTLE}>
            Refresh
          </button>
        }
      />

      <StatusNote status={status} />

      {loading ? (
        <EmptyState>Loading logs…</EmptyState>
      ) : visitors.length === 0 ? (
        <EmptyState>No visits logged yet.</EmptyState>
      ) : (
        <>
          <Card className="mb-6">
            <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-4">
              {[
                ['Visitors', real.length, `${views(real)} page views`, 'text-white/85'],
                ['People', people.length, `${pct(people.length)} · ${views(people)} views`, 'text-emerald-300/85'],
                ['Bots', counts.bots, pct(counts.bots), 'text-rose-300/85'],
                ['Unknown', counts.unknown, pct(counts.unknown), 'text-white/55'],
              ].map(([label, n, note, color]) => (
                <div key={label}>
                  <p className={`text-2xl font-semibold ${color}`}>{n}</p>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-white/35">{label}</p>
                  <p className="mt-0.5 text-[10px] text-white/30">{note}</p>
                </div>
              ))}
            </div>
            <p className="border-t border-white/8 px-5 py-3 text-[11px] text-white/35">
              Visits from before the judge recorded request headers and input have only their user agent and
              address to go on, and mostly come out unknown. Local test runs are counted apart.
            </p>
          </Card>

          <RelightSummary entries={people.flatMap((v) => v.entries)} />

          <div className="mb-4 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  filter === f.key
                    ? 'border-white/30 bg-white/15 text-white'
                    : 'border-white/10 bg-white/5 text-white/50 hover:text-white/80'
                }`}
              >
                {f.label} <span className="opacity-50">{counts[f.key]}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <EmptyState>Nobody here.</EmptyState>
          ) : (
            <div className="space-y-3">
              {shown.map((v) => (
                <Visitor
                  key={v.ip}
                  visitor={v}
                  open={!!expanded[v.ip]}
                  onToggle={() => setExpanded((p) => ({ ...p, [v.ip]: !p[v.ip] }))}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const red = paint(31);
export const green = paint(32);
export const dim = paint(2);
export const bold = paint(1);

export function aggregate(runs) {
  const first = runs.find((r) => r != null);
  if (typeof first === 'number') {
    const nums = runs.filter((r) => typeof r === 'number').sort((a, b) => a - b);
    const mid = Math.floor(nums.length / 2);
    const median = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    return Math.round(median * 1000) / 1000;
  }
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const keys = new Set(runs.flatMap((r) => (r && typeof r === 'object' ? Object.keys(r) : [])));
    return Object.fromEntries([...keys].map((k) => [k, aggregate(runs.map((r) => r?.[k]))]));
  }
  return first ?? null;
}

// has to pass both thresholds so noise on tiny numbers doesn't count
const LOAD_METRICS = [
  { key: 'fcp', label: 'FCP', unit: 'ms', abs: 100 },
  { key: 'lcp', label: 'LCP', unit: 'ms', abs: 150 },
  { key: 'cls', label: 'CLS', unit: '', abs: 0.02 },
  { key: 'tbt', label: 'TBT', unit: 'ms', abs: 50 },
  { key: 'kb', label: 'transfer', unit: 'KB', abs: 50 },
  { key: 'jsKb', label: 'JS', unit: 'KB', abs: 20 },
  { key: 'heapMb', label: 'heap', unit: 'MB', abs: 5 },
  { key: 'cpuMs', label: 'main thread', unit: 'ms', abs: 100 },
];
const FRAME_METRICS = [
  { key: 'fps', label: 'fps', unit: '', abs: 5, higher: true },
  { key: 'p95', label: 'p95 frame', unit: 'ms', abs: 3 },
  { key: 'p99', label: 'p99 frame', unit: 'ms', abs: 6 },
  { key: 'latePct', label: 'frames <30fps', unit: '%', abs: 2 },
  { key: 'busyPct', label: 'main busy', unit: '%', abs: 5 },
];
const REL = 0.15;

export function pageKey(p) {
  return `${p.profile} ${p.site}${p.path}`;
}

export function printResults(pages) {
  for (const profile of [...new Set(pages.map((p) => p.profile))]) {
    const mine = pages.filter((p) => p.profile === profile);
    console.log(`\n${bold(`Load — ${profile}`)} ${dim('(median of runs; ms unless noted)')}`);
    table(
      ['page', 'TTFB', 'FCP', 'LCP', 'CLS', 'TBT', 'KB', 'JS KB', 'req', 'heap MB', 'errors'],
      mine.map((p) => [
        label(p), p.load.ttfb, p.load.fcp, p.load.lcp, p.load.cls, p.load.tbt,
        p.load.kb, p.load.jsKb, p.load.requests, p.load.heapMb,
        p.errors.length ? red(p.errors.length) : 0,
      ])
    );

    const three = mine.filter((p) => p.frames);
    if (three.length) {
      console.log(`\n${bold(`3D frames — ${profile}`)} ${dim('(fps; frame times in ms; late = below 30 fps)')}`);
      const rows = [];
      for (const p of three) {
        Object.entries(p.frames).forEach(([phase, f], i) => {
          rows.push([
            i ? '' : label(p),
            phaseName(phase), f.fps, f.p50, f.p95, f.p99, f.max,
            f.latePct > 5 ? red(f.latePct) : f.latePct, f.busyPct, f.longTaskMs,
          ]);
        });
        const t = p.three;
        const relight = t.relight
          ? `; relight budget ${t.relight.budget} ms, dpr ${t.relight.dpr}${t.relight.failedDpr ? ` (failed at ${t.relight.failedDpr})` : ''}`
          : '';
        rows.push(['', dim(`canvas ${t.size} at ${t.dpr}x${relight}`)]);
      }
      table(['page', 'phase', 'fps', 'p50', 'p95', 'p99', 'max', 'late %', 'busy %', 'long tasks'], rows);
    }

    const broken = mine.filter((p) => p.errors.length);
    for (const p of broken) {
      console.log(red(`\n${label(p)} logged errors:`));
      for (const e of [...new Set(p.errors)].slice(0, 3)) {
        console.log(dim(`  ${e.slice(0, 160)}`));
      }
    }
  }
}

export function compare(pages, previous, name) {
  const before = new Map(previous.pages.map((p) => [pageKey(p), p]));
  const changes = [];
  for (const p of pages) {
    const old = before.get(pageKey(p));
    if (!old) {
      continue;
    }
    for (const m of LOAD_METRICS) {
      changes.push(change(p, m, 'load', old.load?.[m.key], p.load[m.key]));
    }
    for (const [phase, f] of Object.entries(p.frames || {})) {
      for (const m of FRAME_METRICS) {
        changes.push(change(p, m, phaseName(phase), old.frames?.[phase]?.[m.key], f[m.key]));
      }
    }
  }
  const real = changes.filter(Boolean).sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel));
  const worse = real.filter((c) => c.worse);
  const better = real.filter((c) => !c.worse);

  console.log(`\n${bold(`Compared with ${name}`)} ${dim(`(${previous.meta.date}, ${previous.meta.commit})`)}`);
  if (!real.length) {
    console.log(dim(`  no change past ${REL * 100}% on any page`));
  }
  for (const c of worse) {
    console.log(red(`  worse   ${c.text}`));
  }
  for (const c of better) {
    console.log(green(`  better  ${c.text}`));
  }
  const missing = previous.pages.filter((p) => !pages.some((q) => pageKey(q) === pageKey(p)));
  if (missing.length && pages.length >= previous.pages.length) {
    console.log(dim(`  not measured this time: ${missing.map(pageKey).join(', ')}`));
  }
  return worse;
}

function change(p, m, phase, was, now) {
  if (typeof was !== 'number' || typeof now !== 'number') {
    return null;
  }
  const diff = now - was;
  const rel = was ? diff / Math.abs(was) : diff ? Infinity : 0;
  if (Math.abs(diff) < m.abs || Math.abs(rel) < REL) {
    return null;
  }
  const pct = Number.isFinite(rel) ? `${rel > 0 ? '+' : ''}${Math.round(rel * 100)}%` : 'new';
  return {
    rel,
    worse: m.higher ? diff < 0 : diff > 0,
    text: `${pageKey(p)}  ${phase} ${m.label}: ${was} → ${now}${m.unit ? ` ${m.unit}` : ''} (${pct})`,
  };
}

function phaseName(phase) {
  return phase === 'pointerReturn' ? 'pointer (return visit)' : phase;
}

function label(p) {
  return `${p.site}${p.path}`;
}

function table(head, rows) {
  const visible = (s) => String(s ?? '–').replace(/\x1b\[[0-9;]*m/g, '');
  const cells = rows.map((r) => r.map((c) => (c == null ? '–' : String(c))));
  const widths = head.map((h, i) =>
    Math.max(h.length, ...cells.filter((r) => r.length > 2).map((r) => visible(r[i]).length))
  );
  const line = (r) => r.map((c, i) => {
    const pad = ' '.repeat(Math.max(0, widths[i] - visible(c).length));
    return i < 2 ? c + pad : pad + c;
  }).join('  ');
  console.log(dim(line(head)));
  for (const r of cells) {
    console.log(r.length > 2 ? line(r) : `${' '.repeat(widths[0])}  ${r[1]}`);
  }
}

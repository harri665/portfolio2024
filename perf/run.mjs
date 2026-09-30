#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

import { instrument, measurePage } from './lib/measure.mjs';
import { launchArgs, PROFILES } from './lib/profiles.mjs';
import { aggregate, bold, compare, dim, printResults, red } from './lib/report.mjs';
import { blockVisitLogging, discoverPages, newestMtime, origins, serveBuild, SITES } from './lib/sites.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const CLIENT = path.join(HERE, '..', 'client');

const { values: args } = parseArgs({
  options: {
    target: { type: 'string', default: 'local' },
    port: { type: 'string' },
    'api-port': { type: 'string', default: '3005' },
    sites: { type: 'string', default: SITES.join(',') },
    match: { type: 'string' },
    'max-pages': { type: 'string' },
    profiles: { type: 'string', default: 'desktop' },
    runs: { type: 'string', default: '3' },
    duration: { type: 'string', default: '4' },
    '3d-only': { type: 'boolean', default: false },
    'no-frames': { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    compare: { type: 'string', default: 'baseline' },
    'save-baseline': { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help) {
  console.log(fs.readFileSync(path.join(HERE, 'README.md'), 'utf8'));
  process.exit(0);
}

const profileNames = args.profiles === 'all' ? Object.keys(PROFILES) : args.profiles.split(',');
for (const name of profileNames) {
  if (!PROFILES[name]) {
    fail(`Unknown profile "${name}". Profiles: ${Object.keys(PROFILES).join(', ')}`);
  }
}
if (!['local', 'build', 'prod'].includes(args.target)) {
  fail('--target is local (the dev server), build (client/build), or prod');
}
const sites = args.sites.split(',').filter((s) => SITES.includes(s));
const opts = {
  runs: Math.max(1, Number(args.runs)),
  duration: Number(args.duration),
  frames: !args['no-frames'],
  timeout: 60000,
  quietTimeout: 10000,
  settle: 1000,
};

let server = null;
const port = Number(args.port || (args.target === 'build' ? 4173 : 3000));
if (args.target === 'build') {
  const build = path.join(CLIENT, 'build');
  if (!fs.existsSync(path.join(build, 'index.html'))) {
    fail('No client/build. Run `npm run build` in client first.');
  }
  if (newestMtime(path.join(CLIENT, 'src')) > fs.statSync(path.join(build, 'index.html')).mtimeMs) {
    console.log(red('client/src has changed since the last build; rebuild to measure the current code.'));
  }
  server = await serveBuild({ buildDir: build, port, apiPort: Number(args['api-port']) });
}
const siteOrigins = origins(args.target, port);

const browsers = new Map();
async function browserFor(profile) {
  const flags = launchArgs(profile);
  const key = flags.join(' ');
  if (!browsers.has(key)) {
    browsers.set(key, await chromium.launch({ channel: 'chrome', headless: !args.headed, args: flags })
      .catch(() => chromium.launch({ headless: !args.headed, args: flags })));
  }
  return browsers.get(key);
}

try {
  console.log(dim(`Finding pages on ${sites.map((s) => siteOrigins[s]).join(', ')}`));
  const discoverer = await browserFor(PROFILES.desktop);
  let targets = [];
  for (const site of sites) {
    let found;
    try {
      found = await discoverPages(discoverer, siteOrigins[site], opts);
    } catch (err) {
      fail(`Couldn't load ${siteOrigins[site]} (${err.message.split('\n')[0]}). Is the ${args.target === 'local' ? 'dev server (npm run dev)' : 'API server'} running?`);
    }
    const max = args['max-pages'] ? Number(args['max-pages']) : Infinity;
    targets.push(...found.slice(0, max).map((p) => ({ site, path: p })));
  }
  if (args.match) {
    const re = new RegExp(args.match);
    targets = targets.filter((t) => re.test(`${t.site}${t.path}`));
  }
  if (args.list) {
    targets.forEach((t) => console.log(`${t.site}${t.path}  ${siteOrigins[t.site]}${t.path}`));
    process.exit(0);
  }
  if (!targets.length) {
    fail('No pages to measure.');
  }

  // fresh profile every run so every visit is a first visit
  const pages = [];
  const gpus = {};
  for (const profileName of profileNames) {
    const profile = PROFILES[profileName];
    const browser = await browserFor(profile);
    gpus[profileName] = await gpuOf(browser);
    console.log(`\n${bold(profileName)} ${dim(`— ${profile.description}; ${gpus[profileName]}`)}`);

    for (const t of targets) {
      const url = `${siteOrigins[t.site]}${t.path}`;
      const runs = [];
      for (let i = 0; i < opts.runs; i += 1) {
        process.stdout.write(`\r${dim(`  ${t.site}${t.path}  run ${i + 1}/${opts.runs}`)}\x1b[K`);
        const context = await browser.newContext(profile.context);
        await context.addInitScript(instrument);
        await blockVisitLogging(context);
        try {
          runs.push(await measurePage(context, profile, url, opts));
        } catch (err) {
          runs.push({ failed: err.message.split('\n')[0] });
        } finally {
          await context.close();
        }
        if (args['3d-only'] && !runs[0].frames) {
          break;
        }
      }
      const ok = runs.filter((r) => !r.failed);
      if (!ok.length) {
        console.log(`\r${red(`  ${t.site}${t.path} failed: ${runs[0].failed}`)}\x1b[K`);
        continue;
      }
      if (args['3d-only'] && !ok[0].frames) {
        continue;
      }
      pages.push({
        profile: profileName,
        ...t,
        url,
        load: aggregate(ok.map((r) => r.load)),
        frames: ok[0].frames ? aggregate(ok.map((r) => r.frames)) : null,
        three: ok[0].three ? aggregate(ok.map((r) => r.three)) : null,
        errors: [...new Set(ok.flatMap((r) => r.errors))],
        runs: ok,
      });
    }
    process.stdout.write('\r\x1b[K');
  }

  printResults(pages);
  const result = {
    meta: {
      date: new Date().toISOString(),
      ...gitState(),
      target: args.target,
      origins: siteOrigins,
      profiles: Object.fromEntries(profileNames.map((n) => [n, { ...PROFILES[n], gpuName: gpus[n] }])),
      runs: opts.runs,
      duration: opts.duration,
      headed: args.headed,
      chrome: discoverer.version(),
    },
    pages,
  };

  fs.mkdirSync(RESULTS, { recursive: true });
  const previous = findComparison(args.compare);
  const stamp = result.meta.date.replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(RESULTS, `${stamp}-${args.target}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(dim(`\nSaved ${path.relative(process.cwd(), file)}`));
  if (args['save-baseline']) {
    fs.writeFileSync(path.join(RESULTS, 'baseline.json'), JSON.stringify(result, null, 2));
    console.log(dim('Saved as the baseline for later runs'));
  }

  let worse = [];
  if (previous) {
    if (previous.data.meta.target !== args.target) {
      console.log(red(`\nNote: ${previous.name} was measured on --target ${previous.data.meta.target}`));
    }
    worse = compare(pages, previous.data, previous.name);
  } else if (args.compare !== 'none') {
    console.log(dim('\nNo baseline to compare with yet; save one with --save-baseline'));
  }
  process.exitCode = args.strict && worse.length ? 1 : 0;
} finally {
  await Promise.all([...browsers.values()].map((b) => b.close()));
  server?.close();
}

function findComparison(which) {
  if (which === 'none') {
    return null;
  }
  let file = which;
  if (which === 'baseline') {
    file = path.join(RESULTS, 'baseline.json');
  } else if (which === 'previous') {
    const all = fs.readdirSync(RESULTS).filter((f) => /^\d{4}-.*\.json$/.test(f)).sort();
    file = all.length ? path.join(RESULTS, all[all.length - 1]) : '';
  }
  if (!file || !fs.existsSync(file)) {
    if (!['baseline', 'previous'].includes(which)) {
      console.log(red(`No result at ${which}`));
    }
    return null;
  }
  return { name: path.basename(file), data: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

async function gpuOf(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
      if (!gl) {
        return 'no WebGL';
      }
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    });
  } finally {
    await page.close();
  }
}

function gitState() {
  const git = (cmd) => {
    try {
      return execSync(`git ${cmd}`, { cwd: HERE, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return null;
    }
  };
  const dirty = git('status --porcelain -- ../client');
  return {
    commit: git('rev-parse --short HEAD') + (dirty ? '+changes' : ''),
    branch: git('rev-parse --abbrev-ref HEAD'),
  };
}

function fail(message) {
  console.error(red(message));
  process.exit(1);
}

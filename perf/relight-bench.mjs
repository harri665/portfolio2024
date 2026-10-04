// times the relight network and scores it against the path traced refs (PSNR after reinhard,
// same as the relight repo's evaluate.py). uses ?relight=bench
//
//     node relight-bench.mjs                       desktop, WebGPU and WebGL
//     node relight-bench.mjs --profiles desktop,low-end --tiers 384,512,768
//     node relight-bench.mjs --save-reference      keep these images to compare with
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import { chromium } from 'playwright';

import { launchArgs, PROFILES } from './lib/profiles.mjs';
import { blockVisitLogging, origins } from './lib/sites.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RESULTS = path.join(HERE, 'results');
const REFERENCE = path.join(HERE, 'relight-reference');

const { values: args } = parseArgs({
  options: {
    profiles: { type: 'string', default: 'desktop' },
    backends: { type: 'string', default: 'webgpu,webgl' },
    tiers: { type: 'string', default: '512' },
    strides: { type: 'string', default: '1,2,4,8' },
    networks: { type: 'string', default: '128x4' },
    refs: { type: 'string', default: 'E:/NextCloud/Documents/relight/web/scenes/cornell' },
    port: { type: 'string', default: '3000' },
    'no-quality': { type: 'boolean', default: false },
    'save-reference': { type: 'boolean', default: false },
    tune: { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false },
    label: { type: 'string', default: '' },
  },
});
const list = (s) => s.split(',').filter(Boolean);
const strides = list(args.strides).map(Number).sort((a, b) => b - a);
const tiers = list(args.tiers).map(Number);

const BATCH_MS = 150;
const MAX_EVAL_MS = 3000;

function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 31;
  const m = h & 1023;
  return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
}

function loadRefs(dir) {
  const scenePath = path.join(dir, 'scene.json');
  const binPath = path.join(dir, 'refs.bin');
  if (!fs.existsSync(scenePath) || !fs.existsSync(binPath)) {
    return null;
  }
  const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  const buf = fs.readFileSync(binPath);
  return scene.refs.map(({ light, image }) => {
    const n = image.shape.reduce((a, b) => a * b, 1);
    const h = new Uint16Array(buf.buffer, buf.byteOffset + image.offset, n);
    const lin = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      lin[i] = halfToFloat(h[i]);
    }
    const [H, W] = image.shape;
    let lum = 0;
    for (let p = 0; p < H * W; p += 1) {
      lum += 0.2126 * lin[p * 3] + 0.7152 * lin[p * 3 + 1] + 0.0722 * lin[p * 3 + 2];
    }
    const exposure = 0.15 / Math.max(lum / (H * W), 1e-8);
    const tm = lin.map((x) => {
      const y = Math.max(x, 0) * exposure;
      return y / (1 + y);
    });
    return { light: { pos: light.slice(0, 3), radius: light[3] }, W, H, exposure, tm };
  });
}

const srgbToLin = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function toneOf({ width: W, height: H, rgba }) {
  const bytes = Buffer.from(rgba, 'base64');
  const out = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    const src = (H - 1 - y) * W * 4;
    for (let x = 0; x < W; x += 1) {
      for (let k = 0; k < 3; k += 1) {
        out[(y * W + x) * 3 + k] = srgbToLin[bytes[src + x * 4 + k]];
      }
    }
  }
  return { out, bytes };
}

function psnr(a, b) {
  let se = 0;
  for (let i = 0; i < a.length; i += 1) {
    se += (a[i] - b[i]) ** 2;
  }
  return -10 * Math.log10(Math.max(se / a.length, 1e-12));
}

function compareBytes(a, b) {
  let max = 0;
  let se = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 1) {
    if ((i & 3) === 3) {
      continue;
    }
    const d = Math.abs(a[i] - b[i]);
    max = Math.max(max, d);
    se += d * d;
    n += 1;
  }
  return { maxDiff: max, psnr: -10 * Math.log10(Math.max(se / n / 255 ** 2, 1e-12)) };
}

const refs = args['no-quality'] ? null : loadRefs(args.refs);
if (!args['no-quality'] && !refs) {
  console.warn(`No refs.bin in ${args.refs}; timing only.`);
}
const origin = origins('local', Number(args.port)).cs;
const results = [];

for (const profileName of list(args.profiles)) {
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(`unknown profile ${profileName}`);
  }
  const flags = [...launchArgs(profile), '--enable-unsafe-webgpu'];
  const browser = await chromium
    .launch({ channel: 'chrome', headless: !args.headed, args: flags })
    .catch(() => chromium.launch({ headless: !args.headed, args: flags }));
  for (const backend of list(args.backends)) {
    const context = await browser.newContext(profile.context);
    await blockVisitLogging(context);
    const page = await context.newPage();
    if (profile.cpu) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
    }
    await page.goto(`${origin}/?relight=bench`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__relightBench, null, { timeout: 120000 });
    for (const network of list(args.networks)) {
      const entry = { profile: profileName, backend, network, tiers: {}, quality: null, errors: [] };
      results.push(entry);

      for (const tier of tiers) {
        let info;
        const t0 = Date.now();
        try {
          info = await page.evaluate((o) => window.__relightBench.open(o), { tier, backend, network });
        } catch (error) {
          entry.errors.push(`${tier}: ${error.message.split('\n')[0]}`);
          console.log(`${profileName} ${backend} ${tier}px: ${error.message.split('\n')[0]}`);
          continue;
        }
        if (args.tune) {
          const probe = await page.evaluate(() => window.__relightBench.time({ stride: 4, n: 1, batches: 1 }));
          const stride = [1, 2, 4, 8].find((s) => probe.ms * (4 / s) ** 2 <= 30) ?? 8;
          const tuned = await page.evaluate((o) => window.__relightBench.tune(o), { stride, runs: 4 });
          info.kernel = tuned.kernel;
        }
        if (info.backend !== backend) {
          entry.errors.push(`${tier}: asked for ${backend}, ran on ${info.backend}`);
        }
        const row = { ...info, buildMs: Date.now() - t0, strides: {} };
        entry.tiers[tier] = row;
        for (const stride of strides) {
          const probe = await page.evaluate((s) => window.__relightBench.time({ stride: s, n: 1, batches: 1 }), stride);
          if (probe.ms > MAX_EVAL_MS) {
            row.strides[stride] = { ms: probe.ms, items: probe.items, probeOnly: true };
            break;
          }
          const n = Math.max(1, Math.min(16, Math.round(BATCH_MS / Math.max(probe.ms, 0.1))));
          const t = await page.evaluate((o) => window.__relightBench.time(o), { stride, n, batches: 3 });
          row.strides[stride] = { ms: t.ms, items: t.items, nsPerItem: (t.ms * 1e6) / t.items };
        }
        const line = Object.entries(row.strides)
          .sort((a, b) => a[0] - b[0])
          .map(([s, v]) => `s${s} ${v.ms.toFixed(2)} ms`)
          .join('  ');
        console.log(`${profileName} ${info.backend}${info.half ? ' f16' : ''} ${tier}px ${info.network} ${info.kernel}: ${line}`);
      }

      if (refs && !entry.errors.some((e) => e.startsWith(`${refs[0].W}:`))) {
        const W = refs[0].W;
        const info = await page.evaluate((o) => window.__relightBench.open(o), { tier: W, backend, network });
        entry.quality = {};
        for (const stride of strides) {
          const timed = entry.tiers[W]?.strides[stride];
          if (timed?.probeOnly) {
            continue;
          }
          const scores = [];
          const regress = [];
          for (let i = 0; i < refs.length; i += 1) {
            const ref = refs[i];
            const shot = await page.evaluate((o) => window.__relightBench.render(o), {
              lights: [ref.light],
              stride,
              exposure: ref.exposure,
            });
            const { out, bytes } = toneOf(shot);
            scores.push(psnr(out, ref.tm));
            const file = path.join(REFERENCE, `${info.backend}-s${stride}-ref${i}.rgba.gz`);
            if (args['save-reference']) {
              fs.mkdirSync(REFERENCE, { recursive: true });
              fs.writeFileSync(file, zlib.gzipSync(bytes, { level: 9 }));
            } else if (fs.existsSync(file)) {
              regress.push(compareBytes(bytes, zlib.gunzipSync(fs.readFileSync(file))));
            }
          }
          const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
          entry.quality[stride] = {
            psnr: mean,
            psnrPerLight: scores,
            ...(regress.length && {
              vsReference: {
                maxDiff: Math.max(...regress.map((r) => r.maxDiff)),
                minPsnr: Math.min(...regress.map((r) => r.psnr)),
              },
            }),
          };
          const ms = timed?.ms;
          const vs = entry.quality[stride].vsReference;
          console.log(
            `  quality s${stride}: ${mean.toFixed(2)} dB vs path-traced` +
              (ms ? `, ${ms.toFixed(2)} ms` : '') +
              (vs ? `; vs saved: max diff ${vs.maxDiff}/255, worst ${vs.minPsnr.toFixed(1)} dB` : '') +
              `  [${scores.map((s) => s.toFixed(1)).join(' ')}]`
          );
        }
      }
    }
    await page.evaluate(() => window.__relightBench.close());
    await context.close();
  }
  await browser.close();
}

fs.mkdirSync(RESULTS, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = path.join(RESULTS, `relight-${stamp}${args.label ? `-${args.label}` : ''}.json`);
fs.writeFileSync(file, JSON.stringify({ date: new Date().toISOString(), args, results }, null, 1));
console.log(`\nSaved ${path.relative(process.cwd(), file)}`);

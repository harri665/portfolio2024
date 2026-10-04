// packs a relight export for the CS backdrop. positions go to u16 (f32 + distance was most
// of the download), each channel as row deltas with low bytes then high bytes so gzip
// actually does something. relight/scene.js undoes it
//
//     node relight-pack.mjs --in ../relight-data/cornell-original --out ../client/public/relight/cornell-128x4
//     node relight-pack.mjs --in <relight>/web/scenes/cornell-lite --out ../client/public/relight/cornell-64x4 --share-pixels cornell-128x4
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';

const { values: args } = parseArgs({
  options: {
    in: { type: 'string' },
    out: { type: 'string' },
    'share-pixels': { type: 'string' },
  },
});
if (!args.in || !args.out) {
  console.error('usage: node relight-pack.mjs --in <export dir> --out <public dir>');
  process.exit(1);
}

const POS_RANGE = [-1, 1];

class Blob {
  constructor() {
    this.parts = [];
    this.size = 0;
  }

  add(bytes, entry) {
    const pad = -this.size & 15;
    if (pad) {
      this.parts.push(Buffer.alloc(pad));
      this.size += pad;
    }
    const at = this.size;
    this.parts.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    this.size += bytes.byteLength;
    return { offset: at, bytes: bytes.byteLength, ...entry };
  }

  buffer() {
    return Buffer.concat(this.parts);
  }
}

function planes(W, H, channels, value) {
  const NP = W * H;
  const out = new Uint8Array(channels * NP * 2);
  for (let k = 0; k < channels; k += 1) {
    const lo = k * NP * 2;
    const hi = lo + NP;
    for (let y = 0; y < H; y += 1) {
      let prev = 0;
      for (let x = 0; x < W; x += 1) {
        const p = y * W + x;
        const v = value(p, k);
        const d = (v - prev) & 0xffff;
        prev = v;
        out[lo + p] = d & 0xff;
        out[hi + p] = d >> 8;
      }
    }
  }
  return out;
}

function write(file, bytes) {
  fs.writeFileSync(file, bytes);
  const gz = zlib.gzipSync(bytes, { level: 9 });
  fs.writeFileSync(`${file}.gz`, gz);
  return gz.length;
}

fs.mkdirSync(args.out, { recursive: true });
const sizes = [];
const model = fs.readFileSync(path.join(args.in, 'model.bin'));
sizes.push(['model.bin', model.length, write(path.join(args.out, 'model.bin'), model)]);

for (const file of fs.readdirSync(args.in).filter((f) => /^scene(-\d+)?\.json$/.test(f))) {
  const suffix = file.slice('scene'.length, -'.json'.length);
  const scene = JSON.parse(fs.readFileSync(path.join(args.in, file), 'utf8'));
  const raw = fs.readFileSync(path.join(args.in, `pixels${suffix}.bin`));
  const W = scene.width;
  const H = scene.height;
  const NP = W * H;
  const { aux, geom } = scene.pixels;
  if (aux.dtype !== 'float16' || geom.dtype !== 'float32' || aux.shape[2] !== 7) {
    throw new Error(`${file}: not the pixel layout this packs (aux f16 x 7, geom f32 x 4)`);
  }
  const auxH = new Uint16Array(raw.buffer.slice(raw.byteOffset + aux.offset, raw.byteOffset + aux.offset + NP * 14));
  const g = new Float32Array(raw.buffer.slice(raw.byteOffset + geom.offset, raw.byteOffset + geom.offset + NP * 16));
  const [lo, hi] = POS_RANGE;
  let worst = 0;
  const q = new Uint16Array(NP * 3);
  for (let p = 0; p < NP; p += 1) {
    if (!(g[p * 4 + 3] > 0)) {
      continue;
    }
    for (let k = 0; k < 3; k += 1) {
      const v = g[p * 4 + k];
      if (v < lo - 1e-4 || v > hi + 1e-4) {
        throw new Error(`${file}: a position (${v}) is outside ${lo}..${hi}`);
      }
      // 0 = sees nothing
      q[p * 3 + k] = 1 + Math.round(((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 65534);
      worst = Math.max(worst, Math.abs(lo + ((q[p * 3 + k] - 1) / 65534) * (hi - lo) - v));
    }
  }

  const blob = new Blob();
  const pixels = {
    format: 2,
    aux: blob.add(planes(W, H, 7, (p, k) => auxH[p * 7 + k]), { channels: 7 }),
    pos: blob.add(planes(W, H, 3, (p, k) => q[p * 3 + k]), { channels: 3, range: POS_RANGE }),
  };
  const out = { ...scene, pixels };
  delete out.refs;
  delete out.train;
  const bin = blob.buffer();
  const share = args['share-pixels'];
  if (share) {
    const shared = path.join(args.out, '..', share, `pixels${suffix}.bin`);
    if (!fs.existsSync(shared) || !fs.readFileSync(shared).equals(bin)) {
      throw new Error(`${file}: ${shared} isn't these pixels`);
    }
    pixels.file = `../${share}/pixels${suffix}.bin`;
  } else {
    sizes.push([`pixels${suffix}.bin`, bin.length, write(path.join(args.out, `pixels${suffix}.bin`), bin)]);
  }
  const json = Buffer.from(JSON.stringify(out));
  sizes.push([file, json.length, write(path.join(args.out, file), json)]);
  console.log(`${file}: ${W}x${H}, worst position error ${worst.toExponential(1)}`);
}

const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
sizes.forEach(([name, size, gz]) => console.log(`  ${name.padEnd(18)} ${mb(size).padStart(9)}  gzipped ${mb(gz)}`));

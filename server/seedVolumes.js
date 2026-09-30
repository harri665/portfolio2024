// docker only fills a named volume from the image when it's first created, so files added to
// the repo later never show up. copy new ones in from seed/ on startup, once each, so
// something deleted from the admin page stays deleted

import fs from 'fs';
import path from 'path';

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, base);
    return entry.isFile() ? [path.relative(base, full).split(path.sep).join('/')] : [];
  });
}

export function seedVolumes({ seedDir, appDir, manifestFile, dirs }) {
  if (!fs.existsSync(seedDir)) return;

  let seeded = {};
  try {
    seeded = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
  } catch {
    // first run, no manifest yet
  }

  const copied = [];
  for (const dir of dirs) {
    const done = new Set(seeded[dir] || []);
    for (const rel of walk(path.join(seedDir, dir))) {
      if (done.has(rel)) continue;
      const target = path.join(appDir, dir, rel);
      if (!fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(seedDir, dir, rel), target);
        copied.push(`${dir}/${rel}`);
      }
      done.add(rel);
    }
    seeded[dir] = [...done].sort();
  }

  fs.writeFileSync(manifestFile, JSON.stringify(seeded, null, 2));
  if (copied.length) console.log(`Seeded ${copied.length} file(s) into volumes:`, copied.join(', '));
}

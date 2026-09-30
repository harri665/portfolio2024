// blog/, projects/ and pages/ are Docker volumes, so edits made from the admin
// page survive a rebuild. Docker fills a named volume from the image only when
// the volume is first created, so files added to the repo later never reach an
// existing volume and stay hidden behind it. The Dockerfile keeps the repo's
// copies in seed/, and on startup any file the volume hasn't been given yet is
// copied in. Files already in the volume are never overwritten, and a file is
// copied only once, so one deleted from the admin page stays deleted.

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
    // First run: no manifest yet
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

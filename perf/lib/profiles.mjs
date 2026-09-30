// Devices a run can pretend to be. The GPU can't be throttled, only swapped:
// `gpu: 'software'` renders WebGL on the CPU (SwiftShader), which stands in
// for a weak integrated or phone GPU. Everything else here is emulation of
// the screen, CPU and network on the machine running the test.
import { devices } from 'playwright';

// Chrome DevTools' network presets (throughput in bytes/s, latency in ms)
const NETWORKS = {
  'slow-4g': { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  'fast-4g': { latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
};

export const PROFILES = {
  desktop: {
    description: '1440x900 at 1x, this machine at full speed',
    context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  },
  retina: {
    description: '1440x900 at 2x: four times the pixels for the glass and the relit room',
    context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  },
  'low-end': {
    description: '1366x768 laptop, 4x slower CPU, software GPU, fast 4G',
    context: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 },
    cpu: 4,
    network: 'fast-4g',
    gpu: 'software',
  },
  mobile: {
    description: 'Pixel 7 screen and touch, 4x slower CPU, slow 4G (GPU is still this machine\'s)',
    context: { ...devices['Pixel 7'] },
    cpu: 4,
    network: 'slow-4g',
  },
  'mobile-weak': {
    description: 'Pixel 7 screen and touch, 6x slower CPU, software GPU, slow 4G',
    context: { ...devices['Pixel 7'] },
    cpu: 6,
    network: 'slow-4g',
    gpu: 'software',
  },
};

export function networkConditions(name) {
  return name ? { offline: false, ...NETWORKS[name] } : null;
}

// Chrome flags for a profile's GPU; profiles that share them share a browser
export function launchArgs(profile) {
  return profile.gpu === 'software'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--ignore-gpu-blocklist'];
}

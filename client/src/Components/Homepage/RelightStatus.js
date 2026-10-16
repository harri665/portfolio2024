import React, { useEffect, useState } from 'react';

import Button from '../ui/Button';
import { clearProfile } from './relight/adaptiveQuality';
import { useRelightStatus } from './relight/status';

export default function RelightStatus() {
  const status = useRelightStatus();
  const [supportOpen, setSupportOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState(null);

  const resetSettings = () => {
    setResetError(null);
    if (!clearProfile()) {
      setResetError('Your browser blocked access to saved settings. Allow site storage and try again.');
      return;
    }
    setResetting(true);
    window.location.reload();
  };

  return (
    <details
      id="relight-status"
      className="group mt-10 rounded-card border border-line/9 bg-bg/80 text-sm text-ink-3"
    >
      <summary className="flex cursor-pointer select-none list-none items-start gap-3 p-5 sm:p-6 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-ink-3">
            Backdrop renderer
          </span>
          <span className="mt-2 block text-ink-2">
            <Summary status={status} />
          </span>
        </span>
        <Chevron className="mt-0.5 group-open:rotate-180" />
      </summary>

      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        {status.phase === 'running' && <Config status={status} />}

        <div className="mt-5 border-t border-line/9 pt-5">
          <Button size="sm" onClick={resetSettings} disabled={resetting} aria-describedby="relight-reset-description">
            {resetting ? 'Reloading…' : 'Clear cached settings'}
          </Button>
          <p id="relight-reset-description" className="mt-2 text-xs leading-5">
            Clears saved renderer settings and reloads this page to tune them again for your device.
          </p>
          {resetError && <p role="alert" className="mt-2 text-xs leading-5 text-ink-2">{resetError}</p>}
        </div>

        <details className="group/support mt-5" onToggle={(event) => setSupportOpen(event.currentTarget.open)}>
          <summary className="flex cursor-pointer select-none list-none items-center gap-2 text-ink-2 transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
            What your browser supports
            <Chevron className="group-open/support:rotate-180" />
          </summary>
          {supportOpen && <BrowserSupport />}
        </details>
      </div>
    </details>
  );
}

function Chevron({ className = '' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`h-4 w-4 shrink-0 text-ink-3 transition-transform duration-200 ${className}`}
    >
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Summary({ status }) {
  switch (status.phase) {
    case 'loading':
      return 'The relit Cornell box is loading…';
    case 'failed':
      return `The relit Cornell box is off here (${status.reason}), so the knot stands in.`;
    case 'running':
      return status.backend === 'webgpu'
        ? `A neural network relights the Cornell box live on WebGPU${status.half ? ', in 16-bit floats' : ''}.`
        : `A neural network relights the Cornell box live on WebGL2${status.notGPU ? `, as ${status.notGPU}` : ''}.`;
    default:
      return 'The relit Cornell box isn’t running on this page.';
  }
}

const ordinal = (n) => `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
const every = (stride) => (stride <= 1 ? 'every pixel' : `every ${ordinal(stride)} pixel`);
const WEBGPU_KERNEL = /^(\d+)x(\d+)(?:c(\d+))?$/;
const WEBGL_KERNEL = /^o(\d+)$/;
const CHANNELS_PER_GROUP = 4;
const describeKernel = (name) => {
  const [kernel, note] = name.split(', ');
  const gpu = WEBGPU_KERNEL.exec(kernel);
  const gl = WEBGL_KERNEL.exec(kernel);
  let text = kernel;
  if (gpu) {
    const [, threads, pixels, channelGroups] = gpu;
    const channels = channelGroups ? ` by ${CHANNELS_PER_GROUP * channelGroups} channels` : '';
    text = `${threads} threads a workgroup, ${pixels} pixels${channels} each`;
  } else if (gl) {
    const [, outputGroups] = gl;
    text = `${outputGroups} output group${outputGroups === '1' ? '' : 's'} a pass`;
  }
  return note ? `${text} (${note})` : text;
};

function Config({ status: s }) {
  const rows = [
    ['Backend', s.backend === 'webgpu' ? 'WebGPU (compute shader)' : 'WebGL2 (fragment passes)'],
    [
      'Precision',
      s.backend === 'webgpu'
        ? s.half
          ? '16-bit floats (shader-f16)'
          : '32-bit floats'
        : '32-bit maths, 16-bit activations',
    ],
    [
      'Network',
      !s.network || s.network === '128x4'
        ? '128 wide, 4 layers'
        : `${s.network.replace('x', ' wide, ')} layers (the lighter one, for this GPU)`,
    ],
    ['Source image', `${s.size} × ${s.size} px${s.upgrading ? ', loading another' : ''}`],
    ...(Number.isFinite(s.shownPx) ? [['Displayed room', `${Math.round(s.shownPx)} px across`]] : []),
    ['GPU', s.gpu],
    ...(s.kernel ? [['Kernel', describeKernel(s.kernel)]] : []),
    [
      'One light, every pixel',
      s.cost === null ? 'measuring…' : `${s.cost} ms${s.seeded ? ' (provisional estimate)' : ''}`,
    ],
    ['Network budget', `${s.budget} ms an update`],
    ['Moving light', every(s.moving)],
    ['Resting light', s.converged === true
      ? 'every pixel, complete'
      : Number.isFinite(s.refining)
        ? `${Math.round(s.refining * 100)}% complete; converges to every pixel`
        : `converges to ${every(s.resting)}`],
    ...(typeof s.fillPrepared === 'boolean' ? [['Stationary light', s.fillPrepared ? 'preparation started while loading' : 'refined during rendering']] : []),
    ['Pixel ratio', `${s.dpr}×`],
    ['Lighting target', `${s.fps} updates a second`],
    ['Room layer', s.fixedLayer ? `fixed to the screen, at ${s.roomDpr}×` : 'scrolls with the page'],
    ['Settings', s.fromProfile ? 'saved starting point; checked again this visit' : 'being tuned on this visit'],
    [
      'Warm-up',
      s.prepared === 'timed'
        ? 'built and timed while the page loaded'
        : s.prepared === 'built'
          ? 'built while the page loaded'
          : 'none; built when the room started',
    ],
  ];
  return <Rows rows={rows} className="mt-4" />;
}

function Rows({ rows, className = '' }) {
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-[minmax(10rem,auto)_1fr] ${className}`}>
      {rows.map(([label, value, note]) => (
        <div key={label} className="contents">
          <dt className="text-ink-3">{label}</dt>
          <dd className="mb-1.5 font-mono text-xs leading-5 text-ink-2 sm:mb-0">
            {value}
            {note && <span className="ml-2 font-sans text-ink-3">· {note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const yes = (flag) => (flag ? 'yes' : 'no');

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return '—';
  }
  if (bytes >= 1 << 30) {
    return `${+(bytes / (1 << 30)).toFixed(1)} GB`;
  }
  if (bytes >= 1 << 20) {
    return `${Math.round(bytes / (1 << 20))} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

async function probeWebGPU() {
  const out = { api: !!navigator.gpu, secure: window.isSecureContext };
  if (!out.api) {
    return out;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return out;
    }
    const info = adapter.info || (await adapter.requestAdapterInfo?.()) || {};
    out.adapter =
      [info.vendor, info.architecture, info.description || info.device].filter(Boolean).join(' · ') ||
      'unnamed adapter';
    out.fallback = adapter.isFallbackAdapter ?? info.isFallbackAdapter ?? false;
    out.features = [...adapter.features].sort();
    out.limits = adapter.limits;
  } catch (error) {
    out.error = error.message;
  }
  return out;
}

function probeWebGL() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    return { webgl2: false, webgl1: !!document.createElement('canvas').getContext('webgl') };
  }
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const out = {
    webgl2: true,
    renderer: String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    version: String(gl.getParameter(gl.VERSION)),
    floatTargets: !!gl.getExtension('EXT_color_buffer_float'),
    halfTargets: !!gl.getExtension('EXT_color_buffer_half_float'),
    timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    drawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
    uniformBlock: gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE),
  };
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return out;
}

function probeDevice() {
  const media = (query) => window.matchMedia?.(query).matches ?? false;
  const connection = navigator.connection;
  return {
    offscreen: typeof OffscreenCanvas !== 'undefined',
    bitmap: typeof createImageBitmap !== 'undefined',
    memory: navigator.deviceMemory,
    cores: navigator.hardwareConcurrency,
    dpr: window.devicePixelRatio || 1,
    screen: `${window.screen.width} × ${window.screen.height}`,
    touch: media('(pointer: coarse)'),
    reducedMotion: media('(prefers-reduced-motion: reduce)'),
    network: connection?.effectiveType,
    saveData: !!connection?.saveData,
  };
}

function BrowserSupport() {
  const [probe, setProbe] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const webgl = probeWebGL();
    const device = probeDevice();
    probeWebGPU().then((webgpu) => {
      if (!cancelled) {
        setProbe({ webgpu, webgl, device });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!probe) {
    return <p className="mt-3">Asking your browser…</p>;
  }
  const { webgpu: g, webgl: w, device: d } = probe;
  const has = (feature) => !!g.features?.includes(feature);

  const gpuRows = [
    ['WebGPU', yes(g.api), g.api ? 'runs the network' : g.secure ? 'not in this browser' : 'needs HTTPS'],
  ];
  if (g.api) {
    gpuRows.push(['Adapter', g.adapter || (g.error ? `none (${g.error})` : 'none offered for this GPU')]);
  }
  if (g.adapter) {
    gpuRows.push(
      ['Software fallback', yes(g.fallback)],
      ['shader-f16', yes(has('shader-f16')), 'runs the network in 16-bit floats'],
      ['timestamp-query', yes(has('timestamp-query')), 'times the network on the GPU'],
      [
        'Workgroup memory',
        formatBytes(g.limits.maxComputeWorkgroupStorageSize),
        'the network needs 5–18 KB, depending on precision',
      ],
      ['Threads per workgroup', String(g.limits.maxComputeInvocationsPerWorkgroup)],
      ['Largest storage buffer', formatBytes(g.limits.maxStorageBufferBindingSize)],
      ['Features', g.features.length ? g.features.join(', ') : 'none']
    );
  }

  const glRows = [['WebGL2', yes(w.webgl2), w.webgl2 ? 'runs the network where WebGPU can’t' : null]];
  if (w.webgl2) {
    glRows.push(
      ['Renderer', w.renderer],
      ['Version', w.version],
      [
        'Float render targets',
        w.floatTargets ? '32-bit' : w.halfTargets ? '16-bit only' : 'no',
        'needed by the WebGL network',
      ],
      ['Timer queries', yes(w.timer), 'times the WebGL network on the GPU'],
      ['Largest texture', `${w.maxTexture} px`],
      ['Draw buffers', String(w.drawBuffers), 'layer outputs per pass'],
      ['Uniform block', formatBytes(w.uniformBlock), 'weights per pass']
    );
  } else {
    glRows.push(['WebGL 1', yes(w.webgl1)]);
  }

  const deviceRows = [
    ['OffscreenCanvas', yes(d.offscreen), 'hands each image to the page'],
    ['ImageBitmap', yes(d.bitmap)],
    ['Memory', d.memory ? `${d.memory} GB or more` : 'not reported', 'the largest image needs 4 GB'],
    ['CPU threads', d.cores ? String(d.cores) : 'not reported'],
    ['Screen', `${d.screen} at ${d.dpr}×`],
    ['Touch screen', yes(d.touch)],
    ['Reduced motion', yes(d.reducedMotion)],
    ['Connection', d.network || 'not reported', d.saveData ? 'data saver is on: the room stays off' : null],
  ];

  return (
    <div className="mt-4 space-y-6">
      <Group title="WebGPU" rows={gpuRows} />
      <Group title="WebGL" rows={glRows} />
      <Group title="This device" rows={deviceRows} />
    </div>
  );
}

function Group({ title, rows }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink-3">{title}</h3>
      <Rows rows={rows} />
    </div>
  );
}

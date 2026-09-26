import { useFrame } from '@react-three/fiber';
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { apiUrl } from '../../utils/api';
import useCardLights from './useCardLights';

// Backdrops for the project pages. Both are still, quiet, and taken from the
// project itself, so the glass panels have something precise to bend without
// a decoration competing with the text.

// '#f1e05a' -> [r, g, b] in 0..1, left in sRGB like the rest of these shaders
function hexToRgb(hex) {
  const value = parseInt(String(hex || '').replace('#', ''), 16);
  if (Number.isNaN(value)) {
    return null;
  }
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function FullScreenPlane({ uniforms, fragmentShader }) {
  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

// ─── CS: drafting grid ─────────────────────────────────────────────────────
// A fine, still dot grid like engineering paper, with every fifth dot a little
// heavier. The repo's main language colour sits in a faint glow at the top of
// the page and scrolls away with it; without one, the CS lens colour is used.
// Under the hovered glass pane a faint white band runs along its edge, as in
// the CS gallery's liquid, which the pane's glass bends and splits into colour.
export function DraftingGrid({ lens, accent }) {
  const uniforms = useMemo(
    () => ({
      dpr: { value: 1 },
      viewport: { value: new THREE.Vector2(1, 1) },
      scroll: { value: 0 },
      accent: { value: new THREE.Vector3(...(lens?.a || [0.6, 0.7, 1])) },
      // two pane lights (left, top, right, bottom in px) and how lit each is
      focusA: { value: new THREE.Vector4(0, 0, 0, 0) },
      focusAAmount: { value: 0 },
      focusB: { value: new THREE.Vector4(0, 0, 0, 0) },
      focusBAmount: { value: 0 },
    }),
    [lens]
  );
  const updateLights = useCardLights();

  useFrame(({ size, viewport }, delta) => {
    uniforms.dpr.value = viewport.dpr;
    uniforms.viewport.value.set(size.width, size.height);
    uniforms.scroll.value = window.scrollY;
    const rgb = hexToRgb(accent) || lens?.a;
    if (rgb) {
      uniforms.accent.value.set(...rgb);
    }

    const [lightA, lightB] = updateLights(document, size, delta);
    uniforms.focusAAmount.value = lightA ? lightA[4] : 0;
    uniforms.focusBAmount.value = lightB ? lightB[4] : 0;
    if (lightA) {
      uniforms.focusA.value.set(lightA[0], lightA[1], lightA[2], lightA[3]);
    }
    if (lightB) {
      uniforms.focusB.value.set(lightB[0], lightB[1], lightB[2], lightB[3]);
    }
  });

  return <FullScreenPlane uniforms={uniforms} fragmentShader={gridFragmentShader} />;
}

// ─── Art: the project's cover ──────────────────────────────────────────────
// The cover image, cropped to fill the screen, heavily blurred and dimmed,
// darkest toward the bottom where the reading is. It fades in once loaded;
// until then (or if it can't load) the page is plain near-black.
export function CoverBackdrop({ image }) {
  const texture = useRef(null);
  const loadedAt = useRef(null);
  const uniforms = useMemo(
    () => ({
      dpr: { value: 1 },
      viewport: { value: new THREE.Vector2(1, 1) },
      scroll: { value: 0 },
      tCover: { value: null },
      coverSize: { value: new THREE.Vector2(1, 1) },
      ready: { value: 0 },
    }),
    []
  );

  useEffect(() => {
    if (!image) {
      return undefined;
    }
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    // ArtStation's CDN sends no CORS headers, so it comes through the API
    loader.load(
      apiUrl(`/proxy/image?url=${encodeURIComponent(image)}`),
      (loaded) => {
        if (cancelled) {
          loaded.dispose();
          return;
        }
        loaded.generateMipmaps = true;
        loaded.minFilter = THREE.LinearMipmapLinearFilter;
        loaded.needsUpdate = true;
        texture.current?.dispose();
        texture.current = loaded;
        uniforms.tCover.value = loaded;
        uniforms.coverSize.value.set(loaded.image.width || 1, loaded.image.height || 1);
        loadedAt.current = null;
      },
      undefined,
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [image, uniforms]);

  useEffect(() => () => texture.current?.dispose(), []);

  useFrame(({ clock, size, viewport }) => {
    uniforms.dpr.value = viewport.dpr;
    uniforms.viewport.value.set(size.width, size.height);
    uniforms.scroll.value = window.scrollY;
    if (uniforms.tCover.value) {
      if (loadedAt.current === null) {
        loadedAt.current = clock.getElapsedTime();
      }
      uniforms.ready.value = Math.min(1, (clock.getElapsedTime() - loadedAt.current) / 0.8);
    }
  });

  return <FullScreenPlane uniforms={uniforms} fragmentShader={coverFragmentShader} />;
}

const vertexShader = `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const gridFragmentShader = `
  #define SPACING 24.0

  uniform float dpr;
  uniform vec2 viewport;
  uniform float scroll;
  uniform vec3 accent;
  uniform vec4 focusA;
  uniform float focusAAmount;
  uniform vec4 focusB;
  uniform float focusBAmount;

  float sdRoundBox(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  // The light under one pane (rect: left, top, right, bottom), matching the
  // CS gallery's: a faint white band along its edge, strongest in and near
  // its rounded corners, with a little spill outside. The middle stays dark.
  vec3 paneLight(vec2 p, vec4 rect, float amount) {
    vec2 center = 0.5 * (rect.xy + rect.zw);
    vec2 halfSize = 0.5 * (rect.zw - rect.xy);
    float df = sdRoundBox(p - center, halfSize, 24.0);
    vec2 fromCorner = abs(p - center) - (halfSize - 24.0);
    float corner = smoothstep(-90.0, 0.0, min(fromCorner.x, fromCorner.y));
    float band = exp(-abs(df) / 6.0) * mix(0.12, 1.0, corner);
    float spill = df > 0.0 ? exp(-df / 60.0) * 0.04 : 0.0;
    return vec3(1.0) * (band * 0.28 + spill) * amount;
  }

  void main() {
    // CSS pixels, y down, with the grid centred on the page's middle column
    vec2 px = vec2(gl_FragCoord.x, viewport.y * dpr - gl_FragCoord.y) / dpr;
    vec2 g = px - vec2(viewport.x * 0.5, 0.0);

    vec2 index = floor(g / SPACING + 0.5);
    vec2 cell = g - index * SPACING;
    vec2 every5 = abs(mod(index, 5.0));
    bool major = every5.x < 0.5 && every5.y < 0.5;

    float radius = major ? 1.3 : 0.95;
    float d = length(cell) - radius;
    float dotMask = 1.0 - smoothstep(-0.6, 0.6, d);

    // the language glow belongs to the top of the page, so it scrolls away
    vec2 glowAt = vec2(viewport.x * 0.5, 140.0 - scroll);
    vec2 offset = (px - glowAt) / vec2(640.0, 420.0);
    float glow = exp(-dot(offset, offset));

    vec3 base = vec3(0.031, 0.035, 0.047) + accent * 0.06 * glow;
    vec3 ink = mix(vec3(1.0), accent, 0.55 * glow);
    float strength = (major ? 0.26 : 0.13) * (0.75 + 0.5 * glow);

    // the grid thins out toward the screen's edges
    vec2 uv = gl_FragCoord.xy / (viewport * dpr);
    float falloff = smoothstep(1.0, 0.35, length((uv - 0.5) * vec2(1.1, 1.3)));

    vec3 color = base + ink * dotMask * strength * mix(0.45, 1.0, falloff);
    if (focusAAmount > 0.001) color += paneLight(px, focusA, focusAAmount);
    if (focusBAmount > 0.001) color += paneLight(px, focusB, focusBAmount);
    color += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    gl_FragColor = vec4(color, 1.0);
  }
`;

const coverFragmentShader = `
  uniform float dpr;
  uniform vec2 viewport;
  uniform float scroll;
  uniform sampler2D tCover;
  uniform vec2 coverSize;
  uniform float ready;

  void main() {
    vec2 uv = gl_FragCoord.xy / (viewport * dpr);
    vec3 base = vec3(0.031, 0.035, 0.047);
    vec3 color = base;

    if (ready > 0.0) {
      // Crop the cover to fill the screen, zoomed in a little, and let it
      // drift up slightly as the page scrolls
      float screenAspect = viewport.x / viewport.y;
      float imageAspect = coverSize.x / coverSize.y;
      vec2 fit = screenAspect > imageAspect
        ? vec2(1.0, imageAspect / screenAspect)
        : vec2(screenAspect / imageAspect, 1.0);
      vec2 tuv = (uv - 0.5) * fit / 1.2 + 0.5;
      tuv.y += min(scroll / viewport.y, 3.0) * 0.03;

      // A heavy blur from the texture's small mip levels, smoothed with a
      // ring of taps so the levels don't show as blocks
      vec3 image = texture2D(tCover, tuv, 6.0).rgb * 0.2;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        image += texture2D(tCover, tuv + vec2(cos(a), sin(a)) * 0.035, 6.5).rgb * 0.1;
      }

      // Dim and slightly desaturate, darkest at the bottom and the edges
      float luma = dot(image, vec3(0.2126, 0.7152, 0.0722));
      image = mix(vec3(luma), image, 0.8);
      float fromBottom = smoothstep(0.0, 0.9, uv.y);
      float vignette = smoothstep(1.2, 0.3, length((uv - 0.5) * vec2(1.2, 1.0)));
      color = mix(base, base + image * 0.5 * mix(0.45, 1.0, fromBottom) * vignette, ready);
    }

    color += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    gl_FragColor = vec4(color, 1.0);
  }
`;

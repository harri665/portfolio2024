import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

// Refracts the scene through DOM elements, like Apple's clear glass. The
// scene renders to a texture, then a full-screen pass copies it back, bending
// it inward along each glass edge as a thick pane would. Red, green and blue
// sit slightly apart, so light through the glass splits like a prism.
//
// - `selector` matches panes (the hub cards): rounded rects whose highlights
//   are drawn in CSS on top.
// - `textSelector` matches one text element whose glyphs become glass. Its
//   words are rasterised into a mask plus a softened height field, whose
//   slope gives each glyph a bevelled edge to refract and catch the light.
//   Once the glass is drawing, the element gets `data-glass-ready` so CSS
//   can hide the DOM text (it stays for layout, selection and screen readers).
//
// The frosted fill and highlights of glass text have to sit above the page's
// dimming, so this pass also applies the dim (`sceneDim`, phone / sm and up)
// and the backdrop vignette itself, instead of CSS layers over the canvas.
// With `shade` off (the gallery pages, which fade their own CSS vignette as
// the liquid fills in) it only frosts and bends the scene.
//
// `frost` is the blur radius (px) through the glass. The project pages turn it
// down so their backdrop's lines stay sharp enough to see bend at the rim.
// `blurTaps` is how many samples spread across that blur; phones use fewer.
// Enough for every gallery card on screen at once; off-screen ones are skipped
const MAX_PANES = 16;

export default function LiquidGlassPass({
  selector,
  textSelector,
  sceneDim = [0.6, 0.7],
  shade = true,
  frost = 5,
  blurTaps = 12,
}) {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  const target = useMemo(() => new THREE.WebGLRenderTarget(1, 1), []);
  const radii = useRef(new WeakMap());
  // Each pane's current glass strength, eased toward its target
  const strengths = useRef(new WeakMap());
  const text = useRef({ el: null, observer: null, texture: null, pad: 0, ready: false });

  const pass = useMemo(() => {
    const emptyText = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    emptyText.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: target.texture },
        viewport: { value: new THREE.Vector2(1, 1) },
        sceneDim: { value: 1 },
        shadeScene: { value: 1 },
        frost: { value: 5 },
        panes: { value: Array.from({ length: MAX_PANES }, () => new THREE.Vector4()) },
        paneRadii: { value: new Array(MAX_PANES).fill(0) },
        paneOpacity: { value: new Array(MAX_PANES).fill(1) },
        paneStrength: { value: new Array(MAX_PANES).fill(1) },
        paneCount: { value: 0 },
        tText: { value: emptyText },
        textRect: { value: new THREE.Vector4() },
        textTexel: { value: new THREE.Vector2(1, 1) },
        textSigma: { value: 1 },
        textDepth: { value: 0 },
        textOpacity: { value: 0 },
      },
      vertexShader: passVertexShader,
      fragmentShader: passFragmentShader(blurTaps),
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return { material, scene, camera, emptyText };
  }, [target, blurTaps]);

  useEffect(() => {
    target.setSize(Math.round(size.width * dpr), Math.round(size.height * dpr));
  }, [target, size.width, size.height, dpr]);

  // Border radii only change with breakpoints, so read them once per resize
  useEffect(() => {
    const reset = () => {
      radii.current = new WeakMap();
    };
    window.addEventListener('resize', reset);
    return () => window.removeEventListener('resize', reset);
  }, []);

  useEffect(() => {
    const textState = text.current;
    return () => {
      detachText(textState);
      target.dispose();
      pass.material.dispose();
      pass.emptyText.dispose();
      pass.scene.children[0].geometry.dispose();
    };
  }, [target, pass]);

  // Re-rasterises the glass text whenever it resizes or its font loads
  function attachText(el) {
    const textState = text.current;
    detachText(textState);
    textState.el = el;

    const rebuild = () => {
      if (textState.el !== el || !el.isConnected) {
        return;
      }
      const glyphs = rasterizeText(el);
      if (!glyphs) {
        return;
      }
      textState.texture?.dispose();
      textState.texture = glyphs.texture;
      textState.pad = glyphs.pad;
      textState.ready = true;

      const { uniforms } = pass.material;
      uniforms.tText.value = glyphs.texture;
      uniforms.textTexel.value.set(1 / glyphs.width, 1 / glyphs.height);
      uniforms.textSigma.value = glyphs.sigma;
      uniforms.textDepth.value = glyphs.depth;
    };

    textState.observer = new ResizeObserver(rebuild);
    textState.observer.observe(el);
    document.fonts?.ready.then(rebuild);
  }

  // Priority 1 takes over rendering from R3F for this canvas
  useFrame(({ scene, camera }, delta) => {
    const canvasRect = gl.domElement.getBoundingClientRect();
    const { uniforms } = pass.material;
    uniforms.viewport.value.set(canvasRect.width, canvasRect.height);
    uniforms.sceneDim.value = canvasRect.width >= 640 ? sceneDim[1] : sceneDim[0];
    uniforms.shadeScene.value = shade ? 1 : 0;
    uniforms.frost.value = frost;

    let count = 0;
    if (selector) {
      document.querySelectorAll(selector).forEach((el) => {
        if (count >= MAX_PANES) {
          return;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.bottom < 0 || rect.top > canvasRect.height) {
          return;
        }
        let radius = radii.current.get(el);
        if (radius === undefined) {
          radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
          radii.current.set(el, radius);
        }
        uniforms.panes.value[count].set(
          rect.left - canvasRect.left + rect.width / 2,
          rect.top - canvasRect.top + rect.height / 2,
          rect.width / 2,
          rect.height / 2
        );
        uniforms.paneRadii.value[count] = Math.min(radius, rect.width / 2, rect.height / 2);
        // Follow the pane's own fade (set inline by its reveal animation)
        const opacity = parseFloat(el.style.opacity);
        uniforms.paneOpacity.value[count] = Number.isNaN(opacity) ? 1 : opacity;
        // data-liquid-glass="1.8" thickens a pane's glass; a bare attribute is 1
        // A thick pane only thickens while it's hovered (or, on touch
        // screens, in focus), easing in and out; otherwise it's standard glass
        const thick = parseFloat(el.dataset.liquidGlass);
        const active = el.matches(':hover') || el.hasAttribute('data-focus');
        const target = !Number.isNaN(thick) && active ? thick : 1;
        const current = strengths.current.get(el) ?? 1;
        const strength = current + (target - current) * (1 - Math.exp(-delta * 10));
        strengths.current.set(el, strength);
        uniforms.paneStrength.value[count] = strength;
        count += 1;
      });
    }
    uniforms.paneCount.value = count;

    const textState = text.current;
    if (textSelector && !textState.el?.isConnected) {
      const el = document.querySelector(textSelector);
      if (el) {
        attachText(el);
      }
    }
    if (textState.ready && textState.el?.isConnected) {
      const rect = textState.el.getBoundingClientRect();
      const { pad } = textState;
      uniforms.textRect.value.set(
        rect.left - canvasRect.left - pad,
        rect.top - canvasRect.top - pad,
        rect.width + pad * 2,
        rect.height + pad * 2
      );
      // Follow the element's own fade-in
      const opacity = parseFloat(textState.el.style.opacity);
      uniforms.textOpacity.value = Number.isNaN(opacity) ? 1 : opacity;
    } else {
      uniforms.textOpacity.value = 0;
    }

    gl.setRenderTarget(target);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    gl.render(pass.scene, pass.camera);

    if (textState.ready && textState.el && !('glassReady' in textState.el.dataset)) {
      textState.el.dataset.glassReady = '';
    }
  }, 1);

  return null;
}

function detachText(textState) {
  textState.observer?.disconnect();
  textState.texture?.dispose();
  if (textState.el) {
    delete textState.el.dataset.glassReady;
  }
  textState.el = null;
  textState.observer = null;
  textState.texture = null;
  textState.ready = false;
}

// Draws each word of `el` where the DOM laid it out, into a texture holding
// the glyph coverage (red) and a blurred copy of it (green). The blur acts as
// the height of a bevel: its slope is steep at the glyph edge and flat in the
// middle of each stroke. The texture is padded so the bevel isn't clipped.
function rasterizeText(el) {
  const box = el.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) {
    return null;
  }

  const style = getComputedStyle(el);
  const fontSize = parseFloat(style.fontSize) || 16;
  const pad = Math.ceil(fontSize * 0.2);
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.ceil((box.width + pad * 2) * scale);
  const height = Math.ceil((box.height + pad * 2) * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.scale(scale, scale);
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  if ('letterSpacing' in ctx && style.letterSpacing !== 'normal') {
    ctx.letterSpacing = style.letterSpacing;
  }
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';

  // Word by word, so the canvas follows the DOM's own line breaks
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const words = /\S+/g;
    let match;
    while ((match = words.exec(node.textContent))) {
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const rect = range.getBoundingClientRect();
      const metrics = ctx.measureText(match[0]);
      const ascent = metrics.fontBoundingBoxAscent ?? fontSize * 0.92;
      const descent = metrics.fontBoundingBoxDescent ?? fontSize * 0.24;
      const baseline = rect.top - box.top + (rect.height - ascent - descent) / 2 + ascent;
      ctx.fillText(match[0], rect.left - box.left + pad, baseline + pad);
    }
  }

  const pixels = ctx.getImageData(0, 0, width, height).data;
  const coverage = new Float32Array(width * height);
  for (let i = 0; i < coverage.length; i += 1) {
    coverage[i] = pixels[i * 4 + 3] / 255;
  }

  // Three box blurs approximate a Gaussian; sigma is in texels
  const radius = Math.max(1, Math.round(fontSize * 0.022 * scale));
  let bevel = coverage;
  for (let i = 0; i < 3; i += 1) {
    bevel = boxBlur(bevel, width, height, radius);
  }
  const sigma = Math.sqrt(((2 * radius + 1) ** 2 - 1) / 4);

  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < coverage.length; i += 1) {
    data[i * 4] = Math.round(coverage[i] * 255);
    data[i * 4 + 1] = Math.round(bevel[i] * 255);
    data[i * 4 + 3] = 255;
  }
  // Rows run top to bottom, matching the shader's y-down coordinates
  const texture = new THREE.DataTexture(data, width, height);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  return { texture, width, height, pad, sigma, depth: fontSize * 0.12 };
}

function boxBlur(source, width, height, radius) {
  const span = radius * 2 + 1;
  const horizontal = new Float32Array(source.length);
  const out = new Float32Array(source.length);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) {
      sum += source[row + Math.min(Math.max(x, 0), width - 1)];
    }
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = sum / span;
      sum +=
        source[row + Math.min(x + radius + 1, width - 1)] -
        source[row + Math.max(x - radius, 0)];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) {
      sum += horizontal[Math.min(Math.max(y, 0), height - 1) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / span;
      sum +=
        horizontal[Math.min(y + radius + 1, height - 1) * width + x] -
        horizontal[Math.max(y - radius, 0) * width + x];
    }
  }

  return out;
}

const passVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// All glass maths is in CSS pixels with y pointing down, matching the DOM
const passFragmentShader = (blurTaps) => `
  #define MAX_PANES ${MAX_PANES}
  // Prism split: how far (px) red and blue sit either side of green across
  // the whole pane, and how much further apart they bend at the rim
  #define SPLIT 5.5
  #define EDGE_DISPERSION 0.6
  // Frost: how many samples spread across the blur
  #define BLUR_TAPS ${blurTaps}
  // Glass text: its white frosting, and how bright its lit edges get
  #define TEXT_FROST 0.18
  #define TEXT_SPECULAR 0.9

  uniform sampler2D tScene;
  uniform vec2 viewport;
  uniform float sceneDim;
  uniform float shadeScene;
  uniform float frost;
  uniform vec4 panes[MAX_PANES];
  uniform float paneRadii[MAX_PANES];
  uniform float paneOpacity[MAX_PANES];
  uniform float paneStrength[MAX_PANES];
  uniform int paneCount;

  uniform sampler2D tText;
  uniform vec4 textRect;
  uniform vec2 textTexel;
  uniform float textSigma;
  uniform float textDepth;
  uniform float textOpacity;

  varying vec2 vUv;

  float sdRoundRect(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  vec4 sampleAt(vec2 px) {
    vec2 uv = vec2(px.x / viewport.x, 1.0 - px.y / viewport.y);
    return texture2D(tScene, clamp(uv, 0.0, 1.0));
  }

  // A soft disc blur: taps on a golden-angle spiral, weighted toward the
  // centre so it reads as frosting rather than a smear
  vec4 blurredAt(vec2 px) {
    vec4 sum = sampleAt(px);
    float total = 1.0;
    for (int k = 1; k <= BLUR_TAPS; k++) {
      float f = float(k) / float(BLUR_TAPS);
      float angle = float(k) * 2.39996;
      vec2 tap = vec2(cos(angle), sin(angle)) * sqrt(f) * frost;
      float weight = 1.0 - 0.6 * f;
      sum += sampleAt(px + tap) * weight;
      total += weight;
    }
    return sum / total;
  }

  // The frosted, prism-split view through glass, with the scene bent by
  // offset (px). The channels sit slightly apart along one diagonal, and
  // bend by different amounts so the spectrum fans out where glass curves.
  // How far a pane has turned from standard glass into a lens (0..1)
  float lensAmount(float strength) {
    return clamp((strength - 1.0) / 0.4, 0.0, 1.0);
  }

  // As a pane turns into a lens it drops the fixed diagonal split, so its
  // colour comes only from the bend and fans out evenly around every edge
  vec4 throughGlass(vec2 px, vec2 offset, float strength) {
    vec2 split = normalize(vec2(1.0, -0.4)) * SPLIT * (1.0 - lensAmount(strength));
    float dispersion = EDGE_DISPERSION;
    vec4 red = blurredAt(px + offset * (1.0 + dispersion) + split);
    vec4 green = blurredAt(px + offset);
    vec4 blue = blurredAt(px + offset * (1.0 - dispersion) - split);
    vec4 glass = vec4(red.r, green.g, blue.b, max(red.a, max(green.a, blue.a)));
    glass.rgb *= 1.06;
    return glass;
  }

  // The backdrop's dimming and vignette, matching the CSS it replaces:
  // radial-gradient(circle, 0.12, 0.58 56%, 0.95 82%) of #08090c
  vec4 shade(vec4 color, vec2 px) {
    if (shadeScene < 0.5) return color;
    color *= sceneDim;
    float r = length(px - viewport * 0.5) / length(viewport * 0.5);
    float a = r < 0.56
      ? mix(0.12, 0.58, r / 0.56)
      : mix(0.58, 0.95, clamp((r - 0.56) / 0.26, 0.0, 1.0));
    return vec4(vec3(8.0, 9.0, 12.0) / 255.0 * a, a) + color * (1.0 - a);
  }

  // Premultiplied "top over bottom"
  vec4 over(vec4 top, vec4 bottom) {
    return top + bottom * (1.0 - top.a);
  }

  void main() {
    vec2 px = vec2(vUv.x, 1.0 - vUv.y) * viewport;
    vec4 color = texture2D(tScene, vUv);

    for (int i = 0; i < MAX_PANES; i++) {
      if (i >= paneCount) break;

      vec2 p = px - panes[i].xy;
      vec2 halfSize = panes[i].zw;
      float r = paneRadii[i];
      float d = sdRoundRect(p, halfSize, r);
      if (d > 1.0) continue;

      // Outward normal of the edge nearest this pixel
      vec2 e = vec2(0.5, 0.0);
      vec2 normal = normalize(vec2(
        sdRoundRect(p + e.xy, halfSize, r) - sdRoundRect(p - e.xy, halfSize, r),
        sdRoundRect(p + e.yx, halfSize, r) - sdRoundRect(p - e.yx, halfSize, r)
      ) + 1e-5);

      // A rounded bezel: steep at the rim, flat across the middle, so the
      // centre stays undistorted. Standard panes push the scene outward at
      // the edge; thick panes (strength > 1) act like a lens instead and pull
      // in what lies just beyond their edge, each colour channel from a
      // slightly different depth, so light at the edge splits into R, G, B.
      // The lens reaches only a short way, keeping those lines near the rim.
      float strength = paneStrength[i];
      float lens = lensAmount(strength);
      float bezel = clamp(r * 1.15, 14.0, 34.0) * strength;
      float t = clamp(-d / bezel, 0.0, 1.0);
      float bend = pow(1.0 - t, 2.4);
      float reach = mix(-0.7, 0.24, lens);
      vec2 offset = normal * reach * bend * bezel;

      // Antialias the silhouette, and fade with the pane
      float coverage = (1.0 - smoothstep(-1.0, 1.0, d)) * paneOpacity[i];
      color = mix(color, throughGlass(px, offset, strength), coverage);
    }

    color = shade(color, px);

    if (textOpacity > 0.0) {
      vec2 tuv = (px - textRect.xy) / textRect.zw;
      if (all(greaterThanEqual(tuv, vec2(0.0))) && all(lessThanEqual(tuv, vec2(1.0)))) {
        float coverage = texture2D(tText, tuv).r;

        if (coverage > 0.004) {
          // Slope of the bevel: points into the glyph, strongest at its edge
          vec2 grad = vec2(
            texture2D(tText, tuv + vec2(textTexel.x, 0.0)).g -
              texture2D(tText, tuv - vec2(textTexel.x, 0.0)).g,
            texture2D(tText, tuv + vec2(0.0, textTexel.y)).g -
              texture2D(tText, tuv - vec2(0.0, textTexel.y)).g
          );
          float slope = clamp(length(grad) * textSigma / 0.8, 0.0, 1.0);
          vec2 inward = grad / (length(grad) + 1e-5);

          // Like the panes, the bevel bends the scene toward the glyph's core
          vec4 glyph = shade(throughGlass(px, inward * slope * textDepth, 1.0), px);
          glyph = over(vec4(TEXT_FROST), glyph);

          // Light from the top left catches the edges facing it, with a
          // softer bounce on the far side
          float facing = dot(-inward, normalize(vec2(-1.0, -1.0)));
          float light = 0.15 + 0.85 * max(facing, 0.0) + 0.45 * max(-facing, 0.0);
          float specular = clamp(pow(slope, 2.5) * light * TEXT_SPECULAR, 0.0, 1.0);
          glyph = over(vec4(specular), glyph);

          color = mix(color, glyph, coverage * textOpacity);
        }
      }
    }

    gl_FragColor = color;
  }
`;

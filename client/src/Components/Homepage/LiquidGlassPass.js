import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { apiUrl } from '../../utils/api';

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
// - `glassOnly` draws the panes alone, transparent elsewhere, for a backdrop
//   shown on a layer of its own under this canvas (the CS home page's relit
//   room, which stays fixed while this canvas follows the scroll). The scene
//   still renders, for the glass to bend.
//
// - `imageSelector` matches <img>s inside panes (the art gallery thumbnails).
//   Each is drawn into the scene where the DOM laid it out, clipped to its
//   parent and its pane, so the glass bends, frosts and splits it like the
//   backdrop. Once drawn, the <img> gets `data-glass-ready` so CSS can fade
//   its edges and let the glass version show through along the rim.
//
// - `data-glass-merge="<n>"` on panes puts them in group n: the group is
//   drawn as one piece of glass, its panes' outlines blended together so one
//   flows into the next across a small gap (the CS project page's sidebar
//   into its document). CSS borders can't follow that outline, so the pass
//   draws a merged group's rim itself, and its tint (`data-glass-tint`, the
//   share of the page colour mixed in) for the text on it. While a pass is
//   mounted, <html> carries `data-glass-pass`, so CSS can leave that to it.
//
// - `data-glass-bevel` on a pane bevels its two bottom corners: the glass
//   bends deeper round them, catches light along the curve and shades just
//   inside it, like a thick cut edge (the CS home page's cards).
//
// `textFrost` is the glass text's own blur radius (px), `frost` unless given:
// the CS home page frosts its cards heavily but keeps its headline clear.
// `textLens` domes each glyph's face, so the whole letter bends the scene and
// not only its bevel: it pulls in what lies up to that share of the font
// size beyond, shrinking what's behind it. Against an even bright light (the
// CS home page's lamp) a flat glyph shows only that light and disappears;
// domed, it shows the light shrunk and the darker room drawn in around it.
// `textTint` is the colour the glass passes at its thickest, the middle of a
// stroke, fading to clear at the edges, as thick coloured glass does.
//
// `frost` is the blur radius (px) through the glass. The project pages turn it
// down so their backdrop's lines stay sharp enough to see bend at the rim.
// `blurTaps` is how many samples spread across that blur; phones use fewer.
// `haze` mixes that share of white into the view through every pane, the
// milkiness of frosted glass (the CS home page's cards).
// `data-glass-frost` (px) and `data-glass-haze` on a pane override `frost`
// and `haze` for it (the glass showcase sets clear and frosted side by side).
// `hover` ({ frost, split, dim }) changes the panes marked
// `data-glass-hover` as they're hovered (or, on touch screens, in focus),
// easing in and out: its blur widens by `frost`
// times, its prism split by `split` times, and it darkens by `dim`, so text
// on it stays readable with bright light behind it (the CS home page's lamp
// moves behind the hovered card). The scene is then kept with mipmaps, so
// the wider blur can sample a smaller copy and stay smooth.
// `rimCap` keeps a pane's bent rim to that share of its half-size, so small
// panes (the glass showcase's buttons) keep a flat, clear middle; the bend
// is as strong, just squeezed into the narrower rim. 0 leaves it uncapped.
// `adapt` darkens the view through glass by up to that share where what's
// behind is bright, so light text on it stays readable over a pale picture.
// Enough for every gallery card on screen at once; off-screen ones are skipped
const MAX_PANES = 16;

// How many passes are drawing, for <html data-glass-pass>
let mountedPasses = 0;

// Where merged panes join, the glass ripples while the page scrolls (the rest
// of their outline stays still): how much follows the scroll's
// speed, rising quickly and settling over about a third of a second after it
// stops. Worked out once a frame and shared, so the CS project page's two
// canvases (its main one and its sidebar strip) ripple as one.
const WAVE_FULL_SPEED = 2500; // px/s of scrolling for the full ripple
const wave = { key: null, y: 0, t: 0, amount: 0 };

function scrollWave() {
  // the same for every callback within one frame
  const key = document.timeline?.currentTime ?? performance.now();
  if (key === wave.key) return wave;
  const now = performance.now() / 1000;
  const y = window.scrollY;
  const dt = wave.key === null ? 0 : Math.min(Math.max(now - wave.t, 1 / 240), 0.1);
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const target = still || !dt ? 0 : Math.min(Math.abs(y - wave.y) / dt / WAVE_FULL_SPEED, 1);
  const rate = target > wave.amount ? 12 : 4;
  wave.amount += (target - wave.amount) * (1 - Math.exp(-rate * dt));
  wave.key = key;
  wave.y = y;
  wave.t = now;
  return wave;
}

export default function LiquidGlassPass({
  selector,
  textSelector,
  imageSelector,
  sceneDim = [0.6, 0.7],
  shade = true,
  glassOnly = false,
  frost = 5,
  textFrost = frost,
  textLens = 0,
  textTint = [1, 1, 1],
  haze = 0,
  hover = null,
  blurTaps = 12,
  rimCap = 0,
  adapt = 0,
}) {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  const mipmaps = Boolean(hover);
  const target = useMemo(
    () =>
      new THREE.WebGLRenderTarget(
        1,
        1,
        mipmaps ? { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter } : undefined
      ),
    [mipmaps]
  );
  const radii = useRef(new WeakMap());
  // Each pane's current glass strength, eased toward its target
  const strengths = useRef(new WeakMap());
  // How hovered each pane is (0..1), eased, for `hover`
  const hovers = useRef(new WeakMap());
  const text = useRef({ el: null, observer: null, texture: null, pad: 0, ready: false });
  // Pane images' textures by src: a texture, or null while it loads or failed
  const images = useRef(new Map());
  // Whether each pane image is object-fit: contain (read once)
  const fits = useRef(new WeakMap());

  const pass = useMemo(() => {
    const emptyText = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    emptyText.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: target.texture },
        viewport: { value: new THREE.Vector2(1, 1) },
        sceneDim: { value: 1 },
        shadeScene: { value: 1 },
        glassOnly: { value: 0 },
        frost: { value: 5 },
        textFrost: { value: 5 },
        textLens: { value: 0 },
        textTint: { value: new THREE.Vector3(1, 1, 1) },
        haze: { value: 0 },
        hoverFrost: { value: 0 },
        hoverSplit: { value: 0 },
        hoverDim: { value: 0 },
        rimCap: { value: 0 },
        adapt: { value: 0 },
        paneHover: { value: new Array(MAX_PANES).fill(0) },
        panes: { value: Array.from({ length: MAX_PANES }, () => new THREE.Vector4()) },
        paneRadii: { value: new Array(MAX_PANES).fill(0) },
        paneOpacity: { value: new Array(MAX_PANES).fill(1) },
        paneStrength: { value: new Array(MAX_PANES).fill(1) },
        paneGlass: { value: Array.from({ length: MAX_PANES }, () => new THREE.Vector2(1, 1)) },
        paneMerge: { value: new Array(MAX_PANES).fill(0) },
        // the canvas's top left on screen, and the scroll ripple (see scrollWave)
        origin: { value: new THREE.Vector2() },
        waveAmount: { value: 0 },
        waveTime: { value: 0 },
        waveScroll: { value: 0 },
        paneTint: { value: new Array(MAX_PANES).fill(0) },
        paneBevel: { value: new Array(MAX_PANES).fill(0) },
        // per-pane frost and haze; below 0 means the pass's own
        paneFrost: { value: new Array(MAX_PANES).fill(-1) },
        paneHaze: { value: new Array(MAX_PANES).fill(-1) },
        paneCount: { value: 0 },
        tText: { value: emptyText },
        textRect: { value: new THREE.Vector4() },
        textTexel: { value: new THREE.Vector2(1, 1) },
        textSigma: { value: 1 },
        textDomeSigma: { value: 1 },
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
    const imageMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tImage: { value: null },
        viewport: { value: new THREE.Vector2(1, 1) },
        imageRect: { value: new THREE.Vector4() },
        imageSize: { value: new THREE.Vector2(1, 1) },
        contain: { value: 0 },
        clipRect: { value: new THREE.Vector4() },
        pane: { value: new THREE.Vector4() },
        paneRadius: { value: 0 },
        opacity: { value: 1 },
      },
      vertexShader: passVertexShader,
      fragmentShader: imageFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const imageScene = new THREE.Scene();
    imageScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), imageMaterial));

    return { material, scene, camera, emptyText, imageMaterial, imageScene };
  }, [target, blurTaps]);

  // Tells CSS a pass is drawing merged panes' glass (see data-glass-merge).
  // Counted, as a page can run two (the CS project page's sidebar strip).
  useEffect(() => {
    const root = document.documentElement;
    mountedPasses += 1;
    root.setAttribute('data-glass-pass', '');
    return () => {
      mountedPasses -= 1;
      if (mountedPasses === 0) root.removeAttribute('data-glass-pass');
    };
  }, []);

  // Whether the scene's smaller copies need building whatever's hovered: a
  // texture set up for mipmaps that has never had them built reads as black
  const mipsMissing = useRef(true);

  useEffect(() => {
    target.setSize(Math.round(size.width * dpr), Math.round(size.height * dpr));
    // resizing reallocates the texture, copies and all
    mipsMissing.current = true;
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
      pass.imageMaterial.dispose();
      pass.imageScene.children[0].geometry.dispose();
    };
  }, [target, pass]);

  useEffect(() => {
    const cache = images.current;
    return () => {
      cache.forEach((texture) => texture?.dispose());
      cache.clear();
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
      uniforms.textDomeSigma.value = glyphs.domeSigma;
      textState.fontSize = glyphs.fontSize;
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
    uniforms.origin.value.set(canvasRect.left, canvasRect.top);
    const ripple = scrollWave();
    uniforms.waveAmount.value = ripple.amount;
    uniforms.waveTime.value = ripple.t;
    uniforms.waveScroll.value = ripple.y;
    uniforms.sceneDim.value = canvasRect.width >= 640 ? sceneDim[1] : sceneDim[0];
    uniforms.shadeScene.value = shade && !glassOnly ? 1 : 0;
    uniforms.glassOnly.value = glassOnly ? 1 : 0;
    uniforms.frost.value = frost;
    uniforms.textFrost.value = textFrost;
    uniforms.textLens.value = textLens * (text.current.fontSize || 0);
    uniforms.textTint.value.set(textTint[0], textTint[1], textTint[2]);
    uniforms.haze.value = haze;
    uniforms.hoverFrost.value = hover?.frost ?? 0;
    uniforms.hoverSplit.value = hover?.split ?? 0;
    uniforms.hoverDim.value = hover?.dim ?? 0;
    uniforms.rimCap.value = rimCap;
    uniforms.adapt.value = adapt;

    let count = 0;
    // Whether any pane is hovered at all, for the mipmaps
    let anyHover = false;
    // Where each pane was placed this frame, for clipping its images
    const placed = new Map();
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
        placed.set(el, count);
        // data-liquid-glass="1.8" thickens a pane's glass; a bare attribute is 1
        // A thick pane only thickens while it's hovered (or, on touch
        // screens, in focus), easing in and out; otherwise it's standard
        // glass. data-glass-lens keeps it thick all the time.
        const thick = parseFloat(el.dataset.liquidGlass);
        const active = el.matches(':hover') || el.hasAttribute('data-focus');
        const lens = active || el.hasAttribute('data-glass-lens');
        const target = !Number.isNaN(thick) && lens ? thick : 1;
        const current = strengths.current.get(el) ?? 1;
        const strength = current + (target - current) * (1 - Math.exp(-delta * 10));
        strengths.current.set(el, strength);
        uniforms.paneStrength.value[count] = strength;
        if (hover && el.hasAttribute('data-glass-hover')) {
          const was = hovers.current.get(el) ?? 0;
          const now = was + ((active ? 1 : 0) - was) * (1 - Math.exp(-delta * 8));
          hovers.current.set(el, now);
          uniforms.paneHover.value[count] = now;
          anyHover = anyHover || now > 0.001;
        } else {
          uniforms.paneHover.value[count] = 0;
        }
        // data-glass-split / data-glass-bezel scale a pane's prism split and
        // the width of its bent rim; both default to 1
        const split = parseFloat(el.dataset.glassSplit);
        const bezel = parseFloat(el.dataset.glassBezel);
        uniforms.paneGlass.value[count].set(
          Number.isNaN(split) ? 1 : split,
          Number.isNaN(bezel) ? 1 : bezel
        );
        const merge = parseFloat(el.dataset.glassMerge);
        const tint = parseFloat(el.dataset.glassTint);
        uniforms.paneMerge.value[count] = Number.isNaN(merge) ? 0 : merge;
        uniforms.paneTint.value[count] = Number.isNaN(tint) ? 0 : tint;
        uniforms.paneBevel.value[count] = el.hasAttribute('data-glass-bevel') ? 1 : 0;
        const paneFrost = parseFloat(el.dataset.glassFrost);
        const paneHaze = parseFloat(el.dataset.glassHaze);
        uniforms.paneFrost.value[count] = Number.isNaN(paneFrost) ? -1 : paneFrost;
        uniforms.paneHaze.value[count] = Number.isNaN(paneHaze) ? -1 : paneHaze;
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

    // Only the hovered blur reads the scene's smaller copies, so they're
    // rebuilt only while something is hovered, and once whenever they're
    // missing, which keeps the texture complete
    const buildMips = mipmaps && (anyHover || mipsMissing.current);
    target.texture.generateMipmaps = buildMips;
    if (buildMips) mipsMissing.current = false;
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    if (imageSelector && selector) {
      drawImages(canvasRect, placed);
    }
    gl.setRenderTarget(null);
    gl.render(pass.scene, pass.camera);

    if (textState.ready && textState.el && !('glassReady' in textState.el.dataset)) {
      textState.el.dataset.glassReady = '';
    }
  }, 1);

  // Draws the images of this frame's panes over the scene in the render
  // target, so the pass refracts them with everything else
  function drawImages(canvasRect, placed) {
    const { uniforms } = pass.imageMaterial;
    const paneUniforms = pass.material.uniforms;
    uniforms.viewport.value.set(canvasRect.width, canvasRect.height);
    const autoClear = gl.autoClear;
    gl.autoClear = false;

    document.querySelectorAll(imageSelector).forEach((img) => {
      const index = placed.get(img.closest(selector));
      if (index === undefined || !img.src || img.style.display === 'none') {
        return;
      }
      const texture = imageTexture(img.src);
      if (!texture) {
        return;
      }
      let contain = fits.current.get(img);
      if (contain === undefined) {
        contain = getComputedStyle(img).objectFit === 'contain';
        fits.current.set(img, contain);
      }
      const rect = img.getBoundingClientRect();
      const clip = img.parentElement.getBoundingClientRect();
      const { left, top } = canvasRect;
      uniforms.tImage.value = texture;
      uniforms.imageSize.value.set(texture.image.width || 1, texture.image.height || 1);
      uniforms.contain.value = contain ? 1 : 0;
      uniforms.imageRect.value.set(rect.left - left, rect.top - top, rect.width, rect.height);
      uniforms.clipRect.value.set(
        clip.left - left,
        clip.top - top,
        clip.right - left,
        clip.bottom - top
      );
      uniforms.pane.value.copy(paneUniforms.panes.value[index]);
      uniforms.paneRadius.value = paneUniforms.paneRadii.value[index];
      uniforms.opacity.value = paneUniforms.paneOpacity.value[index];
      gl.render(pass.imageScene, pass.camera);
      if (!('glassReady' in img.dataset)) {
        img.dataset.glassReady = '';
      }
    });

    gl.autoClear = autoClear;
  }

  // ArtStation's CDN sends no CORS headers, so images come through the API
  function imageTexture(src) {
    const cache = images.current;
    if (cache.has(src)) {
      return cache.get(src);
    }
    cache.set(src, null);
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      apiUrl(`/proxy/image?url=${encodeURIComponent(src)}`),
      (loaded) => {
        if (!cache.has(src)) {
          loaded.dispose();
          return;
        }
        loaded.generateMipmaps = true;
        loaded.minFilter = THREE.LinearMipmapLinearFilter;
        cache.set(src, loaded);
      },
      undefined,
      () => {}
    );
    return null;
  }

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

  // A wider blur for the dome (textLens, textTint): highest along the middle
  // of each stroke, falling away toward its edges
  const domeRadius = Math.max(2, Math.round(fontSize * 0.05 * scale));
  let dome = coverage;
  for (let i = 0; i < 3; i += 1) {
    dome = boxBlur(dome, width, height, domeRadius);
  }
  const domeSigma = Math.sqrt(((2 * domeRadius + 1) ** 2 - 1) / 4);

  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < coverage.length; i += 1) {
    data[i * 4] = Math.round(coverage[i] * 255);
    data[i * 4 + 1] = Math.round(bevel[i] * 255);
    data[i * 4 + 2] = Math.round(dome[i] * 255);
    data[i * 4 + 3] = 255;
  }
  // Rows run top to bottom, matching the shader's y-down coordinates
  const texture = new THREE.DataTexture(data, width, height);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  return { texture, width, height, pad, sigma, domeSigma, fontSize, depth: fontSize * 0.12 };
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

// One pane image, drawn where its <img> sits: object-fit cover or contain
// within its box, clipped to its parent and to its pane's rounded rect
const imageFragmentShader = `
  uniform sampler2D tImage;
  uniform vec2 viewport;
  uniform vec4 imageRect;
  uniform vec2 imageSize;
  uniform float contain;
  uniform vec4 clipRect;
  uniform vec4 pane;
  uniform float paneRadius;
  uniform float opacity;

  varying vec2 vUv;

  float sdRoundRect(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    vec2 px = vec2(vUv.x, 1.0 - vUv.y) * viewport;
    if (any(lessThan(px, clipRect.xy)) || any(greaterThan(px, clipRect.zw))) discard;
    float d = sdRoundRect(px - pane.xy, pane.zw, paneRadius);
    if (d > 1.0) discard;

    vec2 fit = imageRect.zw / imageSize;
    vec2 shown = imageSize * (contain > 0.5 ? min(fit.x, fit.y) : max(fit.x, fit.y));
    vec2 uv = (px - imageRect.xy - imageRect.zw * 0.5) / shown + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
    uv.y = 1.0 - uv.y;
    gl_FragColor = vec4(texture2D(tImage, uv).rgb, opacity * (1.0 - smoothstep(-1.0, 1.0, d)));
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
  uniform float glassOnly;
  uniform float frost;
  uniform float textFrost;
  uniform float textLens;
  uniform vec3 textTint;
  uniform float haze;
  uniform float hoverFrost;
  uniform float hoverSplit;
  uniform float hoverDim;
  uniform float rimCap;
  uniform float adapt;
  uniform float paneHover[MAX_PANES];
  uniform vec4 panes[MAX_PANES];
  uniform float paneRadii[MAX_PANES];
  uniform float paneOpacity[MAX_PANES];
  uniform float paneStrength[MAX_PANES];
  uniform vec2 paneGlass[MAX_PANES];
  uniform float paneMerge[MAX_PANES];
  uniform vec2 origin;
  uniform float waveAmount;
  uniform float waveTime;
  uniform float waveScroll;
  uniform float paneTint[MAX_PANES];
  uniform float paneBevel[MAX_PANES];
  uniform float paneFrost[MAX_PANES];
  uniform float paneHaze[MAX_PANES];
  uniform int paneCount;

  uniform sampler2D tText;
  uniform vec4 textRect;
  uniform vec2 textTexel;
  uniform float textSigma;
  uniform float textDomeSigma;
  uniform float textDepth;
  uniform float textOpacity;

  varying vec2 vUv;

  float sdRoundRect(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  // Merged panes blend within MERGE px of each other, enough to bridge the
  // gap between them and round the inside corners where they meet
  #define MERGE 44.0
  float smoothUnion(float a, float b) {
    float h = max(MERGE - abs(a - b), 0.0) / MERGE;
    return min(a, b) - h * h * MERGE * 0.25;
  }

  bool inGroup(int j, int lead, float group) {
    return j == lead || (group > 0.5 && abs(paneMerge[j] - group) < 0.5);
  }

  // The bottom-corner bevel: how wide its lit edge is (px), and how far along
  // the edges past each corner's curve it fades out
  #define BEVEL_EDGE 11.0
  #define BEVEL_REACH 40.0

  // How much a point (relative to its pane's centre) lies in one of the
  // pane's bottom corners: 1 round the curve, fading along the edges
  float bottomCorners(vec2 p, vec2 halfSize, float r) {
    vec2 inner = halfSize - r;
    return smoothstep(inner.x - BEVEL_REACH, inner.x, abs(p.x))
      * smoothstep(inner.y - BEVEL_REACH, inner.y, p.y);
  }

  // How far (px) the join ripples at full scroll speed, and how far from
  // where the panes meet the ripple reaches (in how much nearer one pane is
  // than the other)
  #define WAVE_PX 4.0
  #define JOIN 66.0

  // How much a point belongs to the join between merged panes: 1 where it's
  // as near one pane as the other, fading to 0 where only one is near. a and
  // b are its distances to the nearest two.
  float joinWeight(float a, float b) {
    return smoothstep(0.0, 1.0, clamp((JOIN - abs(a - b)) / JOIN, 0.0, 1.0));
  }

  // The scroll ripple where merged panes join: two slow waves laid out down
  // the page, so they ride along with the content while drifting over time.
  // In screen and page coordinates, so separate canvases agree.
  float ripple(vec2 px) {
    vec2 s = px + origin;
    float y = s.y + waveScroll;
    float r = 0.65 * sin(y * 0.045 + s.x * 0.03 - waveTime * 4.0)
      + 0.35 * sin(y * 0.02 - s.x * 0.05 + waveTime * 2.6);
    return r * waveAmount * WAVE_PX;
  }

  // How much a point belongs to the join of a merged group (see joinWeight)
  float joinAt(vec2 px, int lead, float group) {
    if (group < 0.5) return 0.0;
    float a = 1e5;
    float b = 1e5;
    for (int j = 0; j < MAX_PANES; j++) {
      if (j >= paneCount) break;
      if (!inGroup(j, lead, group)) continue;
      float dj = sdRoundRect(px - panes[j].xy, panes[j].zw, paneRadii[j]);
      if (dj < a) {
        b = a;
        a = dj;
      } else if (dj < b) {
        b = dj;
      }
    }
    return joinWeight(a, b);
  }

  // Distance to a pane's edge, or to its whole group's outline when merged,
  // rippling at the join while the page scrolls
  float paneDistance(vec2 px, int lead, float group) {
    float d = 1e5;
    if (group < 0.5) {
      d = sdRoundRect(px - panes[lead].xy, panes[lead].zw, paneRadii[lead]);
    } else {
      float a = 1e5;
      float b = 1e5;
      for (int j = 0; j < MAX_PANES; j++) {
        if (j >= paneCount) break;
        if (!inGroup(j, lead, group)) continue;
        float dj = sdRoundRect(px - panes[j].xy, panes[j].zw, paneRadii[j]);
        d = smoothUnion(d, dj);
        if (dj < a) {
          b = a;
          a = dj;
        } else if (dj < b) {
          b = dj;
        }
      }
      if (waveAmount > 0.001) d += ripple(px) * joinWeight(a, b);
    }
    return d;
  }

  // lod picks a smaller copy of the scene, where it has mipmaps. Exactly that
  // copy: at 0 always the full-size scene, never a copy left from a hover.
  vec4 sampleAt(vec2 px, float lod) {
    vec2 uv = vec2(px.x / viewport.x, 1.0 - px.y / viewport.y);
    return textureLod(tScene, clamp(uv, 0.0, 1.0), lod);
  }

  // A soft disc blur of the given radius: taps on a golden-angle spiral,
  // weighted toward the centre so it reads as frosting rather than a smear
  vec4 blurredAt(vec2 px, float radius, float lod) {
    vec4 sum = sampleAt(px, lod);
    float total = 1.0;
    for (int k = 1; k <= BLUR_TAPS; k++) {
      float f = float(k) / float(BLUR_TAPS);
      float angle = float(k) * 2.39996;
      vec2 tap = vec2(cos(angle), sin(angle)) * sqrt(f) * radius;
      float weight = 1.0 - 0.6 * f;
      sum += sampleAt(px + tap, lod) * weight;
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
  // colour comes only from the bend and fans out evenly around every edge.
  // splitScale widens both the split and the fan (kept short of reversing)
  vec4 throughGlass(vec2 px, vec2 offset, float strength, float splitScale, float radius, float lod) {
    vec2 split = normalize(vec2(1.0, -0.4)) * SPLIT * splitScale * (1.0 - lensAmount(strength));
    float dispersion = min(EDGE_DISPERSION * splitScale, 0.95);
    vec4 red = blurredAt(px + offset * (1.0 + dispersion) + split, radius, lod);
    vec4 green = blurredAt(px + offset, radius, lod);
    vec4 blue = blurredAt(px + offset * (1.0 - dispersion) - split, radius, lod);
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
    // Premultiplied: with glassOnly, clear outside the panes
    vec4 color = glassOnly > 0.5 ? vec4(0.0) : texture2D(tScene, vUv);

    for (int i = 0; i < MAX_PANES; i++) {
      if (i >= paneCount) break;

      // A merged group is drawn once, by its first pane
      float group = paneMerge[i];
      bool drawn = false;
      if (group > 0.5) {
        for (int j = 0; j < MAX_PANES; j++) {
          if (j >= i) break;
          if (abs(paneMerge[j] - group) < 0.5) drawn = true;
        }
      }
      if (drawn) continue;

      float r = paneRadii[i];
      float d = paneDistance(px, i, group);
      if (d > 1.0) continue;

      // Outward normal of the edge nearest this pixel
      vec2 e = vec2(0.5, 0.0);
      vec2 normal = normalize(vec2(
        paneDistance(px + e.xy, i, group) - paneDistance(px - e.xy, i, group),
        paneDistance(px + e.yx, i, group) - paneDistance(px - e.yx, i, group)
      ) + 1e-5);

      // A rounded bezel: steep at the rim, flat across the middle, so the
      // centre stays undistorted. Standard panes push the scene outward at
      // the edge; thick panes (strength > 1) act like a lens instead and pull
      // in what lies just beyond their edge, each colour channel from a
      // slightly different depth, so light at the edge splits into R, G, B.
      // The lens reaches only a short way, keeping those lines near the rim.
      float strength = paneStrength[i];
      float lens = lensAmount(strength);
      // the rim bends deeper at the join while it ripples
      float swell = waveAmount > 0.001 ? 1.0 + waveAmount * 0.6 * joinAt(px, i, group) : 1.0;
      // and round a bevelled pane's bottom corners
      float corner = paneBevel[i] > 0.5 ? bottomCorners(px - panes[i].xy, panes[i].zw, r) : 0.0;
      swell *= 1.0 + corner * 1.2;
      float bezel = clamp(r * 1.15, 14.0, 34.0) * strength * paneGlass[i].y * swell;
      // capped, the rim is narrower but bends as far (see rimCap)
      float rim = rimCap > 0.0 ? min(bezel, min(panes[i].z, panes[i].w) * rimCap) : bezel;
      float t = clamp(-d / rim, 0.0, 1.0);
      float bend = pow(1.0 - t, 2.4);
      float reach = mix(-0.7, 0.24, lens);
      vec2 offset = normal * reach * bend * bezel;

      // Hovered, the frost widens (sampling a smaller copy of the scene, so
      // its taps still blend) and the prism split spreads
      float hovered = paneHover[i];
      float widen = 1.0 + hoverFrost * hovered;
      float paneBlur = paneFrost[i] >= 0.0 ? paneFrost[i] : frost;
      vec4 glass = throughGlass(
        px, offset, strength, paneGlass[i].x * (1.0 + hoverSplit * hovered), paneBlur * widen, log2(widen) * 1.4
      );
      glass.rgb *= 1.0 - hoverDim * hovered;
      glass.rgb = mix(glass.rgb, vec3(8.0, 9.0, 12.0) / 255.0, paneTint[i]);
      // Darker over bright backdrops (see adapt), judged from a few wide taps
      // so it follows the picture's light, not its fine detail
      if (adapt > 0.0) {
        vec3 around = (
          sampleAt(px, 0.0) +
          sampleAt(px + vec2(20.0, 0.0), 0.0) + sampleAt(px - vec2(20.0, 0.0), 0.0) +
          sampleAt(px + vec2(0.0, 20.0), 0.0) + sampleAt(px - vec2(0.0, 20.0), 0.0)
        ).rgb / 5.0;
        float light = dot(around, vec3(0.2126, 0.7152, 0.0722));
        glass.rgb *= 1.0 - adapt * smoothstep(0.3, 0.85, light);
      }
      glass.rgb = mix(glass.rgb, vec3(glass.a), paneHaze[i] >= 0.0 ? paneHaze[i] : haze);

      // The bevel's light: bright along the curve's outer edge, falling off
      // across its width, lit from below so both corners catch it, with a
      // faint shadow line where the bevel meets the flat of the glass
      if (corner > 0.001) {
        float across = clamp(-d / BEVEL_EDGE, 0.0, 1.0);
        float below = max(dot(normal, vec2(0.0, 1.0)), 0.0);
        float light = (0.35 + 0.65 * below) * pow(1.0 - across, 1.6);
        float crease = exp(-abs(-d - BEVEL_EDGE) / 1.6);
        glass.rgb += vec3(light * 0.42 - crease * 0.07) * corner * glass.a;
      }

      // A merged group's rim, which CSS can't draw around its outline: a
      // hairline just inside the edge, brightest where it faces the light at
      // the top left, a softer bounce on the far side, and a faint glow in
      // the glass's thickness
      if (group > 0.5) {
        float facing = dot(normal, normalize(vec2(-1.0, -1.0)));
        float light = 0.18 + 0.75 * max(facing, 0.0) + 0.4 * max(-facing, 0.0);
        float rim = exp(-abs(d + 1.0) / 1.0) * light;
        float glow = exp(d / 22.0) * 0.07;
        glass.rgb += vec3(rim + glow);
      }

      // Antialias the silhouette, and fade with the pane
      float coverage = (1.0 - smoothstep(-1.0, 1.0, d)) * paneOpacity[i];
      color = mix(color, glass, coverage);
    }

    color = shade(color, px);

    if (textOpacity > 0.0) {
      vec2 tuv = (px - textRect.xy) / textRect.zw;
      if (all(greaterThanEqual(tuv, vec2(0.0))) && all(lessThanEqual(tuv, vec2(1.0)))) {
        vec4 mask = texture2D(tText, tuv);
        float coverage = mask.r;

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
          vec2 offset = inward * slope * textDepth;
          // and the domed face pulls in what lies beyond it (textLens), most
          // where the dome slopes, between a stroke's edge and its middle
          if (textLens > 0.0) {
            vec2 rise = vec2(
              texture2D(tText, tuv + vec2(2.0 * textTexel.x, 0.0)).b -
                texture2D(tText, tuv - vec2(2.0 * textTexel.x, 0.0)).b,
              texture2D(tText, tuv + vec2(0.0, 2.0 * textTexel.y)).b -
                texture2D(tText, tuv - vec2(0.0, 2.0 * textTexel.y)).b
            ) * textDomeSigma / 1.6;
            offset -= rise * textLens;
          }
          vec4 glyph = shade(throughGlass(px, offset, 1.0, 1.0, textFrost, 0.0), px);
          // Thicker toward the middle of a stroke, so tinted more there
          glyph.rgb *= mix(vec3(1.0), textTint, smoothstep(0.4, 0.75, mask.b));
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

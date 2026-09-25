import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

// Refracts the scene through DOM elements matching `selector`, like Apple's
// clear glass. The scene renders to a texture, then a full-screen pass copies
// it back, bending it inward along each element's rounded edge as a thick
// pane would. Red, green and blue bend by slightly different amounts, so
// light crossing the rim splits into a spectrum. The element itself only
// needs a transparent background; its highlights are drawn in CSS.
const MAX_PANES = 4;

export default function LiquidGlassPass({ selector }) {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  const target = useMemo(() => new THREE.WebGLRenderTarget(1, 1), []);
  const radii = useRef(new WeakMap());

  const pass = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: target.texture },
        viewport: { value: new THREE.Vector2(1, 1) },
        panes: { value: Array.from({ length: MAX_PANES }, () => new THREE.Vector4()) },
        paneRadii: { value: new Array(MAX_PANES).fill(0) },
        paneCount: { value: 0 },
      },
      vertexShader: passVertexShader,
      fragmentShader: passFragmentShader,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return { material, scene, camera };
  }, [target]);

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

  useEffect(
    () => () => {
      target.dispose();
      pass.material.dispose();
      pass.scene.children[0].geometry.dispose();
    },
    [target, pass]
  );

  // Priority 1 takes over rendering from R3F for this canvas
  useFrame(({ scene, camera }) => {
    const canvasRect = gl.domElement.getBoundingClientRect();
    const { uniforms } = pass.material;
    uniforms.viewport.value.set(canvasRect.width, canvasRect.height);

    let count = 0;
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
      count += 1;
    });
    uniforms.paneCount.value = count;

    gl.setRenderTarget(target);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    gl.render(pass.scene, pass.camera);
  }, 1);

  return null;
}

const passVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// All pane maths is in CSS pixels with y pointing down, matching the DOM
const passFragmentShader = `
  #define MAX_PANES ${MAX_PANES}
  // Prism split: how far (px) red and blue sit either side of green across
  // the whole pane, and how much further apart they bend at the rim
  #define SPLIT 2.5
  #define EDGE_DISPERSION 0.35

  uniform sampler2D tScene;
  uniform vec2 viewport;
  uniform vec4 panes[MAX_PANES];
  uniform float paneRadii[MAX_PANES];
  uniform int paneCount;

  varying vec2 vUv;

  float sdRoundRect(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  vec4 sampleAt(vec2 px) {
    vec2 uv = vec2(px.x / viewport.x, 1.0 - px.y / viewport.y);
    return texture2D(tScene, clamp(uv, 0.0, 1.0));
  }

  void main() {
    vec4 color = texture2D(tScene, vUv);
    vec2 px = vec2(vUv.x, 1.0 - vUv.y) * viewport;

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
      // centre stays perfectly clear and the edge pulls the scene inward
      float bezel = clamp(r * 1.15, 14.0, 34.0);
      float t = clamp(-d / bezel, 0.0, 1.0);
      float bend = pow(1.0 - t, 2.4);
      vec2 offset = -normal * bend * bezel * 0.7;

      // Dispersion: the channels sit slightly apart across the whole pane,
      // along one diagonal like light through a prism, and bend by
      // different amounts at the rim so the spectrum fans out there
      vec2 split = normalize(vec2(1.0, -0.4)) * SPLIT;
      vec4 red = sampleAt(px + offset * (1.0 + EDGE_DISPERSION) + split);
      vec4 green = sampleAt(px + offset);
      vec4 blue = sampleAt(px + offset * (1.0 - EDGE_DISPERSION) - split);
      vec4 glass = vec4(red.r, green.g, blue.b, max(red.a, max(green.a, blue.a)));
      glass.rgb *= 1.06;

      // Antialias the silhouette
      color = mix(glass, color, smoothstep(-1.0, 1.0, d));
    }

    gl_FragColor = color;
  }
`;

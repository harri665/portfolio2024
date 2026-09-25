# Continuous 3D Portfolio — Design Spec (handoff)

## Goal
Turn the current multi-homepage-variant portfolio (CS / Art / Root, via `SubdomainNav.js`) into one
continuous, scroll-driven 3D experience per variant, sharing a single architecture and visual
material system — while keeping the site a fast, legible, accessible portfolio first and a 3D
showpiece second.

Priority order when these trade off: **portfolio function > 3D polish.** Recruiters/visitors must be
able to find work, skills, and contact info quickly even if that means dialing back an effect.

## Current state (context, not to be treated as fixed)
- Stack: React, `@react-three/fiber` (^8.17), `@react-three/drei` (^9.114), `three` (^0.169),
  `framer-motion` (^11), `react-router-dom` (^6).
- `client/src/Components/Homepage/DistortedTorusScene.js` — existing hero 3D piece. Has:
  - Per-variant presets (`art`, `cs`, `hub`) controlling shape (`torusKnot`/`ring`/`box`/etc.),
    lights, distortion, spin speed, scale.
  - A custom shader: fresnel-based rim glow, hue-shifting iridescent color driven by `time`, an
    intro animation (scale/position/spin easing on mount).
  - Colored point lights (magenta `#ff00ff`, cyan `#00ffff`) + a warm spotlight.
- `RootHomePage.js`, `CSHomePage.js`, `ArtHomePage.js`, `SubdomainNav.js` — currently separate
  homepage implementations per variant.
- `ProjectDetails`, `Blog`, `Admin` — existing normal 2D routed pages. **These stay as-is.**

## Decisions already made (do not relitigate without reason)
1. **Navigation model:** scroll-driven camera path. Scroll position (0→1) maps to camera position
   along a spline/waypoint path. Not free-roam, not click-only.
2. **Content model:** 3D is a persistent shell/environment. Real content (headings, descriptions,
   links) lives in HTML overlay panels, not as textures/meshes in the 3D scene. This keeps content
   accessible, crawlable, and legible.
3. **Scope:** one shared shell/architecture reused across all three homepage variants (CS, Art,
   Root/hub). Each variant supplies **data + theme**, not new scroll/camera/fallback logic.
4. **Detail pages stay 2D:** clicking a project in the 3D corridor navigates to the existing
   `ProjectDetails` route as a normal page. Do not try to cram case studies into the 3D shell.
5. **Visual language:** extend the existing `DistortedTorusScene` iridescent-glass shader into a
   shared, reusable material system — "Apple/visionOS glass" aesthetic (frosted, translucent,
   fresnel rim light, hue-shifting) — used by both the 3D objects and the HTML overlay panels.

## Architecture

### A. Shared shell component
Build one component (e.g. `ContinuousSceneShell`) that owns everything variant-agnostic:
- Scroll listener (`framer-motion`'s `useScroll` / `useTransform`, or `window.scrollY` against a
  tall scroll container) mapped to a progress value `0 → 1`.
- A camera-path system: progress drives camera position + look-at target, interpolated smoothly
  (not discrete jumps) along an ordered list of waypoints.
- A **station registry**: ordered list of
  `{ id, scrollRange: [start, end], overlay: <Component>, sceneObjects: [...], hue, distortion }`.
  Each station corresponds to a "room" (Hero, About/Skills, Projects..., Contact) without the scroll
  ever actually stopping — it's one continuous camera move that happens to pass recognizable
  waypoints.
- The persistent `<Canvas>`: lighting rig, `<Environment>` (drei HDRI preset) for real reflections,
  and a `@react-three/postprocessing` stack (Bloom + subtle Chromatic Aberration; optional Depth of
  Field) applied globally, not per-station.
- Fallback/escape hatch (see Accessibility section below).

### B. Per-variant data, not new architecture
`CSHomePage`, `ArtHomePage`, `RootHomePage` become thin data providers that feed the shell:
- Station list (their own projects/content/copy).
- Per-station shape + hue/palette (reusing the existing `ShapeGeometry` switcher pattern:
  box/ring/torusKnot/sphere/icosahedron).
- A base palette/mood (e.g. CS = cooler blues/cyans/geometric shapes and grid-like set dressing;
  Art = warmer/organic shapes, particle fields, painterly tones).
- `SubdomainNav.js` becomes "pick a theme/dataset for the shared shell," not "pick a different
  homepage implementation."

### C. Project/content navigation
Within the Projects station(s), clicking a project's 3D object or its overlay card routes to the
existing `ProjectDetails` page via `react-router-dom`, exactly as today. The 3D shell does not need
to model project detail content.

## Visual system spec

### 1. Shared glass material
Promote the shader from `DistortedTorusScene` into a reusable material (e.g.
`IridescentGlassMaterial`) used by every station's 3D object(s), parameterized by:
- `hueOffset` — see color continuity below.
- `distortionFactor` — can vary per station (e.g. calmer at hero/contact, busier mid-page).
- `fresnelIntensity` / `glowStrength` — pulse up briefly when a station becomes "active" (adapt the
  existing one-shot `introGlow` uniform into a reusable enter/exit pulse rather than only firing on
  mount).
Per-station visual variety should come from swapping **shape + these knobs**, not from writing new
shaders per station.

### 2. Real environment reflections
Add `<Environment>` from drei (studio or gradient HDRI preset) behind the whole scene so glass
objects get genuine specular reflections as the camera travels, replacing/augmenting the shader's
faked reflection color. One shared environment reinforces that every station belongs to the same
world.

### 3. Post-processing (global, not per-station)
`@react-three/postprocessing`: Bloom (makes fresnel edges and the magenta/cyan point lights actually
glow), subtle Chromatic Aberration, optional Depth of Field to soften off-focus stations. Applied
once at the shell level.

### 4. Color continuity across scroll
Shift hue to be primarily a function of **scroll progress** (with `time` still layered in for
subtle live shimmer), so traveling through the site reads as moving through one continuous color
gradient rather than jump-cutting between unrelated palettes per section. Suggested arc: cool
blue/cyan at hero → violet/magenta through projects → settle back to calm blue at contact. This
also doubles as a passive progress indicator.

### 5. HTML overlay panels must match the material
Overlay content panels (headings, descriptions, links, contact form) should read as the *same
substance* as the 3D glass objects, not a flat UI slapped on top:
- `backdrop-filter: blur(...)` frosted panels.
- Thin gradient borders / soft glow in the current hue (magenta/cyan family), not generic black
  shadows.
- **Technical link:** the same hue value driving the shader's `colorTransition`/hue uniform should
  also be written to a CSS custom property (e.g. `--accent-hue`) so overlay borders/glows stay in
  sync with the 3D material in real time.

## Content/placement model
- Overlay panels are **screen-space anchored** (fixed position on screen, e.g. bottom-left or
  centered, fading/sliding in per active station) for legibility and simple responsive behavior.
- Reserve **world-anchored** overlays (drei's `<Html>` projected from a 3D point) only for
  lightweight labels (e.g. a project name hovering near its object), not for dense text — world
  anchoring risks drift/overlap and is harder to keep accessible.
- Overlay HTML must contain the real semantic content (real headings, real links) regardless of 3D
  state — screen readers and crawlers should get a fully meaningful page even though canvas content
  is invisible to them.

## Accessibility / performance fallback (required, not optional)
- Respect `prefers-reduced-motion`: disable camera-path animation and station enter/exit pulses;
  present the same overlay content in a normal static-scroll layout (no canvas animation, or a
  static hero image/frame instead of live canvas).
- Provide a low-end-device / manual "simple view" toggle that swaps to the same fallback path.
- Fallback must reuse the exact same overlay content/components as the 3D mode — same DOM, same
  copy, same links — only the camera/canvas choreography is removed. This guarantees the portfolio
  keeps functioning even in the fallback path.

## Open items for implementation-time decisions (not yet answered — flag if blocking)
- Exact station list/content per variant (CS stations vs. Art stations vs. Root/hub stations).
- Exact palette/hue ranges per variant beyond the general "cooler vs warmer" direction above.
- Whether `RootHomePage`/hub uses its own station set or acts as a chooser before entering CS/Art.
- Camera path shape specifics (how many waypoints, spline curvature) — kept intentionally generic
  above ("gentle forward-moving path, soft dolly + crossfade between stations" was the one
  consistency requirement raised in design discussion, so all variants should share that transition
  *feel* even where content differs).

## Explicit non-goals
- No free-roam/WASD navigation.
- No rebuilding `ProjectDetails`, `Blog`, or `Admin` as 3D/embedded content.
- No per-station bespoke shaders — variety comes from parameters on one shared material.

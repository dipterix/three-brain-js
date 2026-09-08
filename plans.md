# Stop thin streamlines from rendering too dark

## Context

The streamline fragment shader shades each line from bright at its axis to dark at its
edges, which gives thick lines a rounded, tube-like look. `norm = len / vLineWidth`
sweeps `0` at the axis to `0.5` at the edge, and

```glsl
shade = 1.0 - smoothstep( 0.0, interpMax, norm );   // interpMax == 1.2
```

([StreamlineMaterial.js:183-206](inst/three-brain-js/src/js/shaders/StreamlineMaterial.js#L183-L206))
so the edge renders at `1 - smoothstep(0, 1.2, 0.5)` = **0.624** of the true color.

That is fine when the line is thick — the `shade = 1.0` core dominates. When the line is
only one or two pixels wide, **no fragment ever lands near `norm = 0`**, so every visible
pixel sits in the dark part of the ramp and the whole line reads as a muddied color.
Measured on the fixture, recovering `shade` as rendered red ÷ `#EE3B48`:

| slider | min | p10 | median |
|---|---|---|---|
| 0.25 (thin) | **0.609** | 0.836 | 0.941 |
| 1.50 (thick) | 0.786 | 0.857 | 0.933 |

This matters at the default too: the frustum is 300 world units across roughly 1100 px, so
at `linewidth = 0.5` a tract is only about **2 px** wide — right in the problem zone.

The fix is to make the shading strength follow the line's actual on-screen thickness: keep
the tube look where it is visible, fade to flat color where it is not.

---

## Change — `shaders/StreamlineMaterial.js`, fragment stage only

Screen thickness is recoverable from the existing varying with a screen-space derivative.
Crossing the line changes `norm` by `0.5` on each side, so `fwidth(norm)` is approximately
`1 / widthInPixels`:

```glsl
// `norm` goes 0 at the axis to 0.5 at the edge, so its screen-space derivative is
// about 1/width-in-pixels. Below a couple of pixels there is no bright core left to
// see, and the edge ramp alone just darkens the whole line -- so fade the shading
// out and let thin tracts keep their true colour.
float pixelWidth  = 1.0 / max( fwidth( norm ), 1e-5 );
float shadeAmount = smoothstep( 2.0, 6.0, pixelWidth );

shade = 1.0 - shadeAmount * smoothstep( 0.0, interpMax, norm );
```

Compute `pixelWidth` / `shadeAmount` once, above the `#ifdef USE_DISTANCE_THRESHOLD`
block, and apply `shadeAmount` in **both** places that currently assign `shade` — the
`else` branch inside the `#ifdef` and the `#else` branch. Leave the faded-line
`shade = 0.5` short-circuit alone.

No new uniforms and no CPU change. `fwidth` is core in GLSL ES 3.00 and the app already
creates a WebGL2 context ([ViewerCanvas.js:353](inst/three-brain-js/src/js/core/ViewerCanvas.js#L353)),
so no extension pragma is needed.

**Accuracy caveat, stated rather than glossed:** `fwidth` is `|dFdx| + |dFdy|`, so
`1/fwidth(norm)` equals the true pixel width only for an axis-aligned gradient and
underestimates it by up to √2 for a diagonal line. That is fine for driving a smoothstep
band, but it means the 2–6 px thresholds are approximate and should be tuned against
measurement rather than trusted analytically.

**Threshold tuning.** Start at `smoothstep(2.0, 6.0, pixelWidth)`, then measure the actual
rendered width at slider `0.25` / `0.5` / `1.5` and adjust so that the default (`0.5`)
lands near the flat end and `1.5` still shows clear tube shading. Expect the default to
become visibly brighter — that is the point of the change.

---

## Verification

Fixture and drivers are in `/private/tmp/.../scratchpad` (`fsfixture`, `save_widget.R`,
`check_width.mjs`, `analyze_shade.mjs`, plus the `w_thin.png` / `w_thick.png` baselines
already captured from the current build).

1. **Shade distribution** — re-run `analyze_shade.mjs` at slider `0.25`, `0.5` and `1.5`.
   Thin should move from `min 0.609` to essentially `1.0` (flat, full color); thick should
   stay near `min 0.786`, i.e. unchanged.
2. **Thick lines look identical** — screenshot at slider `1.5` and compare against the
   existing `w_thick.png`. Any visible flattening means the band is set too wide.
3. **Measured pixel width** — in the browser, compute
   `vLineWidth / (frustumWidth / canvasWidthPx)` for each slider value and confirm the
   chosen 2–6 px band maps onto them as intended. This is what the thresholds are tuned
   against.
4. **Zoom independence** — sweep zoom 1 → 4 at a fixed slider and confirm the shading does
   not change, since on-screen width is now zoom-invariant. If shading shifts with zoom,
   `fwidth` is picking up something other than line thickness.
5. **Side panels** — check tracts in an axial/coronal panel are not over-darkened; those
   render at a different scale and are a good independent check on the band.
6. **No shader errors** — confirm a clean console; a `fwidth` compile failure would surface
   as a three.js program-link error rather than a silent fallback.
7. **Regression** — the four R suites and `R CMD check`; a JS-only change should leave them
   untouched.

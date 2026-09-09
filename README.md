# Lumen

A camera that uses every photon your phone can gather — night vision, macro,
lens-level zoom and gyro stabilisation, running entirely in the browser on your
phone. No app store, no build step, no dependencies.

**Open it:** https://tridentintelfree.github.io/Gametry/

Then tap **Share → Add to Home Screen** and it launches fullscreen like a native app.

Everything happens on your device. The camera feed never leaves the phone —
there is no server, no upload, and no storage.

## Modes

| Mode | What it does |
| --- | --- |
| **Auto** | Balanced. Light frame stacking, natural colour. |
| **Night** | Deep frame stacking with shadow lift. Hold still — it keeps getting cleaner. |
| **Night Vision** | Maximum gain, image-intensifier green. Mono sees deeper than colour. |
| **False Colour** | Maps brightness to a heat ramp, revealing detail the eye flattens. |
| **Macro** | Ultra-wide lens up close, centre-cropped, focus peaking on. |
| **Light Trails** | Every pixel keeps its brightest moment — long exposure, handheld. |

## How the night vision actually works

A dark frame isn't empty; it's signal buried under sensor noise. The noise is
random, the scene isn't — so averaging successive frames cancels the noise while
the image reinforces. N frames cuts noise by roughly √N. This is the same
technique astrophotographers use to pull galaxies out of grain.

A naive average smears anything that moves, so each pixel's blend rate is driven
by how much it changed since the last frame: static pixels integrate deeply,
pixels that jumped are taken fresh. Moving subjects stay sharp while the static
parts of the scene clean up. All accumulation happens in linear light — averaging
in sRGB would bias exactly the shadows we're trying to rescue.

After that: black-point subtraction, auto-gain driven by a 64×64 readback of the
scene, a shadow-lifting tone curve, edge-aware denoise, and unsharp masking.

## Stabilisation

The gyroscope reports angular velocity. Integrating it gives orientation, but
raw integration drifts and fights you when you pan deliberately. So the
integrated angle is continuously leaked back toward zero — fast wobble survives,
slow intentional movement decays away. The frame shifts by the opposite of the
residual shake, which is why stabilising crops in about 12%: it needs spare
pixels to move into.

## Controls

- **Pinch** the viewfinder or drag the zoom slider — up to 8×
- **Lens buttons** (.5× / 1× / 3×) appear when your phone exposes multiple back
  cameras. These are real optical lenses, not crops.
- **⚙** opens brightness, shadows, contrast, denoise, sharpen and colour sliders
- **Peaking** tints in-focus edges — essential in Macro, where depth of field is
  a few millimetres
- **Info** reports exactly what your specific device and iOS version expose

## What isn't possible here, and why

Safari gives web pages a camera stream and nothing below it. So:

- **LiDAR / depth** — no browser on iOS exposes the depth sensor. Not a
  limitation of this app; the API does not exist.
- **RAW capture** — no access to the Bayer data.
- **True manual ISO and shutter** — Safari has not implemented these
  MediaTrack constraints. Lumen compensates in the shader instead, which
  recovers most of the range but is not the same as a real long exposure.
- **Optical stabilisation control** — OIS runs by itself; it can't be addressed.

The **Info** panel measures rather than guesses, so it will tell you the truth
about your handset rather than what this README assumed.

All of the above would require a native app, which needs a Mac and Xcode to
build.

## Requirements

iOS 15+ Safari (WebGL2 and `getUserMedia`), or any modern Chromium/Firefox on
desktop. Must be served over HTTPS — GitHub Pages already is.

## Project structure

```
index.html          app shell
css/app.css         UI
js/app.js           wiring: modes, controls, capture, diagnostics
js/camera.js        device discovery, lens switching, capability probing
js/pipeline.js      render graph, auto-exposure, histogram readback
js/shaders.js       GLSL: accumulation, tone mapping, palettes, peaking
js/glcore.js        WebGL2 helpers
js/motion.js        gyroscope stabiliser
js/modes.js         shooting-mode presets
game/               Gametry, the 2D platformer this repo started as
```

## The game

This repo was originally **Gametry**, a Silksong-inspired platformer. It still
works and still lives here: https://tridentintelfree.github.io/Gametry/game/

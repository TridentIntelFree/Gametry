// GLSL ES 3.0 sources for the processing pipeline.
//
// The pipeline is three passes:
//   1. ACCUM    video frame -> linear-light accumulation buffer (temporal denoise)
//   2. COMPOSITE accumulation -> screen (transform, tone map, palette, peaking)
//   3. ANALYZE  accumulation -> tiny buffer read back for histogram / auto-gain
//
// Everything between pass 1 and 2 lives in linear light. Averaging in sRGB
// space would bias shadows, which is exactly where the signal we care about is.

export const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}`;

// --- pass 1: temporal accumulation ------------------------------------------
//
// Averaging N frames cuts random sensor noise by sqrt(N). That is the whole
// trick behind "night vision" here: a dark frame is not empty, it is signal
// buried under noise, and the noise is what averages away.
//
// A naive average smears anything that moves, so each pixel's blend rate is
// driven by how much it changed. Static pixels integrate deeply (low alpha,
// heavy averaging); pixels that jumped are taken fresh. That keeps moving
// subjects sharp while still cleaning up the static parts of the scene.
export const ACCUM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFrame;
uniform sampler2D uHistory;
uniform float uAlphaMin;   // steady-state blend weight (~1/frames averaged)
uniform float uRejectLo;   // below this delta, integrate fully
uniform float uRejectHi;   // above this delta, take the new pixel outright
uniform float uReset;      // 1.0 on the first frame / after a mode change
uniform int   uMode;       // 0 = average, 1 = max (light trails)
${COMMON}

void main() {
  vec3 cur = srgbToLinear(texture(uFrame, vUv).rgb);

  if (uReset > 0.5) {
    fragColor = vec4(cur, 1.0);
    return;
  }

  vec3 hist = texture(uHistory, vUv).rgb;

  if (uMode == 1) {
    // light trails: keep the brightest value each pixel has ever seen
    fragColor = vec4(max(hist, cur), 1.0);
    return;
  }

  float delta = length(cur - hist);
  float alpha = mix(uAlphaMin, 1.0, smoothstep(uRejectLo, uRejectHi, delta));
  fragColor = vec4(mix(hist, cur, alpha), 1.0);
}`;

// --- pass 2: transform, tone map, look --------------------------------------
export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uAccum;
uniform vec2  uTexel;
uniform vec2  uOffset;     // stabilisation shift, in UV
uniform float uZoom;
uniform float uRoll;       // stabilisation roll, radians
uniform float uMirror;     // 1.0 to flip horizontally (front camera)

uniform float uBlack;      // black point subtracted before gain
uniform float uGain;       // manual exposure gain
uniform float uAutoGain;   // gain from the analysis pass
uniform float uGamma;
uniform float uContrast;
uniform float uSat;
uniform float uDenoise;    // 0 = off
uniform float uSharp;      // unsharp amount
uniform float uPeak;       // focus-peaking threshold, 0 = off
uniform float uVignette;
uniform int   uPalette;    // 0 natural, 1 night (green), 2 thermal, 3 mono
${COMMON}

vec2 xform(vec2 uv) {
  vec2 p = uv - 0.5;
  if (uMirror > 0.5) p.x = -p.x;
  float s = sin(uRoll), c = cos(uRoll);
  p = mat2(c, -s, s, c) * p;
  p /= uZoom;
  return p + 0.5 + uOffset;
}

// Edge-aware blur. Weight by spatial distance AND luminance similarity so
// flat noisy regions smooth out while real edges survive.
vec3 denoise(vec2 uv) {
  vec3 c0 = texture(uAccum, uv).rgb;
  if (uDenoise < 0.001) return c0;

  float l0 = luma(c0);
  float range = 0.09 / uDenoise;
  vec3 sum = c0;
  float wsum = 1.0;

  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      if (x == 0 && y == 0) continue;
      vec2 o = vec2(float(x), float(y)) * uTexel * 1.4;
      vec3 c = texture(uAccum, uv + o).rgb;
      float w = exp(-abs(luma(c) - l0) / range)
              * exp(-float(x * x + y * y) * 0.18);
      sum += c * w;
      wsum += w;
    }
  }
  return sum / wsum;
}

vec3 palette(vec3 c) {
  if (uPalette == 0) return c;
  float l = luma(c);
  if (uPalette == 3) return vec3(l);
  if (uPalette == 1) {
    // image-intensifier green: most of the range in green, a little bleed
    return vec3(l * 0.22, l * 1.05, l * 0.38);
  }
  // thermal ramp: black -> purple -> red -> orange -> white
  vec3 a = mix(vec3(0.0, 0.0, 0.08), vec3(0.45, 0.03, 0.42), smoothstep(0.0, 0.32, l));
  vec3 b = mix(a, vec3(0.94, 0.28, 0.05), smoothstep(0.32, 0.65, l));
  return mix(b, vec3(1.0, 0.98, 0.82), smoothstep(0.65, 1.0, l));
}

void main() {
  vec2 uv = xform(vUv);

  // outside the source frame (stabiliser pushed past the edge)
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 c = denoise(uv);

  // --- tone mapping, in linear light ---
  c = max(c - uBlack, 0.0) * (uGain * uAutoGain);
  c = pow(max(c, 0.0), vec3(uContrast));          // contrast about mid grey
  c = pow(max(c, 0.0), vec3(1.0 / uGamma));       // shadow lift

  float l = luma(c);
  c = mix(vec3(l), c, uSat);
  c = palette(c);
  c = linearToSrgb(c);

  // --- unsharp mask, in display space ---
  if (uSharp > 0.001) {
    vec3 blur = vec3(0.0);
    blur += linearToSrgb(texture(uAccum, uv + vec2( uTexel.x, 0.0)).rgb);
    blur += linearToSrgb(texture(uAccum, uv + vec2(-uTexel.x, 0.0)).rgb);
    blur += linearToSrgb(texture(uAccum, uv + vec2(0.0,  uTexel.y)).rgb);
    blur += linearToSrgb(texture(uAccum, uv + vec2(0.0, -uTexel.y)).rgb);
    blur *= 0.25;
    c += (c - blur) * uSharp;
  }

  // --- focus peaking: Sobel on luma, tint what is in focus ---
  if (uPeak > 0.001) {
    float gx = 0.0, gy = 0.0;
    for (int i = -1; i <= 1; i++) {
      float wl = (i == 0) ? 2.0 : 1.0;
      gx += wl * (luma(texture(uAccum, uv + vec2( uTexel.x, float(i) * uTexel.y)).rgb)
                - luma(texture(uAccum, uv + vec2(-uTexel.x, float(i) * uTexel.y)).rgb));
      gy += wl * (luma(texture(uAccum, uv + vec2(float(i) * uTexel.x,  uTexel.y)).rgb)
                - luma(texture(uAccum, uv + vec2(float(i) * uTexel.x, -uTexel.y)).rgb));
    }
    float edge = length(vec2(gx, gy)) * 6.0;
    c = mix(c, vec3(1.0, 0.25, 0.55), smoothstep(uPeak, uPeak * 2.2, edge));
  }

  if (uVignette > 0.001) {
    float d = length(vUv - 0.5) * 1.414;
    c *= 1.0 - uVignette * smoothstep(0.45, 1.0, d);
  }

  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// --- pass 3: downsample for CPU readback ------------------------------------
//
// A 64x64 box-filtered version of the accumulation buffer. Read back a few
// times a second to build the histogram and drive auto-gain. sqrt-encoded to
// RGBA8 so shadow detail survives the trip through 8 bits.
export const ANALYZE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uAccum;
uniform vec2 uTexel;

void main() {
  vec3 sum = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      sum += texture(uAccum, vUv + vec2(float(x), float(y)) * uTexel * 4.0).rgb;
    }
  }
  fragColor = vec4(sqrt(max(sum / 9.0, 0.0)), 1.0);
}`;

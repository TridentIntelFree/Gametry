// Shooting modes. Each one is a preset over the pipeline state — the
// difference between "Night" and "Auto" is entirely how deeply frames are
// stacked and how hard the tone curve lifts the shadows.

export const MODES = {
  auto: {
    name: 'Auto',
    hint: 'Balanced. Light stacking, natural colour.',
    state: {
      stackFrames: 3,
      accumMode: 0,
      rejectLo: 0.06,
      rejectHi: 0.30,
      black: 0.0,
      gain: 1.0,
      gamma: 1.0,
      contrast: 1.0,
      saturation: 1.0,
      denoise: 0.25,
      sharpen: 0.25,
      palette: 0,
      vignette: 0.0,
      autoExposure: true,
      autoTarget: 0.20,
      autoMax: 3,
    },
  },

  night: {
    name: 'Night',
    hint: 'Deep frame stacking. Hold still — the longer you hold, the cleaner it gets.',
    state: {
      stackFrames: 24,
      accumMode: 0,
      rejectLo: 0.10,
      rejectHi: 0.42,
      black: 0.006,
      gain: 1.0,
      gamma: 1.9,
      contrast: 0.92,
      saturation: 0.85,
      denoise: 0.85,
      sharpen: 0.45,
      palette: 0,
      vignette: 0.0,
      autoExposure: true,
      autoTarget: 0.30,
      autoMax: 14,
    },
  },

  intensifier: {
    name: 'Night Vision',
    hint: 'Maximum gain, image-intensifier green. Monochrome sees deeper than colour.',
    state: {
      stackFrames: 32,
      accumMode: 0,
      rejectLo: 0.12,
      rejectHi: 0.48,
      black: 0.004,
      gain: 1.3,
      gamma: 2.3,
      contrast: 0.88,
      saturation: 1.0,
      denoise: 1.0,
      sharpen: 0.55,
      palette: 1,
      vignette: 0.35,
      autoExposure: true,
      autoTarget: 0.34,
      autoMax: 20,
    },
  },

  thermal: {
    name: 'False Colour',
    hint: 'Maps brightness to a heat ramp. Not a thermal sensor — it reveals detail the eye flattens.',
    state: {
      stackFrames: 12,
      accumMode: 0,
      rejectLo: 0.10,
      rejectHi: 0.40,
      black: 0.002,
      gain: 1.0,
      gamma: 1.6,
      contrast: 1.05,
      saturation: 1.0,
      denoise: 0.6,
      sharpen: 0.3,
      palette: 2,
      vignette: 0.0,
      autoExposure: true,
      autoTarget: 0.30,
      autoMax: 10,
    },
  },

  macro: {
    name: 'Macro',
    hint: 'Ultra-wide lens up close, centre-cropped. Get within a few centimetres.',
    state: {
      stackFrames: 6,
      accumMode: 0,
      rejectLo: 0.05,
      rejectHi: 0.25,
      black: 0.0,
      gain: 1.0,
      gamma: 1.0,
      contrast: 1.05,
      saturation: 1.05,
      denoise: 0.3,
      sharpen: 0.7,
      palette: 0,
      vignette: 0.0,
      autoExposure: true,
      autoTarget: 0.20,
      autoMax: 3,
    },
    lensFactor: 0.5,   // ultra-wide focuses far closer than the main lens
    zoom: 2.0,         // crop back in to fill the frame with the subject
    peak: 0.20,        // focus peaking on: depth of field is razor thin up close
  },

  trails: {
    name: 'Light Trails',
    hint: 'Every pixel keeps its brightest moment. Long exposure without a tripod mount.',
    state: {
      stackFrames: 1,
      accumMode: 1,
      black: 0.0,
      gain: 1.0,
      gamma: 1.2,
      contrast: 1.0,
      saturation: 1.1,
      denoise: 0.0,
      sharpen: 0.2,
      palette: 0,
      vignette: 0.0,
      autoExposure: false,
      autoTarget: 0.20,
      autoMax: 1,
    },
  },
};

export function applyMode(pipeline, key) {
  const mode = MODES[key];
  if (!mode) return null;
  Object.assign(pipeline.state, mode.state);
  pipeline.state.mode = key;
  if (mode.peak != null) pipeline.state.peak = mode.peak;
  pipeline.reset();
  return mode;
}

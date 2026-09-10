// Contrast-detection autofocus, built on manual focus.
//
// Safari does not expose focusMode or pointsOfInterest on many iPhones, so
// there is no way to ask the camera to focus. It does expose focusDistance.
// That is enough to do it ourselves: a defocused image is a low-pass version
// of a focused one, so sweeping the focus distance and keeping the position
// with the most high-frequency energy finds focus directly.
//
// Two passes — a coarse sweep to locate the peak, then a fine sweep around it.
// The lens needs a moment to physically settle after each step, and the
// temporal accumulator has to be flushed, or a measurement reports where the
// lens *was*.

// The lens moves in wall-clock time, not frames, so wait on both: enough
// frames for the accumulator to refill, and enough milliseconds for the
// voice-coil to actually arrive. Measuring too early reports where the lens
// *was* and the sweep converges on nonsense.
const SETTLE_FRAMES = 2;
const SETTLE_MS = 90;
const COARSE_STEPS = 11;
const FINE_STEPS = 5;

export class AutoFocus {
  constructor(camera, pipeline) {
    this.camera = camera;
    this.pipeline = pipeline;
    this.running = false;
    this.cancelled = false;
    this.lastResult = null;
  }

  get available() {
    return !!this.camera.focusRange();
  }

  cancel() {
    this.cancelled = true;
  }

  // cx, cy: where in the frame to focus, 0..1. onProgress(fraction, t).
  async run(cx = 0.5, cy = 0.5, onProgress = null) {
    if (!this.available || this.running) return null;
    this.running = true;
    this.cancelled = false;

    const state = this.pipeline.state;
    const saved = { stackFrames: state.stackFrames };
    // Measure on single frames: temporal averaging is the one pipeline stage
    // that reaches the accumulation buffer the metric reads, and it suppresses
    // exactly the high frequencies focus is judged by. (Denoise and sharpen
    // live in the composite pass and never touch that buffer, so they are
    // irrelevant here.)
    state.stackFrames = 1;

    try {
      const coarse = await this.sweep(0, 1, COARSE_STEPS, cx, cy, onProgress, 0, 0.75);
      if (this.cancelled || !coarse) return null;

      // refine within one coarse step either side of the winner
      const span = 1 / (COARSE_STEPS - 1);
      const lo = Math.max(0, coarse.t - span);
      const hi = Math.min(1, coarse.t + span);
      const fine = await this.sweep(lo, hi, FINE_STEPS, cx, cy, onProgress, 0.75, 1);
      if (this.cancelled) return null;

      const best = fine && fine.score >= coarse.score ? fine : coarse;
      await this.camera.setFocusDistance(best.t);
      this.lastResult = best;
      return best;
    } finally {
      state.stackFrames = saved.stackFrames;
      this.pipeline.reset();
      this.running = false;
    }
  }

  async sweep(lo, hi, steps, cx, cy, onProgress, progFrom, progTo) {
    let best = null;
    for (let i = 0; i < steps; i++) {
      if (this.cancelled) return best;
      const t = lo + ((hi - lo) * i) / (steps - 1);

      const ok = await this.camera.setFocusDistance(t);
      if (!ok) return best;

      this.pipeline.reset();
      await settle();
      if (this.cancelled) return best;

      const score = this.pipeline.measureSharpness(cx, cy);
      if (!best || score > best.score) best = { t, score };

      onProgress?.(progFrom + ((progTo - progFrom) * (i + 1)) / steps, t);
    }
    return best;
  }
}

// Both conditions, not either: frames for the accumulator, milliseconds for
// the lens.
function settle() {
  const frames = new Promise((resolve) => {
    let left = SETTLE_FRAMES;
    const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
  const clock = new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  return Promise.all([frames, clock]);
}

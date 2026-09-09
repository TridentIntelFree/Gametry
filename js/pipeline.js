// The render graph: video -> accumulation -> screen, plus the analysis
// readback that drives auto-gain and the live histogram.

import { GLCore } from './glcore.js';
import { VERT, ACCUM_FRAG, COMPOSITE_FRAG, ANALYZE_FRAG } from './shaders.js';

const ANALYZE_SIZE = 64;
const ANALYZE_INTERVAL = 180; // ms between CPU readbacks

export class Pipeline {
  constructor(canvas) {
    this.core = new GLCore(canvas);
    const gl = this.core.gl;

    this.progAccum = this.core.program(VERT, ACCUM_FRAG, 'accum');
    this.progComposite = this.core.program(VERT, COMPOSITE_FRAG, 'composite');
    this.progAnalyze = this.core.program(VERT, ANALYZE_FRAG, 'analyze');

    this.videoTex = this.core.videoTexture();
    this.accum = [null, null];
    this.front = 0;
    this.analyzeTarget = this.core.target(ANALYZE_SIZE, ANALYZE_SIZE, 'byte');
    this.analyzeBuf = new Uint8Array(ANALYZE_SIZE * ANALYZE_SIZE * 4);
    this.lastAnalyze = 0;

    this.width = 0;
    this.height = 0;
    this.needsReset = true;

    // Processing runs at the display's own pixel count, so the result maps
    // 1:1 to the screen. Rendering smaller and letting the GPU upscale is
    // indistinguishable from a lens that never focused.
    this.maxDimension = 2600;
    this.frameMs = 16;
    this.qualityScale = 1;
    this.crop = [0, 0, 1, 1];
    this.lastCropKey = '';
    this.sourceScale = 1; // real source pixels per output pixel (>=1 is sharp)

    this.histogram = new Uint32Array(64);
    this.meanLuma = 0.2;
    this.autoGain = 1;

    this.state = {
      mode: 'auto',
      stackFrames: 1,
      rejectLo: 0.06,
      rejectHi: 0.30,
      accumMode: 0,
      black: 0.0,
      gain: 1.0,
      gamma: 1.0,
      contrast: 1.0,
      saturation: 1.0,
      denoise: 0.0,
      sharpen: 0.25,
      peak: 0.0,
      vignette: 0.0,
      palette: 0,
      zoom: 1,          // user zoom, applied at ingest
      stabMargin: 1,    // stabiliser headroom, applied at composite
      autoExposure: true,
      autoTarget: 0.22,
      autoMax: 8,
      mirror: false,
    };
  }

  get gl() { return this.core.gl; }

  // Work out the region of the video to sample (aspect-fill, then zoom) and
  // how many pixels to process it at.
  //
  // The crop is taken from the full-resolution video, so zooming 3x into a 4K
  // frame still leaves ~1280 real pixels across — optical-grade detail rather
  // than a magnified thumbnail.
  planCrop(videoW, videoH, zoom, outAspect) {
    const videoAspect = videoW / videoH;
    let cw, ch;
    if (videoAspect > outAspect) {
      ch = videoH;
      cw = videoH * outAspect;      // video is wider than the screen: trim sides
    } else {
      cw = videoW;
      ch = videoW / outAspect;      // taller: trim top and bottom
    }
    cw /= zoom;
    ch /= zoom;

    const su = cw / videoW;
    const sv = ch / videoH;
    this.crop = [(1 - su) / 2, (1 - sv) / 2, su, sv];
    return { cw, ch };
  }

  resize(cropW, cropH, outW, outH) {
    // Never process more pixels than either the crop actually contains or the
    // screen can show — beyond that is pure cost with nothing to see for it.
    const cap = this.maxDimension;
    let w = Math.min(cropW, outW, cap) * this.qualityScale;
    let h = w * (outH / outW);
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    // Real sensor pixels behind each screen pixel, end to end. The processing
    // buffer is a ceiling on detail just as much as the crop is, so the honest
    // figure is whichever is smaller — measured against the screen, not
    // against the buffer (which would flatter itself).
    this.sourceScale = Math.min(cropW, w) / outW;
    if (w === this.width && h === this.height) return;

    const gl = this.gl;
    for (const t of this.accum) {
      if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    }
    this.accum = [this.core.target(w, h), this.core.target(w, h)];
    this.width = w;
    this.height = h;
    this.needsReset = true;
  }

  reset() { this.needsReset = true; }

  // Frame budget feedback. Called with the measured GPU-side frame time.
  observeFrameTime(ms) {
    this.frameMs += (ms - this.frameMs) * 0.05;
    // Floor is 0.75, not 0.55: below that the softness is more objectionable
    // than the dropped frames it buys back.
    if (this.frameMs > 34 && this.qualityScale > 0.75) {
      this.qualityScale = Math.max(0.75, this.qualityScale - 0.05);
      this.width = 0; // force a resize on next frame
    } else if (this.frameMs < 15 && this.qualityScale < 1) {
      this.qualityScale = Math.min(1, this.qualityScale + 0.04);
      this.width = 0;
    }
  }

  render(camera, motion, dt) {
    if (!camera.ready) return;
    const gl = this.gl;
    const s = this.state;

    const outW = this.core.canvas.width;
    const outH = this.core.canvas.height;
    const { cw, ch } = this.planCrop(camera.width, camera.height, s.zoom, outW / outH);
    this.resize(cw, ch, outW, outH);

    // Changing the crop invalidates the accumulated history — it was gathered
    // through a different window onto the scene.
    const cropKey = this.crop.map((v) => v.toFixed(4)).join(',');
    if (cropKey !== this.lastCropKey) {
      this.lastCropKey = cropKey;
      this.needsReset = true;
    }

    this.core.uploadVideo(this.videoTex, camera.video);

    // --- pass 1: accumulate ---
    const src = this.accum[this.front];
    const dst = this.accum[1 - this.front];
    this.core.draw(
      this.progAccum,
      dst,
      { uFrame: this.videoTex, uHistory: src.tex },
      {
        uCrop: this.crop,
        uAlphaMin: 1 / Math.max(1, s.stackFrames),
        uRejectLo: s.rejectLo,
        uRejectHi: s.rejectHi,
        uReset: this.needsReset ? 1 : 0,
        uMode: s.accumMode,
      }
    );
    this.front = 1 - this.front;
    this.needsReset = false;

    const accumTex = this.accum[this.front].tex;

    // --- analysis readback: histogram + auto exposure ---
    const now = performance.now();
    if (now - this.lastAnalyze > ANALYZE_INTERVAL) {
      this.lastAnalyze = now;
      this.analyze(accumTex);
    }

    if (s.autoExposure) {
      const target = s.autoTarget;
      const desired = Math.max(
        1,
        Math.min(s.autoMax, target / Math.max(this.meanLuma, 0.002))
      );
      // ease toward the target so exposure never pumps
      this.autoGain += (desired - this.autoGain) * Math.min(1, dt * 1.5);
    } else {
      this.autoGain += (1 - this.autoGain) * Math.min(1, dt * 3);
    }

    // --- pass 2: composite to screen ---
    // Only the stabiliser's margin crop happens here; user zoom already
    // happened at ingest against full sensor resolution.
    this.core.draw(
      this.progComposite,
      null,
      { uAccum: accumTex },
      {
        uTexel: [1 / this.width, 1 / this.height],
        uOffset: motion.offset,
        uZoom: Math.max(1, s.stabMargin),
        uRoll: motion.roll,
        uMirror: s.mirror ? 1 : 0,
        uBlack: s.black,
        uGain: s.gain,
        uAutoGain: this.autoGain,
        uGamma: s.gamma,
        uContrast: s.contrast,
        uSat: s.saturation,
        uDenoise: s.denoise,
        uSharp: s.sharpen,
        uPeak: s.peak,
        uVignette: s.vignette,
        uPalette: s.palette,
      }
    );
  }

  analyze(accumTex) {
    const gl = this.gl;
    this.core.draw(
      this.progAnalyze,
      this.analyzeTarget,
      { uAccum: accumTex },
      { uTexel: [1 / this.width, 1 / this.height] }
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.analyzeTarget.fbo);
    gl.readPixels(0, 0, ANALYZE_SIZE, ANALYZE_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, this.analyzeBuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.histogram.fill(0);
    let sum = 0;
    const buf = this.analyzeBuf;
    const n = ANALYZE_SIZE * ANALYZE_SIZE;
    for (let i = 0; i < n; i++) {
      // shader wrote sqrt(linear); undo it to get linear luminance back
      const r = buf[i * 4] / 255, g = buf[i * 4 + 1] / 255, b = buf[i * 4 + 2] / 255;
      const lin = 0.2126 * r * r + 0.7152 * g * g + 0.0722 * b * b;
      sum += lin;
      // histogram is plotted in display space, so bin the sqrt-ish value
      const disp = Math.sqrt(lin);
      const bin = Math.min(63, (disp * 64) | 0);
      this.histogram[bin]++;
    }
    this.meanLuma = sum / n;
  }

  // Read the current canvas back as a PNG blob for saving/sharing.
  async capture() {
    return new Promise((resolve) => {
      this.core.canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }
}

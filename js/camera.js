// Camera acquisition, lens discovery and capability probing.
//
// iOS Safari exposes each physical back lens as a separate videoinput device
// once permission has been granted, which is what makes real optical lens
// switching possible from a web page. Labels are the only signal for which
// lens is which, so we match on them and fall back gracefully.

const LENS_PATTERNS = [
  { re: /ultra.?wide/i, factor: 0.5, label: '.5×', name: 'Ultra Wide' },
  { re: /telephoto/i, factor: 3, label: '3×', name: 'Telephoto' },
  { re: /triple/i, factor: 1, label: '1×', name: 'Triple (auto)' },
  { re: /dual.?wide/i, factor: 1, label: '1×', name: 'Dual Wide (auto)' },
  { re: /dual/i, factor: 1, label: '1×', name: 'Dual (auto)' },
  { re: /wide/i, factor: 1, label: '1×', name: 'Wide' },
];

export class Camera {
  constructor() {
    this.stream = null;
    this.track = null;
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('webkit-playsinline', '');

    this.lenses = [];      // discovered back lenses, sorted by focal factor
    this.frontId = null;
    this.currentId = null;
    this.facing = 'environment';
    this.capabilities = {};
  }

  get ready() {
    return this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  get width() { return this.video.videoWidth; }
  get height() { return this.video.videoHeight; }

  // Permission must be granted before enumerateDevices() returns labels, so
  // open a throwaway stream first, then enumerate, then open the lens we want.
  async start(preferredFactor = 1) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not expose camera access (getUserMedia).');
    }

    const seed = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    seed.getTracks().forEach((t) => t.stop());

    await this.discover();
    const lens = this.pickLens(preferredFactor);
    await this.open(lens ? lens.deviceId : null, 'environment');
  }

  async discover() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');

    const back = [];
    for (const d of cams) {
      const label = d.label || '';
      if (/front/i.test(label)) {
        this.frontId = d.deviceId;
        continue;
      }
      const match = LENS_PATTERNS.find((p) => p.re.test(label));
      back.push({
        deviceId: d.deviceId,
        rawLabel: label,
        factor: match ? match.factor : 1,
        label: match ? match.label : '1×',
        name: match ? match.name : (label || 'Camera'),
      });
    }

    // No labels at all (permission denied, or a browser that withholds them):
    // fall back to whatever videoinputs exist.
    if (back.length === 0 && cams.length > 0) {
      back.push({
        deviceId: cams[0].deviceId,
        rawLabel: cams[0].label,
        factor: 1,
        label: '1×',
        name: 'Camera',
      });
    }

    // De-duplicate by focal factor, preferring a dedicated physical lens over a
    // virtual "auto" device, so the zoom bar shows .5 / 1 / 3 rather than five
    // near-identical entries.
    const byFactor = new Map();
    for (const lens of back) {
      const existing = byFactor.get(lens.factor);
      const isVirtual = /auto/i.test(lens.name);
      if (!existing || (/auto/i.test(existing.name) && !isVirtual)) {
        byFactor.set(lens.factor, lens);
      }
    }
    this.lenses = [...byFactor.values()].sort((a, b) => a.factor - b.factor);
    return this.lenses;
  }

  pickLens(factor) {
    if (!this.lenses.length) return null;
    // the widest lens whose native factor does not overshoot the request
    let best = this.lenses[0];
    for (const lens of this.lenses) {
      if (lens.factor <= factor + 1e-3) best = lens;
    }
    return best;
  }

  async open(deviceId, facing = 'environment') {
    this.stop();

    const video = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: facing };

    // Ask for the most pixels the lens will give us; the browser clamps to the
    // nearest supported format rather than failing.
    Object.assign(video, {
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 60 },
    });

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
      // Some devices reject the exact deviceId under load; retry loosely.
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
        audio: false,
      });
    }

    this.stream = stream;
    this.track = stream.getVideoTracks()[0];
    this.currentId = deviceId;
    this.facing = facing;
    this.video.srcObject = stream;
    this.probe();

    await this.video.play().catch(() => {});
    await new Promise((resolve) => {
      if (this.ready) return resolve();
      this.video.onloadedmetadata = () => resolve();
      setTimeout(resolve, 3000);
    });
    return this.track;
  }

  async switchToFront() {
    if (!this.frontId) return this.open(null, 'user');
    return this.open(this.frontId, 'user');
  }

  // What does this specific browser + device actually allow? Safari has
  // historically not implemented zoom/torch/ISO constraints, so nothing here
  // is assumed — it is measured and reported in the diagnostics panel.
  probe() {
    const caps = {};
    try {
      caps.capabilities = this.track?.getCapabilities ? this.track.getCapabilities() : null;
      caps.settings = this.track?.getSettings ? this.track.getSettings() : null;
    } catch {
      caps.capabilities = null;
    }
    const supported = navigator.mediaDevices.getSupportedConstraints
      ? navigator.mediaDevices.getSupportedConstraints()
      : {};
    caps.supportedConstraints = supported;
    caps.hasZoom = !!(caps.capabilities && 'zoom' in caps.capabilities);
    caps.hasTorch = !!(caps.capabilities && 'torch' in caps.capabilities);
    caps.hasFocus = !!(caps.capabilities && 'focusDistance' in caps.capabilities);
    caps.hasISO = !!(caps.capabilities && 'iso' in caps.capabilities);
    caps.hasExposureTime = !!(caps.capabilities && 'exposureTime' in caps.capabilities);
    this.capabilities = caps;
    return caps;
  }

  // Optical/sensor zoom, where the browser implements it. Returns false when
  // unsupported so the caller can fall back to shader zoom.
  async setNativeZoom(value) {
    const caps = this.capabilities.capabilities;
    if (!caps || !('zoom' in caps)) return false;
    const clamped = Math.max(caps.zoom.min, Math.min(caps.zoom.max, value));
    try {
      await this.track.applyConstraints({ advanced: [{ zoom: clamped }] });
      return true;
    } catch {
      return false;
    }
  }

  async setTorch(on) {
    if (!this.capabilities.hasTorch) return false;
    try {
      await this.track.applyConstraints({ advanced: [{ torch: !!on }] });
      return true;
    } catch {
      return false;
    }
  }

  // Nudge the browser's auto-exposure darker or brighter where supported.
  // Even without it the shader gain does the heavy lifting.
  async setExposureCompensation(ev) {
    const caps = this.capabilities.capabilities;
    if (!caps || !('exposureCompensation' in caps)) return false;
    try {
      await this.track.applyConstraints({ advanced: [{ exposureCompensation: ev }] });
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.track = null;
    }
  }
}

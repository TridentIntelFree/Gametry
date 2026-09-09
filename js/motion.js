// Gyroscope-driven digital stabilisation.
//
// The gyro reports angular velocity. Integrating it gives orientation, but
// integrating raw gives unbounded drift — and more importantly it would fight
// you when you deliberately pan. So the integrated angle is continuously
// leaked back toward zero: fast wobble survives, slow intentional movement
// decays away. That is a high-pass filter, and it is what makes the result
// feel like a gimbal rather than a lock.
//
// The frame is then shifted by the opposite of the residual shake. That needs
// spare pixels around the edges, which is why stabilisation forces a small
// crop (see MARGIN).

export const MARGIN = 1.12; // minimum zoom while stabilising, ~12% crop

export class Stabilizer {
  constructor() {
    this.enabled = false;
    this.granted = false;
    this.available = typeof window.DeviceMotionEvent !== 'undefined';
    this.needsPermission =
      this.available && typeof window.DeviceMotionEvent.requestPermission === 'function';

    // residual shake, radians
    this.pitch = 0;
    this.yaw = 0;
    this.roll = 0;
    // smoothed output
    this.outX = 0;
    this.outY = 0;
    this.outRoll = 0;

    this.strength = 0.7;
    this.decay = 2.6;      // how fast intentional motion is forgiven, per second
    this.lastT = 0;
    this.sawData = false;

    this._onMotion = this._onMotion.bind(this);
  }

  // iOS requires this to be called from inside a user gesture.
  async requestPermission() {
    if (!this.available) return false;
    if (!this.needsPermission) {
      this.granted = true;
      window.addEventListener('devicemotion', this._onMotion);
      return true;
    }
    try {
      const res = await window.DeviceMotionEvent.requestPermission();
      this.granted = res === 'granted';
      if (this.granted) window.addEventListener('devicemotion', this._onMotion);
      return this.granted;
    } catch {
      this.granted = false;
      return false;
    }
  }

  _onMotion(e) {
    const r = e.rotationRate;
    if (!r) return;
    const now = performance.now();
    const dt = this.lastT ? Math.min((now - this.lastT) / 1000, 0.1) : 0;
    this.lastT = now;
    if (!dt) return;

    if (r.alpha || r.beta || r.gamma) this.sawData = true;

    const D2R = Math.PI / 180;
    // integrate
    this.pitch += (r.beta || 0) * D2R * dt;
    this.yaw += (r.gamma || 0) * D2R * dt;
    this.roll += (r.alpha || 0) * D2R * dt;

    // leak toward zero — the high-pass that separates shake from panning
    const k = Math.exp(-this.decay * dt);
    this.pitch *= k;
    this.yaw *= k;
    this.roll *= k;
  }

  // Returns the correction to apply this frame, in UV units and radians.
  update(dt, fovRadians = 1.2) {
    if (!this.enabled || !this.granted) {
      this.outX += (0 - this.outX) * Math.min(1, dt * 8);
      this.outY += (0 - this.outY) * Math.min(1, dt * 8);
      this.outRoll += (0 - this.outRoll) * Math.min(1, dt * 8);
      return { offset: [this.outX, this.outY], roll: this.outRoll };
    }

    // angle -> fraction of the frame. Screen axes depend on orientation.
    const landscape = Math.abs(window.orientation) === 90 ||
      (screen.orientation && /landscape/.test(screen.orientation.type));

    let tx = this.yaw / fovRadians;
    let ty = this.pitch / fovRadians;
    if (landscape) {
      const t = tx;
      tx = ty;
      ty = -t;
    }

    const limit = (MARGIN - 1) * 0.5;
    tx = Math.max(-limit, Math.min(limit, tx * this.strength));
    ty = Math.max(-limit, Math.min(limit, ty * this.strength));
    const troll = Math.max(-0.12, Math.min(0.12, this.roll * this.strength));

    // critically-damped-ish smoothing so corrections never snap
    const s = Math.min(1, dt * 14);
    this.outX += (tx - this.outX) * s;
    this.outY += (ty - this.outY) * s;
    this.outRoll += (troll - this.outRoll) * s;

    return { offset: [this.outX, this.outY], roll: this.outRoll };
  }

  reset() {
    this.pitch = this.yaw = this.roll = 0;
    this.outX = this.outY = this.outRoll = 0;
  }

  destroy() {
    window.removeEventListener('devicemotion', this._onMotion);
  }
}

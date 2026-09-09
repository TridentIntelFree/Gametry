// Enemy types: ground-patrolling Crawler and hovering Flyer.

class Crawler {
  constructor(x, y) {
    this.w = 26;
    this.h = 18;
    this.x = x + (TILE - this.w) / 2;
    this.y = y + TILE - this.h;
    this.vx = 0;
    this.vy = 0;
    this.dir = 1;
    this.speed = 42;
    this.hp = 2;
    this.dead = false;
    this.flash = 0;      // hurt flash timer
    this.knock = 0;      // knockback timer (no walking while knocked)
    this.lastSlashHit = -1;
    this.t = Math.random() * 10;
  }

  update(dt, game) {
    if (this.dead) return;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.knock = Math.max(0, this.knock - dt);

    this.vy = Math.min(this.vy + 2200 * dt, 900);
    if (this.knock <= 0) this.vx = this.dir * this.speed;

    const res = moveWithCollision(this, game.level, dt);

    if (res.grounded && this.knock <= 0) {
      // turn around at walls and ledges
      const aheadX = this.dir > 0 ? this.x + this.w + 2 : this.x - 3;
      const wall = game.level.rectSolid(aheadX, this.y + 4, 1, this.h - 8);
      const ground = game.level.rectSolid(aheadX, this.y + this.h + 4, 1, 4);
      if (wall || !ground) this.dir *= -1;
    }
  }

  takeHit(fromDir, game) {
    this.hp -= 1;
    this.flash = 0.15;
    this.knock = 0.25;
    this.vx = fromDir * 260;
    this.vy = -140;
    if (this.hp <= 0) {
      this.dead = true;
      game.spawnBurst(this.x + this.w / 2, this.y + this.h / 2, '#c8d0e0', 14);
    } else {
      game.spawnBurst(this.x + this.w / 2, this.y + this.h / 2, '#f0a44a', 6);
    }
  }

  draw(ctx, cam) {
    if (this.dead) return;
    const x = this.x - cam.x, y = this.y - cam.y;
    const cx = x + this.w / 2;
    ctx.fillStyle = this.flash > 0 ? '#e8e8f2' : '#2a2438';
    // dome body
    ctx.beginPath();
    ctx.ellipse(cx, y + this.h, this.w / 2, this.h, 0, Math.PI, 0);
    ctx.fill();
    // shell highlight
    ctx.strokeStyle = 'rgba(190,205,235,0.18)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(cx, y + this.h, this.w / 2 - 4, this.h - 4, 0, Math.PI * 1.15, Math.PI * 1.6);
    ctx.stroke();
    // shuffling legs
    ctx.strokeStyle = this.flash > 0 ? '#e8e8f2' : '#1c1828';
    ctx.lineWidth = 2;
    const step = Math.sin(this.t * 14) * 3;
    for (let i = 0; i < 4; i++) {
      const lx = x + 4 + i * (this.w - 8) / 3;
      ctx.beginPath();
      ctx.moveTo(lx, y + this.h - 2);
      ctx.lineTo(lx + (i % 2 ? step : -step), y + this.h + 3);
      ctx.stroke();
    }
    // eye
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath();
    ctx.arc(cx + this.dir * 7, y + this.h - 8, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

class Flyer {
  constructor(x, y) {
    this.w = 22;
    this.h = 20;
    this.homeX = x + (TILE - this.w) / 2;
    this.homeY = y + (TILE - this.h) / 2;
    this.x = this.homeX;
    this.y = this.homeY;
    this.vx = 0;
    this.vy = 0;
    this.hp = 2;
    this.dead = false;
    this.flash = 0;
    this.knock = 0;
    this.lastSlashHit = -1;
    this.t = Math.random() * 10;
  }

  update(dt, game) {
    if (this.dead) return;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.knock = Math.max(0, this.knock - dt);

    const p = game.player;
    const px = p.x + p.w / 2, py = p.y + p.h / 2;
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const dx = px - cx, dy = py - cy;
    const dist = Math.hypot(dx, dy);

    if (this.knock <= 0) {
      if (dist < 250 && !p.dead) {
        // chase the player
        this.vx += (dx / dist) * 420 * dt;
        this.vy += (dy / dist) * 420 * dt;
      } else {
        // drift back home and bob
        this.vx += (this.homeX - this.x) * 1.6 * dt;
        this.vy += (this.homeY + Math.sin(this.t * 2.4) * 12 - this.y) * 1.6 * dt;
      }
      // speed cap + damping
      const sp = Math.hypot(this.vx, this.vy);
      const cap = 120;
      if (sp > cap) { this.vx *= cap / sp; this.vy *= cap / sp; }
    }
    this.vx *= 1 - 0.8 * dt;
    this.vy *= 1 - 0.8 * dt;

    moveWithCollision(this, game.level, dt);
  }

  takeHit(fromDir, game) {
    this.hp -= 1;
    this.flash = 0.15;
    this.knock = 0.3;
    this.vx = fromDir * 300;
    this.vy = -120;
    if (this.hp <= 0) {
      this.dead = true;
      game.spawnBurst(this.x + this.w / 2, this.y + this.h / 2, '#c8d0e0', 14);
    } else {
      game.spawnBurst(this.x + this.w / 2, this.y + this.h / 2, '#f0a44a', 6);
    }
  }

  draw(ctx, cam) {
    if (this.dead) return;
    const x = this.x - cam.x, y = this.y - cam.y;
    const cx = x + this.w / 2, cy = y + this.h / 2;
    const flap = Math.sin(this.t * 16) * 0.6;
    // wings
    ctx.fillStyle = this.flash > 0 ? '#e8e8f2' : '#3a3350';
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(cx + s * 6, cy - 4);
      ctx.rotate(s * flap);
      ctx.beginPath();
      ctx.ellipse(s * 7, 0, 9, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // body
    ctx.fillStyle = this.flash > 0 ? '#e8e8f2' : '#2a2438';
    ctx.beginPath();
    ctx.ellipse(cx, cy, this.w / 2 - 2, this.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // eyes
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath();
    ctx.arc(cx - 4, cy - 1, 2.2, 0, Math.PI * 2);
    ctx.arc(cx + 4, cy - 1, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

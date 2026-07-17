// The player: Silksong-style movement (coyote time, jump buffering, wall
// jumps, dash) and needle combat (4-way slash, pogo, silk + heal).

const P = {
  RUN: 250,
  ACC: 2600,
  FRI: 2400,
  AIR_ACC: 1800,
  AIR_FRI: 500,
  GRAV: 2200,
  MAX_FALL: 900,
  WALL_SLIDE: 140,
  JUMP: 680,
  WJ_VY: 580,
  WJ_VX: 340,
  WJ_LOCK: 0.14,
  COYOTE: 0.1,
  JUMP_BUFFER: 0.12,
  DASH_V: 560,
  DASH_T: 0.16,
  DASH_CD: 0.45,
  POGO: 560,
  ATK_T: 0.14,
  ATK_CD: 0.32,
  HEAL_TIME: 0.85,
  HEAL_COST: 3,
  MAX_MASKS: 5,
  MAX_SILK: 9,
};

class Player {
  constructor(x, y) {
    this.w = 20;
    this.h = 34;
    this.respawn(x, y);
    this.masks = P.MAX_MASKS;
    this.silk = 0;
  }

  respawn(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.onGround = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpCut = false;
    this.wallDir = 0;        // -1 wall on left, 1 wall on right, 0 none
    this.wjLock = 0;
    this.dashT = 0;
    this.dashDir = 1;
    this.dashCd = 0;
    this.canAirDash = true;
    this.atkT = 0;
    this.atkCd = 0;
    this.atkDir = 'side';    // 'side' | 'up' | 'down'
    this.slashId = 0;
    this.invuln = 0;
    this.healT = 0;
    this.dead = false;
    this.landT = 0;          // landing squash timer
    this.ghosts = [];        // dash afterimages
    this.ghostT = 0;
  }

  update(dt, game) {
    if (this.dead) return;
    const level = game.level;

    this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.wjLock = Math.max(0, this.wjLock - dt);
    this.dashT = Math.max(0, this.dashT - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.atkT = Math.max(0, this.atkT - dt);
    this.atkCd = Math.max(0, this.atkCd - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.landT = Math.max(0, this.landT - dt);

    // dash afterimages
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      this.ghosts[i].life -= dt;
      if (this.ghosts[i].life <= 0) this.ghosts.splice(i, 1);
    }
    if (this.dashT > 0) {
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = 0.028;
        this.ghosts.push({ x: this.x, y: this.y, facing: this.facing, life: 0.22 });
      }
    }

    const axis = Input.axis();
    if (axis !== 0 && this.dashT <= 0) this.facing = axis;

    // --- healing (bind): hold heal on the ground with enough silk ---
    const canHeal = this.onGround && this.silk >= P.HEAL_COST &&
      this.masks < P.MAX_MASKS && this.dashT <= 0;
    if (Input.held('heal') && canHeal) {
      this.healT += dt;
      if (this.healT >= P.HEAL_TIME) {
        this.healT = 0;
        this.silk -= P.HEAL_COST;
        this.masks = Math.min(P.MAX_MASKS, this.masks + 1);
        game.spawnBurst(this.x + this.w / 2, this.y + this.h / 2, '#ffffff', 16);
      }
      this.vx = 0;
    } else {
      this.healT = 0;
    }
    const healing = this.healT > 0;

    // --- horizontal movement ---
    if (this.dashT > 0) {
      this.vx = this.dashDir * P.DASH_V;
      this.vy = 0;
    } else if (!healing) {
      const control = this.wjLock > 0 ? 0.3 : 1;
      const acc = (this.onGround ? P.ACC : P.AIR_ACC) * control;
      const fri = this.onGround ? P.FRI : P.AIR_FRI;
      if (axis !== 0) {
        this.vx += axis * acc * dt;
        this.vx = Math.max(-P.RUN, Math.min(P.RUN, this.vx));
      } else {
        const s = Math.sign(this.vx);
        this.vx -= s * fri * dt;
        if (Math.sign(this.vx) !== s) this.vx = 0;
      }
    }

    // --- wall contact ---
    const wallL = level.rectSolid(this.x - 1.5, this.y + 4, 1, this.h - 8);
    const wallR = level.rectSolid(this.x + this.w + 0.5, this.y + 4, 1, this.h - 8);
    this.wallDir = wallR ? 1 : wallL ? -1 : 0;
    const wallSliding = !this.onGround && this.wallDir !== 0 &&
      axis === this.wallDir && this.vy > 0 && this.dashT <= 0;
    if (wallSliding && Math.random() < dt * 22) {
      game.particles.push({
        x: this.x + (this.wallDir > 0 ? this.w : 0),
        y: this.y + 6 + Math.random() * (this.h - 12),
        vx: -this.wallDir * (10 + Math.random() * 25),
        vy: -20 - Math.random() * 40,
        life: 0.25 + Math.random() * 0.2,
        maxLife: 0.45,
        size: 1.5 + Math.random() * 1.5,
        color: '#5a688a',
        grav: 500,
      });
    }

    // --- gravity ---
    if (this.dashT <= 0) {
      this.vy += P.GRAV * dt;
      // releasing jump early cuts the rise short (variable jump height)
      if (!Input.held('jump') && this.vy < 0 && !this.jumpCut) {
        this.jumpCut = true;
        this.vy *= 0.45;
      }
      const maxFall = wallSliding ? P.WALL_SLIDE : P.MAX_FALL;
      this.vy = Math.min(this.vy, maxFall);
    }

    // --- jumping ---
    if (Input.pressed('jump')) this.jumpBuffer = P.JUMP_BUFFER;
    if (this.jumpBuffer > 0 && !healing) {
      if (this.onGround || this.coyote > 0) {
        this.vy = -P.JUMP;
        this.jumpBuffer = 0;
        this.coyote = 0;
        this.jumpCut = false;
        this.dashT = 0;
        game.spawnBurst(this.x + this.w / 2, this.y + this.h, '#5a688a', 4, 60);
      } else if (this.wallDir !== 0) {
        this.vy = -P.WJ_VY;
        this.vx = -this.wallDir * P.WJ_VX;
        this.facing = -this.wallDir;
        this.wjLock = P.WJ_LOCK;
        this.jumpBuffer = 0;
        this.jumpCut = false;
        this.canAirDash = true;
        game.spawnBurst(this.x + (this.wallDir > 0 ? this.w : 0), this.y + this.h / 2, '#5a688a', 5, 80);
      }
    }

    // --- dash ---
    if (Input.pressed('dash') && this.dashCd <= 0 && this.dashT <= 0 &&
        !healing && (this.onGround || this.canAirDash)) {
      this.dashT = P.DASH_T;
      this.dashCd = P.DASH_CD;
      this.dashDir = axis !== 0 ? axis : this.facing;
      this.facing = this.dashDir;
      if (!this.onGround) this.canAirDash = false;
      game.spawnBurst(this.x + this.w / 2, this.y + this.h / 2, '#b8c4de', 8, 90);
    }

    // --- attack ---
    if (Input.pressed('attack') && this.atkCd <= 0 && this.dashT <= 0 && !healing) {
      this.atkT = P.ATK_T;
      this.atkCd = P.ATK_CD;
      this.slashId++;
      if (Input.held('up')) this.atkDir = 'up';
      else if (Input.held('down') && !this.onGround) this.atkDir = 'down';
      else this.atkDir = 'side';
    }

    // --- move & collide ---
    const res = moveWithCollision(this, level, dt);
    const wasGrounded = this.onGround;
    this.onGround = res.grounded;
    if (this.onGround) {
      this.coyote = P.COYOTE;
      this.canAirDash = true;
      this.jumpCut = false;
      if (!wasGrounded) {
        this.landT = 0.11;
        game.spawnBurst(this.x + this.w / 2, this.y + this.h, '#3a4763', 4, 50);
      }
    }
    if (res.hitX) this.dashT = 0;

    // --- spike damage ---
    if (level.rectHits(this.x + 3, this.y + 4, this.w - 6, this.h - 6, '^')) {
      this.damage(1, this.x, game);
    }
  }

  // world-space hitbox of the current slash
  slashRect() {
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    if (this.atkDir === 'up') return { x: cx - 18, y: this.y - 40, w: 36, h: 44 };
    if (this.atkDir === 'down') return { x: cx - 18, y: this.y + this.h - 4, w: 36, h: 44 };
    return this.facing > 0
      ? { x: this.x + this.w - 4, y: cy - 16, w: 46, h: 32 }
      : { x: this.x - 42, y: cy - 16, w: 46, h: 32 };
  }

  pogo() {
    this.vy = -P.POGO;
    this.jumpCut = true;       // pogo height is fixed, not jump-cuttable
    this.canAirDash = true;
    this.dashCd = 0;
    this.atkT = 0;
  }

  gainSilk(n) {
    this.silk = Math.min(P.MAX_SILK, this.silk + n);
  }

  damage(n, fromX, game) {
    if (this.invuln > 0 || this.dead) return;
    this.masks -= n;
    this.invuln = 1.3;
    this.healT = 0;
    this.dashT = 0;
    this.atkT = 0;
    const dir = this.x + this.w / 2 < fromX ? -1 : 1;
    this.vx = dir * 230;
    this.vy = -300;
    game.onPlayerHurt();
    if (this.masks <= 0) {
      this.dead = true;
      game.onPlayerDeath();
    }
  }

  draw(ctx, cam, time) {
    if (this.dead) return;

    // dash afterimages, oldest first
    for (const g of this.ghosts) {
      const a = (g.life / 0.22) * 0.3;
      ctx.save();
      ctx.translate(g.x + this.w / 2 - cam.x, g.y - cam.y);
      ctx.scale(g.facing, 1);
      ctx.fillStyle = `rgba(143,164,216,${a})`;
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.lineTo(9, this.h - 2);
      ctx.lineTo(-9, this.h - 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 8, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // blink while invulnerable
    if (this.invuln > 0 && Math.floor(time * 18) % 2 === 0) return;

    const x = this.x - cam.x, y = this.y - cam.y;
    const cx = x + this.w / 2;

    // squash on landing, stretch while airborne, bob while running
    let sx = 1, sy = 1;
    if (this.landT > 0) {
      sy = 0.86;
      sx = 1.14;
    } else if (!this.onGround) {
      const k = Math.max(-0.1, Math.min(0.14, -this.vy / 1800));
      sy = 1 + k;
      sx = 1 - k * 0.6;
    }
    const running = this.onGround && Math.abs(this.vx) > 30;
    const bob = running ? Math.sin(time * 13) * 1.6 : 0;

    ctx.save();
    ctx.translate(cx, y + this.h);
    ctx.scale(this.facing * sx, sy);
    ctx.translate(0, -this.h + bob);

    // cloak
    ctx.fillStyle = '#e9e5f2';
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(9, this.h - 2);
    ctx.lineTo(-9, this.h - 2);
    ctx.closePath();
    ctx.fill();

    // head with two horn tips
    ctx.beginPath();
    ctx.arc(0, 8, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-5, 2); ctx.lineTo(-8, -8); ctx.lineTo(-2, 0);
    ctx.moveTo(5, 2); ctx.lineTo(8, -8); ctx.lineTo(2, 0);
    ctx.fill();

    // red scarf accent
    ctx.fillStyle = '#c0304a';
    ctx.fillRect(-6, 14, 12, 4);

    // eyes
    ctx.fillStyle = '#10141f';
    ctx.beginPath();
    ctx.arc(2, 7, 2, 0, Math.PI * 2);
    ctx.arc(6, 7, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // healing glow + threads
    if (this.healT > 0) {
      const p = this.healT / P.HEAL_TIME;
      ctx.strokeStyle = `rgba(255,255,255,${0.3 + p * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, y + this.h / 2, 26 - p * 10, 0, Math.PI * 2 * p);
      ctx.stroke();
    }

    // needle slash arc
    if (this.atkT > 0) {
      const a = this.atkT / P.ATK_T;
      const r = this.slashRect();
      const scx = r.x + r.w / 2 - cam.x;
      const scy = r.y + r.h / 2 - cam.y;
      let ang = 0;
      if (this.atkDir === 'up') ang = -Math.PI / 2;
      else if (this.atkDir === 'down') ang = Math.PI / 2;
      else ang = this.facing > 0 ? 0 : Math.PI;
      ctx.strokeStyle = `rgba(245,242,255,${a})`;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(scx, scy, 20, ang - 1.1, ang + 1.1);
      ctx.stroke();
      ctx.strokeStyle = `rgba(192,48,74,${a * 0.7})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(scx, scy, 14, ang - 0.9, ang + 0.9);
      ctx.stroke();
    }
  }
}

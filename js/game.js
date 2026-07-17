// Main game: loop, camera, world state, particles, background and UI.

const canvas = document.getElementById('game');
// opaque + desynchronized shave latency where the platform supports it
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const VIEW_W = canvas.width;
const VIEW_H = canvas.height;

// scale canvas to fit the window, preserving aspect ratio
// (visualViewport tracks the real usable area on iOS when toolbars show/hide)
function fitCanvas() {
  const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const s = Math.min(vw / VIEW_W, vh / VIEW_H);
  canvas.style.width = `${VIEW_W * s}px`;
  canvas.style.height = `${VIEW_H * s}px`;
}
window.addEventListener('resize', fitCanvas);
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitCanvas);
fitCanvas();

// soft light halo around the player, pre-rendered once
const lightSprite = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(256, 256, 20, 256, 256, 250);
  rg.addColorStop(0, 'rgba(160,190,255,0.14)');
  rg.addColorStop(0.5, 'rgba(120,150,220,0.06)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 512, 512);
  return c;
})();

// pre-generated parallax silhouette layers
function makeBgLayer(seed, count, minH, maxH) {
  const rnd = mulberry32(seed);
  const shapes = [];
  for (let i = 0; i < count; i++) {
    shapes.push({
      x: rnd() * 2800,
      w: 30 + rnd() * 90,
      h: minH + rnd() * (maxH - minH),
      top: rnd() < 0.55, // stalactite (from ceiling) vs stalagmite (from floor)
    });
  }
  return shapes;
}

const game = {
  state: 'title', // 'title' | 'play' | 'dying'
  time: 0,
  level: new Level(LEVEL_MAP),
  player: null,
  enemies: [],
  benches: [],
  shards: [],
  checkpoint: null,
  cam: { x: 0, y: 0, vw: VIEW_W, vh: VIEW_H },
  particles: [],
  fade: 0,
  deathT: 0,
  toastText: '',
  toastT: 0,
  shakeT: 0,
  shakeMag: 0,
  dustT: 0,
  bgFar: makeBgLayer(7, 40, 60, 200),
  bgMid: makeBgLayer(29, 34, 70, 230),
  bgNear: makeBgLayer(13, 30, 80, 260),
};

function initWorld() {
  const s = game.level.spawns;
  game.checkpoint = { x: s.player.x, y: s.player.y };
  game.player = new Player(s.player.x, s.player.y);
  game.benches = s.benches.map((b, i) => ({ x: b.x, y: b.y, i }));
  game.shards = s.shards.map((sh) => ({ x: sh.x, y: sh.y, taken: false }));
  respawnEnemies();
  snapCamera();
}

function respawnEnemies() {
  const s = game.level.spawns;
  game.enemies = [
    ...s.crawlers.map((c) => new Crawler(c.x, c.y)),
    ...s.flyers.map((f) => new Flyer(f.x, f.y)),
  ];
}

game.spawnBurst = (x, y, color, n, speed = 160) => {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.4 + Math.random() * 0.8);
    game.particles.push({
      x, y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 40,
      life: 0.3 + Math.random() * 0.4,
      maxLife: 0.7,
      size: 1.5 + Math.random() * 2.5,
      color,
      grav: 300,
    });
  }
};

game.toast = (text) => {
  game.toastText = text;
  game.toastT = 2.8;
};

game.onPlayerHurt = () => {
  game.shakeT = 0.25;
  game.shakeMag = 6;
  game.spawnBurst(game.player.x + game.player.w / 2, game.player.y + game.player.h / 2, '#c0304a', 10);
};

game.onPlayerDeath = () => {
  game.state = 'dying';
  game.deathT = 0;
  game.spawnBurst(game.player.x + game.player.w / 2, game.player.y + game.player.h / 2, '#e9e5f2', 24, 220);
};

function restAtBench(bench) {
  const p = game.player;
  p.masks = P.MAX_MASKS;
  game.checkpoint = { x: bench.x + 4, y: bench.y - 4 };
  respawnEnemies();
  game.spawnBurst(p.x + p.w / 2, p.y + p.h / 2, '#ffffff', 12, 80);
  game.toast(bench.i === game.benches.length - 1
    ? 'You reached the far bench — end of the demo. Thanks for playing!'
    : 'Rested. Checkpoint saved.');
}

function respawnAtCheckpoint() {
  const p = game.player;
  p.respawn(game.checkpoint.x, game.checkpoint.y);
  p.masks = P.MAX_MASKS;
  p.silk = 0;
  p.dead = false;
  respawnEnemies();
  snapCamera();
}

function snapCamera() {
  const p = game.player;
  game.cam.x = clamp(p.x + p.w / 2 - VIEW_W / 2, 0, game.level.pxW - VIEW_W);
  game.cam.y = clamp(p.y + p.h / 2 - VIEW_H / 2, 0, game.level.pxH - VIEW_H);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ---------------------------------------------------------------- update ---

function update(dt) {
  game.time += dt;
  game.toastT = Math.max(0, game.toastT - dt);
  game.shakeT = Math.max(0, game.shakeT - dt);

  if (game.state === 'title') {
    if (Input.anyKeyPressed()) {
      game.state = 'play';
      game.toast('Find a bench to rest and save your progress.');
    }
    return;
  }

  if (game.state === 'dying') {
    game.deathT += dt;
    updateParticles(dt);
    if (game.deathT > 1.4) {
      respawnAtCheckpoint();
      game.state = 'play';
    }
    return;
  }

  const p = game.player;
  const level = game.level;

  p.update(dt, game);
  for (const e of game.enemies) e.update(dt, game);

  // --- slash hits ---
  if (p.atkT > 0) {
    const r = p.slashRect();
    let pogoed = false;
    for (const e of game.enemies) {
      if (e.dead || e.lastSlashHit === p.slashId) continue;
      if (rectsOverlap(r.x, r.y, r.w, r.h, e.x, e.y, e.w, e.h)) {
        e.lastSlashHit = p.slashId;
        const fromDir = e.x + e.w / 2 < p.x + p.w / 2 ? -1 : 1;
        e.takeHit(fromDir, game);
        p.gainSilk(1);
        game.shakeT = 0.1;
        game.shakeMag = 3;
        if (p.atkDir === 'down') pogoed = true;
        else if (p.atkDir === 'side') p.vx -= p.facing * 60; // slight recoil
      }
    }
    if (p.atkDir === 'down' && level.rectHits(r.x, r.y, r.w, r.h, '^')) pogoed = true;
    if (pogoed) p.pogo();
  }

  // --- enemy contact damage ---
  for (const e of game.enemies) {
    if (e.dead) continue;
    if (rectsOverlap(p.x + 2, p.y + 2, p.w - 4, p.h - 4, e.x, e.y, e.w, e.h)) {
      p.damage(1, e.x + e.w / 2, game);
    }
  }

  // --- silk shards ---
  for (const sh of game.shards) {
    if (sh.taken) continue;
    if (rectsOverlap(p.x, p.y, p.w, p.h, sh.x - 8, sh.y - 8, 16, 16)) {
      sh.taken = true;
      p.gainSilk(3);
      game.spawnBurst(sh.x, sh.y, '#bfe8ff', 10, 100);
    }
  }

  // --- benches ---
  for (const b of game.benches) {
    const near = rectsOverlap(p.x, p.y, p.w, p.h, b.x - 8, b.y - 8, TILE + 16, TILE + 8);
    b.near = near;
    if (near && Input.pressed('up')) restAtBench(b);
  }

  // --- camera: smooth follow with facing lookahead ---
  const targetX = clamp(p.x + p.w / 2 + p.facing * 50 - VIEW_W / 2, 0, level.pxW - VIEW_W);
  const targetY = clamp(p.y + p.h / 2 - VIEW_H / 2 - 30, 0, level.pxH - VIEW_H);
  game.cam.x += (targetX - game.cam.x) * Math.min(1, 5 * dt);
  game.cam.y += (targetY - game.cam.y) * Math.min(1, 5 * dt);

  // --- ambient dust motes ---
  game.dustT -= dt;
  if (game.dustT <= 0) {
    game.dustT = 0.12;
    game.particles.push({
      x: game.cam.x + Math.random() * VIEW_W,
      y: game.cam.y + Math.random() * VIEW_H,
      vx: 6 + Math.random() * 10,
      vy: -4 - Math.random() * 8,
      life: 2.5 + Math.random() * 2,
      maxLife: 4.5,
      size: 1 + Math.random() * 1.4,
      color: '#6b7896',
      grav: 0,
    });
  }

  updateParticles(dt);
}

function updateParticles(dt) {
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const pt = game.particles[i];
    pt.life -= dt;
    if (pt.life <= 0) { game.particles.splice(i, 1); continue; }
    pt.vy += pt.grav * dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
  }
}

// ---------------------------------------------------------------- render ---

function drawBackground() {
  const cam = game.cam;
  // deep cave gradient
  const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  grad.addColorStop(0, '#0a0e18');
  grad.addColorStop(0.6, '#0c1220');
  grad.addColorStop(1, '#070a12');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  drawBgLayer(game.bgFar, 0.18, '#111828');
  drawBgLayer(game.bgMid, 0.3, '#0f1524');
  drawBgLayer(game.bgNear, 0.45, '#0c1220');
  drawFog();
}

// slow horizontal mist bands drifting through the cave
function drawFog() {
  for (let i = 0; i < 2; i++) {
    const y0 = VIEW_H * (0.35 + i * 0.3) + Math.sin(game.time * 0.1 + i * 2.1) * 24;
    const g = ctx.createLinearGradient(0, y0 - 60, 0, y0 + 60);
    g.addColorStop(0, 'rgba(80,100,145,0)');
    g.addColorStop(0.5, `rgba(80,100,145,${0.055 + i * 0.02})`);
    g.addColorStop(1, 'rgba(80,100,145,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0 - 60, VIEW_W, 120);
  }
}

function drawBgLayer(shapes, factor, color) {
  const ox = game.cam.x * factor;
  ctx.fillStyle = color;
  for (const s of shapes) {
    const x = s.x - ox;
    if (x + s.w < -50 || x > VIEW_W + 50) continue;
    ctx.beginPath();
    if (s.top) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + s.w, 0);
      ctx.lineTo(x + s.w / 2, s.h);
    } else {
      ctx.moveTo(x, VIEW_H);
      ctx.lineTo(x + s.w, VIEW_H);
      ctx.lineTo(x + s.w / 2, VIEW_H - s.h);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function drawBench(b) {
  const x = b.x - game.cam.x, y = b.y - game.cam.y;
  // warm lantern glow so benches read as safe places
  const glow = ctx.createRadialGradient(x + TILE / 2, y + 10, 4, x + TILE / 2, y + 10, 52);
  const pulse = 0.09 + Math.sin(game.time * 1.7 + b.i) * 0.02;
  glow.addColorStop(0, `rgba(255,214,150,${pulse})`);
  glow.addColorStop(1, 'rgba(255,214,150,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 40, y - 44, TILE + 80, TILE + 60);
  ctx.strokeStyle = '#cfd6e4';
  ctx.lineWidth = 3;
  // seat
  ctx.beginPath();
  ctx.moveTo(x - 4, y + 18);
  ctx.lineTo(x + TILE + 4, y + 18);
  ctx.stroke();
  // legs
  ctx.beginPath();
  ctx.moveTo(x + 2, y + 18); ctx.lineTo(x + 2, y + TILE);
  ctx.moveTo(x + TILE - 2, y + 18); ctx.lineTo(x + TILE - 2, y + TILE);
  ctx.stroke();
  // backrest scroll
  ctx.beginPath();
  ctx.arc(x + 4, y + 8, 6, Math.PI * 0.5, Math.PI * 1.6);
  ctx.stroke();

  if (b.near && game.state === 'play') {
    ctx.fillStyle = 'rgba(233,229,242,0.9)';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▲ rest', x + TILE / 2, y - 12);
  }
}

function drawShard(sh) {
  if (sh.taken) return;
  const bob = Math.sin(game.time * 3 + sh.x) * 3;
  const x = sh.x - game.cam.x, y = sh.y - game.cam.y + bob;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#bfe8ff';
  ctx.shadowColor = '#7fd0ff';
  ctx.shadowBlur = 10;
  ctx.fillRect(-4, -4, 8, 8);
  ctx.restore();
}

function drawParticles() {
  for (const pt of game.particles) {
    ctx.globalAlpha = Math.min(1, pt.life / (pt.maxLife * 0.5));
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - game.cam.x, pt.y - game.cam.y, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;
}

function drawVignette() {
  const g = ctx.createRadialGradient(
    VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35,
    VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.85
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(2,4,10,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function drawUI() {
  const p = game.player;
  // masks
  for (let i = 0; i < P.MAX_MASKS; i++) {
    const x = 26 + i * 26, y = 26;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    if (i < p.masks) {
      ctx.fillStyle = '#e9e5f2';
      ctx.fillRect(-8, -8, 16, 16);
    } else {
      ctx.strokeStyle = 'rgba(233,229,242,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(-8, -8, 16, 16);
    }
    ctx.restore();
  }
  // silk gauge, segmented per unit
  const gx = 26, gy = 46, gw = P.MAX_SILK * 12;
  ctx.strokeStyle = 'rgba(191,232,255,0.4)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(gx, gy, gw, 8);
  ctx.fillStyle = '#bfe8ff';
  ctx.fillRect(gx + 1, gy + 1, (gw - 2) * (p.silk / P.MAX_SILK), 6);
  ctx.fillStyle = 'rgba(10,16,28,0.55)';
  for (let i = 1; i < P.MAX_SILK; i++) ctx.fillRect(gx + i * 12, gy + 1, 1, 6);

  // toast message
  if (game.toastT > 0) {
    ctx.globalAlpha = Math.min(1, game.toastT);
    ctx.fillStyle = '#e9e5f2';
    ctx.font = '15px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(game.toastText, VIEW_W / 2, VIEW_H - 40);
    ctx.globalAlpha = 1;
  }
}

function drawTitle() {
  ctx.fillStyle = 'rgba(4,6,12,0.78)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#e9e5f2';
  ctx.font = 'bold 58px Georgia, serif';
  ctx.fillText('G A M E T R Y', VIEW_W / 2, 170);

  ctx.fillStyle = '#8b96b0';
  ctx.font = '17px Georgia, serif';
  ctx.fillText('a Silksong-inspired prototype', VIEW_W / 2, 205);

  ctx.font = '14px monospace';
  ctx.fillStyle = '#aab4cc';
  const lines = window.TOUCH_UI ? [
    'Move .......... left pad',
    'Jump .......... JUMP   (hold walls to wall-jump)',
    'Attack ........ ATK    (hold ▼ in the air to pogo)',
    'Dash .......... DASH',
    'Bind (heal) ... hold BIND on the ground (costs 3 silk)',
    'Rest .......... ▲ at a bench',
  ] : [
    'Move .......... Arrow keys / WASD',
    'Jump .......... Z / Space   (hold walls to wall-jump)',
    'Attack ........ X / J       (down + attack in air to pogo)',
    'Dash .......... C / K',
    'Bind (heal) ... hold V / L on the ground (costs 3 silk)',
    'Rest .......... Up at a bench',
  ];
  lines.forEach((l, i) => ctx.fillText(l, VIEW_W / 2, 280 + i * 24));

  const blink = Math.sin(game.time * 4) > -0.2;
  if (blink) {
    ctx.fillStyle = '#e9e5f2';
    ctx.font = '16px monospace';
    ctx.fillText(window.TOUCH_UI ? '— tap to begin —' : '— press any key —', VIEW_W / 2, 470);
  }
}

function render() {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);

  // screen shake
  ctx.save();
  if (game.shakeT > 0) {
    ctx.translate(
      (Math.random() - 0.5) * 2 * game.shakeMag,
      (Math.random() - 0.5) * 2 * game.shakeMag
    );
  }

  drawBackground();
  game.level.draw(ctx, game.cam);
  for (const b of game.benches) drawBench(b);
  for (const sh of game.shards) drawShard(sh);
  for (const e of game.enemies) e.draw(ctx, game.cam);
  game.player.draw(ctx, game.cam, game.time);
  drawParticles();

  // soft light halo following the player
  if (!game.player.dead) {
    const px = game.player.x + game.player.w / 2 - game.cam.x;
    const py = game.player.y + game.player.h / 2 - game.cam.y;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(lightSprite, px - 256, py - 256);
    ctx.globalCompositeOperation = 'source-over';
  }

  drawVignette();

  ctx.restore();

  if (game.state === 'title') drawTitle();
  else drawUI();

  // death fade
  if (game.state === 'dying') {
    ctx.fillStyle = `rgba(2,3,8,${Math.min(1, game.deathT / 0.9)})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

// ------------------------------------------------------------------ loop ---

initWorld();

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  update(dt);
  render();
  Input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

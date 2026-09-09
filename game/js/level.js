// Tile-based level: parsing, collision queries, and rendering.
//
// Map legend:
//   #  solid rock          ^  spikes
//   P  player spawn        B  bench (checkpoint)
//   C  crawler enemy       F  flyer enemy
//   *  silk shard pickup   .  air

const TILE = 32;

// deterministic RNG (also used by game.js for the procedural background)
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pre-rendered tile textures: drawn once at load, blitted per frame.
const TileArt = (() => {
  const variants = [];
  for (let v = 0; v < 4; v++) {
    const cv = document.createElement('canvas');
    cv.width = TILE; cv.height = TILE;
    const g = cv.getContext('2d');
    const rnd = mulberry32(1234 + v * 977);
    g.fillStyle = ['#161e2d', '#18202f', '#141c2a', '#171f2e'][v];
    g.fillRect(0, 0, TILE, TILE);
    // faint sediment strata
    for (let i = 0; i < 3; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(160,180,220,0.05)' : 'rgba(0,0,0,0.10)';
      g.fillRect(0, rnd() * TILE, TILE, 3 + rnd() * 5);
    }
    // mineral speckles
    for (let i = 0; i < 26; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(140,160,200,0.10)' : 'rgba(0,0,0,0.22)';
      g.fillRect(rnd() * TILE, rnd() * TILE, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    // hairline cracks
    g.strokeStyle = 'rgba(5,8,16,0.3)';
    g.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      g.beginPath();
      let px = rnd() * TILE, py = rnd() * TILE;
      g.moveTo(px, py);
      for (let s = 0; s < 3; s++) {
        px += (rnd() - 0.5) * 14;
        py += (rnd() - 0.5) * 14;
        g.lineTo(px, py);
      }
      g.stroke();
    }
    variants.push(cv);
  }

  const spike = document.createElement('canvas');
  spike.width = TILE; spike.height = TILE;
  {
    const g = spike.getContext('2d');
    const n = 4, sw = TILE / n;
    const grad = g.createLinearGradient(0, TILE, 0, 4);
    grad.addColorStop(0, '#39415a');
    grad.addColorStop(0.7, '#9aa3b8');
    grad.addColorStop(1, '#e8ecf6');
    for (let i = 0; i < n; i++) {
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(i * sw, TILE);
      g.lineTo(i * sw + sw / 2, 4);
      g.lineTo((i + 1) * sw, TILE);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(i * sw + sw / 2, 6);
      g.lineTo(i * sw + 1, TILE);
      g.stroke();
    }
  }

  // small glowing crystal sprite for exposed rock faces
  const crystal = document.createElement('canvas');
  crystal.width = 24; crystal.height = 24;
  {
    const g = crystal.getContext('2d');
    const rg = g.createRadialGradient(12, 12, 1, 12, 12, 12);
    rg.addColorStop(0, 'rgba(150,220,255,0.5)');
    rg.addColorStop(1, 'rgba(150,220,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 24, 24);
    g.save();
    g.translate(12, 12);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#bfe8ff';
    g.fillRect(-3, -3, 6, 6);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(-3, -3, 3, 3);
    g.restore();
  }

  return { variants, spike, crystal };
})();

const LEVEL_MAP = [
  "################################################################################################",
  "################################################################################################",
  "################################################################################################",
  "################################################################################################",
  "##############################################...............................................###",
  "##############################################...........................*...................###",
  "##############################################...*............................F..............###",
  "##############################################.......#####..............###..................###",
  "################################################.....#####..........F............*...........###",
  "##############################################.......#####......###..........................###",
  "##############################################.......#####......................###..........###",
  "##############################################.......#####...................................###",
  "##############################################.....#######............................C...B..###",
  "##############################################.......###########################################",
  "###########################..................#.......###########################################",
  "##.......................##.......*..........#.......###########################################",
  "##.......................##..................###.....###########################################",
  "##............*..........##.......##.........#.......###########################################",
  "##...................................................###########################################",
  "##............................##......##.............###########################################",
  "##...................................................###########################################",
  "##..P...B.................................C..........###########################################",
  "#############################.......############################################################",
  "#############################.......############################################################",
  "#############################^^^^^^^############################################################",
  "################################################################################################",
  "################################################################################################",
];

class Level {
  constructor(rows) {
    this.h = rows.length;
    this.w = rows[0].length;
    this.pxW = this.w * TILE;
    this.pxH = this.h * TILE;
    this.tiles = [];
    this.spawns = { player: null, benches: [], crawlers: [], flyers: [], shards: [] };

    for (let r = 0; r < this.h; r++) {
      const row = [];
      for (let c = 0; c < this.w; c++) {
        let ch = rows[r][c];
        const px = c * TILE, py = r * TILE;
        if (ch === 'P') { this.spawns.player = { x: px + 6, y: py }; ch = '.'; }
        else if (ch === 'B') { this.spawns.benches.push({ x: px, y: py }); ch = '.'; }
        else if (ch === 'C') { this.spawns.crawlers.push({ x: px, y: py }); ch = '.'; }
        else if (ch === 'F') { this.spawns.flyers.push({ x: px, y: py }); ch = '.'; }
        else if (ch === '*') { this.spawns.shards.push({ x: px + TILE / 2, y: py + TILE / 2 }); ch = '.'; }
        row.push(ch);
      }
      this.tiles.push(row);
    }
  }

  tile(c, r) {
    if (c < 0 || r < 0 || c >= this.w || r >= this.h) return '#';
    return this.tiles[r][c];
  }

  solid(c, r) { return this.tile(c, r) === '#'; }

  // does the pixel rect overlap any tile of the given character?
  rectHits(x, y, w, h, ch) {
    const c0 = Math.floor(x / TILE), c1 = Math.floor((x + w - 0.001) / TILE);
    const r0 = Math.floor(y / TILE), r1 = Math.floor((y + h - 0.001) / TILE);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        if (this.tile(c, r) === ch) return true;
    return false;
  }

  rectSolid(x, y, w, h) { return this.rectHits(x, y, w, h, '#'); }

  draw(ctx, cam) {
    const c0 = Math.max(0, Math.floor(cam.x / TILE));
    const c1 = Math.min(this.w - 1, Math.floor((cam.x + cam.vw) / TILE));
    const r0 = Math.max(0, Math.floor(cam.y / TILE));
    const r1 = Math.min(this.h - 1, Math.floor((cam.y + cam.vh) / TILE));

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = this.tiles[r][c];
        const x = c * TILE - cam.x;
        const y = r * TILE - cam.y;
        if (ch === '#') {
          ctx.drawImage(TileArt.variants[(c * 7 + r * 13) % TileArt.variants.length], x, y);
          const airUp = this.tile(c, r - 1) !== '#';
          const airDown = this.tile(c, r + 1) !== '#';
          const airL = this.tile(c - 1, r) !== '#';
          const airR = this.tile(c + 1, r) !== '#';
          // directional edge light: pale on top/left faces, dark below/right
          if (airUp) {
            ctx.fillStyle = '#33415d';
            ctx.fillRect(x, y, TILE, 3);
            ctx.fillStyle = 'rgba(90,120,170,0.25)';
            ctx.fillRect(x, y + 3, TILE, 2);
          }
          if (airDown) {
            ctx.fillStyle = '#0b101c';
            ctx.fillRect(x, y + TILE - 3, TILE, 3);
          }
          if (airL) {
            ctx.fillStyle = 'rgba(70,95,140,0.25)';
            ctx.fillRect(x, y, 2, TILE);
          }
          if (airR) {
            ctx.fillStyle = 'rgba(8,12,22,0.5)';
            ctx.fillRect(x + TILE - 2, y, 2, TILE);
          }
          // occasional glowing crystal growing from an exposed top face
          if (airUp && (c * 31 + r * 17) % 13 === 0) {
            ctx.drawImage(TileArt.crystal, x + ((c * 13) % 12) - 2, y - 10);
          }
        } else if (ch === '^') {
          ctx.drawImage(TileArt.spike, x, y);
        }
      }
    }
  }
}

// Axis-separated AABB movement against solid tiles.
// Mutates e.x / e.y / e.vx / e.vy; returns collision flags.
function moveWithCollision(e, level, dt) {
  const res = { hitX: false, hitY: false, grounded: false };

  e.x += e.vx * dt;
  if (level.rectSolid(e.x, e.y, e.w, e.h)) {
    if (e.vx > 0) e.x = Math.floor((e.x + e.w) / TILE) * TILE - e.w - 0.01;
    else e.x = (Math.floor(e.x / TILE) + 1) * TILE + 0.01;
    e.vx = 0;
    res.hitX = true;
  }

  e.y += e.vy * dt;
  if (level.rectSolid(e.x, e.y, e.w, e.h)) {
    if (e.vy > 0) {
      e.y = Math.floor((e.y + e.h) / TILE) * TILE - e.h - 0.01;
      res.grounded = true;
    } else {
      e.y = (Math.floor(e.y / TILE) + 1) * TILE + 0.01;
    }
    e.vy = 0;
    res.hitY = true;
  }

  return res;
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

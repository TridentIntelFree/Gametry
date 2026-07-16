// Tile-based level: parsing, collision queries, and rendering.
//
// Map legend:
//   #  solid rock          ^  spikes
//   P  player spawn        B  bench (checkpoint)
//   C  crawler enemy       F  flyer enemy
//   *  silk shard pickup   .  air

const TILE = 32;

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
          // rock with slight per-tile shade variation
          const shade = (c * 7 + r * 13) % 3;
          ctx.fillStyle = ['#161e2d', '#18202f', '#141c2a'][shade];
          ctx.fillRect(x, y, TILE, TILE);
          // pale highlight along exposed top edges
          if (this.tile(c, r - 1) !== '#') {
            ctx.fillStyle = '#2f3d57';
            ctx.fillRect(x, y, TILE, 4);
          }
          if (this.tile(c, r + 1) !== '#') {
            ctx.fillStyle = '#0d1320';
            ctx.fillRect(x, y + TILE - 3, TILE, 3);
          }
        } else if (ch === '^') {
          ctx.fillStyle = '#9aa3b8';
          const n = 4, sw = TILE / n;
          for (let i = 0; i < n; i++) {
            ctx.beginPath();
            ctx.moveTo(x + i * sw, y + TILE);
            ctx.lineTo(x + i * sw + sw / 2, y + 6);
            ctx.lineTo(x + (i + 1) * sw, y + TILE);
            ctx.fill();
          }
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

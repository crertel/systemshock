// Level / map parsing from archive.dat (or a save file).
// Per-level resource ids: base = SAVE_GAME_ID_BASE + level*100; the level's
// data chunks live at base + xx (xx = the code's comment label):
//   +4  FullMap, +5 tile map (MapElem[64*64], LZW), +7 loved_textures.
//
// Floor/ceiling geometry is a port of the engine's terrain tables
// (frtables.c tile_floors[] + pt_deref[], frterr.c merge_masks[]).

export const SAVE_GAME_ID_BASE = 4000;
export const PER_LEVEL = 100;
export const MAX_LEVELS = 16;

export function levelBase(level) { return SAVE_GAME_ID_BASE + level * PER_LEVEL; }

export function findLevels(res) {
  const levels = [];
  for (let l = 0; l < MAX_LEVELS; l++) if (res.has(levelBase(l) + 5)) levels.push(l);
  return levels;
}

// pt_deref: point code (0..23) -> position within the unit tile (x east, y north).
// Corners 0=SW,4=NW,8=NE,C=SE; edge points at 1/8,1/2,7/8; oct points at FROCT.
const FROCT = 19195 / 65536; // ~0.29289
const PT = (() => {
  const corner = [[0, 0], [0, 1], [1, 1], [1, 0]]; // base 0..3
  const make = (base, dir, frac) => {
    const [x, y] = corner[base];
    if (dir === 1) return [x, y + frac]; // +y
    if (dir === 2) return [x + frac, y]; // +x
    return [x, y];
  };
  return [
    make(0, 0, 0), make(0, 1, 0.125), make(0, 1, 0.5), make(0, 1, 0.875),
    make(1, 0, 0), make(3, 1, 0.125), make(3, 1, 0.5), make(3, 1, 0.875),
    make(2, 0, 0), make(0, 2, 0.125), make(0, 2, 0.5), make(0, 2, 0.875),
    make(3, 0, 0), make(1, 2, 0.125), make(1, 2, 0.5), make(1, 2, 0.875),
    make(0, 1, FROCT), make(0, 1, 1 - FROCT), make(3, 1, FROCT), make(3, 1, 1 - FROCT),
    make(0, 2, FROCT), make(0, 2, 1 - FROCT), make(1, 2, FROCT), make(1, 2, 1 - FROCT),
  ];
})();

// tile_floors[]: { ptsper, data[], flg2?, notop? }. Data bytes: low 6 bits =
// point code; bit 0x80 (zPa) = corner is modified by `param`.
const P = 0x80; // zPa: uses param
const F3 = (a, b, c) => ({ ptsper: 3, data: [a, b, c] });
const F4 = (a, b, c, d) => ({ ptsper: 4, data: [a, b, c, d] });
const T4 = (a, b, c, d) => ({ ptsper: 4, notop: true, data: [a, b, c, d] });
const S4 = (a, b, c, d) => ({ ptsper: 4, data: [P | a, P | b, c, d] });
const S3cc = (pl, p2, p3, p4, p5) => ({ ptsper: 3, flg2: true, data: [P | p2, P | p3, pl, P | p4, P | p5, pl] });
const S3cv = (ph, p2, p3, p4, p5) => ({ ptsper: 3, flg2: true, data: [p2, p3, P | ph, p4, p5, P | ph] });
const Sspl = (pla, pha, pm1, pm2) => ({ ptsper: 3, flg2: true, data: [pla, pm1, pm2, P | pha, P | pm2, P | pm1] });

const TILE_FLOORS = [
  { ptsper: 0, data: [] },                       // 0 solid
  F4(4, 8, 12, 0),                               // 1 open
  F3(8, 12, 0), F3(12, 0, 4), F3(4, 8, 0), F3(4, 8, 12), // 2-5 main diagonals
  S4(4, 8, 12, 0), S4(8, 12, 0, 4), S4(12, 0, 4, 8), S4(0, 4, 8, 12), // 6-9 basic slopes
  S3cc(12, 4, 8, 0, 4), S3cc(0, 8, 12, 4, 8), S3cc(4, 12, 0, 8, 12), S3cc(8, 0, 4, 12, 0), // 10-13
  S3cv(12, 4, 8, 0, 4), S3cv(0, 8, 12, 4, 8), S3cv(4, 12, 0, 8, 12), S3cv(8, 0, 4, 12, 0), // 14-17
  Sspl(12, 4, 0, 8), Sspl(0, 8, 4, 12), Sspl(4, 12, 8, 0), Sspl(8, 0, 12, 4), // 18-21 splits
  F4(0x16, 0x17, 0x15, 0x14), F4(0x13, 0x12, 0x10, 0x11), // 22-23 oct
  T4(4, 8, 12, 0), T4(4, 8, 12, 0),              // 24-25 tri (no ceiling)
  F4(4, 6, 12, 0), F4(4, 8, 12, 0x0A), F4(4, 8, 6, 0), F4(0x0E, 8, 12, 0), // 26-29 1/4 diag
  F4(8, 12, 0, 2), F4(4, 8, 0x0A, 0), F4(4, 8, 12, 2), F4(0x0E, 12, 0, 4), // 30-33
  F3(4, 8, 6), F3(4, 0x0A, 0), F3(6, 12, 0), F3(4, 0x0E, 0), // 34-37 3/4 diag
  F3(4, 8, 2), F3(8, 12, 0x0A), F3(2, 12, 0), F3(8, 12, 0x0E), // 38-41
  F4(4, 8, 12, 0),                               // 42 vsplit (flat approx)
  F4(2, 6, 12, 0), F4(4, 0x0E, 0x0A, 0), F4(4, 8, 6, 2), F4(0x0E, 8, 12, 0x0A), // 43-46 halves
  F4(3, 7, 12, 0), F4(4, 0x0F, 0x0B, 0), F4(4, 8, 5, 1), F4(0x0D, 8, 12, 9), // 47-50 thin walls
];

const MIR_MATCH = 0, MIR_MIRROR = 1, MIR_CFLAT = 2, MIR_FFLAT = 3;

export class LevelMap {
  constructor(res, level) {
    this.res = res;
    this.level = level;
    const base = levelBase(level);

    let xSize = 64, ySize = 64, zShft = 3;
    if (res.has(base + 4)) {
      const fm = res.read(base + 4).data;
      const v = new DataView(fm.buffer, fm.byteOffset, fm.byteLength);
      xSize = v.getUint32(0, true) || 64;
      ySize = v.getUint32(4, true) || 64;
      zShft = v.getUint32(16, true) || 3;
    }
    this.xSize = xSize; this.ySize = ySize; this.zShft = zShft;

    this.tiles = res.read(base + 5).data;

    this.loved = null;
    if (res.has(base + 7)) {
      const lt = res.read(base + 7).data;
      const v = new DataView(lt.buffer, lt.byteOffset, lt.byteLength);
      const n = Math.floor(lt.byteLength / 2);
      this.loved = new Int16Array(n);
      for (let i = 0; i < n; i++) this.loved[i] = v.getInt16(i * 2, true);
    }
  }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.xSize && y < this.ySize; }

  tile(x, y) {
    const o = (x + y * this.xSize) * 16;
    const t = this.tiles;
    const flrRot = t[o + 1], ceilRot = t[o + 2];
    const tmap = t[o + 6] | (t[o + 7] << 8);
    const flag1 = t[o + 8], flag2 = t[o + 9];
    const flip = (flag1 & 0x60) >> 5; // 0 none,1 yup,2 odd,3 even
    const parity = (x + y) & 1;
    return {
      x, y,
      tiletype: t[o] & 0x3f,
      floorH: flrRot & 0x1f,
      ceilH: 32 - (ceilRot & 0x1f),
      param: t[o + 3],
      texFloor: (tmap >> 11) & 0x1f,
      texCeil: (tmap >> 6) & 0x1f,
      texWall: tmap & 0x3f,
      rotFloor: (flrRot & 0x60) >> 5,
      rotCeil: (ceilRot & 0x60) >> 5,
      mirror: (flag2 & 0x0c) >> 2,
      wallFlip: flip === 1 || (flip === 2 && parity === 1) || (flip === 3 && parity === 0),
      lightFloor: t[o + 10] & 0x0f,
      lightCeil: t[o + 11] & 0x0f,
    };
  }

  // Floor polygons (array of polys; each poly = [{x,y,z}] with z in height steps).
  floorPolys(te) { return this._polys(te, false); }
  // Ceiling polygons (empty for solid or no-top tiles).
  ceilPolys(te) { return this._polys(te, true); }

  _polys(te, ceiling) {
    const ttf = TILE_FLOORS[te.tiletype];
    if (!ttf || ttf.ptsper === 0) return [];
    if (ceiling && ttf.notop) return [];
    const elems = ttf.flg2 ? [[0, 1, 2], [3, 4, 5]] : [[...Array(ttf.ptsper).keys()]];
    const polys = [];
    for (const idxs of elems) {
      const poly = idxs.map((i) => {
        const byte = ttf.data[i];
        const code = byte & 0x3f;
        const usesParam = (byte & 0x80) !== 0;
        const pos = PT[code] || [0, 0];
        let z;
        if (!ceiling) {
          // FFLAT forces floor flat; otherwise param raises marked corners.
          z = te.floorH + (usesParam && te.mirror !== MIR_FFLAT ? te.param : 0);
        } else if (te.mirror === MIR_CFLAT) {
          z = te.ceilH;
        } else if (te.mirror === MIR_MIRROR) {
          z = te.ceilH + (usesParam ? te.param : 0);
        } else { // MATCH or FFLAT: ceiling dips where floor rises (constant gap)
          z = te.ceilH - (usesParam ? te.param : 0);
        }
        return { x: pos[0], y: pos[1], z };
      });
      polys.push(poly);
    }
    return polys;
  }

  isSolid(x, y) {
    if (!this.inBounds(x, y)) return true;
    return (this.tiles[(x + y * this.xSize) * 16] & 0x3f) === 0;
  }
}

// Rotate a (u,v) in [0,1] by rot*90 degrees (texture rotation).
export function rotUV(u, v, rot) {
  switch (rot & 3) {
    case 1: return [1 - v, u];
    case 2: return [1 - u, 1 - v];
    case 3: return [v, 1 - u];
    default: return [u, v];
  }
}

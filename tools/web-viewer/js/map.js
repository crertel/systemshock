// Level / map parsing from archive.dat (or a save file).
// Per-level resource ids: base = SAVE_GAME_ID_BASE + level*100; the level's
// data chunks live at base + xx (xx = the code's comment label):
//   +4  FullMap, +5 tile map (MapElem[64*64], LZW), +7 loved_textures.

export const SAVE_GAME_ID_BASE = 4000;
export const PER_LEVEL = 100;
export const MAX_LEVELS = 16;

export function levelBase(level) { return SAVE_GAME_ID_BASE + level * PER_LEVEL; }

// Which levels are present in a ResFile (tile map chunk exists).
export function findLevels(res) {
  const levels = [];
  for (let l = 0; l < MAX_LEVELS; l++) {
    if (res.has(levelBase(l) + 5)) levels.push(l);
  }
  return levels;
}

// Tile types we render with sloped floors (subset; everything else is flat).
// Names from tilename.h: 1 OPEN, 6-9 SLOPEUP_N/E/S/W, 10-13 SLOPECC_*, 14-17 SLOPECV_*.
const TILE_SOLID = 0;
const TILE_OPEN = 1;

// For a slope tiletype, which of the 4 corners get raised by `param` (in height
// steps). Corner order: [SW, SE, NE, NW]. Ridge/valley (cc/cv) slopes are
// approximated by raising the two corners on the high side.
const SLOPE_RAISE = {
  6: [0, 0, 1, 1], // SLOPEUP_N  -> north corners (NE,NW)
  7: [0, 1, 1, 0], // SLOPEUP_E  -> east corners  (SE,NE)
  8: [1, 1, 0, 0], // SLOPEUP_S  -> south corners (SW,SE)
  9: [1, 0, 0, 1], // SLOPEUP_W  -> west corners  (SW,NW)
  // concave (valley) — raise three corners around the named one
  10: [1, 0, 1, 1], 11: [1, 1, 1, 0], 12: [0, 1, 1, 1], 13: [1, 1, 0, 1],
  // convex (ridge) — raise the single named corner
  14: [0, 0, 0, 1], 15: [1, 0, 0, 0], 16: [0, 1, 0, 0], 17: [0, 0, 1, 0],
};

export class LevelMap {
  constructor(res, level) {
    this.res = res;
    this.level = level;
    const base = levelBase(level);

    // FullMap: first 20 bytes give x_size,y_size,x_shft,y_shft,z_shft (u32).
    let xSize = 64, ySize = 64, zShft = 3;
    if (res.has(base + 4)) {
      const fm = res.read(base + 4).data;
      const v = new DataView(fm.buffer, fm.byteOffset, fm.byteLength);
      xSize = v.getUint32(0, true) || 64;
      ySize = v.getUint32(4, true) || 64;
      zShft = v.getUint32(16, true) || 3;
    }
    this.xSize = xSize;
    this.ySize = ySize;
    this.zShft = zShft; // height step = 1/(1<<zShft) tile widths

    // Tile map.
    const tiles = res.read(base + 5).data;
    this.tiles = tiles; // Uint8Array, 16 bytes per element, row-major (x fastest)

    // loved_textures: per-level texture id list (int16 array).
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
    const flrRot = t[o + 1];
    const ceilRot = t[o + 2];
    const tmap = t[o + 6] | (t[o + 7] << 8);
    return {
      x, y,
      tiletype: t[o] & 0x3f,
      floorH: flrRot & 0x1f,
      ceilStored: ceilRot & 0x1f,
      ceilH: 32 - (ceilRot & 0x1f),
      param: t[o + 3],
      texFloor: (tmap >> 11) & 0x1f,
      texCeil: (tmap >> 6) & 0x1f,
      texWall: tmap & 0x3f,
      lightFloor: t[o + 10] & 0x0f, // flag3 low nibble (0=bright .. 15=dark)
      lightCeil: t[o + 11] & 0x0f, // flag4 low nibble
    };
  }

  // Floor corner heights (in height steps) as [SW, SE, NE, NW].
  floorCorners(te) {
    const base = [te.floorH, te.floorH, te.floorH, te.floorH];
    if (te.tiletype === TILE_OPEN || te.tiletype === TILE_SOLID) return base;
    const raise = SLOPE_RAISE[te.tiletype];
    if (raise) for (let i = 0; i < 4; i++) base[i] += raise[i] * te.param;
    return base;
  }

  // Ceiling corners: flat at ceilH (ceiling slopes not modelled in this viewer).
  ceilCorners(te) { return [te.ceilH, te.ceilH, te.ceilH, te.ceilH]; }

  isSolid(x, y) {
    if (!this.inBounds(x, y)) return true;
    return (this.tiles[(x + y * this.xSize) * 16] & 0x3f) === TILE_SOLID;
  }
}

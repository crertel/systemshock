// Resolve a global texture number to RGBA pixels, from texture.res + a palette.
//
// Layout (see textmaps.c): each global texture number `num` maps to
//   64px : resource 707 + num  (compound, item 0)
//   128px: resource 1000 + num (compound, item 0)
//   32px : resource 77, item num (one big compound resource)
//   16px : resource 76, item num
// We prefer 64px for geometry.

import { decodeBitmap, toRGBA } from './bitmap.js';

export const TEXTURE_64_ID = 707;
export const TEXTURE_128_ID = 1000;
export const TEXTURE_32_ID = 77;
export const TEXTURE_16_ID = 76;

export class TextureProvider {
  constructor(texRes, palette) {
    this.res = texRes;
    this.pal = palette;
    this.cache = new Map(); // num -> {w,h,data} | null
  }

  // Returns { w, h, data:Uint8Array(RGBA) } or null if unavailable.
  getImage(num) {
    if (this.cache.has(num)) return this.cache.get(num);
    const img = this._resolve(num);
    this.cache.set(num, img);
    return img;
  }

  _resolve(num) {
    const r = this.res;
    const tryItem = (blob) => {
      try { return toRGBA(decodeBitmap(blob), this.pal, { opaque: true }); }
      catch { return null; }
    };
    const single = (id) => {
      if (!r.has(id)) return null;
      const rr = r.read(id);
      const blob = rr.compound ? rr.items[0] : rr.data;
      if (!blob) return null;
      const dec = safeDecode(blob);
      if (!dec) return null;
      return { w: dec.w, h: dec.h, data: toRGBA(dec, this.pal, { opaque: true }) };
    };
    const fromCompound = (id, index) => {
      if (!r.has(id)) return null;
      const rr = r.read(id);
      if (!rr.compound || index >= rr.items.length) return null;
      const dec = safeDecode(rr.items[index]);
      if (!dec) return null;
      return { w: dec.w, h: dec.h, data: toRGBA(dec, this.pal, { opaque: true }) };
    };
    return single(TEXTURE_64_ID + num)
      || single(TEXTURE_128_ID + num)
      || fromCompound(TEXTURE_32_ID, num)
      || fromCompound(TEXTURE_16_ID, num);
  }
}

function safeDecode(blob) {
  try { return decodeBitmap(blob); } catch { return null; }
}

// Find a loaded ResFile that looks like texture.res.
export function findTextureRes(files) {
  for (const f of files) {
    if (f.res.has(TEXTURE_64_ID) || f.res.has(TEXTURE_32_ID)) return f.res;
  }
  return null;
}

// Model materials (citmat.res): MATERIAL_BASE + texid, compound item 0.
export const MATERIAL_BASE = 475;

export function findMaterialRes(files) {
  for (const f of files) if (f.res.has(MATERIAL_BASE)) return f.res;
  return null;
}

// Provider that resolves a model's tmap texid -> RGBA material image.
export class MaterialProvider {
  constructor(matRes, palette) {
    this.res = matRes;
    this.pal = palette;
    this.cache = new Map();
  }
  getImage(texid) {
    if (this.cache.has(texid)) return this.cache.get(texid);
    let img = null;
    const id = MATERIAL_BASE + texid;
    if (this.res && this.res.has(id)) {
      try {
        const r = this.res.read(id);
        const blob = r.compound ? r.items[0] : r.data;
        const dec = decodeBitmap(blob);
        img = { w: dec.w, h: dec.h, data: toRGBA(dec, this.pal, { opaque: true }) };
      } catch { img = null; }
    }
    this.cache.set(texid, img);
    return img;
  }
}

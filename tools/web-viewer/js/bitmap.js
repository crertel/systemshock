// Bitmap / image decoding (RTYPE_IMAGE). On-disk layout = FrameDescLayout:
// a 28-byte header (embedded grs_bitmap + update rect + pallOff) then pixels.

export const BMT_FLAT8 = 2;
export const BMT_RSD8 = 4;
export const BMF_TRANS = 1;

export function parseBitmapHeader(data) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    type: data[4],
    align: data[5],
    flags: v.getUint16(6, true),
    w: v.getInt16(8, true),
    h: v.getInt16(10, true),
    row: v.getUint16(12, true),
    pallOff: v.getUint32(24, true),
    pixelStart: 28,
  };
}

// Decode an image resource item (a FrameDesc blob) into 8-bit indexed pixels.
// Returns { w, h, flags, indices:Uint8Array(w*h), embeddedPalette? }.
export function decodeBitmap(data) {
  const hdr = parseBitmapHeader(data);
  const { w, h, type, flags, pixelStart } = hdr;
  if (w <= 0 || h <= 0 || w > 4096 || h > 4096) {
    throw new Error(`Implausible bitmap size ${w}x${h}`);
  }
  const total = w * h;
  let indices;
  if (type === BMT_FLAT8) {
    indices = data.subarray(pixelStart, pixelStart + total);
    if (indices.length < total) {
      const padded = new Uint8Array(total);
      padded.set(indices);
      indices = padded;
    }
  } else if (type === BMT_RSD8) {
    indices = rsd8Decode(data.subarray(pixelStart), total);
  } else {
    throw new Error(`Unsupported bitmap type ${type}`);
  }

  let embeddedPalette = null;
  if (hdr.pallOff && hdr.pallOff + 4 <= data.length) {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const start = v.getInt16(hdr.pallOff, true);
    const count = v.getInt16(hdr.pallOff + 2, true);
    const rgb = data.subarray(hdr.pallOff + 4, hdr.pallOff + 4 + count * 3);
    embeddedPalette = { start, count, rgb };
  }

  return { w, h, flags, indices, type, embeddedPalette };
}

// Run-Skip-Dump decompression (RSD8). Produces `total` indexed bytes; skip
// runs and overrun produce index 0 (the transparent color).
export function rsd8Decode(src, total) {
  const out = new Uint8Array(total);
  let i = 0, o = 0;
  while (o < total && i < src.length) {
    const b = src[i++];
    if (b === 0x00) { // RUN: [00][count][value]
      const count = src[i++];
      const val = src[i++];
      for (let k = 0; k < count && o < total; k++) out[o++] = val;
    } else if (b < 0x80) { // DUMP literal: count = b
      for (let k = 0; k < b && o < total; k++) out[o++] = src[i++];
    } else if (b === 0x80) { // LONG opcode: u16 follows
      const w = src[i] | (src[i + 1] << 8); i += 2;
      if (w === 0x0000) break; // end of bitmap
      if (w < 0x8000) { // long SKIP
        for (let k = 0; k < w && o < total; k++) out[o++] = 0;
      } else if (w < 0xc000) { // long DUMP
        const count = w & 0x7fff;
        for (let k = 0; k < count && o < total; k++) out[o++] = src[i++];
      } else { // long RUN
        const count = w & 0x3fff;
        const val = src[i++];
        for (let k = 0; k < count && o < total; k++) out[o++] = val;
      }
    } else { // SKIP (transparent): count = b & 0x7F
      const count = b & 0x7f;
      for (let k = 0; k < count && o < total; k++) out[o++] = 0;
    }
  }
  return out;
}

// Turn indexed pixels into an ImageData using a palette (Uint8Array 768).
export function toImageData(decoded, pal, { transparentIndex0 = true } = {}) {
  const { w, h, indices, flags } = decoded;
  const img = new ImageData(w, h);
  const d = img.data;
  const trans = transparentIndex0 && (flags & BMF_TRANS);
  for (let p = 0; p < w * h; p++) {
    const idx = indices[p];
    const o = p * 4;
    d[o] = pal[idx * 3];
    d[o + 1] = pal[idx * 3 + 1];
    d[o + 2] = pal[idx * 3 + 2];
    d[o + 3] = (trans && idx === 0) ? 0 : 255;
  }
  return img;
}

// Indexed pixels -> RGBA Uint8Array (no DOM). For world textures pass
// opaque:true so index 0 is not treated as transparent.
export function toRGBA(decoded, pal, { opaque = false } = {}) {
  const { w, h, indices, flags } = decoded;
  const out = new Uint8Array(w * h * 4);
  const trans = !opaque && (flags & BMF_TRANS);
  for (let p = 0; p < w * h; p++) {
    const idx = indices[p];
    const o = p * 4;
    out[o] = pal[idx * 3];
    out[o + 1] = pal[idx * 3 + 1];
    out[o + 2] = pal[idx * 3 + 2];
    out[o + 3] = (trans && idx === 0) ? 0 : 255;
  }
  return out;
}

export function bitmapToCanvas(decoded, pal, opts) {
  const img = toImageData(decoded, pal, opts);
  const canvas = document.createElement('canvas');
  canvas.width = decoded.w;
  canvas.height = decoded.h;
  canvas.getContext('2d').putImageData(img, 0, 0);
  return canvas;
}

// Font decoding (RTYPE_FONT). 84-byte header (grs_font) then off_tab then a
// single horizontal pixel strip holding every glyph side by side.
//
//   id    @0  u16   0xCCCC = color (8bpp), else monochrome (1bpp)
//   min   @36 u16   first char code
//   max   @38 u16   last char code
//   buf   @76 u32   byte offset to pixel data
//   w     @80 u16   row stride of the strip, in BYTES
//   h     @82 u16   glyph height in pixels
//   off_tab @84 u16[(max-min+1)+1]   horizontal start of each glyph

export function decodeFont(data) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const id = v.getUint16(0, true);
  const color = id === 0xcccc;
  const min = v.getUint16(36, true);
  const max = v.getUint16(38, true);
  const buf = v.getUint32(76, true);
  const rowBytes = v.getUint16(80, true);
  const h = v.getUint16(82, true);
  const n = max - min + 1;
  if (n <= 0 || n > 1024 || h <= 0 || h > 256) throw new Error('Implausible font header');

  const offTab = new Uint16Array(n + 1);
  for (let i = 0; i <= n; i++) offTab[i] = v.getUint16(84 + i * 2, true);

  const strip = data.subarray(buf);
  const glyphs = [];
  for (let i = 0; i < n; i++) {
    const x0 = offTab[i];
    const gw = Math.max(0, offTab[i + 1] - x0);
    const px = new Uint8Array(gw * h); // 0=bg, 1=fg (mono) or palette index (color)
    for (let row = 0; row < h; row++) {
      const rowBase = row * rowBytes;
      for (let col = 0; col < gw; col++) {
        if (color) {
          px[row * gw + col] = strip[rowBase + x0 + col] || 0;
        } else {
          const bit = x0 + col;
          const byte = strip[rowBase + (bit >> 3)] || 0;
          px[row * gw + col] = (byte >> (7 - (bit & 7))) & 1;
        }
      }
    }
    glyphs.push({ code: min + i, w: gw, h, px });
  }
  return { color, min, max, h, glyphs };
}

// Render the whole glyph set to a canvas atlas. For color fonts a palette is
// used; for mono fonts foreground is drawn white.
export function fontToCanvas(font, pal) {
  const pad = 1;
  let totalW = pad;
  for (const g of font.glyphs) totalW += g.w + pad;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, totalW);
  canvas.height = font.h + pad * 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let x = pad;
  for (const g of font.glyphs) {
    if (g.w > 0) {
      const img = ctx.createImageData(g.w, font.h);
      for (let p = 0; p < g.w * font.h; p++) {
        const o = p * 4;
        if (font.color) {
          const idx = g.px[p];
          img.data[o] = pal[idx * 3];
          img.data[o + 1] = pal[idx * 3 + 1];
          img.data[o + 2] = pal[idx * 3 + 2];
          img.data[o + 3] = idx === 0 ? 0 : 255;
        } else {
          const on = g.px[p];
          img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
          img.data[o + 3] = on ? 255 : 0;
        }
      }
      ctx.putImageData(img, x, pad);
    }
    x += g.w + pad;
  }
  return canvas;
}

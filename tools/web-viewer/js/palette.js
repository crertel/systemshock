// Palette handling. A System Shock palette is 768 raw bytes = 256 RGB triples,
// 8-bit (0-255) values (this port does NOT do the classic 6-bit<<2 expansion).

export function parsePalette(bytes) {
  // Returns Uint8Array(256*3). Pads/truncates defensively.
  const pal = new Uint8Array(768);
  pal.set(bytes.subarray(0, 768));
  return pal;
}

// A neutral fallback palette so images are visible before gamepal.res is loaded:
// a smooth grayscale ramp (index 0 = black/transparent).
export function fallbackPalette() {
  const pal = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    pal[i * 3] = pal[i * 3 + 1] = pal[i * 3 + 2] = i;
  }
  return pal;
}

// Render a palette to a canvas as a 16x16 swatch grid.
export function paletteToCanvas(pal, cell = 16) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16 * cell;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 256; i++) {
    const x = (i % 16) * cell;
    const y = ((i / 16) | 0) * cell;
    ctx.fillStyle = `rgb(${pal[i * 3]},${pal[i * 3 + 1]},${pal[i * 3 + 2]})`;
    ctx.fillRect(x, y, cell, cell);
  }
  return canvas;
}

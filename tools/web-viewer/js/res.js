// Parser for the "LG ResFile v2" container format.
// See docs/resource-format.md for the on-disk layout.

import { lzwExpand } from './lzw.js';

export const RDF_LZW = 0x01;
export const RDF_COMPOUND = 0x02;
export const RDF_LOADONOPEN = 0x08;

// Resource type names (restypes.h).
export const RTYPE = {
  0: 'unknown', 1: 'string', 2: 'image', 3: 'font', 4: 'anim',
  5: 'palette', 6: 'shadtab', 7: 'voc', 8: 'shape', 9: 'pict',
  10: 'b2extern', 11: 'b2reloc', 12: 'b2code', 13: 'b2header', 14: 'b2resrvd',
  15: 'obj3d', 16: 'stencil', 17: 'movie', 18: 'rect', 48: 'app',
};
export function typeName(t) { return RTYPE[t] || (t >= 48 ? `app+${t - 48}` : `type${t}`); }

const SIGNATURE = [
  0x4c, 0x47, 0x20, 0x52, 0x65, 0x73, 0x20, 0x46,
  0x69, 0x6c, 0x65, 0x20, 0x76, 0x32, 0x0d, 0x0a, // "LG Res File v2\r\n"
];

export class ResFile {
  constructor(input, name = '') {
    this.name = name;
    // Accept an ArrayBuffer or any typed-array view (e.g. a Node Buffer, whose
    // .buffer may be a shared pool with a nonzero byteOffset).
    if (ArrayBuffer.isView(input)) {
      this.bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    } else {
      this.bytes = new Uint8Array(input);
    }
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.entries = []; // dir order, excluding deleted (id 0)
    this.byId = new Map();
    this._parse();
  }

  _parse() {
    const b = this.bytes, v = this.view;
    if (b.length < 128) throw new Error('File too small to be a ResFile');
    for (let i = 0; i < 16; i++) {
      if (b[i] !== SIGNATURE[i]) throw new Error('Not an "LG ResFile v2" (bad signature)');
    }
    this.comment = readCString(b, 16, 96);
    const dirOffset = v.getInt32(124, true);
    const numEntries = v.getUint16(dirOffset, true);
    const dataOffset = v.getInt32(dirOffset + 2, true);

    let off = dataOffset;
    let p = dirOffset + 6;
    for (let i = 0; i < numEntries; i++) {
      const id = v.getUint16(p, true);
      const w1 = v.getUint32(p + 2, true);
      const w2 = v.getUint32(p + 6, true);
      p += 10;
      const size = w1 & 0xffffff;
      const flags = (w1 >>> 24) & 0xff;
      const csize = w2 & 0xffffff;
      const type = (w2 >>> 24) & 0xff;
      if (id !== 0) {
        const entry = { id, size, csize, flags, type, offset: off };
        this.entries.push(entry);
        this.byId.set(id, entry);
      }
      off = (off + csize + 3) & ~3; // 4-byte align between resources
    }
  }

  has(id) { return this.byId.has(id); }

  get(id) { return this.byId.get(id); }

  // Returns the fully-decoded resource:
  //   simple:   { compound:false, type, flags, data:Uint8Array }
  //   compound: { compound:true,  type, flags, numRefs, items:[Uint8Array] }
  read(id) {
    const e = this.byId.get(id);
    if (!e) throw new Error(`No resource ${id}`);
    const compressed = (e.flags & RDF_LZW) !== 0;
    const compound = (e.flags & RDF_COMPOUND) !== 0;

    if (!compound) {
      let data;
      if (compressed) {
        data = lzwExpand(this.bytes.subarray(e.offset, e.offset + e.csize), e.size);
      } else {
        data = this.bytes.subarray(e.offset, e.offset + e.size);
      }
      return { compound: false, type: e.type, flags: e.flags, data };
    }

    // Compound: ref-table header is always stored uncompressed; only the
    // item-data region is (optionally) LZW-compressed.
    const v = this.view;
    const numRefs = v.getUint16(e.offset, true);
    const headerSize = 2 + (numRefs + 1) * 4;
    const offsets = new Uint32Array(numRefs + 1);
    for (let i = 0; i <= numRefs; i++) offsets[i] = v.getUint32(e.offset + 2 + i * 4, true);

    let itemRegion;
    const uncompRegionSize = e.size - headerSize;
    if (compressed) {
      const diskStart = e.offset + headerSize;
      itemRegion = lzwExpand(this.bytes.subarray(diskStart, e.offset + e.csize), uncompRegionSize);
    } else {
      const start = e.offset + headerSize;
      itemRegion = this.bytes.subarray(start, start + uncompRegionSize);
    }

    const items = [];
    for (let i = 0; i < numRefs; i++) {
      const a = offsets[i] - headerSize;
      const bnd = offsets[i + 1] - headerSize;
      items.push(itemRegion.subarray(Math.max(0, a), Math.max(0, bnd)));
    }
    return { compound: true, type: e.type, flags: e.flags, numRefs, items };
  }
}

function readCString(bytes, start, maxLen) {
  let end = start;
  const lim = start + maxLen;
  while (end < lim && bytes[end] !== 0 && bytes[end] !== 0x1a) end++;
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export function isResFile(buffer) {
  const b = new Uint8Array(buffer);
  if (b.length < 16) return false;
  for (let i = 0; i < 16; i++) if (b[i] !== SIGNATURE[i]) return false;
  return true;
}

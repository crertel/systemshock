// obj3d model interpreter (RTYPE_OBJ3D). Ports the LG 3D bytecode interpreter
// (src/Libraries/3D/Source/interp.c) to extract static geometry: it walks the
// opcode stream, building points (resbuf) and emitting polygon/line faces.
//
// Visibility culling is disabled so the whole model is captured: jnorm always
// continues, sortnorm recurses both BSP branches. Runtime-only opcodes
// (icall via pointers, stack params, vpoint/vtext tables) are skipped.
//
// Model resources live at id 2300 + N (compound, item 0).

export const OBJ3D_BASE = 0x8fc; // 2300

const DEFAULT_COLOR = [0.6, 0.62, 0.66];
const TMAP_COLOR = [0.72, 0.72, 0.78];

export function findModels(res) {
  const ids = [];
  for (const e of res.entries) if (e.type === 15) ids.push(e.id);
  return ids;
}

// Decode one model resource id -> { faces:[{verts,color}], lines:[{a,b,color}], bbox }.
export function decodeModel(res, id, palette = null) {
  const r = res.read(id);
  const data = r.compound ? r.items[0] : r.data;
  return interpretModel(data, palette);
}

export function interpretModel(data, palette) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const i16 = (o) => dv.getInt16(o, true);
  const u16 = (o) => dv.getUint16(o, true);
  const fix = (o) => dv.getInt32(o, true) / 65536;
  const vec = (o) => [fix(o), fix(o + 4), fix(o + 8)];

  const res = new Array(1024).fill(null); // resbuf: index -> [x,y,z]
  const uvbuf = new Array(1024).fill(null); // index -> [u,v] in 0..1
  const faces = [];
  const lines = [];
  let color = DEFAULT_COLOR.slice();
  let ops = 0;
  const MAX_OPS = 500000;

  const setColorIdx = (idx) => {
    if (palette) color = [palette[idx * 3] / 255, palette[idx * 3 + 1] / 255, palette[idx * 3 + 2] / 255];
  };
  const pt = (idx) => res[idx] || [0, 0, 0];

  // Interpret starting at byte offset `start` until an opcode stops the stream.
  const run = (start, depth) => {
    let o = start;
    if (depth > 64) return;
    while (o >= 0 && o < data.length) {
      if (++ops > MAX_OPS) return;
      const op = u16(o);
      switch (op) {
        case 0: return;            // EOF
        case 7: return;            // DEBUG (stops)
        case 33: return;           // SCALERES (noop/stops)
        case 19: return;           // unused
        case 1: o += 28; break;    // JNORM: always continue (no cull)
        case 2:                    // LNRES
          lines.push({ a: pt(u16(o + 2)), b: pt(u16(o + 4)), color: color.slice() });
          o += 6; break;
        case 3: {                  // MULTIRES count,start, vec[count]
          const count = i16(o + 2), start2 = i16(o + 4);
          for (let k = 0; k < count; k++) res[start2 + k] = vec(o + 6 + k * 12);
          o += 6 + count * 12; break;
        }
        case 4: {                  // POLYRES count, idx[count]
          const count = u16(o + 2);
          const verts = [];
          for (let k = 0; k < count; k++) verts.push(pt(u16(o + 4 + k * 2)));
          if (verts.length >= 3) faces.push({ verts, color: color.slice() });
          o += 4 + count * 2; break;
        }
        case 5: setColorIdx(u16(o + 2)); o += 4; break; // SETCOLOR
        case 6: {                  // SORTNORM (BSP): recurse both branches
          run(o + i16(o + 26), depth + 1);
          run(o + i16(o + 28), depth + 1);
          o += 30; break;
        }
        case 8: o += 4 + u16(o + 2) * 4; break;  // SETSHADE
        case 9: o += 4; break;                   // GOURSURF
        case 10: case 11: case 12: {             // X/Y/Z_REL dest,src,delta
          const dest = i16(o + 2), src = i16(o + 4), d = fix(o + 6);
          const p = pt(src).slice();
          p[op - 10] += d;
          res[dest] = p;
          o += 10; break;
        }
        case 13: case 14: case 15: {             // XY/XZ/YZ_REL dest,src,d1,d2
          const dest = i16(o + 2), src = i16(o + 4), d1 = fix(o + 6), d2 = fix(o + 10);
          const p = pt(src).slice();
          const ax = op === 13 ? [0, 1] : op === 14 ? [0, 2] : [1, 2];
          p[ax[0]] += d1; p[ax[1]] += d2;
          res[dest] = p;
          o += 14; break;
        }
        case 16: case 17: case 18: o += 20; break; // ICALL_* (pointer; skip)
        case 20: run(o + u16(o + 2), depth + 1); o += 4; break; // SFCAL
        case 21: res[u16(o + 2)] = vec(o + 4); o += 16; break;  // DEFRES
        case 22: res[u16(o + 2)] = vec(o + 4); o += 18; break;  // DEFRES_I
        case 23: case 24: o += 8; break;          // GETPARMS(_I)
        case 25: case 26: o += 4; break;          // GOUR_P / GOUR_VC
        case 27: o += 4; break;                   // GETVCOLOR (runtime; keep color)
        case 28: o += 6; break;                   // GETVSCOLOR
        case 29: o += 4 + u16(o + 2) * 10; break; // RGBSHADES
        case 30: o += 4; break;                   // DRAW_MODE
        case 31: o += 4; break;                   // GETPCOLOR
        case 32: o += 6; break;                   // GETPSCOLOR
        case 34: case 35: o += 6; break;          // VPNT_P / VPNT_V (runtime pts)
        case 36:                                  // SETUV idx,u,v (fix 16.16 = 0..1)
          uvbuf[u16(o + 2)] = [dv.getUint32(o + 4, true) / 65536, dv.getUint32(o + 8, true) / 65536];
          o += 12; break;
        case 37: {                                // UVLIST count, (idx,u,v)[count]
          const count = u16(o + 2);
          for (let k = 0; k < count; k++) {
            const e = o + 4 + k * 10;
            uvbuf[u16(e)] = [dv.getUint32(e + 2, true) / 65536, dv.getUint32(e + 6, true) / 65536];
          }
          o += 4 + count * 10; break;
        }
        case 38: {                                // TMAP_OP texid,count,idx[count]
          const texid = u16(o + 2), count = u16(o + 4);
          const verts = [], uvs = [];
          for (let k = 0; k < count; k++) {
            const idx = u16(o + 6 + k * 2);
            verts.push(pt(idx));
            uvs.push(uvbuf[idx] || [0, 0]);
          }
          if (verts.length >= 3) faces.push({ verts, uvs, texid, color: TMAP_COLOR.slice() });
          o += 6 + count * 2; break;
        }
        case 39: o += 8; break;                   // DBG (header / no-op)
        default: return;                          // unknown opcode: stop
      }
    }
  };

  run(0, 0);

  // Bounding box for framing.
  const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const grow = (p) => { for (let i = 0; i < 3; i++) { if (p[i] < bbox.min[i]) bbox.min[i] = p[i]; if (p[i] > bbox.max[i]) bbox.max[i] = p[i]; } };
  for (const f of faces) f.verts.forEach(grow);
  for (const l of lines) { grow(l.a); grow(l.b); }

  return { faces, lines, bbox, faceCount: faces.length, lineCount: lines.length };
}

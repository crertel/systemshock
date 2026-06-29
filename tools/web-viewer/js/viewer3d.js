// three.js level-geometry viewer.
//
// Faces are grouped by their resolved global texture number; each group becomes
// a mesh with the real texture.res bitmap as a DataTexture. The tile light
// value is baked into per-vertex color and multiplies the texture (so no scene
// lighting is needed). When no texture is available the face falls back to a
// hue-coded vertex color.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { rotUV } from './map.js';

export class Viewer3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c10);

    // Lights are only used by lit materials (models); the level uses
    // MeshBasicMaterial and ignores them.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(0.5, 1, 0.8);
    this.scene.add(dir);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.screenSpacePanning = false;

    this.meshGroup = null;
    this.ceilingMeshes = [];
    this.texCache = new Map();
    this._showCeiling = true;
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);

    this._running = true;
    const loop = () => {
      if (!this._running) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this._running = false;
    window.removeEventListener('resize', this._resize);
    for (const t of this.texCache.values()) t.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }

  setShowCeiling(v) {
    this._showCeiling = v;
    for (const m of this.ceilingMeshes) m.visible = v;
  }

  _texture(num, texProvider) {
    if (!texProvider) return null;
    if (this.texCache.has(num)) return this.texCache.get(num);
    const img = texProvider.getImage(num);
    let tex = null;
    if (img) {
      tex = new THREE.DataTexture(img.data, img.w, img.h, THREE.RGBAFormat);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.flipY = true;
      tex.needsUpdate = true;
    }
    this.texCache.set(num, tex);
    return tex;
  }

  _clearGroup() {
    if (this.meshGroup) {
      this.scene.remove(this.meshGroup);
      this.meshGroup.traverse((o) => o.geometry && o.geometry.dispose());
    }
    this.ceilingMeshes = [];
  }

  _modelTexture(texid, matProvider) {
    if (!matProvider) return null;
    if (this.texCache.has(texid)) return this.texCache.get(texid);
    const img = matProvider.getImage(texid);
    let tex = null;
    if (img) {
      tex = new THREE.DataTexture(img.data, img.w, img.h, THREE.RGBAFormat);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.flipY = true;
      tex.needsUpdate = true;
    }
    this.texCache.set(texid, tex);
    return tex;
  }

  // Render a decoded obj3d model: textured/colored polygons (lit) + wire lines.
  loadModel(model, matProvider = null) {
    this._clearGroup();
    const group = new THREE.Group();

    // Untextured (flat-color) faces -> one vertex-colored mesh.
    const pos = [], col = [];
    // Textured faces grouped by texid -> one mesh each with the material map.
    const texGroups = new Map(); // texid -> { pos, uv, tex }

    for (const f of model.faces) {
      const tex = f.uvs ? this._modelTexture(f.texid, matProvider) : null;
      if (tex) {
        let tg = texGroups.get(f.texid);
        if (!tg) { tg = { pos: [], uv: [], tex }; texGroups.set(f.texid, tg); }
        for (let i = 1; i < f.verts.length - 1; i++) {
          for (const k of [0, i, i + 1]) {
            tg.pos.push(f.verts[k][0], f.verts[k][1], f.verts[k][2]);
            tg.uv.push(f.uvs[k][0], f.uvs[k][1]);
          }
        }
      } else {
        for (let i = 1; i < f.verts.length - 1; i++) {
          for (const k of [0, i, i + 1]) {
            pos.push(f.verts[k][0], f.verts[k][1], f.verts[k][2]);
            col.push(f.color[0], f.color[1], f.color[2]);
          }
        }
      }
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    }
    for (const tg of texGroups.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(tg.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(tg.uv, 2));
      g.computeVertexNormals();
      group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tg.tex, side: THREE.DoubleSide })));
    }
    if (model.lines.length) {
      const lp = [], lc = [];
      for (const l of model.lines) {
        lp.push(l.a[0], l.a[1], l.a[2], l.b[0], l.b[1], l.b[2]);
        for (let k = 0; k < 2; k++) lc.push(l.color[0], l.color[1], l.color[2]);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
      group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true })));
    }

    this.scene.add(group);
    this.meshGroup = group;

    // Frame to the bounding box.
    const b = model.bbox;
    const ctr = b.min.map((mn, i) => (mn + b.max[i]) / 2);
    const size = Math.max(1e-3, ...b.max.map((mx, i) => mx - b.min[i]));
    this.controls.target.set(ctr[0], ctr[1], ctr[2]);
    this.camera.position.set(ctr[0] + size, ctr[1] + size * 0.6, ctr[2] + size * 1.4);
    this.camera.near = size / 100;
    this.camera.far = size * 100;
    this.camera.updateProjectionMatrix();
    this.resize();
  }

  load(level, texProvider = null) {
    this._clearGroup();
    const group = new THREE.Group();
    const step = 1 / (1 << level.zShft);

    // Geometry buckets, keyed so that all faces sharing a texture (and the
    // floor/wall vs ceiling split, for the toggle) merge into one mesh.
    const buckets = new Map(); // key -> { builder, num|null, ceiling }
    const bucket = (num, ceiling) => {
      const tex = this._texture(num, texProvider);
      const key = `${tex ? num : 'flat'}:${ceiling ? 'c' : 'm'}`;
      let b = buckets.get(key);
      if (!b) { b = { builder: new MeshBuilder(), tex, num, ceiling }; buckets.set(key, b); }
      return b;
    };

    const resolveNum = (idx) => {
      if (level.loved && idx < level.loved.length) {
        const n = level.loved[idx];
        if (n >= 0) return n;
      }
      return idx;
    };

    const cornerXZ = (x, y) => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];

    // Per-tile corner heights ([SW,SE,NE,NW] floor/ceil in steps), cached.
    const cornerCache = new Map();
    const corners = (x, y) => {
      const k = y * level.xSize + x;
      let v = cornerCache.get(k);
      if (!v) { v = level.corners(level.tile(x, y)); cornerCache.set(k, v); }
      return v;
    };

    for (let y = 0; y < level.ySize; y++) {
      for (let x = 0; x < level.xSize; x++) {
        const te = level.tile(x, y);
        if (te.tiletype === 0) continue;

        // Floor polygons (real per-corner heights, slopes, diagonals, splits).
        const fNum = resolveNum(te.texFloor);
        const fb = bucket(fNum, false);
        const fcol = colorFor(fb, te.lightFloor, 1.0, fNum);
        for (const poly of level.floorPolys(te)) {
          fb.builder.polyFan(
            poly.map((p) => [x + p.x, p.z * step, y + p.y]),
            fcol, poly.map((p) => rotUV(p.x, p.y, te.rotFloor)));
        }

        // Ceiling polygons (mirror/flat per the tile's mirror bits).
        const cNum = resolveNum(te.texCeil);
        const cb = bucket(cNum, true);
        const ccol = colorFor(cb, te.lightCeil, 0.7, cNum);
        for (const poly of level.ceilPolys(te)) {
          cb.builder.polyFan(
            poly.map((p) => [x + p.x, p.z * step, y + p.y]),
            ccol, poly.map((p) => rotUV(p.x, p.y, te.rotCeil)));
        }

        // Walls between tiles. Tops/bottoms follow the actual per-corner
        // floor/ceiling heights of this tile and its neighbour, so walls along
        // sloped edges slant correctly. V follows absolute world height so
        // vertical texturing lines up; U honors the tile's L/R flip flag.
        const cw = cornerXZ(x, y); // world XZ of [SW, SE, NE, NW]
        const Ac = corners(x, y);
        const wNum = resolveNum(te.texWall);
        const wb = bucket(wNum, false);
        const wcol = colorFor(wb, 7, 0.85, wNum);
        const u0 = te.wallFlip ? 1 : 0, u1 = te.wallFlip ? 0 : 1;
        const neigh = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]];
        // emit a wall along edge P0..P1 from per-endpoint bottom to top heights.
        const emit = (P0, P1, b0, b1, t0, t1) => {
          b0 = Math.min(b0, t0); b1 = Math.min(b1, t1);
          if (t0 - b0 < 1e-4 && t1 - b1 < 1e-4) return;
          const yb0 = b0 * step, yb1 = b1 * step, yt0 = t0 * step, yt1 = t1 * step;
          addFace(wb,
            [[P0[0], yb0, P0[1]], [P1[0], yb1, P1[1]], [P1[0], yt1, P1[1]], [P0[0], yt0, P0[1]]],
            [[u0, yb0], [u1, yb1], [u1, yt1], [u0, yt0]], wcol);
        };
        for (let e = 0; e < 4; e++) {
          const i0 = e, i1 = (e + 1) % 4;
          const P0 = cw[i0], P1 = cw[i1];
          const [nx, ny] = neigh[e];
          if (level.isSolid(nx, ny)) {
            emit(P0, P1, Ac.floor[i0], Ac.floor[i1], Ac.ceil[i0], Ac.ceil[i1]);
          } else {
            const Bc = corners(nx, ny);
            const bIdx = (wx, wy) => {
              const lx = wx - nx, ly = wy - ny;
              return lx === 0 ? (ly === 0 ? 0 : 3) : (ly === 0 ? 1 : 2);
            };
            const j0 = bIdx(P0[0], P0[1]), j1 = bIdx(P1[0], P1[1]);
            // Lower wall: this floor above neighbour floor.
            emit(P0, P1, Bc.floor[j0], Bc.floor[j1], Ac.floor[i0], Ac.floor[i1]);
            // Upper wall: this ceiling below neighbour ceiling.
            emit(P0, P1, Ac.ceil[i0], Ac.ceil[i1],
              Math.max(Ac.ceil[i0], Bc.ceil[j0]), Math.max(Ac.ceil[i1], Bc.ceil[j1]));
          }
        }
      }
    }

    for (const b of buckets.values()) {
      const mat = b.tex
        ? new THREE.MeshBasicMaterial({ map: b.tex, vertexColors: true, side: THREE.DoubleSide })
        : new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
      const mesh = b.builder.toMesh(mat);
      if (b.ceiling) { mesh.visible = this._showCeiling; this.ceilingMeshes.push(mesh); }
      group.add(mesh);
    }

    const grid = new THREE.GridHelper(level.xSize, level.xSize, 0x223344, 0x16202c);
    grid.position.set(level.xSize / 2, -0.01, level.ySize / 2);
    group.add(grid);

    this.scene.add(group);
    this.meshGroup = group;

    const cx = level.xSize / 2, cz = level.ySize / 2;
    this.controls.target.set(cx, 1, cz);
    this.camera.position.set(cx, level.xSize * 0.8, cz + level.ySize * 0.9);
    this.camera.updateProjectionMatrix();
    this.resize();
  }
}

function addFace(b, pts, uv, color) { b.builder.quad(pts[0], pts[1], pts[2], pts[3], color, uv); }

class MeshBuilder {
  constructor() { this.pos = []; this.col = []; this.uv = []; }
  tri(a, b, c, color, ua, ub, uc) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.col.push(color[0], color[1], color[2]);
    this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  quad(a, b, c, d, color, uv) {
    this.tri(a, b, c, color, uv[0], uv[1], uv[2]);
    this.tri(a, c, d, color, uv[0], uv[2], uv[3]);
  }
  // Triangle-fan a 3- or 4-vertex polygon.
  polyFan(verts, color, uvs) {
    for (let i = 1; i < verts.length - 1; i++) {
      this.tri(verts[0], verts[i], verts[i + 1], color, uvs[0], uvs[i], uvs[i + 1]);
    }
  }
  toMesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return new THREE.Mesh(g, material);
  }
}

// Per-vertex color. Textured buckets get grayscale brightness (multiplies the
// texture); untextured fallback buckets get a hue from the texture index.
function colorFor(b, lv, faceMul, texNum) {
  const bright = (1 - (lv / 15) * 0.7) * faceMul;
  if (b.tex) return [bright, bright, bright];
  return hslToRgb(((texNum * 47) % 360) / 360, 0.45, 0.5 * bright + 0.08);
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hk(h + 1 / 3), hk(h), hk(h - 1 / 3)];
}

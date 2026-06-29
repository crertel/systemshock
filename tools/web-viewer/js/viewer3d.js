// three.js level-geometry viewer.
//
// Faces are grouped by their resolved global texture number; each group becomes
// a mesh with the real texture.res bitmap as a DataTexture. The tile light
// value is baked into per-vertex color and multiplies the texture (so no scene
// lighting is needed). When no texture is available the face falls back to a
// hue-coded vertex color.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Viewer3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c10);

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

  load(level, texProvider = null) {
    if (this.meshGroup) {
      this.scene.remove(this.meshGroup);
      this.meshGroup.traverse((o) => o.geometry && o.geometry.dispose());
    }
    this.ceilingMeshes = [];
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
    const FUV = [[0, 0], [1, 0], [1, 1], [0, 1]];

    for (let y = 0; y < level.ySize; y++) {
      for (let x = 0; x < level.xSize; x++) {
        const te = level.tile(x, y);
        if (te.tiletype === 0) continue;

        const c = cornerXZ(x, y);
        const fH = level.floorCorners(te).map((h) => h * step);
        const cH = level.ceilCorners(te).map((h) => h * step);

        // Floor.
        const fNum = resolveNum(te.texFloor);
        const fb = bucket(fNum, false);
        addFace(fb,
          [[c[0][0], fH[0], c[0][1]], [c[1][0], fH[1], c[1][1]],
           [c[2][0], fH[2], c[2][1]], [c[3][0], fH[3], c[3][1]]],
          FUV, colorFor(fb, te.lightFloor, 1.0, fNum));

        // Ceiling.
        const cNum = resolveNum(te.texCeil);
        const cb = bucket(cNum, true);
        addFace(cb,
          [[c[0][0], cH[0], c[0][1]], [c[1][0], cH[1], c[1][1]],
           [c[2][0], cH[2], c[2][1]], [c[3][0], cH[3], c[3][1]]],
          FUV, colorFor(cb, te.lightCeil, 0.7, cNum));

        // Walls.
        const wNum = resolveNum(te.texWall);
        const wb = bucket(wNum, false);
        const wcol = colorFor(wb, 7, 0.85, wNum);
        const fl = te.floorH * step, cl = te.ceilH * step;
        const neigh = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]];
        for (let e = 0; e < 4; e++) {
          const a = c[e], b = c[(e + 1) % 4];
          const emit = (yb, yt) => {
            if (yt - yb < 1e-4) return;
            addFace(bucket(wNum, false),
              [[a[0], yb, a[1]], [b[0], yb, b[1]], [b[0], yt, b[1]], [a[0], yt, a[1]]],
              [[0, 0], [1, 0], [1, yt - yb], [0, yt - yb]], wcol);
          };
          const [nx, ny] = neigh[e];
          if (level.isSolid(nx, ny)) {
            emit(fl, cl);
          } else {
            const nt = level.tile(nx, ny);
            const nfl = nt.floorH * step, ncl = nt.ceilH * step;
            if (nfl > fl) emit(fl, nfl);
            if (ncl < cl) emit(ncl, cl);
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

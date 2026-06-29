// three.js level-geometry viewer. Builds floor/ceiling/wall meshes from a
// LevelMap with baked vertex colors (hue from texture index, brightness from
// the tile's light value), so no scene lighting is required.

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

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.screenSpacePanning = false;

    this.meshGroup = null;
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
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }

  setShowCeiling(v) {
    this._showCeiling = v;
    if (this.ceilMesh) this.ceilMesh.visible = v;
  }

  load(level) {
    if (this.meshGroup) {
      this.scene.remove(this.meshGroup);
      this.meshGroup.traverse((o) => o.geometry && o.geometry.dispose());
    }
    const group = new THREE.Group();
    const step = 1 / (1 << level.zShft); // world height per height-step

    const floor = new MeshBuilder();
    const ceil = new MeshBuilder();
    const wall = new MeshBuilder();

    const cornerXZ = (x, y) => [
      [x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], // SW, SE, NE, NW
    ];

    for (let y = 0; y < level.ySize; y++) {
      for (let x = 0; x < level.xSize; x++) {
        const te = level.tile(x, y);
        if (te.tiletype === 0) continue; // solid: no interior geometry

        const c = cornerXZ(x, y);
        const fH = level.floorCorners(te).map((h) => h * step);
        const cH = level.ceilCorners(te).map((h) => h * step);

        const fcol = shade(te.texFloor, te.lightFloor, 1.0);
        const ccol = shade(te.texCeil, te.lightCeil, 0.7);

        // Floor (SW,SE,NE,NW) and ceiling.
        floor.quad(
          [c[0][0], fH[0], c[0][1]], [c[1][0], fH[1], c[1][1]],
          [c[2][0], fH[2], c[2][1]], [c[3][0], fH[3], c[3][1]], fcol);
        ceil.quad(
          [c[0][0], cH[0], c[0][1]], [c[1][0], cH[1], c[1][1]],
          [c[2][0], cH[2], c[2][1]], [c[3][0], cH[3], c[3][1]], ccol);

        // Walls on each edge (flat heights). Edge i runs between corner i and i+1.
        const neigh = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]];
        const wcolBase = shade(te.texWall, 7, 0.85);
        for (let e = 0; e < 4; e++) {
          const a = c[e], b = c[(e + 1) % 4];
          const [nx, ny] = neigh[e];
          const fl = te.floorH * step;
          const cl = te.ceilH * step;
          if (level.isSolid(nx, ny)) {
            wall.quad(
              [a[0], fl, a[1]], [b[0], fl, b[1]],
              [b[0], cl, b[1]], [a[0], cl, a[1]], wcolBase);
          } else {
            const nt = level.tile(nx, ny);
            const nfl = nt.floorH * step;
            const ncl = nt.ceilH * step;
            if (nfl > fl) { // step up to neighbour floor
              wall.quad(
                [a[0], fl, a[1]], [b[0], fl, b[1]],
                [b[0], nfl, b[1]], [a[0], nfl, a[1]], wcolBase);
            }
            if (ncl < cl) { // drop down to neighbour ceiling
              wall.quad(
                [a[0], ncl, a[1]], [b[0], ncl, b[1]],
                [b[0], cl, b[1]], [a[0], cl, a[1]], wcolBase);
            }
          }
        }
      }
    }

    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.floorMesh = floor.toMesh(mat);
    this.ceilMesh = ceil.toMesh(mat);
    this.wallMesh = wall.toMesh(mat);
    this.ceilMesh.visible = this._showCeiling;
    group.add(this.floorMesh, this.ceilMesh, this.wallMesh);

    // Grid for scale.
    const grid = new THREE.GridHelper(level.xSize, level.xSize, 0x223344, 0x16202c);
    grid.position.set(level.xSize / 2, -0.01, level.ySize / 2);
    group.add(grid);

    this.scene.add(group);
    this.meshGroup = group;

    // Frame the level.
    const cx = level.xSize / 2, cz = level.ySize / 2;
    this.controls.target.set(cx, 1, cz);
    this.camera.position.set(cx, level.xSize * 0.8, cz + level.ySize * 0.9);
    this.camera.updateProjectionMatrix();
    this.resize();
  }
}

class MeshBuilder {
  constructor() { this.pos = []; this.col = []; }
  tri(a, b, c, color) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.col.push(color[0], color[1], color[2]);
  }
  quad(a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); }
  toMesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return new THREE.Mesh(g, material);
  }
}

// Map a texture index to a stable hue, and a light value (0=bright..15=dark)
// plus a face multiplier to an RGB triple in [0,1].
function shade(texIndex, light, faceMul) {
  const hue = ((texIndex * 47) % 360) / 360;
  const bright = (1 - (light / 15) * 0.75) * faceMul;
  return hslToRgb(hue, 0.45, 0.5 * bright + 0.08);
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

# System Shock Resource Viewer

A dependency-free, client-side web app for browsing System Shock data files
(the "LG ResFile v2" format — `.res` files, `archive.dat`, save games) and
visualizing levels in 3D with three.js.

Everything runs in the browser; **no files are uploaded** anywhere. The parsers
are a direct port of the engine's resource code — see
[`../../docs/resource-format.md`](../../docs/resource-format.md) for the format
spec they implement.

## Running

It must be served over HTTP (it uses ES modules and loads three.js from a CDN
import map, which `file://` blocks):

```
just viewer            # serves at http://localhost:8000/
# or, from this directory:
nix run nixpkgs#python3 -- -m http.server 8000
```

Then open <http://localhost:8000/>. An internet connection is needed the first
time so the browser can fetch three.js from unpkg.

## Using it

1. Click **Open files…** (or drag-and-drop) and select files from your
   `res/data` directory. Good ones to start with:
   - `gamepal.res` — load this first so images get the correct palette.
   - `texture.res`, `objart.res`, `gamescr.res` — sprites/textures.
   - `cybstrng.res` — game strings.
   - `obj3d.res` — 3D object models (+ `citmat.res` for their textures).
   - `archive.dat` — the levels (enables the 3D view).
   You can select several at once; palettes from any file populate the
   **Palette** dropdown and apply globally.
2. Pick a resource from the list (filter by type or search by id). The viewer
   auto-dispatches by resource type:
   - **image** → decoded bitmap frames (FLAT8 + RSD8), zoomable, transparency
     shown as a checkerboard.
   - **string** → the string table.
   - **palette** → 16×16 swatch grid (with "use as active palette").
   - **font** → glyph atlas.
   - **3D level** (from `archive.dat`) → walkable level geometry; drag to orbit,
     scroll to zoom, right-drag to pan, toggle the ceiling.
   - **obj3d model** (from `obj3d.res`) → the lit 3D object mesh; drag to orbit.
   - anything else → hex dump.

## What's implemented

| Format | Status |
|--------|--------|
| RES container (header/dir, 4-byte align, simple + compound) | ✅ |
| LZW decompression (fixed 14-bit codes) | ✅ |
| Bitmaps: FLAT8 (uncompressed) + RSD8 (run-skip-dump) | ✅ |
| Palettes (768-byte, 8-bit RGB) | ✅ |
| Strings (compound, NUL-terminated) | ✅ |
| Fonts (mono + color glyph strips) | ✅ |
| Level geometry: floors, ceilings, walls, ramps | ✅ |
| Real `texture.res` textures on level geometry | ✅ (load `texture.res` + `gamepal.res`) |
| 3D object models (`obj3d.res`, RTYPE_OBJ3D) | ✅ |
| Textured models (`citmat.res` materials + model UVs) | ✅ (load `citmat.res` + `gamepal.res`) |

Validated against a real DOS CD-ROM install: `texture.res` decodes 955 frames
(16/32/64/128 px) with zero failures; all 16 levels parse from `archive.dat`;
level 0 resolves all 2820 face-texture lookups (52 distinct textures, 0 missing).

## 3D textures

When both `texture.res` and `gamepal.res` are loaded, level faces are textured
with the real game bitmaps: each tile's floor/ceiling/wall texture index →
`loved_textures` (the per-level texture list) → the 64px texture in
`texture.res`, decoded with the active palette and applied as a three.js
`DataTexture`. The tile's light value (0=bright..15=dark) is baked into vertex
color and multiplies the texture, so darker areas read correctly. If
`texture.res` isn't loaded, faces fall back to hue-coded colors by texture index.

## 3D object models

`obj3d.res` models (resources 2300+) are stored as a bytecode for the engine's
3D interpreter (`src/Libraries/3D/Source/interp.c`). `js/model.js` ports that
interpreter to extract static geometry: it walks the opcode stream building
points (`defres`/`multires`/`*_rel`) and emitting polygon/line faces
(`polyres`/`tmap`/`lnres`), with colors from `setcolor` + the palette.
Visibility culling is disabled so the whole model is captured (`jnorm` always
continues, `sortnorm` traverses both BSP branches).

Textured faces (`tmap`) are rendered with their real material: the texid maps to
`citmat.res` material `475 + texid` (item 0), decoded with the palette and
applied with the model's `setuv`/`uvlist` texture coordinates. **Load
`citmat.res`** (and `gamepal.res`) alongside `obj3d.res` to see textured models;
without it, textured faces fall back to a neutral color.

Stack-parameter opcodes (`getparms`) and the runtime vpoint table are skipped.
Pointer-based sub-object calls (`icall`, used for articulated parts) are also
skipped — but none of the 80 shipped game models actually use `icall`, so in
practice every model renders completely.

## Geometry accuracy

Floors and ceilings are a port of the engine's terrain tables
(`frtables.c` `tile_floors[]` + `pt_deref[]`, `frterr.c` `merge_masks[]`), so
all 51 tile types are shaped correctly: basic ramps, diagonals, ridge/valley
("zany") slopes, diagonal splits, octagons, triangles, and quarter/thin-wall
tiles. Per-corner heights come from the tile's `floor`/`ceil`/`param` fields, and
ceilings follow the tile's mirror bits (MATCH / MIRROR / CFLAT / FFLAT) — e.g. an
FFLAT tile renders a flat floor under a sloped ceiling. Texture rotation
(floor/ceiling) and L/R flip (walls) flags are applied.

Walls between tiles follow the actual per-corner floor/ceiling heights of the
tile and its neighbour, so walls along sloped edges slant to match (a wall
tapers to zero where the neighbouring floor rises to meet it). Wall V is locked
to absolute world height so vertical texturing lines up across stacked tiles.

### Remaining simplification

- The vertical-split (`VSPLIT`) tile is drawn as a single flat floor.

## Files

```
index.html        page + three.js import map
css/style.css
js/lzw.js         LZW decompressor
js/res.js         RES container parser
js/palette.js     palette parse + swatch render
js/bitmap.js      FLAT8 / RSD8 bitmap decode
js/strings.js     string-table decode
js/font.js        font glyph decode
js/map.js         FullMap + MapElem parse, tile->corner-height
js/model.js       obj3d bytecode interpreter -> static mesh
js/textures.js    texture-number -> texture.res bitmap resolution
js/viewer3d.js    three.js geometry builder + textures + orbit camera
js/app.js         UI orchestration
```

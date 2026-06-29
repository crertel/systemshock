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

Validated against a real DOS CD-ROM install: `texture.res` decodes 955 frames
(16/32/64/128 px) with zero failures; all 16 levels parse from `archive.dat`.

## Known simplifications (3D)

The geometry is built for legibility, not pixel-accurate parity with the
in-game terrain renderer:

- Floors use real per-corner slope heights for the common slope tiles
  (`SLOPEUP_*`); ridge/valley (`SLOPECC/CV`) slopes are approximated, and
  diagonal "solid corner" tiles render as flat. Ceilings are drawn flat.
- Walls use flat per-tile floor/ceiling heights (slope on wall edges ignored).
- Faces are **colored** by texture index + tile light value rather than textured
  with the real `texture.res` bitmaps. (Texture mapping onto geometry is the
  natural next step — `loved_textures` → `texture.res` resolution is already
  parsed in `js/map.js`.)

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
js/viewer3d.js    three.js geometry builder + orbit camera
js/app.js         UI orchestration
```

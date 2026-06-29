# System Shock Resource & File Format Specification

This document describes the on-disk data formats used by System Shock as
implemented in this source port (Shockolate). It covers the directory layout the
engine expects, the **LG resource file** container format (`.res` files and most
`.dat` files), the compression scheme, the resource/ref ID system, and an
inventory of the concrete data files (game art, strings, level/map data, save
games, and audio).

It is written from the source under `src/Libraries/RES/` (the resource manager,
originally Rex Bradford's "LG ResFile v2" library) and `src/GameSrc/` (the
game's use of it). Source references are given as `file:line` where useful.

> **Endianness:** the format is little-endian. Several decoders explicitly
> reassemble multi-byte integers byte-by-byte (e.g. `ResDecodeRefTable` in
> `refacc.c`) to remain portable, but the disk layout itself is little-endian.
> **Packing:** the resource headers are compiled with `#pragma pack(push,2)`
> (`res.h`), i.e. 2-byte alignment — this is why `ResDirEntry` is 10 bytes, not
> 12.

---

## 1. On-disk directory layout

The engine resolves all asset paths **relative to its current working
directory**, using lowercase names (`src/MacSrc/OpenGL.cc`, `init.c`, etc.). On a
case-sensitive filesystem the names must match exactly. The original DOS CD ships
UPPERCASE names (`DATA/`, `SOUND/`), which must be remapped — see the project
`justfile`'s `install-assets` recipe.

```
<working dir>/
├── res/
│   ├── data/              # game resource files (.res) and data tables (.dat)
│   │   ├── *.res          # LG resource files (art, strings, palettes, …)
│   │   ├── archive.dat    # LG resource file: all level/map data
│   │   ├── objprop.dat    # raw table: object class properties
│   │   ├── textprop.dat   # raw table: texture properties
│   │   ├── ipal.dat       # raw: inverse-palette lookup (32768 bytes)
│   │   ├── shadtabl.dat   # raw: color shading table (256×16)
│   │   ├── bwtabl.dat     # raw: B/W shading table (256×16)
│   │   └── digiparm.bin   # raw: per-SFX volume/flags/priority
│   ├── sound/
│   │   ├── thm<N>.bin     # DOS theme/transition metadata, per theme
│   │   ├── genmidi/        # General MIDI music (*.xmi)
│   │   └── sblaster/       # Sound Blaster music (*.xmi)
│   └── *.sf2             # SoundFont(s) for FluidSynth (scanned at startup)
├── shaders/              # GLSL shaders (OpenGL renderer)
├── CurrentGame.dat       # working copy of the active game (LG resource file)
└── savgam*.dat           # save slots (LG resource files)
```

- `res/data` is the canonical asset directory (`ARCHIVE_FNAME` =
  `"res/data/archive.dat"`, `gamewrap.h:41`).
- The FluidSynth output scan looks for `*.sf2` directly in `res/`
  (`MusicSrc/MusicDevice.c:1201`).
- Saves and `CurrentGame.dat` are written to the working directory
  (`gamewrap.h:40`).

---

## 2. The LG resource file format (`.res`, `archive.dat`, save games)

Every `.res` file, plus `archive.dat`, `CurrentGame.dat`, and the `savgam*.dat`
save slots, use the same container: **"LG ResFile v2"**. The layout is, in file
order:

```
+----------------------+  offset 0
|  ResFileHeader       |  128 bytes
+----------------------+  offset 128
|  resource data       |  variable; each resource's bytes, 4-byte aligned
|  (back to back)      |
+----------------------+  offset = header.dirOffset
|  ResDirHeader        |  6 bytes
|  ResDirEntry[N]      |  10 bytes each
+----------------------+  EOF
```

The directory lives at the **end** of the file; the header's `dirOffset` field
points to it. (`res.h` "Resource-file disk format: header, data, dir".)

### 2.1 File header — `ResFileHeader` (128 bytes)

`res.h:321`

| Offset | Size | Field        | Notes |
|-------:|-----:|--------------|-------|
| 0      | 16   | `signature`  | Magic bytes (see below) |
| 16     | 96   | `comment`    | User comment, terminated with `'\z'` |
| 112    | 12   | `reserved`   | Reserved, must be 0 |
| 124    | 4    | `dirOffset`  | `int32`, file offset of the directory |

The signature is exactly (`resfile.c:50`):

```
'L','G',' ','R','e','s',' ','F','i','l','e',' ','v','2', 0x0D, 0x0A
```

i.e. the ASCII string `"LG Res File v2"` followed by CR LF. On open, the engine
`fread`s 128 bytes and rejects the file if the 16-byte signature doesn't match
(`resfile.c:134`).

### 2.2 Directory header — `ResDirHeader` (6 bytes)

`res.h:328`

| Offset | Size | Field        | Notes |
|-------:|-----:|--------------|-------|
| 0      | 2    | `numEntries` | `uint16`, number of directory entries |
| 2      | 4    | `dataOffset` | `int32`, file offset where resource data begins (normally 128) |

`numEntries` `ResDirEntry` records follow immediately.

### 2.3 Directory entry — `ResDirEntry` (10 bytes)

`res.h:335`. Bit-packed into three little-endian words under `pack(2)`:

| Offset | Size | Field             | Notes |
|-------:|-----:|-------------------|-------|
| 0      | 2    | `id`              | `uint16` resource ID; **0 = deleted/empty slot** |
| 2      | 4    | `size:24` + `flags:8` | low 24 bits = uncompressed size (in-RAM size); high 8 bits = flags |
| 6      | 4    | `csize:24` + `type:8` | low 24 bits = compressed (on-disk) size; high 8 bits = resource type |

Notes:
- `size` is the uncompressed size; `csize` is the size actually stored on disk.
  For uncompressed resources `csize` is still the valid on-disk byte count.
- Max resource size is therefore ~16 MB (24-bit).
- Entries with `id == 0` are holes left by deletion; the loader marks the file
  `RFF_NEEDSPACK` and `ResPack()` compacts them (`resfile.c:189,410`).

### 2.4 Locating resource data

The directory does **not** store a per-resource file offset. Instead the loader
walks entries in order starting at `dataOffset`, advancing by each resource's
`csize`, **4-byte aligned** between resources (`resfile.c:300`,
`RES_OFFSET_ALIGN` in `res_.h:85`):

```
offset[0]   = dirHeader.dataOffset
offset[i+1] = align4(offset[i] + entry[i].csize)
```

So reading a file is: read header → seek to `dirOffset` → read directory →
reconstruct each resource's offset by accumulating aligned `csize`s.

### 2.5 Resource flags (`RDF_*`)

`res.h:215`, stored in the entry's `flags` byte:

| Value | Name             | Meaning |
|------:|------------------|---------|
| 0x01  | `RDF_LZW`        | Resource body is LZW-compressed on disk |
| 0x02  | `RDF_COMPOUND`   | Compound resource (has a ref table; see §2.7) |
| 0x04  | `RDF_RESERVED`   | Reserved |
| 0x08  | `RDF_LOADONOPEN` | Preload this resource's raw data when the file is opened |

### 2.6 Resource types (`RTYPE_*`)

`restypes.h:72`, stored in the entry's `type` byte. Types 0–47 are system-wide;
48–63 are application-specific (`RTYPE_APP = 48`). The game stores level/save
data as `RTYPE_APP` (see §6).

| Value | Name          | Content |
|------:|---------------|---------|
| 0  | `RTYPE_UNKNOWN`  | Unknown, or mixed types in a compound |
| 1  | `RTYPE_STRING`   | String (usually a compound table entry) |
| 2  | `RTYPE_IMAGE`    | Bitmap image (usually compound) |
| 3  | `RTYPE_FONT`     | Bitmap font |
| 4  | `RTYPE_ANIM`     | Animation script |
| 5  | `RTYPE_PALL`     | 256-color palette |
| 6  | `RTYPE_SHADTAB`  | Shading table |
| 7  | `RTYPE_VOC`      | Sound (`.voc`) |
| 8  | `RTYPE_SHAPE`    | Shape (usually compound) |
| 9  | `RTYPE_PICT`     | Picture (usually compound) |
| 10–14 | `RTYPE_B2*`   | BABL2 (Looking Glass scripting) records |
| 15 | `RTYPE_OBJ3D`    | 3D object (always compound) |
| 16 | `RTYPE_STENCIL`  | Stencil with offsets |
| 17 | `RTYPE_MOVIE`    | Movie (LG `.mov` format) |
| 18 | `RTYPE_RECT`     | List of bounding rects for images |
| 48 | `RTYPE_APP`      | First of 16 application-specific types |

### 2.7 Simple vs compound resources

A **simple** resource is just a byte blob (optionally LZW-compressed).

A **compound** resource (`RDF_COMPOUND`) packs many sub-items behind a *ref
table*. Its on-disk payload is:

```
+--------------------+
| numRefs : uint16   |   number of items
+--------------------+
| offset[0] : uint32 |   numRefs+1 offsets, each measured from the
| offset[1] : uint32 |   START of the resource payload (they include
| ...                |   the size of this table header itself)
| offset[numRefs]    |   final offset = end of last item
+--------------------+
| item 0 bytes       |
| item 1 bytes       |
| ...                |
+--------------------+
```

Item *i*'s size is `offset[i+1] - offset[i]`; its data begins at
`startOffset = 2 + (numRefs+1)*4` within the payload. (`refacc.c:299`
`ResDecodeRefTable`, and `readRefTableEntries` at `refacc.c:197`.)

When a compound resource is *also* `RDF_LZW`, the ref-table header (numRefs +
offsets) is stored **uncompressed**, and only the item-data region is
LZW-compressed (`resload.c:154`–`168` `ResRetrieve`).

### 2.8 Resource IDs and Refs

`res.h:90`:

- `Id` — `uint16`, identifies a whole resource. `0`=null, `1`/`2` reserved for
  the LRU list head/tail, IDs ≥ 3 are valid (`ID_MIN`).
- `Ref` — `uint32`, identifies an item inside a compound resource. High 16 bits
  = the compound resource's `Id`, low 16 bits = the item index (`RefIndex`).
  - `REFID(ref) = ref >> 16`
  - `REFINDEX(ref) = ref & 0xFFFF`
  - `MKREF(id, index) = (id << 16) | index`

### 2.9 Compression: LZW

`RDF_LZW` resources use classic variable-width **LZW** (`lzw.c`/`lzw.h`):

- Code width up to **14 bits** (`LZW_BITS = 14`); string table of 18041 entries
  (a prime above 2¹⁴, `lzw.h:71`).
- Codes grow from the initial width as the dictionary fills, in the standard
  LZW manner; the decoder uses a decode stack of up to 4000 bytes
  (`LZW_DECODE_STACK_SIZE`).
- The compressed stream contains no length prefix — the decoder
  (`LzwExpandFp2Buff`) expands directly into a buffer sized from the directory's
  uncompressed `size` field.

### 2.10 Read path summary

For a given resource ID the engine (`resload.c`, `resacc.c`):

1. Looks up the `ResDesc` populated from the directory (file number, offset,
   sizes, flags, type).
2. Allocates `fsize` (uncompressed size) bytes and `ResRetrieve`s from disk:
   seek to the resource offset; if compound, read the ref-table header first; if
   `RDF_LZW`, LZW-expand the body, else copy it raw.
3. Optionally runs a **decode function** (`ResourceFormat`, `resformat.h`) to
   turn the on-disk byte layout into the in-memory struct layout (handles 32/64-
   bit pointer width and field alignment portably). `RawFormat` means "no
   translation."

---

## 3. The `ResourceFormat` / `ResLayout` decode system

`resformat.h`. Many resources need byte-for-byte translation between disk and
memory (so the same files work on 32- and 64-bit, and across alignment rules). A
`ResLayout` describes a struct as a list of typed fields:

- Field types (`RFFT_*`): `PAD` (skip N bytes), `UINT8`, `UINT16`, `UINT32`,
  `INTPTR` (32-bit on disk, native in RAM), `RAW` (copy N bytes / rest), `END`.
- `ResLayout` carries `dsize` (size on disk), `msize` (size in memory), `flags`,
  and the field list.
- `LAYOUT_FLAG_ARRAY` — the resource is an array of records of `dsize` bytes.
- `LAYOUT_FLAG_RAW_DATA_FOLLOWS` — a fixed header is decoded, then trailing raw
  bytes (e.g. bitmap pixels) are copied after it.

A `ResourceFormat` bundles a `decoder`, `encoder`, layout `data`, and `freer`.
`FORMAT_RAW` is the no-op format; `FORMAT_REFTABLE` decodes a compound resource's
ref table. The game defines per-chunk formats for level data (§6).

---

## 4. Resource file inventory (`res/data/*.res`)

All of these are LG resource files (§2). Language variants: `cit`/`cyb` =
English, `frn` = French, `ger` = German. Loaded mostly via `ResOpenFile()`.

| File | Content | Loaded by |
|------|---------|-----------|
| `texture.res` | World textures (16/32/64/128 px variants) | `cybmem.c:94` |
| `objart.res`  | 2D object sprites | `objload.c` |
| `objart2.res` | Additional object art / critter sprites | `cybmem.c:112` |
| `objart3.res` | Critter movement/animation sprites | `cybmem.c:118` |
| `handart.res` | Player hand/weapon graphics | `cybmem.c:105` |
| `obj3d.res`   | 3D object models (`RTYPE_OBJ3D`) | `init.c:765` |
| `citmat.res`  | Material/texture-mapping definitions | `init.c:769` |
| `gamepal.res` | Main 256-color game palette | `init.c:623` |
| `gamescr.res` | Game-screen UI art and fonts | `init.c:757` |
| `mfdart.res` / `mfdfrn.res` / `mfdger.res` | MFD (multi-function display) art | `init.c:196,761` |
| `cybstrng.res` / `frnstrng.res` / `gerstrng.res` | Game strings/UI text (`RTYPE_STRING`) | `gamestrn.c:70` |
| `citbark.res` / `frnbark.res` / `gerbark.res` | NPC voice "barks" | `audiolog.c:57` |
| `citalog.res` / `frnalog.res` / `geralog.res` | Audio logs / emails (Afile audio) | `audiolog.c:58` |
| `digifx.res`  | Digital sound effects (`RTYPE_VOC`) | `init.c:773` |
| `splash.res` / `splshpal.res` | Splash image + palette | `setup.c` |
| `svgaintr.res` / `svgadeth.res` / `svgaend.res` | SVGA cutscenes (`RTYPE_MOVIE`) | `cutsloop.c:62` |

Within these files, content is addressed by fixed resource IDs (and refs for
compound resources). Examples of base IDs used by the game:

```
SFX_BASE             = 201     // digifx.res sound effects
AUDIOLOG_BASE_ID     = 2741    // citalog.res audio logs
AUDIOLOG_BARK_BASE_ID= 3100
TEXTURE_16_ID        = 76      // texture.res, by size class
TEXTURE_32_ID        = 77
TEXTURE_64_ID        = 707
TEXTURE_128_ID       = 1000
```

(Constants verified for `SFX_BASE`, save/level bases in §6; texture/audiolog
bases are as referenced in the loading code — consult the headers for the
authoritative values per build.)

---

## 5. Raw data tables (non-resource `.dat` / `.bin`)

These files are **not** LG resource files — they are read with plain
`fopen_caseless()` + `fread()`. Several start with a 4-byte version number that
is checked against a compiled-in constant.

| File | Content | Layout | Read by |
|------|---------|--------|---------|
| `ipal.dat` | Inverse-palette lookup (RGB→index) | 32768 raw bytes | `init.c:713` (`shock_alloc_ipal`) |
| `shadtabl.dat` | Color shading/light table | 256 × 16 bytes | `textmaps.c` (`Init_Lighting`) |
| `bwtabl.dat` | Black/white shading table | 256 × 16 bytes | `textmaps.c` |
| `textprop.dat` | Texture properties | `uint32` version (=`TEXTPROP_VERSION_NUMBER` 9), then per-texture records | `textmaps.c:328` |
| `objprop.dat` | Object-class property tables (guns, ammo, drugs, …) | `uint32` version (=`OBJPROP_VERSION_NUMBER` 45), then per-class structs | `objsim.c:1391` |
| `digiparm.bin` | Per-SFX playback metadata | three parallel `uint8[NUM_DIGI_FX]` arrays: volume, flags, priority (`NUM_DIGI_FX = 114`) | `digifx.c:88` |

Version constants (authoritative, from headers):
`TEXTPROP_VERSION_NUMBER = 9` (`textmaps.h:72`),
`OBJPROP_VERSION_NUMBER = 45` (`objver.h:52`),
`MAP_VERSION_NUMBER = 11` (`map.h:93`),
`PLAYER_VERSION_NUMBER = 6` (`player.h:79`).

> For the exact field layouts of `textprop.dat` and `objprop.dat` records, the
> source of truth is the parsing code (`textmaps.c`, `objsim.c`) and the structs
> in `Headers/textmaps.h` and the object-property headers. They are sequences of
> small packed structs, not self-describing.

---

## 6. Level / map data (`archive.dat`) and save games

### 6.1 archive.dat is itself a resource file

`archive.dat` is an LG resource file (§2) containing the pristine state of every
level. To start a game the engine **copies** `archive.dat` → `CurrentGame.dat`
and works on the copy (`gamewrap.c:455`). Saving writes `CurrentGame.dat` and
copies it to a `savgam*.dat` slot; loading copies a slot back to
`CurrentGame.dat` and opens it (`gamewrap.c:201,256,333,336`,
`saveload.c:342,770`).

### 6.2 Level resource-ID scheme

Each level's data is stored as a block of consecutive resource IDs. The base ID
for a level (`gamewrap.h:38`):

```
SAVE_GAME_ID_BASE     = 4000
NUM_RESIDS_PER_LEVEL  = 100
ResIdFromLevel(level) = SAVE_GAME_ID_BASE + level*100 + 2     // = 4002, 4102, …
```

So level 0 occupies IDs ~4002–4053, level 1 ~4102–4153, and so on (100 IDs
reserved per level). An older save scheme used `OLD_SAVE_GAME_ID_BASE = 550`
with 2 IDs per level (`OldResIdFromLevel`, `gamewrap.c:109`).

Each individual chunk is written as its **own** resource. `save_current_map()`
calls `write_id(id_num, idx++, …)` with `id_num = ResIdFromLevel(level)` and an
incrementing `idx`; `write_id` in turn does
`ResMake(id_num + idx, …, RTYPE_APP, …, format_from_idx_version(idx, version))`
(`saveload.c:291`). It is *not* one compound resource per level — each chunk is a
separate top-level resource with its own decode format. The resulting resource ID
is:

```
resID = SAVE_GAME_ID_BASE + level*100 + (2 + idx)
      = SAVE_GAME_ID_BASE + level*100 + xx      // xx = the code's "xxNN" label
```

### 6.3 Per-level chunk table

Contents in write order, from `save_current_map()` (`saveload.c:356`–442). The
`xx` column is the source comment label and equals the resource-ID offset from
`SAVE_GAME_ID_BASE + level*100`:

| xx | Content | Notes |
|---:|---------|-------|
| 02 | Map version (`uint32`) | `MAP_VERSION_NUMBER` = 11 |
| 03 | Object version (`uint32`) | `OBJECT_VERSION_NUMBER` = 27 |
| 04 | `FullMap` | map dimensions, scale, schedule, global state |
| 05 | Tile map | `MapElem[64*64]`, LZW |
| 06 | Schedule queue | `SchedEvent[]`; `NUM_MAP_SCHEDULES` = 1, raw/LZW |
| 07 | Loved textures | 16-bit texture IDs in use |
| 08 | Object list (`objs`) | all objects, LZW |
| 09 | Object cross-refs (`objRefs`) | spatial lookup, LZW |
| 10–24 | Per-class object arrays | guns, ammo, physics, grenades, drugs, hardware, software, bigstuff, smallstuff, fixtures, doors, animating, traps, containers, critters |
| 25–39 | Default object of each class | same 15 classes |
| 40–41 | (unused/filler) | reserved `idx++` slots |
| 42 | Texture animation state (`animtextures`) | |
| 43–44 | Surveillance: `hack_cam_objs`, `hack_cam_surrogates` | |
| 45 | `LevelData` (`level_gamedata`) | hazards, gravity, exit times, automap config |
| 46–47 | Automap strings | only if built with `SAVE_AUTOMAP_STRINGS` |
| 48 | (player EDMS physics — not saved) | reserved `idx++` slot |
| 49–50 | Paths: `paths`, `used_paths` | AI pathfinding |
| 51–53 | `animlist`, `anim_counter`, height semaphores (`h_sems`) | |

A separate `SAVELOAD_VERIFICATION_ID` resource holds a verification cookie
written first and last as an integrity marker (`saveload.c:356,454`).

The byte-exact disk layout of each chunk is defined by the format tables
`LevelVersion11Format[]` and `LevelVersion12Format[]` in
`src/GameSrc/archiveformat.c`, selected by `format_from_idx_version(index,
version)` (`saveload.c`). **Version 11** is the original packed layout; **version
12** ("EasySaves") adds alignment padding so structs round-trip safely on
modern 32/64-bit builds. The decoder auto-selects based on the stored map
version, so both old and new files load.

### 6.4 Save-game specific resources

Beyond the per-level blocks, a `CurrentGame.dat` / save slot holds:

| Resource ID | Content |
|------------:|---------|
| `SAVE_GAME_ID_BASE` (4000) | Save comment string |
| `SAVE_GAME_ID_BASE + 1` (4001) | `Player` struct, via `FORMAT_PLAYER` |
| 4002+ | Level blocks (§6.3) for each saved level |
| (schedule IDs) | Global game schedules |

The `Player` resource is decoded with a layout (`gamewrap.c`) that handles the
`PLAYER_VERSION_NUMBER = 6` format, including auto-detecting the MFD-puzzle array
size from the resource size (older 32-entry vs newer 64-entry layouts).

---

## 7. Sound & music layout (`res/sound/`)

Three distinct mechanisms (`src/MacSrc/SDLSound.c`, `src/MusicSrc/`):

1. **Digital sound effects** — `res/data/digifx.res` (LG resource file,
   `RTYPE_VOC` samples, IDs from `SFX_BASE = 201`), with per-effect
   volume/flags/priority in `res/data/digiparm.bin` (§5).

2. **Music (XMI)** — per-output-device subdirectories under `res/sound/`,
   selected by the active MIDI driver name (`MusicDev->musicType`):
   - `res/sound/genmidi/*.xmi` — General MIDI
   - `res/sound/sblaster/*.xmi` — Sound Blaster
   Theme tracks are loaded as `res/sound/<musicType>/thm<N>.xmi` and named tracks
   as `res/sound/<musicType>/<name>.xmi` (`SDLSound.c:154`). XMI is the
   Miles/IMA interleaved-MIDI format; it is parsed by `MacSrc/Xmi.c` and
   synthesized via FluidSynth using a SoundFont found in `res/*.sf2`.

3. **Theme metadata** — `res/sound/thm<N>.bin` (top level): per-theme tables
   read with raw `fread` (`SDLSound.c:160`) describing track selection,
   transitions, layering, and key mapping for the dynamic music system.

---

## 8. Source map

Where each format lives, for anyone extending this spec:

| Area | Files |
|------|-------|
| Container format, header/dir | `src/Libraries/RES/Source/res.h`, `resfile.c` |
| Resource types / flags | `restypes.h`, `res.h` |
| Loading / retrieval | `resload.c`, `resacc.c` |
| Compound resources / refs | `refacc.c`, `res.h` |
| Decode/encode layouts | `resformat.h`, `resformat.c` |
| LZW compression | `lzw.c`, `lzw.h` |
| Case-insensitive open | `caseless.c`, `fopen_caseless` (`resfile.c`) |
| Level/map data & saves | `src/GameSrc/saveload.c`, `gamewrap.c`, `archiveformat.c`, `Headers/gamewrap.h`, `Headers/map.h` |
| Raw data tables | `src/GameSrc/textmaps.c`, `objsim.c`, `digifx.c`, `init.c` |
| Music / sound | `src/MacSrc/SDLSound.c`, `src/MacSrc/Xmi.c`, `src/MusicSrc/` |

---

*This spec describes the formats as implemented in this repository. The
authoritative source is always the code referenced above; where a field's
byte-exact layout matters (level chunks, object/texture property tables), read
the corresponding `ResLayout`/parsing code rather than relying on the summary
tables here.*

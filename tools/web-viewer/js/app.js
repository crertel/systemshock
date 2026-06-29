// System Shock resource viewer — UI orchestration.

import { ResFile, isResFile, typeName } from './res.js';
import { parsePalette, fallbackPalette, paletteToCanvas } from './palette.js';
import { decodeBitmap, bitmapToCanvas } from './bitmap.js';
import { decodeStrings } from './strings.js';
import { decodeFont, fontToCanvas } from './font.js';
import { findLevels, LevelMap, levelBase } from './map.js';
import { TextureProvider, findTextureRes } from './textures.js';
import { Viewer3D } from './viewer3d.js';

const state = {
  files: [], // { name, res }
  resources: [], // { file, entry }
  palettes: [], // { label, pal }
  activePal: null,
  zoom: 4,
  showCeiling: true,
  viewer3d: null,
  selection: null,
  current3D: null, // { res, level }
};

const els = {};
function $(id) { return document.getElementById(id); }

window.addEventListener('DOMContentLoaded', () => {
  els.fileInput = $('file-input');
  els.openBtn = $('open-btn');
  els.drop = $('drop');
  els.list = $('res-list');
  els.filter = $('type-filter');
  els.search = $('search');
  els.detail = $('detail');
  els.palSelect = $('pal-select');
  els.zoom = $('zoom');
  els.ceiling = $('ceiling-toggle');
  els.status = $('status');

  els.openBtn.onclick = () => els.fileInput.click();
  els.fileInput.onchange = (e) => loadFiles([...e.target.files]);
  els.filter.onchange = renderList;
  els.search.oninput = renderList;
  els.palSelect.onchange = () => {
    state.activePal = state.palettes[els.palSelect.value]?.pal || fallbackPalette();
    if (state.current3D) open3DLevel(state.current3D.res, state.current3D.level);
    else if (state.selection) openResource(state.selection);
  };
  els.zoom.oninput = () => { state.zoom = +els.zoom.value; if (state.selection) openResource(state.selection); };
  els.ceiling.onchange = () => {
    state.showCeiling = els.ceiling.checked;
    if (state.viewer3d) state.viewer3d.setShowCeiling(state.showCeiling);
  };

  ['dragenter', 'dragover'].forEach((ev) => els.drop.addEventListener(ev, (e) => {
    e.preventDefault(); els.drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => els.drop.addEventListener(ev, (e) => {
    e.preventDefault(); els.drop.classList.remove('over');
  }));
  els.drop.addEventListener('drop', (e) => loadFiles([...e.dataTransfer.files]));

  state.activePal = fallbackPalette();
  setStatus('Drop .res / .dat files (include gamepal.res for correct colors).');
});

function setStatus(msg) { els.status.textContent = msg; }

async function loadFiles(fileList) {
  for (const f of fileList) {
    try {
      const buf = await f.arrayBuffer();
      if (!isResFile(buf)) { console.warn(`${f.name}: not a ResFile, skipped`); continue; }
      const res = new ResFile(buf, f.name);
      state.files.push({ name: f.name, res });
      for (const entry of res.entries) state.resources.push({ file: f.name, res, entry });
      collectPalettes(res, f.name);
    } catch (err) {
      console.error(`${f.name}:`, err);
    }
  }
  refreshPaletteSelect();
  renderList();
  setStatus(`${state.files.length} file(s), ${state.resources.length} resources loaded.`);
}

function collectPalettes(res, name) {
  for (const e of res.entries) {
    const isPal = e.type === 5 || (e.size === 768 && !(e.flags & 0x02));
    if (!isPal) continue;
    try {
      const r = res.read(e.id);
      const data = r.compound ? r.items[0] : r.data;
      if (data && data.length >= 768) {
        state.palettes.push({ label: `${name} #${e.id} (${typeName(e.type)})`, pal: parsePalette(data) });
      }
    } catch { /* ignore */ }
  }
}

function refreshPaletteSelect() {
  els.palSelect.innerHTML = '';
  if (state.palettes.length === 0) {
    const o = document.createElement('option');
    o.textContent = 'grayscale (load gamepal.res)';
    els.palSelect.appendChild(o);
    state.activePal = fallbackPalette();
    return;
  }
  state.palettes.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = p.label;
    els.palSelect.appendChild(o);
  });
  if (!state.activePal || state.activePal === fallbackPalette()) {
    state.activePal = state.palettes[0].pal;
  }
}

function renderList() {
  const filter = els.filter.value;
  const q = els.search.value.trim().toLowerCase();
  els.list.innerHTML = '';

  // Level shortcuts (3D) per file.
  for (const f of state.files) {
    const levels = findLevels(f.res);
    for (const lvl of levels) {
      const row = document.createElement('div');
      row.className = 'res-row level';
      row.innerHTML = `<span class="rid">L${lvl}</span><span class="rtype">3D level</span><span class="rname">${f.name}</span>`;
      row.onclick = () => { selectRow(row); open3DLevel(f.res, lvl); };
      if (filter === 'all' || filter === 'level') els.list.appendChild(row);
    }
  }

  let shown = 0;
  for (const item of state.resources) {
    const { entry, file } = item;
    const tn = typeName(entry.type);
    if (filter !== 'all' && filter !== 'level' && filter !== tn) continue;
    if (q && !(`${entry.id}`.includes(q) || tn.includes(q) || file.toLowerCase().includes(q))) continue;
    if (shown++ > 6000) continue; // safety cap
    const row = document.createElement('div');
    row.className = 'res-row';
    const fl = [];
    if (entry.flags & 0x01) fl.push('lzw');
    if (entry.flags & 0x02) fl.push('cmpd');
    row.innerHTML = `<span class="rid">${entry.id}</span>` +
      `<span class="rtype">${tn}</span>` +
      `<span class="rsize">${entry.size}b</span>` +
      `<span class="rflags">${fl.join(',')}</span>`;
    row.title = `${file} • id ${entry.id} • on-disk ${entry.csize}b`;
    row.onclick = () => { selectRow(row); state.selection = item; openResource(item); };
    els.list.appendChild(row);
  }
}

function selectRow(row) {
  els.list.querySelectorAll('.res-row.sel').forEach((r) => r.classList.remove('sel'));
  row.classList.add('sel');
}

function teardown3D() {
  if (state.viewer3d) { state.viewer3d.dispose(); state.viewer3d = null; }
  state.current3D = null;
  els.ceiling.parentElement.style.display = 'none';
}

function open3DLevel(res, level) {
  teardown3D();
  state.selection = null;
  state.current3D = { res, level };
  els.detail.innerHTML = '';
  els.ceiling.parentElement.style.display = '';
  const wrap = document.createElement('div');
  wrap.className = 'view3d';
  els.detail.appendChild(wrap);
  try {
    const map = new LevelMap(res, level);
    const texRes = findTextureRes(state.files);
    const provider = texRes ? new TextureProvider(texRes, state.activePal) : null;
    const v = new Viewer3D(wrap);
    state.viewer3d = v;
    v.setShowCeiling(state.showCeiling);
    v.load(map, provider);
    v.resize();
    const info = document.createElement('div');
    info.className = 'meta';
    info.textContent = `Level ${level} • ${map.xSize}×${map.ySize} tiles • ` +
      `${provider ? 'textured' : 'load texture.res for textures'} • ` +
      `drag to orbit, scroll to zoom, right-drag to pan`;
    els.detail.appendChild(info);
  } catch (err) {
    wrap.innerHTML = `<div class="error">Failed to build level: ${err.message}</div>`;
    console.error(err);
  }
}

function openResource(item) {
  teardown3D();
  const { res, entry } = item;
  els.detail.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'meta';
  head.textContent = `${item.file} • id ${entry.id} • ${typeName(entry.type)} • ${entry.size} bytes` +
    `${entry.flags & 1 ? ' • lzw' : ''}${entry.flags & 2 ? ' • compound' : ''}`;
  els.detail.appendChild(head);

  try {
    switch (entry.type) {
      case 2: return renderImage(res, entry);
      case 1: return renderStrings(res, entry);
      case 5: return renderPalette(res, entry);
      case 3: return renderFont(res, entry);
      default: return renderRaw(res, entry);
    }
  } catch (err) {
    const e = document.createElement('div');
    e.className = 'error';
    e.textContent = `Decode error: ${err.message}`;
    els.detail.appendChild(e);
    console.error(err);
    renderRaw(res, entry);
  }
}

function renderImage(res, entry) {
  const r = res.read(entry.id);
  const blobs = r.compound ? r.items : [r.data];
  const gallery = document.createElement('div');
  gallery.className = 'gallery';
  let ok = 0;
  blobs.forEach((blob, i) => {
    try {
      const dec = decodeBitmap(blob);
      const canvas = bitmapToCanvas(dec, state.activePal);
      const cell = document.createElement('div');
      cell.className = 'frame';
      canvas.style.width = `${dec.w * state.zoom}px`;
      canvas.style.height = `${dec.h * state.zoom}px`;
      canvas.className = 'pixelated';
      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.textContent = r.compound ? `#${i} ${dec.w}×${dec.h}` : `${dec.w}×${dec.h}`;
      cell.appendChild(canvas); cell.appendChild(cap);
      gallery.appendChild(cell);
      ok++;
    } catch (e) { /* skip non-image item */ }
  });
  if (!ok) throw new Error('no decodable frames');
  els.detail.appendChild(gallery);
}

function renderStrings(res, entry) {
  const strings = decodeStrings(res, entry.id);
  const list = document.createElement('ol');
  list.className = 'strings';
  list.start = 0;
  strings.forEach((s, i) => {
    const li = document.createElement('li');
    li.value = i;
    li.textContent = s;
    list.appendChild(li);
  });
  els.detail.appendChild(list);
}

function renderPalette(res, entry) {
  const r = res.read(entry.id);
  const data = r.compound ? r.items[0] : r.data;
  const pal = parsePalette(data);
  const canvas = paletteToCanvas(pal, 18);
  canvas.className = 'pixelated';
  els.detail.appendChild(canvas);
  const btn = document.createElement('button');
  btn.textContent = 'Use as active palette';
  btn.onclick = () => {
    state.palettes.push({ label: `${entry.id} (selected)`, pal });
    refreshPaletteSelect();
    els.palSelect.value = state.palettes.length - 1;
    state.activePal = pal;
  };
  els.detail.appendChild(btn);
}

function renderFont(res, entry) {
  const r = res.read(entry.id);
  const data = r.compound ? r.items[0] : r.data;
  const font = decodeFont(data);
  const canvas = fontToCanvas(font, state.activePal);
  canvas.className = 'pixelated';
  canvas.style.transform = `scale(${Math.max(1, state.zoom / 2)})`;
  canvas.style.transformOrigin = 'top left';
  const wrap = document.createElement('div');
  wrap.style.overflow = 'auto';
  wrap.appendChild(canvas);
  els.detail.appendChild(wrap);
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${font.color ? 'color' : 'mono'} font • chars ${font.min}-${font.max} • height ${font.h}`;
  els.detail.appendChild(meta);
}

function renderRaw(res, entry) {
  let data;
  try { const r = res.read(entry.id); data = r.compound ? r.items[0] : r.data; }
  catch { data = res.bytes.subarray(entry.offset, entry.offset + Math.min(entry.csize, 4096)); }
  const pre = document.createElement('pre');
  pre.className = 'hex';
  pre.textContent = hexDump(data.subarray(0, 2048));
  els.detail.appendChild(pre);
  if (data.length > 2048) {
    const note = document.createElement('div');
    note.className = 'meta';
    note.textContent = `… showing first 2048 of ${data.length} bytes`;
    els.detail.appendChild(note);
  }
}

function hexDump(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 16) {
    const row = bytes.subarray(i, i + 16);
    let hex = '', asc = '';
    for (let j = 0; j < 16; j++) {
      if (j < row.length) {
        hex += row[j].toString(16).padStart(2, '0') + ' ';
        asc += row[j] >= 32 && row[j] < 127 ? String.fromCharCode(row[j]) : '.';
      } else hex += '   ';
    }
    out += i.toString(16).padStart(6, '0') + '  ' + hex + ' ' + asc + '\n';
  }
  return out;
}

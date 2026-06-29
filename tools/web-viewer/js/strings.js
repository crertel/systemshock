// String resources (RTYPE_STRING): a compound resource where each ref item is
// one NUL-terminated string.

export function decodeStrings(res, id) {
  const r = res.read(id);
  if (!r.compound) {
    // Some string resources may be a single blob of NUL-separated strings.
    return splitNulStrings(r.data);
  }
  return r.items.map((item) => cstr(item));
}

function cstr(bytes) {
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return latin1(bytes.subarray(0, end));
}

function splitNulStrings(bytes) {
  const out = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      out.push(latin1(bytes.subarray(start, i)));
      start = i + 1;
    }
  }
  if (start < bytes.length) out.push(latin1(bytes.subarray(start)));
  return out;
}

function latin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x02) continue; // discretionary-hyphen marker used by SS strings
    s += String.fromCharCode(b);
  }
  return s;
}

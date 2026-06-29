// LZW decompressor for "LG ResFile v2" resources.
//
// Ported from src/Libraries/RES/Source/lzw.c. Important properties of this
// variant (they differ from GIF/compress):
//   - codes are a FIXED 14 bits wide (never variable), packed MSB-first
//   - code 0x3FFF (MAX_VALUE) = end-of-data
//   - code 0x3FFE (FLUSH_CODE) = reset the string table (next_code -> 256)
//   - literal bytes are codes 0..255; new codes start at 256
//
// expectedSize (optional) bounds the output and provides a safety stop.

const LZW_BITS = 14;
const MAX_VALUE = (1 << LZW_BITS) - 1; // 16383, end-of-data
const MAX_CODE = MAX_VALUE - 2; //        16381, last storable code
const FLUSH_CODE = MAX_VALUE - 1; //      16382, table reset
const TABLE_SIZE = 18041;

export function lzwExpand(src, expectedSize = 0) {
  const prefix = new Uint16Array(TABLE_SIZE);
  const append = new Uint8Array(TABLE_SIZE);
  const stack = new Uint8Array(TABLE_SIZE + 16);

  const cap = expectedSize || 1 << 20;
  let out = new Uint8Array(cap);
  let outLen = 0;
  const emit = (b) => {
    if (outLen >= out.length) {
      const grown = new Uint8Array(out.length * 2);
      grown.set(out);
      out = grown;
    }
    out[outLen++] = b;
  };

  let srcPos = 0;
  let bitBuffer = 0;
  let bitCount = 0;
  const getByte = () => (srcPos < src.length ? src[srcPos++] : 0);
  const inputCode = () => {
    while (bitCount <= 24) {
      bitBuffer = (bitBuffer | (getByte() << (24 - bitCount))) >>> 0;
      bitCount += 8;
    }
    const ret = bitBuffer >>> (32 - LZW_BITS);
    bitBuffer = (bitBuffer << LZW_BITS) >>> 0;
    bitCount -= LZW_BITS;
    return ret;
  };

  // Decode a code into `stack` (in reverse); returns the top index.
  const decodeString = (offset, code) => {
    let sp = offset;
    let guard = 0;
    while (code > 255) {
      stack[sp++] = append[code];
      code = prefix[code];
      if (++guard > TABLE_SIZE) break; // corrupt stream guard
    }
    stack[sp] = code;
    return sp;
  };

  let nextCode = 256;
  let oldCode = inputCode();
  let character = oldCode;
  emit(oldCode & 0xff);

  let newCode;
  while ((newCode = inputCode()) !== MAX_VALUE) {
    if (newCode === FLUSH_CODE) {
      nextCode = 256;
      oldCode = inputCode();
      character = oldCode;
      emit(oldCode & 0xff);
      if (expectedSize && outLen >= expectedSize) break;
      continue;
    }

    let sp;
    if (newCode >= nextCode) {
      // KwKwK case: code not yet in table
      stack[0] = character & 0xff;
      sp = decodeString(1, oldCode);
    } else {
      sp = decodeString(0, newCode);
    }

    character = stack[sp];
    for (let i = sp; i >= 0; i--) emit(stack[i]);

    if (nextCode <= MAX_CODE) {
      prefix[nextCode] = oldCode;
      append[nextCode] = character & 0xff;
      nextCode++;
    }
    oldCode = newCode;

    if (expectedSize && outLen >= expectedSize) break;
  }

  return out.subarray(0, expectedSize ? Math.min(expectedSize, outLen) : outLen);
}

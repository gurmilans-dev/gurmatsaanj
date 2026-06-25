// Minimal QR Code generator for short remote-pairing URLs.
// Supports QR Model 2, version 5, error correction level L, byte mode.

const VERSION = 5;
const SIZE = VERSION * 4 + 17;
const DATA_CODEWORDS = 108;
const EC_CODEWORDS = 26;
const PAD_BYTES = [0xec, 0x11];

let gfExp = null;
let gfLog = null;

function initGalois() {
  if (gfExp && gfLog) return;
  gfExp = new Array(512).fill(0);
  gfLog = new Array(256).fill(0);
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) gfExp[i] = gfExp[i - 255];
}

function gfMul(a, b) {
  if (!a || !b) return 0;
  initGalois();
  return gfExp[gfLog[a] + gfLog[b]];
}

function generatorPoly(degree) {
  initGalois();
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], gfExp[i]);
    }
    poly = next;
  }
  return poly;
}

function reedSolomon(data, degree) {
  const gen = generatorPoly(degree);
  const result = new Array(degree).fill(0);
  for (const value of data) {
    const factor = value ^ result.shift();
    result.push(0);
    if (!factor) continue;
    for (let i = 0; i < degree; i += 1) {
      result[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return result;
}

function pushBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) {
    bits.push((value >>> i) & 1);
  }
}

function makeCodewords(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  if (bytes.length > DATA_CODEWORDS - 2) {
    throw new Error('QR pairing URL is too long.');
  }

  const bits = [];
  pushBits(bits, 0x4, 4);
  pushBits(bits, bytes.length, 8);
  for (const byte of bytes) pushBits(bits, byte, 8);
  const remaining = DATA_CODEWORDS * 8 - bits.length;
  pushBits(bits, 0, Math.min(4, remaining));
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    data.push(value);
  }
  let padIndex = 0;
  while (data.length < DATA_CODEWORDS) {
    data.push(PAD_BYTES[padIndex % PAD_BYTES.length]);
    padIndex += 1;
  }
  return [...data, ...reedSolomon(data, EC_CODEWORDS)];
}

function blankMatrix() {
  return Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));
}

function setFunction(modules, reserved, row, col, dark) {
  if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return;
  modules[row][col] = Boolean(dark);
  reserved[row][col] = true;
}

function drawFinder(modules, reserved, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
      const inCore = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark = inCore && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      setFunction(modules, reserved, rr, cc, dark);
    }
  }
}

function drawAlignment(modules, reserved, centerRow, centerCol) {
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      setFunction(modules, reserved, centerRow + r, centerCol + c, dark);
    }
  }
}

function reserveFormat(modules, reserved) {
  for (let i = 0; i <= 5; i += 1) setFunction(modules, reserved, i, 8, false);
  setFunction(modules, reserved, 7, 8, false);
  setFunction(modules, reserved, 8, 8, false);
  setFunction(modules, reserved, 8, 7, false);
  for (let i = 9; i < 15; i += 1) setFunction(modules, reserved, 8, 14 - i, false);
  for (let i = 0; i < 8; i += 1) setFunction(modules, reserved, 8, SIZE - 1 - i, false);
  for (let i = 8; i < 15; i += 1) setFunction(modules, reserved, SIZE - 15 + i, 8, false);
  setFunction(modules, reserved, SIZE - 8, 8, true);
}

function drawPatterns() {
  const modules = blankMatrix();
  const reserved = blankMatrix();

  drawFinder(modules, reserved, 0, 0);
  drawFinder(modules, reserved, 0, SIZE - 7);
  drawFinder(modules, reserved, SIZE - 7, 0);
  drawAlignment(modules, reserved, 30, 30);

  for (let i = 8; i < SIZE - 8; i += 1) {
    const dark = i % 2 === 0;
    setFunction(modules, reserved, 6, i, dark);
    setFunction(modules, reserved, i, 6, dark);
  }

  reserveFormat(modules, reserved);
  return { modules, reserved };
}

function placeData(modules, reserved, codewords) {
  const bits = [];
  for (const byte of codewords) pushBits(bits, byte, 8);

  let bitIndex = 0;
  let upward = true;
  for (let col = SIZE - 1; col >= 1; col -= 2) {
    if (col === 6) col -= 1;
    for (let i = 0; i < SIZE; i += 1) {
      const row = upward ? SIZE - 1 - i : i;
      for (let j = 0; j < 2; j += 1) {
        const cc = col - j;
        if (reserved[row][cc]) continue;
        modules[row][cc] = Boolean(bits[bitIndex] || 0);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function maskBit(mask, row, col) {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return false;
  }
}

function cloneMatrix(matrix) {
  return matrix.map((row) => row.slice());
}

function applyMask(modules, reserved, mask) {
  const next = cloneMatrix(modules);
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (!reserved[row][col] && maskBit(mask, row, col)) {
        next[row][col] = !next[row][col];
      }
    }
  }
  return next;
}

function formatBits(mask) {
  const data = (1 << 3) | mask; // Error correction L.
  let rem = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

function drawFormat(modules, mask) {
  const bits = formatBits(mask);
  const bit = (i) => Boolean((bits >>> i) & 1);
  for (let i = 0; i <= 5; i += 1) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i < 15; i += 1) modules[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i += 1) modules[8][SIZE - 1 - i] = bit(i);
  for (let i = 8; i < 15; i += 1) modules[SIZE - 15 + i][8] = bit(i);
  modules[SIZE - 8][8] = true;
}

function penalty(modules) {
  let score = 0;

  for (let row = 0; row < SIZE; row += 1) {
    let runColor = modules[row][0];
    let run = 1;
    for (let col = 1; col < SIZE; col += 1) {
      if (modules[row][col] === runColor) {
        run += 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else {
        runColor = modules[row][col];
        run = 1;
      }
    }
  }

  for (let col = 0; col < SIZE; col += 1) {
    let runColor = modules[0][col];
    let run = 1;
    for (let row = 1; row < SIZE; row += 1) {
      if (modules[row][col] === runColor) {
        run += 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else {
        runColor = modules[row][col];
        run = 1;
      }
    }
  }

  for (let row = 0; row < SIZE - 1; row += 1) {
    for (let col = 0; col < SIZE - 1; col += 1) {
      const color = modules[row][col];
      if (color === modules[row][col + 1] && color === modules[row + 1][col] && color === modules[row + 1][col + 1]) {
        score += 3;
      }
    }
  }

  const pattern = [true, false, true, true, true, false, true, false, false, false, false];
  const inverse = [false, false, false, false, true, false, true, true, true, false, true];
  const hasPattern = (values, index, target) => target.every((v, offset) => values[index + offset] === v);
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col <= SIZE - 11; col += 1) {
      const values = modules[row];
      if (hasPattern(values, col, pattern) || hasPattern(values, col, inverse)) score += 40;
    }
  }
  for (let col = 0; col < SIZE; col += 1) {
    const values = modules.map((row) => row[col]);
    for (let row = 0; row <= SIZE - 11; row += 1) {
      if (hasPattern(values, row, pattern) || hasPattern(values, row, inverse)) score += 40;
    }
  }

  let dark = 0;
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) if (modules[row][col]) dark += 1;
  }
  const percent = (dark * 100) / (SIZE * SIZE);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

export function createQrMatrix(text) {
  const codewords = makeCodewords(text);
  const { modules, reserved } = drawPatterns();
  placeData(modules, reserved, codewords);

  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = applyMask(modules, reserved, mask);
    drawFormat(candidate, mask);
    const score = penalty(candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

export function qrPath(matrix, margin = 4) {
  const parts = [];
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix[row].length; col += 1) {
      if (matrix[row][col]) parts.push(`M${col + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return parts.join('');
}

export const QR_SIZE = SIZE;

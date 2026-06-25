import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(process.cwd(), 'frontend/public');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function writePng(path, width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
}

function hex(value) {
  const clean = value.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
    clean.length >= 8 ? parseInt(clean.slice(6, 8), 16) : 255,
  ];
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round(a[3] + (b[3] - a[3]) * t),
  ];
}

function createCanvas(width, height, color = '#ffffff') {
  const rgba = Buffer.alloc(width * height * 4);
  const c = hex(color);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = c[0];
    rgba[i * 4 + 1] = c[1];
    rgba[i * 4 + 2] = c[2];
    rgba[i * 4 + 3] = c[3];
  }
  return { width, height, rgba };
}

function blendPixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const i = (Math.floor(y) * canvas.width + Math.floor(x)) * 4;
  const a = color[3] / 255;
  canvas.rgba[i] = Math.round(color[0] * a + canvas.rgba[i] * (1 - a));
  canvas.rgba[i + 1] = Math.round(color[1] * a + canvas.rgba[i + 1] * (1 - a));
  canvas.rgba[i + 2] = Math.round(color[2] * a + canvas.rgba[i + 2] * (1 - a));
  canvas.rgba[i + 3] = 255;
}

function fillRect(canvas, x, y, w, h, color) {
  const c = Array.isArray(color) ? color : hex(color);
  for (let yy = Math.floor(y); yy < Math.ceil(y + h); yy += 1) {
    for (let xx = Math.floor(x); xx < Math.ceil(x + w); xx += 1) blendPixel(canvas, xx, yy, c);
  }
}

function fillRoundedRect(canvas, x, y, w, h, r, colorTop, colorBottom = colorTop) {
  const top = Array.isArray(colorTop) ? colorTop : hex(colorTop);
  const bottom = Array.isArray(colorBottom) ? colorBottom : hex(colorBottom);
  for (let yy = Math.floor(y); yy < Math.ceil(y + h); yy += 1) {
    const t = h <= 1 ? 0 : (yy - y) / h;
    const c = mix(top, bottom, Math.max(0, Math.min(1, t)));
    for (let xx = Math.floor(x); xx < Math.ceil(x + w); xx += 1) {
      const dx = xx < x + r ? x + r - xx : xx > x + w - r ? xx - (x + w - r) : 0;
      const dy = yy < y + r ? y + r - yy : yy > y + h - r ? yy - (y + h - r) : 0;
      if (dx * dx + dy * dy <= r * r) blendPixel(canvas, xx, yy, c);
    }
  }
}

function fillCircle(canvas, cx, cy, radius, color) {
  const c = Array.isArray(color) ? color : hex(color);
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) blendPixel(canvas, x, y, c);
    }
  }
}

function fillEllipse(canvas, cx, cy, rx, ry, color) {
  const c = Array.isArray(color) ? color : hex(color);
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) blendPixel(canvas, x, y, c);
    }
  }
}

function fillPolygon(canvas, points, color) {
  const c = Array.isArray(color) ? color : hex(color);
  const minY = Math.floor(Math.min(...points.map((p) => p[1])));
  const maxY = Math.ceil(Math.max(...points.map((p) => p[1])));
  for (let y = minY; y <= maxY; y += 1) {
    const xs = [];
    for (let i = 0; i < points.length; i += 1) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length; i += 2) {
      for (let x = Math.floor(xs[i]); x <= Math.ceil(xs[i + 1]); x += 1) blendPixel(canvas, x, y, c);
    }
  }
}

function drawLine(canvas, x1, y1, x2, y2, width, color) {
  const c = Array.isArray(color) ? color : hex(color);
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    fillCircle(canvas, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, width / 2, c);
  }
}

function drawMark(canvas, cx, cy, size) {
  const cream = '#fff9ef';
  const shade = '#fde8bf';
  const s = size / 100;
  fillEllipse(canvas, cx, cy + 6 * s, 32 * s, 9 * s, '#c66e12aa');
  fillRoundedRect(canvas, cx - 2.4 * s, cy + 5 * s, 4.8 * s, 33 * s, 2 * s, cream);
  fillPolygon(canvas, [
    [cx - 2 * s, cy + 7 * s],
    [cx - 38 * s, cy + 5 * s],
    [cx - 48 * s, cy + 16 * s],
    [cx - 48 * s, cy + 43 * s],
    [cx - 35 * s, cy + 36 * s],
    [cx - 2 * s, cy + 38 * s],
  ], cream);
  fillPolygon(canvas, [
    [cx + 2 * s, cy + 7 * s],
    [cx + 38 * s, cy + 5 * s],
    [cx + 48 * s, cy + 16 * s],
    [cx + 48 * s, cy + 43 * s],
    [cx + 35 * s, cy + 36 * s],
    [cx + 2 * s, cy + 38 * s],
  ], cream);
  for (let i = 0; i < 3; i += 1) {
    drawLine(canvas, cx - 39 * s, cy + (19 + i * 7) * s, cx - 11 * s, cy + (17 + i * 6) * s, 1.8 * s, shade);
    drawLine(canvas, cx + 11 * s, cy + (17 + i * 6) * s, cx + 39 * s, cy + (19 + i * 7) * s, 1.8 * s, shade);
  }
  fillCircle(canvas, cx, cy - 24 * s, 16 * s, '#fff4dc');
  drawLine(canvas, cx - 11 * s, cy - 24 * s, cx + 11 * s, cy - 24 * s, 6 * s, '#e89b2c');
  drawLine(canvas, cx, cy - 35 * s, cx, cy - 13 * s, 5 * s, '#e89b2c');
}

function icon(size, maskable = false) {
  const c = createCanvas(size, size, '#faf6ef');
  const pad = maskable ? size * 0.06 : size * 0.02;
  fillRoundedRect(c, pad, pad, size - pad * 2, size - pad * 2, size * 0.22, '#e89b2c', '#c66e12');
  fillCircle(c, size * 0.5, size * 0.5, size * 0.39, '#f7b95544');
  drawMark(c, size * 0.5, size * 0.43, size * 0.92);
  return c;
}

function splash(width, height) {
  const c = createCanvas(width, height, '#faf6ef');
  const cx = width / 2;
  const cy = height * 0.42;
  const bgTop = hex('#fffaf1');
  const bgBottom = hex('#f4eadc');
  for (let y = 0; y < height; y += 1) {
    const rowColor = mix(bgTop, bgBottom, y / height);
    fillRect(c, 0, y, width, 1, rowColor);
  }
  const iconSize = Math.min(width * 0.28, 240);
  const appIcon = icon(Math.round(iconSize), false);
  const startX = Math.round(cx - appIcon.width / 2);
  const startY = Math.round(cy - appIcon.height / 2);
  for (let y = 0; y < appIcon.height; y += 1) {
    for (let x = 0; x < appIcon.width; x += 1) {
      const i = (y * appIcon.width + x) * 4;
      blendPixel(c, startX + x, startY + y, [
        appIcon.rgba[i],
        appIcon.rgba[i + 1],
        appIcon.rgba[i + 2],
        appIcon.rgba[i + 3],
      ]);
    }
  }
  return c;
}

const assets = [
  ['icons/apple-touch-icon.png', icon(180)],
  ['icons/icon-192.png', icon(192)],
  ['icons/icon-512.png', icon(512)],
  ['icons/maskable-512.png', icon(512, true)],
  ['splash/splash-1170x2532.png', splash(1170, 2532)],
  ['splash/splash-1179x2556.png', splash(1179, 2556)],
  ['splash/splash-1290x2796.png', splash(1290, 2796)],
  ['splash/splash-1125x2436.png', splash(1125, 2436)],
  ['splash/splash-828x1792.png', splash(828, 1792)],
  ['splash/splash-2048x2732.png', splash(2048, 2732)],
];

for (const [file, canvas] of assets) {
  writePng(resolve(root, file), canvas.width, canvas.height, canvas.rgba);
  console.log(`wrote ${file}`);
}

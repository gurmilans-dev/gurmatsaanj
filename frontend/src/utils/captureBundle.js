// Stored ZIP entries keep audio binary and avoid base64 copies or dependencies.
export const BUNDLE_LIMIT = 64 * 1024 * 1024;
const allowed = new Set(['manifest.json', 'trace.json', 'audio.webm', 'audio.mp4', 'audio.ogg']);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export async function digest(bytes) {
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), (n) => n.toString(16).padStart(2, '0')).join('');
}
export async function createBundle(entries) {
  const parts = []; const central = []; let offset = 0;
  if (entries.length > 3 || new Set(entries.map((e) => e.name)).size !== entries.length) throw new Error('Invalid bundle entries');
  for (const entry of entries) {
    if (!allowed.has(entry.name)) throw new Error('Invalid bundle filename');
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    const name = encoder.encode(entry.name); const crc = crc32(bytes);
    if (offset + bytes.length + 1024 > BUNDLE_LIMIT) throw new Error('Bundle exceeds 64 MiB');
    const header = new Uint8Array(30); const h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, bytes.length, true); h.setUint32(22, bytes.length, true); h.setUint16(26, name.length, true);
    const directory = new Uint8Array(46); const d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint16(14, 0x21, true);
    d.setUint32(16, crc, true); d.setUint32(20, bytes.length, true); d.setUint32(24, bytes.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true);
    parts.push(header, name, bytes); central.push(directory, name); offset += header.length + name.length + bytes.length;
  }
  const directorySize = central.reduce((sum, p) => sum + p.length, 0);
  const footer = new Uint8Array(22); const f = new DataView(footer.buffer);
  f.setUint32(0, 0x06054b50, true); f.setUint16(8, entries.length, true); f.setUint16(10, entries.length, true);
  f.setUint32(12, directorySize, true); f.setUint32(16, offset, true);
  return new Blob([...parts, ...central, footer], { type: 'application/zip' });
}
export function readBundle(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > BUNDLE_LIMIT || bytes.length < 22) throw new Error('Invalid/oversized capture bundle');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  if (view.getUint32(end, true) !== 0x06054b50 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 20, true)) throw new Error('Unsupported ZIP footer');
  const count = view.getUint16(end + 10, true); const size = view.getUint32(end + 12, true); const base = view.getUint32(end + 16, true);
  if (count > 3 || count !== view.getUint16(end + 8, true) || base + size !== end) throw new Error('Invalid ZIP directory');
  const entries = Object.create(null); let cursor = base; let nextLocal = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const n = view.getUint16(cursor + 28, true); const length = view.getUint32(cursor + 24, true); const local = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + n));
    if (!allowed.has(name) || Object.hasOwn(entries, name) || cursor + 46 + n > end || local !== nextLocal || local + 30 > base ||
        view.getUint16(cursor + 8, true) !== 0x800 || view.getUint16(cursor + 10, true) || view.getUint32(cursor + 20, true) !== length ||
        view.getUint16(cursor + 30, true) || view.getUint16(cursor + 32, true)) throw new Error('Unsupported/unsafe ZIP entry');
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== 0x800 || view.getUint16(local + 8, true) ||
        view.getUint16(local + 26, true) !== n || view.getUint16(local + 28, true) || view.getUint32(local + 18, true) !== length || view.getUint32(local + 22, true) !== length ||
        decoder.decode(bytes.subarray(local + 30, local + 30 + n)) !== name) throw new Error('ZIP header mismatch');
    const start = local + 30 + n; const stop = start + length;
    if (stop > base) throw new Error('Truncated ZIP payload');
    const payload = bytes.subarray(start, stop);
    if (crc32(payload) !== view.getUint32(cursor + 16, true) || view.getUint32(local + 14, true) !== view.getUint32(cursor + 16, true)) throw new Error('Bundle checksum mismatch');
    entries[name] = payload; nextLocal = stop; cursor += 46 + n;
  }
  if (cursor !== end || nextLocal !== base || !entries['manifest.json'] || !entries['trace.json']) throw new Error('Incomplete capture bundle');
  return entries;
}

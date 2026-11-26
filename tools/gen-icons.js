'use strict';
// يولّد أيقونة PNG مربعة (PWA) بلا مكتبات خارجية باستخدام zlib المدمج
const fs = require('node:fs');
const zlib = require('node:zlib');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function png(size, pixelFn) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter none
    for (let x = 0; x < size; x++) { const [r, g, b] = pixelFn(x, y); raw[p++] = r; raw[p++] = g; raw[p++] = b; }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGB
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const TEAL = [15, 118, 110], TEAL2 = [20, 184, 166], WHITE = [255, 255, 255];
function pixel(size) {
  return (x, y) => {
    const t = y / size;
    const bg = [Math.round(TEAL[0] + (TEAL2[0] - TEAL[0]) * t), Math.round(TEAL[1] + (TEAL2[1] - TEAL[1]) * t), Math.round(TEAL[2] + (TEAL2[2] - TEAL[2]) * t)];
    const cx = size / 2, cy = size / 2;
    // حقيبة تسوق بيضاء بسيطة
    const bagW = size * 0.34, bagH = size * 0.30, bx = cx - bagW / 2, by = cy - bagH / 2 + size * 0.04;
    const inBag = x >= bx && x <= bx + bagW && y >= by && y <= by + bagH;
    // مقبض الحقيبة
    const hx = cx - bagW * 0.22, hw = bagW * 0.44, hy = by - size * 0.10, hh = size * 0.12;
    const inHandle = x >= hx && x <= hx + hw && y >= hy && y <= hy + hh && !(x > hx + hw * 0.18 && x < hx + hw * 0.82 && y > hy + hh * 0.25);
    // شريط فاصل أعلى الحقيبة
    const inBand = x >= bx && x <= bx + bagW && y >= by + bagH * 0.28 && y <= by + bagH * 0.28 + size * 0.018;
    if (inHandle && !inBag) return WHITE;
    if (inBand && inBag) return bg;
    if (inBag) return WHITE;
    return bg;
  };
}

const out = process.argv[2] || 'public';
for (const size of [512, 192, 180]) {
  const file = `${out}/icon-${size}.png`;
  fs.writeFileSync(file, png(size, pixel(size)));
  console.log('wrote', file);
}
// apple-touch-icon
fs.writeFileSync(`${out}/apple-touch-icon.png`, png(180, pixel(180)));
console.log('wrote apple-touch-icon');

// Draws the app icons the manifest points at, and the favicon every page links, so
// they can be regenerated rather than being opaque binaries in the tree:
//     node icons/make-icons.mjs
//
// It writes the PNG by hand -- a raw RGBA raster, one filter byte per scanline,
// zlib-deflated -- because the whole project has no dependencies and an icon is
// not worth breaking that for. The mark is the key strip: dark ground, white keys,
// one key lit amber, which is what every screen of the app has along its bottom.
// The favicon is the same mark at 16, 32 and 48 px wrapped in one .ico, the format
// a browser asks for at /favicon.ico whether or not the page names one.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BG = [0x14, 0x16, 0x1a], WHITE = [0xf2, 0xf2, 0xf2], BLACK = [0x22, 0x25, 0x2b],
      AMBER = [0xe8, 0xb4, 0x4a], EDGE = [0x2c, 0x31, 0x3b];

function icon(size) {
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const rect = (x0, y0, w, h, c) => {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++)
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) put(x, y, c);
  };

  // a rounded-square ground, so the icon reads as an app rather than a sticker
  const r = size * 0.22;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.max(r - x, 0, x - (size - 1 - r)), dy = Math.max(r - y, 0, y - (size - 1 - r));
    put(x, y, BG, Math.hypot(dx, dy) <= r ? 255 : 0);
  }

  // seven white keys across the lower two thirds, the fourth of them lit
  const pad = size * 0.16, top = size * 0.30, bot = size - pad;
  if (size < 24) {
    // a favicon: seven keys with seams do not fit in sixteen pixels, so five keys of
    // two pixels with one-pixel seams, the middle one lit, laid out on the pixel grid
    const x0 = Math.round((size - 14) / 2), t0 = Math.round(top);
    for (let k = 0; k < 5; k++) rect(x0 + k * 3, t0, 2, Math.round(bot) - t0, k === 2 ? AMBER : WHITE);
    return px;
  }
  const w = (size - pad * 2) / 7, seam = Math.max(1, size * 0.012);
  for (let k = 0; k < 7; k++) {
    rect(pad + k * w, top, w - seam, bot - top, k === 3 ? AMBER : WHITE);
    rect(pad + k * w, top, w - seam, seam, EDGE);
  }
  // black keys straddling the seams, skipping the two the pattern leaves out
  for (const k of [1, 2, 4, 5, 6]) {
    rect(pad + k * w - w * 0.3, top, w * 0.6, (bot - top) * 0.6, BLACK);
  }
  return px;
}

// ---- PNG container ---------------------------------------------------------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return buf => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;                       // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;                  // filter: none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- ICO container ---------------------------------------------------------
// A directory of PNG-encoded entries, which every browser since 2007 reads.
function ico(sizes) {
  const images = sizes.map(s => png(s, icon(s)));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  const dir = [], parts = [];
  let offset = 6 + 16 * sizes.length;
  sizes.forEach((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s & 0xff; e[1] = s & 0xff;             // width, height (0 would mean 256)
    e[2] = 0; e[3] = 0;                           // palette, reserved
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); // planes, bits per pixel
    e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    dir.push(e); parts.push(images[i]);
  });
  return Buffer.concat([head, ...dir, ...parts]);
}

const here = dirname(fileURLToPath(import.meta.url));
for (const size of [192, 512]) {
  const file = join(here, `icon-${size}.png`);
  writeFileSync(file, png(size, icon(size)));
  console.log('wrote', file);
}
const fav = join(here, '..', 'favicon.ico');
writeFileSync(fav, ico([16, 32, 48]));
console.log('wrote', fav);

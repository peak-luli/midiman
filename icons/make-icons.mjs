// Draws the app icons the manifest points at, so they can be regenerated rather
// than being two opaque binaries in the tree:  node icons/make-icons.mjs
//
// It also writes favicon.svg, the same mark as vectors, for the tab of every page:
// a favicon is drawn at 16 and 32 pixels, where a raster of seven keys is a smear
// and a vector is still seven keys. One `layout` gives both the numbers.
//
// It writes the PNG by hand -- a raw RGBA raster, one filter byte per scanline,
// zlib-deflated -- because the whole project has no dependencies and an icon is
// not worth breaking that for. The mark is the key strip: dark ground, white keys,
// one key lit amber, which is what every screen of the app has along its bottom.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BG = [0x14, 0x16, 0x1a], WHITE = [0xf2, 0xf2, 0xf2], BLACK = [0x22, 0x25, 0x2b],
      AMBER = [0xe8, 0xb4, 0x4a], EDGE = [0x2c, 0x31, 0x3b];

/** Where everything sits, for a square of `size`: the ground's corner radius, the
 *  key strip's padding and top, the width of one white key and its top edge line. */
function layout(size) {
  const pad = size * 0.16;
  return { r: size * 0.22, pad, top: size * 0.30, bot: size - pad, w: (size - pad * 2) / 7, edge: size * 0.012 };
}
const LIT = 3;                          // the fourth white key is the amber one
const BLACKS = [1, 2, 4, 5, 6];         // the seams a black key straddles

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
  const { r, pad, top, bot, w, edge } = layout(size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.max(r - x, 0, x - (size - 1 - r)), dy = Math.max(r - y, 0, y - (size - 1 - r));
    put(x, y, BG, Math.hypot(dx, dy) <= r ? 255 : 0);
  }

  // seven white keys across the lower two thirds, the fourth of them lit
  for (let k = 0; k < 7; k++) {
    rect(pad + k * w, top, w - edge, bot - top, k === LIT ? AMBER : WHITE);
    rect(pad + k * w, top, w - edge, edge, EDGE);
  }
  // black keys straddling the seams, skipping the two the pattern leaves out
  for (const k of BLACKS) {
    rect(pad + k * w - w * 0.3, top, w * 0.6, (bot - top) * 0.6, BLACK);
  }
  return px;
}

/** The same mark as an SVG, in a 100-unit box. */
function svg() {
  const size = 100, { r, pad, top, bot, w, edge } = layout(size);
  const hex = ([R, G, B]) => '#' + [R, G, B].map(v => v.toString(16).padStart(2, '0')).join('');
  const n = v => +v.toFixed(2);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    `<rect width="${size}" height="${size}" rx="${n(r)}" fill="${hex(BG)}"/>`];
  for (let k = 0; k < 7; k++) {
    out.push(`<rect x="${n(pad + k * w)}" y="${n(top)}" width="${n(w - edge)}" height="${n(bot - top)}" fill="${hex(k === LIT ? AMBER : WHITE)}"/>`);
    out.push(`<rect x="${n(pad + k * w)}" y="${n(top)}" width="${n(w - edge)}" height="${n(edge)}" fill="${hex(EDGE)}"/>`);
  }
  for (const k of BLACKS) {
    out.push(`<rect x="${n(pad + k * w - w * 0.3)}" y="${n(top)}" width="${n(w * 0.6)}" height="${n((bot - top) * 0.6)}" fill="${hex(BLACK)}"/>`);
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
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

const here = dirname(fileURLToPath(import.meta.url));
for (const size of [192, 512]) {
  const file = join(here, `icon-${size}.png`);
  writeFileSync(file, png(size, icon(size)));
  console.log('wrote', file);
}
writeFileSync(join(here, 'favicon.svg'), svg());
console.log('wrote', join(here, 'favicon.svg'));

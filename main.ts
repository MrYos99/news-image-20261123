// news-image-20261123 v3 — bright broadsheet front page.
// Monday 23 November 2026, summed up as a light paper newspaper:
// paper background, thin ink rules, serif type, 13 illustrated cards
// (3 lead + 10 grid), KPI strip, ALSO strip, DATE CHECK footer.
// Node 22 standard library only. No network, no clock, no randomness.
// Writes one 1024x1024 PNG to /output/entry.png (or argv[2]).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const W = 1024;
const H = 1024;
const MARGIN_X = 38;
const CONTENT_W = 948;
const GAP_Y = 8;

// ---- paper palette (bright broadsheet, no dark cards) ----
const PAPER = [244, 239, 230]; // #F4EFE6 canvas
const CARD = [250, 247, 242];  // #FAF7F2 card paper
const INK = [20, 20, 20];      // #141414 headline ink
const INK2 = [43, 47, 54];     // #2B2F36 secondary ink
const SOFT = [96, 100, 108];   // soft grey ink for legend
const RED = [185, 28, 28];     // #B91C1C accent (rules + labels only)
const BLUE = [30, 58, 95];     // #1E3A5F dark blue (KPI numbers)

// ---- serif glyph atlas (font-glyphs.txt, data file) ----
// Each line: [advance, leftBearing, topOffset, width, height, base64]
// bitmap bits are packed continuously, MSB first, row-major.
// Glyph top in em units = topOffset; baseline sits at em y = 62.
const BASELINE_EM = 62;
const CAP_TOP_EM = 14;
const glyphs = new Map();
{
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, 'font-glyphs.txt'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/\[([\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*'([^']*)'\]\s*,\s*\/\/\s*(\d+)/);
    if (!m) continue;
    glyphs.set(Number(m[7]), {
      advance: Number(m[1]),
      f2: Number(m[2]),
      f3: Number(m[3]),
      w: Number(m[4]),
      h: Number(m[5]),
      bytes: Buffer.from(m[6], 'base64'),
    });
  }
}
function glyphFor(ch) {
  const g = glyphs.get(ch.charCodeAt(0));
  if (g) return g;
  return glyphs.get(32); // fall back to space
}

// ---- PNG encoder (stdlib zlib) ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgb) {
  const rows = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    rows[y * (1 + w * 3)] = 0;
    rgb.copy(rows, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rows, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- pixel buffer + shape primitives (rects and polygons only) ----
const px = Buffer.alloc(W * H * 3);
function setPx(x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
}
function fillRect(x, y, w, h, c) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w));
  const y1 = Math.min(H, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 3;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
    }
  }
}
function hline(x, y, w, c) { fillRect(x, y, w, 1, c); }
function vline(x, y, h, c) { fillRect(x, y, 1, h, c); }
function drawLine(x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPx(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}
// Even-odd scanline polygon fill. pts = [[x,y], ...]
function fillPoly(pts, c) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= y + 0.5 && b[1] > y + 0.5) || (b[1] <= y + 0.5 && a[1] > y + 0.5)) {
        const t = (y + 0.5 - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]));
      const xb = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) setPx(x, y, c);
    }
  }
}
function box(x, y, w, h, c) {
  hline(x, y, w, c);
  hline(x, y + h - 1, w, c);
  vline(x, y, h, c);
  vline(x + w - 1, y, h, c);
}

// ---- text engine (serif atlas, fractional scales, nearest-neighbour) ----
function textWidth(str, sx) {
  let w = 0;
  for (const ch of str) w += glyphFor(ch).advance * sx;
  return w;
}
// Draw text so the CAP TOP sits at topY. sx/sy may differ (condensed heads).
// Returns the x position just past the last glyph.
function drawText(str, x, topY, sx, sy, c) {
  let pen = x;
  for (const ch of str) {
    const g = glyphFor(ch);
    if (g.w > 0 && g.h > 0) {
      const gx0 = Math.round(pen + g.f2 * sx);
      const gy0 = Math.round(topY + (g.f3 - CAP_TOP_EM) * sy);
      const dw = Math.max(1, Math.ceil(g.w * sx));
      const dh = Math.max(1, Math.ceil(g.h * sy));
      for (let dy = 0; dy < dh; dy++) {
        const sySrc = Math.min(g.h - 1, Math.floor(dy / sy));
        for (let dx = 0; dx < dw; dx++) {
          const sxSrc = Math.min(g.w - 1, Math.floor(dx / sx));
          const bit = sySrc * g.w + sxSrc;
          if ((g.bytes[bit >> 3] >> (7 - (bit & 7))) & 1) setPx(gx0 + dx, gy0 + dy, c);
        }
      }
    }
    pen += g.advance * sx;
  }
  return pen;
}
// Greedy word wrap. Returns lines as arrays of words.
function wrapWords(str, maxW, sx) {
  const words = str.split(' ');
  const lines = [];
  let cur = [];
  let curW = 0;
  for (const wd of words) {
    const ww = textWidth(wd, sx);
    const sp = cur.length > 0 ? textWidth(' ', sx) : 0;
    if (cur.length > 0 && curW + sp + ww > maxW) {
      lines.push(cur);
      cur = [wd];
      curW = ww;
    } else {
      cur.push(wd);
      curW += sp + ww;
    }
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}
function drawLines(lines, x, topY, lineH, sx, sy, colorFn) {
  lines.forEach((words, li) => {
    let pen = x;
    words.forEach((wd, wi) => {
      const col = colorFn ? colorFn(wd, li, wi) : INK;
      pen = drawText(wd, pen, topY + li * lineH, sx, sy, col);
      if (wi + 1 < words.length) pen += textWidth(' ', sx);
    });
  });
}
// Badge: "LABEL | Outlet" — label in red, rest in ink. Picks the largest
// scale from the ladder that fits maxW. Returns the scale used.
const BADGE_LADDER = [0.26, 0.24, 0.22, 0.20, 0.18, 0.17, 0.16];
function drawBadge(badge, x, topY, maxW) {
  const parts = badge.split(' | ');
  const label = parts[0];
  const outlet = parts.length > 1 ? ' | ' + parts.slice(1).join(' | ') : '';
  let s = BADGE_LADDER[BADGE_LADDER.length - 1];
  for (const cand of BADGE_LADDER) {
    if (textWidth(badge, cand) <= maxW) { s = cand; break; }
  }
  let pen = drawText(label, x, topY, s, s, RED);
  if (outlet) pen = drawText(outlet, pen, topY, s, s, INK2);
  return { scale: s, width: pen - x };
}

// ---- fit gate (any overflow aborts the run with exit 1) ----
const fitErrors = [];
function checkFit(label, w, maxW) {
  if (w > maxW + 0.5) fitErrors.push(`${label}: ${w.toFixed(1)}px > ${maxW}px`);
}
function checkLines(label, n, maxN) {
  if (n > maxN) fitErrors.push(`${label}: ${n} lines > ${maxN}`);
}
function finishFit() {
  if (fitErrors.length > 0) {
    for (const e of fitErrors) console.error('FIT FAIL: ' + e);
    process.exit(1);
  }
}

// ---- deterministic pseudo-random (fixed-seed LCG, seed 1337) ----
// No unseeded randomness anywhere in this file: every run draws in the same
// order, so the output stays byte-identical across runs.
// state = (1664525 * state + 1013904223) mod 2^32; returns state / 2^32.
let rngState = 1337;
function rng() {
  rngState = (1664525 * rngState + 1013904223) >>> 0;
  return rngState / 4294967296;
}

// ---- scene helpers (all shapes drawn from plain rects and polygons) ----
const SKY = [220, 232, 240];
const SKY2 = [206, 222, 233];
const DUST = [226, 210, 172];
const DUST2 = [214, 194, 150];
const NIGHT = [51, 71, 94];
const NIGHT2 = [43, 60, 82];
const SEA = [111, 163, 196];
const SEA2 = [88, 138, 172];
const LAND = [217, 201, 168];
const LAND2 = [199, 182, 148];
const STONE = [185, 169, 140];
const STONE2 = [165, 148, 120];
const ROOF = [163, 59, 46];
const SLATE = [74, 93, 107];
const LEAF = [122, 148, 106];
const LEAF2 = [96, 122, 84];
const SUN = [214, 164, 66];
const FIRE = [214, 110, 44];
const FIRE2 = [226, 164, 60];
const SMOKEC = [205, 205, 200];
const CLOUDC = [247, 247, 243];
const WHITE = [250, 247, 242];
const GOLD = [186, 140, 52];

function skyBands(x, y, w, h, top, bottom) {
  fillRect(x, y, w, Math.ceil(h / 2), top);
  fillRect(x, y + Math.ceil(h / 2), w, h - Math.ceil(h / 2), bottom);
}
function cloud(x, y, s, c) {
  x += Math.floor(rng() * 5) - 2;
  y += Math.floor(rng() * 3) - 1;
  fillRect(x, y + 2 * s, 12 * s, 3 * s, c);
  fillRect(x + 2 * s, y, 7 * s, 5 * s, c);
  fillRect(x + 9 * s, y + 1 * s, 4 * s, 4 * s, c);
}
function bird(x, y, s, c) {
  x += Math.floor(rng() * 5) - 2;
  y += Math.floor(rng() * 3) - 1;
  drawLine(x, y, x + 3 * s, y + 2 * s, c);
  drawLine(x + 3 * s, y + 2 * s, x + 6 * s, y, c);
}
function smokePuff(x, y, w, h, c) {
  fillRect(x, y, w, Math.ceil(h / 3), c);
  fillRect(x + Math.ceil(w * 0.2), y + Math.ceil(h / 3), Math.ceil(w * 0.8), Math.ceil(h / 3), c);
  fillRect(x + Math.ceil(w * 0.35), y + Math.ceil(2 * h / 3), Math.ceil(w * 0.65), h - Math.ceil(2 * h / 3), c);
}
function stars(x, y, w, h, n, c) {
  for (let i = 0; i < n; i++) {
    const sx = x + Math.floor(rng() * Math.max(1, w - 4));
    const sy = y + Math.floor(rng() * Math.max(1, h - 4));
    fillRect(sx, sy, 2, 2, c);
  }
}
function flagPole(x, y, h, stripes, cPole) {
  vline(x, y, h, cPole || INK);
  const sh = Math.max(3, Math.floor(h / stripes.length / 2));
  stripes.forEach((col, i) => fillRect(x + 1, y + i * sh, 16, sh, col));
}
function figure(x, y, s, shirt, pants) {
  fillRect(x + 2 * s, y, 3 * s, 3 * s, [212, 178, 140]); // head
  fillRect(x + 1 * s, y + 3 * s, 5 * s, 5 * s, shirt);   // torso
  fillRect(x + 1 * s, y + 8 * s, 2 * s, 4 * s, pants);   // leg L
  fillRect(x + 4 * s, y + 8 * s, 2 * s, 4 * s, pants);   // leg R
}
function house(x, y, w, h, wall, roof, win) {
  fillRect(x, y + Math.ceil(h * 0.32), w, h - Math.ceil(h * 0.32), wall);
  fillPoly([[x, y + Math.ceil(h * 0.32)], [x + Math.floor(w / 2), y], [x + w, y + Math.ceil(h * 0.32)]], roof);
  const ww = Math.max(2, Math.floor(w / 6));
  const cols = Math.max(1, Math.floor((w - ww) / (ww + 3)));
  for (let i = 0; i < cols; i++) {
    fillRect(x + 3 + i * (ww + 3), y + Math.ceil(h * 0.45), ww, Math.ceil(h * 0.22), win);
    fillRect(x + 3 + i * (ww + 3), y + Math.ceil(h * 0.72), ww, Math.ceil(h * 0.22), win);
  }
}
function tower(x, y, w, h, wall, win) {
  fillRect(x, y, w, h, wall);
  const ww = Math.max(2, Math.floor(w / 5));
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 3; i++) {
      fillRect(x + 3 + i * (ww + 3), y + 4 + r * Math.ceil(h / 3), ww, Math.ceil(h / 6), win);
    }
  }
}
function shipSide(x, y, w, hull, deck) {
  fillPoly([[x, y], [x + w, y], [x + w - Math.ceil(w * 0.14), y + Math.ceil(w * 0.16)], [x + Math.ceil(w * 0.1), y + Math.ceil(w * 0.16)]], hull);
  fillRect(x + Math.ceil(w * 0.2), y - Math.ceil(w * 0.09), Math.ceil(w * 0.3), Math.ceil(w * 0.09), deck);
  vline(x + Math.ceil(w * 0.32), y - Math.ceil(w * 0.26), Math.ceil(w * 0.17), INK);
  fillRect(x + Math.ceil(w * 0.32) + 1, y - Math.ceil(w * 0.26), 10, 5, RED);
}
function chartBars(x, y, w, h, vals, up, down) {
  const n = vals.length;
  const bw = Math.floor(w / (n * 2));
  vals.forEach((v, i) => {
    const bh = Math.max(2, Math.round(h * v));
    fillRect(x + i * 2 * bw + Math.floor(bw / 2), y + h - bh, bw, bh, v >= 0.5 ? up : down);
  });
}
function trendLine(pts, c) {
  for (let i = 0; i + 1 < pts.length; i++) drawLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c);
}
function arrowHead(x, y, dx, dy, c) {
  fillPoly([[x, y], [x - dx * 3 - dy * 2, y - dy * 3 + dx * 2], [x - dx * 3 + dy * 2, y - dy * 3 - dx * 2]], c);
}

// ---- illustrated scenes: leads (art 285x121) ----
function sceneL1(x, y, w, h) {
  skyBands(x, y, w, 55, SKY, SKY2);
  fillRect(x + w - 28, y + 6, 12, 12, SUN);
  fillRect(x + w - 32, y + 10, 4, 4, SUN);
  cloud(x + 14, y + 10, 1, CLOUDC);
  cloud(x + 150, y + 6, 1, CLOUDC);
  bird(x + 90, y + 18, 1, INK2);
  bird(x + 122, y + 12, 1, INK2);
  fillRect(x, y + 55, w, h - 55, SEA);
  fillRect(x, y + 92, w, h - 92, SEA2);
  hline(x + 8, y + 64, 46, [200, 220, 230]);
  hline(x + 170, y + 70, 52, [200, 220, 230]);
  hline(x + 10, y + 104, 60, [220, 235, 242]);
  hline(x + 180, y + 108, 50, [220, 235, 242]);
  shipSide(x + 28, y + 78, 150, [120, 125, 130], [90, 95, 100]);
  fillRect(x + 44, y + 56, 22, 9, [178, 60, 44]);
  fillRect(x + 70, y + 56, 22, 9, [60, 110, 90]);
  fillRect(x + 96, y + 56, 22, 9, [186, 140, 52]);
  shipSide(x + 205, y + 88, 60, [140, 145, 150], [110, 115, 120]);
}
function sceneL2(x, y, w, h) {
  skyBands(x, y, w, 58, NIGHT, NIGHT2);
  stars(x, y, w, 58, 14, [220, 225, 230]);
  fillRect(x + w - 34, y + 8, 14, 14, [235, 232, 220]);
  fillRect(x, y + 58, w, h - 58, [70, 100, 130]);
  fillRect(x, y + 96, w, h - 96, [58, 84, 112]);
  hline(x + 12, y + 66, 44, [150, 175, 195]);
  hline(x + 190, y + 72, 48, [150, 175, 195]);
  hline(x + 60, y + 104, 70, [170, 190, 205]);
  smokePuff(x + 96, y + 34, 18, 28, SMOKEC);
  shipSide(x + 40, y + 80, 170, [150, 155, 160], [110, 115, 120]);
  fillRect(x + 150, y + 70, 12, 8, FIRE);
  fillRect(x + 153, y + 72, 6, 5, FIRE2);
  drawLine(x + 222, y + 16, x + 234, y + 28, GOLD);
  drawLine(x + 234, y + 16, x + 222, y + 28, GOLD);
  drawLine(x + 228, y + 28, x + 160, y + 66, GOLD);
  fillRect(x + 232, y + 60, 34, 5, [40, 52, 66]);
  vline(x + 244, y + 52, 8, [40, 52, 66]);
}
function sceneL3(x, y, w, h) {
  skyBands(x, y, w, 50, DUST, DUST2);
  fillRect(x + w - 30, y + 8, 12, 12, [232, 200, 130]);
  cloud(x + 20, y + 12, 1, [240, 228, 200]);
  fillRect(x, y + 50, w, h - 50, LAND2);
  fillRect(x, y + 50, w, 3, [180, 162, 128]);
  // damaged building 1
  fillRect(x + 16, y + 38, 52, 62, STONE);
  fillPoly([[x + 16, y + 38], [x + 26, y + 30], [x + 34, y + 38], [x + 44, y + 28], [x + 56, y + 38], [x + 68, y + 38], [x + 68, y + 46], [x + 16, y + 46]], STONE2);
  fillRect(x + 22, y + 52, 8, 10, [40, 38, 34]);
  fillRect(x + 38, y + 52, 8, 10, [226, 200, 120]);
  fillRect(x + 54, y + 52, 8, 10, [40, 38, 34]);
  fillRect(x + 22, y + 72, 8, 10, [40, 38, 34]);
  fillRect(x + 38, y + 72, 8, 10, [40, 38, 34]);
  // damaged building 2
  fillRect(x + 90, y + 30, 64, 70, STONE2);
  fillPoly([[x + 90, y + 30], [x + 104, y + 22], [x + 116, y + 30], [x + 132, y + 20], [x + 154, y + 30], [x + 154, y + 38], [x + 90, y + 38]], STONE);
  fillRect(x + 98, y + 44, 9, 11, [40, 38, 34]);
  fillRect(x + 116, y + 44, 9, 11, [226, 200, 120]);
  fillRect(x + 134, y + 44, 9, 11, [40, 38, 34]);
  fillRect(x + 98, y + 64, 9, 11, [40, 38, 34]);
  fillRect(x + 116, y + 64, 9, 11, [40, 38, 34]);
  // building 3
  fillRect(x + 176, y + 48, 48, 52, STONE);
  fillPoly([[x + 176, y + 48], [x + 192, y + 40], [x + 208, y + 48], [x + 224, y + 48], [x + 224, y + 54], [x + 176, y + 54]], STONE2);
  fillRect(x + 184, y + 60, 8, 10, [40, 38, 34]);
  fillRect(x + 200, y + 60, 8, 10, [40, 38, 34]);
  // rubble + smoke + figure + warning triangle
  fillPoly([[x + 60, y + 100], [x + 74, y + 92], [x + 88, y + 100]], [150, 134, 108]);
  fillPoly([[x + 150, y + 100], [x + 162, y + 93], [x + 174, y + 100]], [150, 134, 108]);
  smokePuff(x + 100, y + 8, 14, 22, SMOKEC);
  smokePuff(x + 190, y + 22, 12, 18, SMOKEC);
  figure(x + 120, y + 88, 1, [120, 90, 70], INK2);
  fillPoly([[x + 244, y + 22], [x + 252, y + 36], [x + 236, y + 36]], GOLD);
  drawLine(x + 244, y + 22, x + 252, y + 36, INK);
  drawLine(x + 252, y + 36, x + 236, y + 36, INK);
  drawLine(x + 236, y + 36, x + 244, y + 22, INK);
  drawLine(x + 8, y + 108, x + 30, y + 116, [160, 142, 112]);
}

// ---- illustrated scenes: grid row 1 (art 168x79) ----
function sceneG1(x, y, w, h) {
  skyBands(x, y, w, 34, NIGHT, NIGHT2);
  stars(x, y, w, 34, 8, [220, 225, 230]);
  fillRect(x, y + 34, w, h - 34, [120, 110, 95]);
  fillRect(x + 10, y + 18, 40, 44, STONE);
  fillPoly([[x + 10, y + 18], [x + 20, y + 12], [x + 30, y + 18], [x + 40, y + 12], [x + 50, y + 18], [x + 50, y + 24], [x + 10, y + 24]], STONE2);
  fillRect(x + 16, y + 30, 7, 8, [40, 38, 34]);
  fillRect(x + 28, y + 30, 7, 8, [226, 200, 120]);
  fillRect(x + 16, y + 44, 7, 8, [40, 38, 34]);
  fillRect(x + 30, y + 40, 8, 7, FIRE);
  fillRect(x + 62, y + 26, 36, 36, STONE2);
  fillRect(x + 68, y + 32, 6, 7, [40, 38, 34]);
  fillRect(x + 80, y + 32, 6, 7, [40, 38, 34]);
  fillRect(x + 68, y + 44, 6, 7, [226, 200, 120]);
  smokePuff(x + 18, y + 2, 12, 14, SMOKEC);
  fillPoly([[x + 104, y + 62], [x + 112, y + 56], [x + 120, y + 62]], [150, 134, 108]);
  drawLine(x + 118, y + 62, x + 134, y + 34, INK2);
  drawLine(x + 124, y + 62, x + 140, y + 34, INK2);
  hline(x + 122, y + 56, 14, INK2);
  hline(x + 125, y + 48, 14, INK2);
  hline(x + 128, y + 40, 14, INK2);
  figure(x + 142, y + 50, 1, [178, 60, 44], INK2);
}
function sceneG2(x, y, w, h) {
  skyBands(x, y, w, 30, SKY, SKY2);
  fillRect(x + 8, y + 12, 58, 20, STONE);
  fillPoly([[x + 8, y + 12], [x + 37, y + 4], [x + 66, y + 12]], ROOF);
  fillRect(x + 14, y + 20, 6, 6, [40, 38, 34]);
  fillRect(x + 30, y + 20, 6, 6, [40, 38, 34]);
  fillRect(x + 46, y + 20, 6, 6, [40, 38, 34]);
  cloud(x + 100, y + 8, 1, CLOUDC);
  fillRect(x + 6, y + 34, w - 12, 40, WHITE);
  box(x + 6, y + 34, w - 12, 40, INK2);
  hline(x + 8, y + 46, w - 16, [220, 220, 215]);
  hline(x + 8, y + 58, w - 16, [220, 220, 215]);
  chartBars(x + 12, y + 40, w - 24, 28, [0.9, 0.72, 0.78, 0.55, 0.38, 0.22], BLUE, RED);
  trendLine([[x + 14, y + 40], [x + 60, y + 46], [x + 110, y + 52], [x + 150, y + 62]], RED);
  arrowHead(x + 150, y + 62, 1, 1, RED);
}
function sceneG3(x, y, w, h) {
  skyBands(x, y, w, 36, SKY, SKY2);
  cloud(x + 12, y + 6, 1, CLOUDC);
  tower(x + 8, y + 14, 26, 34, STONE, [40, 38, 34]);
  tower(x + 40, y + 8, 30, 40, STONE2, [40, 38, 34]);
  tower(x + 76, y + 18, 24, 30, STONE, [226, 200, 120]);
  fillRect(x, y + 48, w, h - 48, LAND);
  flagPole(x + 112, y + 10, 26, [[178, 34, 34], WHITE], INK);
  flagPole(x + 132, y + 10, 26, [[178, 34, 34]], INK);
  flagPole(x + 152, y + 10, 26, [[0, 110, 110]], INK);
  fillRect(x + 60, y + 60, 48, 10, [120, 100, 80]);
  fillRect(x + 66, y + 54, 14, 6, WHITE);
  fillRect(x + 84, y + 54, 14, 6, WHITE);
  figure(x + 34, y + 56, 1, [30, 58, 95], INK2);
  figure(x + 118, y + 56, 1, [120, 90, 70], INK2);
}
function sceneG4(x, y, w, h) {
  skyBands(x, y, w, 36, SKY, SKY2);
  fillRect(x + w - 24, y + 6, 10, 10, SUN);
  fillRect(x + 50, y + 34, 68, 30, STONE);
  fillPoly([[x + 56, y + 34], [x + 66, y + 20], [x + 100, y + 20], [x + 110, y + 34]], SLATE);
  vline(x + 62, y + 40, 24, WHITE);
  vline(x + 80, y + 40, 24, WHITE);
  vline(x + 98, y + 40, 24, WHITE);
  fillRect(x, y + 64, w, h - 64, LAND);
  flagPole(x + 14, y + 12, 24, [[230, 140, 40], WHITE, [20, 130, 70]], INK);
  flagPole(x + 134, y + 12, 24, [[178, 34, 34], [30, 58, 95]], INK);
  fillRect(x + 118, y + 58, 34, 9, BLUE);
  fillRect(x + 122, y + 60, 6, 5, WHITE);
  fillRect(x + 132, y + 60, 6, 5, WHITE);
  fillRect(x + 142, y + 60, 6, 5, WHITE);
  figure(x + 30, y + 54, 1, [120, 90, 70], INK2);
  figure(x + 88, y + 54, 1, [30, 58, 95], INK2);
}
function sceneG5(x, y, w, h) {
  skyBands(x, y, w, 36, SKY, SKY2);
  cloud(x + 110, y + 6, 1, CLOUDC);
  fillRect(x + 40, y + 26, 88, 34, STONE);
  fillPoly([[x + 40, y + 26], [x + 84, y + 12], [x + 128, y + 26]], ROOF);
  vline(x + 52, y + 32, 28, WHITE);
  vline(x + 72, y + 32, 28, WHITE);
  vline(x + 92, y + 32, 28, WHITE);
  vline(x + 112, y + 32, 28, WHITE);
  fillRect(x, y + 60, w, h - 60, LAND);
  flagPole(x + 12, y + 12, 24, [[20, 20, 20], [178, 34, 34], [20, 130, 70]], INK);
  flagPole(x + 140, y + 12, 24, [[30, 90, 180], [178, 34, 34]], INK);
  figure(x + 62, y + 48, 1, [30, 58, 95], INK2);
  figure(x + 92, y + 48, 1, [120, 90, 70], INK2);
  fillRect(x + 78, y + 56, 12, 4, [212, 178, 140]);
}

// ---- illustrated scenes: grid row 2 (art 168x79) ----
function sceneG6(x, y, w, h) {
  skyBands(x, y, w, 36, SKY, SKY2);
  fillRect(x + w - 22, y + 6, 10, 10, SUN);
  cloud(x + 96, y + 8, 1, CLOUDC);
  fillRect(x, y + 52, w, h - 52, LAND);
  // Eiffel Tower silhouette with lattice slits and arch cutout
  fillPoly([[x + 18, y + 62], [x + 34, y + 10], [x + 38, y + 10], [x + 54, y + 62]], INK2);
  fillRect(x + 30, y + 4, 12, 6, INK2);
  vline(x + 35, y, 4, INK2);
  fillRect(x + 22, y + 44, 28, 3, SKY);
  fillRect(x + 26, y + 28, 20, 3, SKY);
  fillPoly([[x + 28, y + 62], [x + 36, y + 50], [x + 44, y + 62]], LAND);
  fillRect(x + 66, y + 56, 10, 4, GOLD);
  fillRect(x + 80, y + 52, 10, 4, GOLD);
  chartBars(x + 96, y + 34, 62, 24, [0.3, 0.45, 0.42, 0.62, 0.78, 0.95], BLUE, GOLD);
  trendLine([[x + 98, y + 52], [x + 120, y + 46], [x + 140, y + 40], [x + 156, y + 36]], BLUE);
  arrowHead(x + 156, y + 36, 1, -1, BLUE);
}
function sceneG7(x, y, w, h) {
  skyBands(x, y, w, 36, [200, 205, 210], [190, 196, 202]);
  for (let i = 0; i < 7; i++) {
    const rx = x + 8 + i * 22;
    drawLine(rx, y + 4, rx - 6, y + 16, [140, 148, 156]);
    drawLine(rx + 10, y + 18, rx + 4, y + 30, [140, 148, 156]);
  }
  fillRect(x, y + 48, w, h - 48, LAND2);
  fillRect(x + 10, y + 30, 66, 28, STONE2);
  fillPoly([[x + 10, y + 30], [x + 43, y + 20], [x + 76, y + 30]], SLATE);
  fillRect(x + 18, y + 12, 8, 20, STONE2);
  fillRect(x + 32, y + 8, 8, 24, STONE2);
  smokePuff(x + 16, y, 12, 12, SMOKEC);
  fillRect(x + 20, y + 40, 7, 8, [40, 38, 34]);
  fillRect(x + 36, y + 40, 7, 8, [226, 200, 120]);
  fillRect(x + 52, y + 40, 7, 8, [40, 38, 34]);
  chartBars(x + 92, y + 30, 66, 26, [0.9, 0.75, 0.8, 0.55, 0.4, 0.28], [110, 115, 120], RED);
  trendLine([[x + 94, y + 32], [x + 116, y + 38], [x + 136, y + 42], [x + 154, y + 50]], RED);
  arrowHead(x + 154, y + 50, 1, 1, RED);
}
function sceneG8(x, y, w, h) {
  skyBands(x, y, w, 30, NIGHT, NIGHT2);
  stars(x, y, w, 30, 6, [220, 225, 230]);
  // floodlights
  vline(x + 10, y + 4, 22, INK2);
  vline(x + w - 12, y + 4, 22, INK2);
  fillPoly([[x + 6, y + 4], [x + 16, y + 4], [x + 34, y + 30], [x + 2, y + 30]], [230, 225, 180]);
  fillPoly([[x + w - 18, y + 4], [x + w - 8, y + 4], [x + w - 4, y + 30], [x + w - 36, y + 30]], [230, 225, 180]);
  // scoreboard
  fillRect(x + 56, y + 6, 56, 20, WHITE);
  box(x + 56, y + 6, 56, 20, INK);
  drawText('4-4', x + 56 + 7, y + 8, 0.32, 0.32, INK);
  // stands with crowd
  fillRect(x, y + 30, w, 14, [60, 66, 78]);
  fillRect(x, y + 44, w, 12, [48, 54, 66]);
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 24; i++) {
      const cx = x + 4 + i * 7;
      const cy = y + 33 + r * 11;
      const cc = (i + r) % 3 === 0 ? RED : ((i + r) % 3 === 1 ? WHITE : GOLD);
      fillRect(cx, cy, 3, 3, cc);
    }
  }
  // pitch, goal, ball
  fillRect(x, y + 56, w, h - 56, LEAF);
  fillRect(x, y + 56, w, 2, LEAF2);
  hline(x, y + 66, w, [235, 235, 230]);
  box(x + 12, y + 60, 22, 10, WHITE);
  fillRect(x + 128, y + 68, 5, 5, WHITE);
  box(x + 128, y + 68, 5, 5, INK);
}
function sceneG9(x, y, w, h) {
  skyBands(x, y, w, 36, SKY, SKY2);
  cloud(x + 12, y + 6, 1, CLOUDC);
  // capitol dome
  fillRect(x + 52, y + 34, 64, 28, STONE);
  fillPoly([[x + 58, y + 34], [x + 70, y + 18], [x + 98, y + 18], [x + 110, y + 34]], WHITE);
  fillRect(x + 80, y + 12, 8, 6, WHITE);
  vline(x + 84, y + 2, 10, INK);
  fillRect(x + 85, y + 2, 10, 5, RED);
  vline(x + 62, y + 40, 22, WHITE);
  vline(x + 80, y + 40, 22, WHITE);
  vline(x + 98, y + 40, 22, WHITE);
  fillRect(x, y + 62, w, h - 62, LAND);
  // ballot box + papers + voter
  fillRect(x + 16, y + 50, 22, 16, INK);
  fillRect(x + 20, y + 46, 14, 4, INK);
  drawLine(x + 24, y + 44, x + 30, y + 36, INK2);
  fillRect(x + 28, y + 32, 10, 6, WHITE);
  box(x + 28, y + 32, 10, 6, INK2);
  figure(x + 128, y + 50, 1, [178, 60, 44], INK2);
  fillRect(x + 142, y + 44, 12, 8, WHITE);
  box(x + 142, y + 44, 12, 8, INK2);
}
function sceneG10(x, y, w, h) {
  skyBands(x, y, w, 36, SKY, SKY2);
  fillRect(x + 12, y + 6, 10, 10, SUN);
  cloud(x + 90, y + 8, 1, CLOUDC);
  fillRect(x, y + 52, w, h - 52, LAND);
  // Sydney tower needle + pod
  fillRect(x + 24, y + 8, 4, 48, INK2);
  fillRect(x + 16, y + 30, 20, 8, INK2);
  fillRect(x + 20, y + 56, 12, 6, INK2);
  fillRect(x + 44, y + 40, 22, 16, STONE);
  fillPoly([[x + 44, y + 40], [x + 55, y + 32], [x + 66, y + 40]], ROOF);
  chartBars(x + 84, y + 32, 72, 26, [0.35, 0.5, 0.45, 0.65, 0.8, 0.95], GOLD, BLUE);
  trendLine([[x + 86, y + 50], [x + 108, y + 44], [x + 130, y + 40], [x + 152, y + 34]], GOLD);
  arrowHead(x + 152, y + 34, 1, -1, GOLD);
  fillRect(x + 88, y + 60, 8, 4, GOLD);
  fillRect(x + 100, y + 58, 8, 4, GOLD);
}

// ============================================================
// FASE 1 — GRID LAYOUT SEBAGAI DATA (bukan kode gambar).
// Satu struktur data mendeskripsikan semua zona dan kartu.
// Rendering (Fase 2) hanya membaca struktur ini; tidak ada
// koordinat yang di-hardcode di kode gambar.
// ============================================================

// ---- typographic parameters (named constants, not coordinates) ----
const LEAD_HEAD_SX = 0.47, LEAD_HEAD_SY = 0.47, LEAD_HEAD_LH = 26;
const LEAD_SUB_S = 0.28, LEAD_SUB_LH = 18;
const GRID_HEAD_SX = 0.30, GRID_HEAD_SY = 0.34, GRID_HEAD_LH = 19;
const GRID_SUB_S = 0.28, GRID_SUB_LH = 15;
const BADGE_LH = 13;
const LEAD_ART_H = 121, GRID_ART_H = 79;
const LEAD_PAD = 10, LEAD_PAD_TOP = 8, GRID_PAD = 6, GRID_PAD_TOP = 6;

// ---- story data (exact wording, verified facts only) ----
const LEAD_DATA = [
  { badge: 'CONFIRMED | Gulf News', head: 'Trump: sink ships that defy Iran blockade', sub: 'Fresh strikes may wait until 2027', scene: sceneL1 },
  { badge: 'OFFICIAL | AP', head: 'Kyiv: we sank a Russian warship', sub: 'Zelenskyy confirms hit off Benghazi', scene: sceneL2 },
  { badge: 'CONFIRMED | Oxfam', head: "Gaza now a 'toxic wasteland'", sub: 'Over 99% of Gaza is contaminated', scene: sceneL3 },
];
const GRID_DATA = [
  { badge: 'CONFIRMED | AA', head: 'Kyiv-region strike death toll hits 11', sub: 'Rescuers search rubble', scene: sceneG1 },
  { badge: 'CONFIRMED | Yonhap', head: 'KOSPI plunges 3.3% on AI fears', sub: 'Tech sell-off spreads', scene: sceneG2 },
  { badge: 'CONFIRMED | CNA', head: 'Singapore, China sign 29 deals', sub: '29 pacts at forum', scene: sceneG3 },
  { badge: 'CONFIRMED | The Hindu', head: 'Modi hosts Nepal PM, unveils aid', sub: '15,000-crore package', scene: sceneG4 },
  { badge: 'CONFIRMED | BBC', head: 'Kenya, DR Congo restore full ties', sub: 'Full ties restored', scene: sceneG5 },
  { badge: 'CONFIRMED | Euronews', head: 'France unveils 15bn euros', sub: 'Pledged in Paris', scene: sceneG6 },
  { badge: 'CONFIRMED | Reuters', head: 'France downturn at six-month low', sub: 'Services PMI 46.6', scene: sceneG7 },
  { badge: 'CONFIRMED | Serie A', head: 'Atalanta 4-4 Inter in eight-goal epic', sub: 'Eight-goal thriller', scene: sceneG8 },
  { badge: 'REPORTED | AA', head: 'Trump blames voters after loss', sub: 'Ignored Iran warnings', scene: sceneG9 },
  { badge: 'REPORTED | SMH', head: 'Australia warns of slower growth', sub: 'Slower growth ahead', scene: sceneG10 },
];
const KPI_DATA = [
  { num: '11', label: 'killed in Dymer strike' },
  { num: '3.3%', label: 'KOSPI fall on AI fears' },
  { num: '29', label: 'Singapore-China deals' },
  { num: 'EUR 15bn', label: 'Choose France pledges' },
];
const ALSO_TEXT = 'ALSO | Guterres rues COP31 flop | Iran imposes power cuts | Venezuela talks conclude | Gaza lead-poisoning death | UK: Burnham eyes EU reset | Wall St futures climb';
const FOOT1 = 'DATE CHECK: COP31 collapse, Bahrain radar claim and 186 drones were 22 NOV - NOT today.';
const FOOT2 = "CONFIRMED = 2+ outlets | OFFICIAL = on the record | REPORTED = one outlet | CLAIM = one side's account";

// ---- badge measuring (scale ladder; exact outlet spelling kept) ----
function measureBadge(badge, maxW) {
  const parts = badge.split(' | ');
  const label = parts[0];
  const outlet = parts.length > 1 ? ' | ' + parts.slice(1).join(' | ') : '';
  let s = BADGE_LADDER[BADGE_LADDER.length - 1];
  for (const cand of BADGE_LADDER) {
    if (textWidth(badge, cand) <= maxW) { s = cand; break; }
  }
  return { scale: s, label, outlet, width: textWidth(badge, s) };
}

// ---- build the grid data structure ----
function buildLayout() {
  const G = {
    canvas: { x: 0, y: 0, w: 1024, h: 1024 },
    masthead: { x: 38, y: 12, w: 948, h: 56, date: 'MONDAY, 23 NOVEMBER 2026', tag: 'THE WORLD IN ONE DAY' },
    ticker: { x: 38, y: 76, w: 948, h: 30, label: 'TOP STORY', head: 'Trump: sink ships that defy Iran blockade' },
    kpi: { x: 38, y: 114, w: 948, h: 72, cells: [] },
    leads: [],
    grid: [],
    also: { x: 38, y: 906, w: 948, h: 64, text: ALSO_TEXT, lines: [] },
    footer: { x: 38, y: 978, w: 948, h: 42, line1: FOOT1, line2: FOOT2 },
  };
  // KPI: 4 cells tiling the KPI zone
  const cellW = G.kpi.w / 4;
  KPI_DATA.forEach((k, i) => {
    G.kpi.cells.push({ x: G.kpi.x + i * cellW, y: G.kpi.y, w: cellW, h: G.kpi.h, num: k.num, label: k.label });
  });
  // Leads: 3 cards, 305 wide; leftover 33px split 16/17 across 2 gaps
  const leadW = 305, leadH = 280, leadY = 194;
  const leadGapTotal = G.masthead.w - 3 * leadW;
  const leadGap1 = Math.floor(leadGapTotal / 2);
  const leadGap2 = leadGapTotal - leadGap1;
  const leadX = [G.masthead.x, G.masthead.x + leadW + leadGap1, G.masthead.x + 2 * leadW + leadGap1 + leadGap2];
  LEAD_DATA.forEach((d, i) => {
    const card = { x: leadX[i], y: leadY, w: leadW, h: leadH, badge: d.badge, head: d.head, sub: d.sub, scene: d.scene };
    finishCard(card, LEAD_PAD, LEAD_PAD_TOP, LEAD_ART_H, 285, LEAD_HEAD_SX, LEAD_HEAD_SY, LEAD_HEAD_LH, LEAD_SUB_S, LEAD_SUB_LH, 5, 5);
    G.leads.push(card);
  });
  // Grid: 5 cols x 2 rows, 180 wide, 12px gaps, 204 tall, 8px row gap
  const gridW = 180, gridH = 204, gridGap = 12, gridRowGap = 8, gridY0 = 482;
  GRID_DATA.forEach((d, i) => {
    const row = Math.floor(i / 5);
    const col = i % 5;
    const card = { x: G.masthead.x + col * (gridW + gridGap), y: gridY0 + row * (gridH + gridRowGap), w: gridW, h: gridH, badge: d.badge, head: d.head, sub: d.sub, scene: d.scene };
    finishCard(card, GRID_PAD, GRID_PAD_TOP, GRID_ART_H, 168, GRID_HEAD_SX, GRID_HEAD_SY, GRID_HEAD_LH, GRID_SUB_S, GRID_SUB_LH, 4, 4);
    G.grid.push(card);
  });
  // ALSO: pre-wrap into at most 2 lines inside its zone
  G.also.lines = wrapWords(G.also.text, G.also.w, 0.28);
  checkLines('ALSO', G.also.lines.length, 2);
  for (const ln of G.also.lines) checkFit('ALSO line', textWidth(ln.join(' '), 0.28), G.also.w);
  checkLayout(G);
  return G;
}

// Fill in one card's art rect, wrapped lines and text Y positions.
function finishCard(card, pad, padTop, artH, textW, hsx, hsy, hlh, ss, slh, gap1, gap2) {
  card.art = { x: card.x + pad, y: card.y + padTop, w: card.w - 2 * pad, h: artH };
  card.headLines = wrapWords(card.head, textW, hsx);
  card.subLines = wrapWords(card.sub, textW, ss);
  checkLines('headline ' + card.head, card.headLines.length, 3);
  checkLines('subline ' + card.sub, card.subLines.length, 2);
  for (const ln of card.headLines) checkFit('head line', textWidth(ln.join(' '), hsx), textW);
  for (const ln of card.subLines) checkFit('sub line', textWidth(ln.join(' '), ss), textW);
  card.badgeM = measureBadge(card.badge, textW);
  checkFit('badge ' + card.badge, card.badgeM.width, textW);
  const textH = BADGE_LH + gap1 + card.headLines.length * hlh + gap2 + card.subLines.length * slh;
  const textAreaTop = card.y + padTop + artH;
  const textAreaH = card.h - padTop - artH;
  card.textY = textAreaTop + Math.floor((textAreaH - textH) / 2);
  card.headY = card.textY + BADGE_LH + gap1;
  card.subY = card.headY + card.headLines.length * hlh + gap2;
  card.headLH = hlh;
  card.subLH = slh;
  card.headSX = hsx;
  card.headSY = hsy;
  card.subS = ss;
}

// ---- Phase 1 boundary check: inside canvas, no overlaps, art inside card ----
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function checkInside(name, r, outer) {
  if (r.x < outer.x || r.y < outer.y || r.x + r.w > outer.x + outer.w || r.y + r.h > outer.y + outer.h) {
    fitErrors.push('LAYOUT ' + name + ' outside canvas/card');
  }
}
function checkLayout(G) {
  const c = G.canvas;
  const zones = [G.masthead, G.ticker, G.kpi, G.also, G.footer, ...G.leads, ...G.grid];
  for (const z of zones) checkInside('zone', z, c);
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      if (rectsOverlap(zones[i], zones[j])) fitErrors.push('LAYOUT overlap zones ' + i + ' & ' + j);
    }
  }
  for (const cell of G.kpi.cells) checkInside('kpi cell', cell, G.kpi);
  for (let i = 0; i < G.kpi.cells.length; i++) {
    for (let j = i + 1; j < G.kpi.cells.length; j++) {
      if (rectsOverlap(G.kpi.cells[i], G.kpi.cells[j])) fitErrors.push('LAYOUT overlap kpi cells');
    }
  }
  for (const card of [...G.leads, ...G.grid]) {
    checkInside('art', card.art, card);
    if (card.subY + card.subLines.length * card.subLH > card.y + card.h) {
      fitErrors.push('LAYOUT text overflows card ' + card.head);
    }
  }
  if (fitErrors.length === 0) {
    console.log('LAYOUT OK: ' + zones.length + ' zones, 4 kpi cells, 13 cards, 0 overlaps, all inside 1024x1024');
  }
}

// ============================================================
// FASE 2 — RENDERING PIPELINE (membaca grid data saja).
// Urutan: latar kertas -> rule -> teks -> ilustrasi -> footer.
// Tidak ada koordinat yang di-hardcode di sini; semua posisi
// dan ukuran berasal dari struktur GRID.
// ============================================================
function drawBadgeAt(m, x, topY) {
  let pen = drawText(m.label, x, topY, m.scale, m.scale, RED);
  if (m.outlet) pen = drawText(m.outlet, pen, topY, m.scale, m.scale, INK2);
  return pen;
}
function drawMasthead(z) {
  const ds = 0.62, ts = 0.24;
  const dateW = textWidth(z.date, ds);
  const tagW = textWidth(z.tag, ts);
  checkFit('masthead date', dateW, z.w - tagW - 20);
  const dateTop = z.y + 6;
  const dateBase = dateTop + (BASELINE_EM - CAP_TOP_EM) * ds;
  drawText(z.date, z.x, dateTop, ds, ds, INK);
  const tagTop = dateBase - (BASELINE_EM - CAP_TOP_EM) * ts;
  drawText(z.tag, z.x + z.w - tagW, tagTop, ts, ts, INK2);
  fillRect(z.x, z.y + z.h + 2, z.w, 3, INK);
}
function drawTicker(z) {
  const ls = 0.32, hs = 0.38;
  const lw = textWidth(z.label, ls);
  const hw = textWidth(z.head, hs);
  checkFit('ticker label', lw, 200);
  checkFit('ticker headline', hw, z.w - lw - 40);
  drawText(z.label, z.x, z.y + 8, ls, ls, RED);
  vline(z.x + lw + 8, z.y + 6, 18, SOFT);
  drawText(z.head, z.x + lw + 17, z.y + 6, hs, hs, INK);
  hline(z.x, z.y + z.h, z.w, INK);
}
function drawKPI(z) {
  const numS = 0.62, labS = 0.27;
  z.cells.forEach((cell, i) => {
    checkFit('kpi num ' + cell.num, textWidth(cell.num, numS), cell.w - 12);
    checkFit('kpi label ' + cell.label, textWidth(cell.label, labS), cell.w - 12);
    drawText(cell.num, cell.x + 6, cell.y + 6, numS, numS, BLUE);
    drawText(cell.label, cell.x + 6, cell.y + 43, labS, labS, INK2);
    if (i > 0) vline(cell.x, cell.y + 6, 60, SOFT);
  });
  hline(z.x, z.y + z.h, z.w, INK);
}
function drawCard(c) {
  fillRect(c.x, c.y, c.w, c.h, CARD);
  box(c.x, c.y, c.w, c.h, INK);
  c.scene(c.art.x, c.art.y, c.art.w, c.art.h);
  drawBadgeAt(c.badgeM, c.art.x, c.textY);
  drawLines(c.headLines, c.art.x, c.headY, c.headLH, c.headSX, c.headSY, () => INK);
  drawLines(c.subLines, c.art.x, c.subY, c.subLH, c.subS, c.subS, () => INK2);
}
function drawAlso(z) {
  const topY = z.y + Math.floor((z.h - z.lines.length * 16) / 2);
  drawLines(z.lines, z.x, topY, 16, 0.28, 0.28, (wd, li, wi) => (li === 0 && wi === 0 ? RED : INK2));
}
function drawFooter(z) {
  const s1 = 0.24, s2 = 0.22;
  checkFit('footer date check', textWidth(z.line1, s1), z.w);
  checkFit('footer legend', textWidth(z.line2, s2), z.w);
  let pen = drawText('DATE CHECK:', z.x, z.y + 4, s1, s1, RED);
  drawText(z.line1.slice('DATE CHECK:'.length), pen, z.y + 4, s1, s1, INK);
  drawText(z.line2, z.x, z.y + 20, s2, s2, SOFT);
}

// ---- main ----
function main() {
  const G = buildLayout(); // Fase 1: grid data + boundary check
  fillRect(0, 0, W, H, PAPER);
  drawMasthead(G.masthead);
  drawTicker(G.ticker);
  drawKPI(G.kpi);
  for (const c of G.leads) drawCard(c);
  for (const c of G.grid) drawCard(c);
  hline(G.also.x, G.also.y - 4, G.also.w, INK);
  drawAlso(G.also);
  hline(G.footer.x, G.footer.y - 4, G.footer.w, INK);
  drawFooter(G.footer);
  finishFit();
  const outPath = process.argv[2] || '/output/entry.png';
  mkdirSync(dirname(outPath), { recursive: true });
  const png = encodePNG(W, H, px);
  writeFileSync(outPath, png);
  console.log('wrote ' + outPath + ' ' + png.length + ' bytes 1024x1024');
}

main();

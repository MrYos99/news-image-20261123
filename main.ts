// news-image-20261123 -- "The World in One Day"
// A program that draws a newspaper front page summing up the world news of
// Monday 23 November 2026, and writes it to entry.png.
//
// Drawn entirely in code: a DejaVu Serif Bold glyph atlas (font-glyphs.txt,
// a data file read at startup), flat vector shapes, and a hand-rolled PNG
// encoder. No network, no randomness, no clock reads -- the program runs
// twice and writes byte-identical output both times. Node 22 stdlib only.
//
// Layout (1024x1024, marginX 38, content 948, gapY 8):
//   masthead 56 (y 12) | ticker 30 (y 76) | KPI 72 (y 114)
//   lead 280 (y 194, 3 cards of 305) | grid 416 (y 482, 5x2 of 180x204)
//   ALSO 64 (y 906) | footer 42 (y 978) -> ends 1020.
// No map. No large-radius ring or disc decoration anywhere.
//
// Facts come only from the verified 23 Nov 2026 research file. Every card
// carries a certainty tag (CONFIRMED / OFFICIAL / REPORTED / CLAIM) and a
// short source. Headlines are wrapped, never truncated, and never set
// below 22px (lead) / 16px (grid); each headline is measured against the
// glyph atlas before drawing, and the program exits non-zero if one does
// not fit -- the fix is shorter wording in the data, never a smaller font.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// ------------------------------------------------------------------ canvas
const W = 1024;
const H = 1024;

type RGB = [number, number, number];

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG = hex('#0E131A');
const PANEL = hex('#161E29');
const CARD_BG = hex('#18202C');
const CARD_LINE = hex('#2D3B4E');
const ART_BG = hex('#141923');
const ART_LINE = hex('#334155');
const INK = hex('#F8FAFC');
const MUTED = hex('#CBD5E1');
const DIM = hex('#94A3B8');
const TICKER_BG = hex('#B91C1C');
const KPI_NUM = hex('#38BDF8');
const WHITE: RGB = [255, 255, 255];
const GREY = hex('#94A3B8');
const GREY_DARK = hex('#64748B');
const LIGHT = hex('#E2E8F0');
const SHADOW = hex('#0A0D13');

const px = new Uint8Array(W * H * 3);

function setPixel(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) setPixel(xx, yy, c);
  }
}

function fillVGrad(x: number, y: number, w: number, h: number, cTop: RGB, cBot: RGB): void {
  for (let yy = 0; yy < h; yy++) {
    const t = h <= 1 ? 0 : yy / (h - 1);
    const c: RGB = [
      Math.round(cTop[0] + (cBot[0] - cTop[0]) * t),
      Math.round(cTop[1] + (cBot[1] - cTop[1]) * t),
      Math.round(cTop[2] + (cBot[2] - cTop[2]) * t),
    ];
    fillRect(x, y + yy, w, 1, c);
  }
}

function strokeRect(x: number, y: number, w: number, h: number, t: number, c: RGB): void {
  fillRect(x, y, w, t, c);
  fillRect(x, y + h - t, w, t, c);
  fillRect(x, y, t, h, c);
  fillRect(x + w - t, y, t, h, c);
}

function hline(x0: number, x1: number, y: number, t: number, c: RGB): void {
  fillRect(Math.min(x0, x1), y, Math.abs(x1 - x0), t, c);
}

function vline(x: number, y0: number, y1: number, t: number, c: RGB): void {
  fillRect(x, Math.min(y0, y1), t, Math.abs(y1 - y0), c);
}

// Bresenham line, drawn as t-wide squares along the path.
function line(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (let n = 0; n < 4000; n++) {
    fillRect(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

type Pt = [number, number];

// Even-odd scanline polygon fill (convex or concave, no self-intersection).
function fillPoly(points: Pt[], c: RGB): void {
  if (points.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, py] of points) {
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if (y1 === y2) continue;
      const lo = Math.min(y1, y2);
      const hi = Math.max(y1, y2);
      if (y < lo || y >= hi) continue;
      xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      fillRect(Math.ceil(xs[k]), y, Math.floor(xs[k + 1]) - Math.ceil(xs[k]) + 1, 1, c);
    }
  }
}

function strokePoly(points: Pt[], t: number, c: RGB): void {
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    line(x1, y1, x2, y2, t, c);
  }
}

function triangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  fillPoly([[x0, y0], [x1, y1], [x2, y2]], c);
}

// --------------------------------------------------------------------- PNG
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let v = n;
  for (let k = 0; k < 8; k++) v = (v & 1) ? (0xedb88320 ^ (v >>> 1)) : (v >>> 1);
  CRC_TABLE[n] = v >>> 0;
}

function crc32(buf: Buffer): number {
  let v = 0xffffffff;
  for (let i = 0; i < buf.length; i++) v = CRC_TABLE[(v ^ buf[i]) & 0xff] ^ (v >>> 8);
  return (v ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------- serif glyph atlas
// font-glyphs.txt is a DATA file shipped in this repo: one line per glyph,
// ASCII 32..126, rendered at 64 px: [advance, xOff, yOff, w, h, 'base64bits']
// where (xOff, yOff) is the ink-box top-left relative to the ascender top.
// Atlas metrics (DejaVu Serif Bold at 64 px): ascent 61, descent 16.
const ATLAS_SIZE = 64;
const ATLAS_ASCENT = 61;
const ATLAS_DESCENT = 16;

interface Glyph {
  adv: number;
  xOff: number;
  yOff: number;
  w: number;
  h: number;
  bits: Uint8Array; // row-major 0/1, w*h
}

function loadAtlas(): Glyph[] {
  let text = '';
  try {
    text = readFileSync(new URL('./font-glyphs.txt', import.meta.url), 'utf8');
  } catch {
    text = readFileSync(join(process.cwd(), 'font-glyphs.txt'), 'utf8');
  }
  const out: Glyph[] = [];
  const re = /^\s*\[([\d.]+),\s*(-?\d+),\s*(-?\d+),\s*(\d+),\s*(\d+),\s*'([^']*)'\s*\]/;
  for (const ln of text.split('\n')) {
    const m = re.exec(ln);
    if (!m) continue;
    const adv = Number(m[1]);
    const xOff = Number(m[2]);
    const yOff = Number(m[3]);
    const w = Number(m[4]);
    const h = Number(m[5]);
    const raw = Buffer.from(m[6], 'base64');
    const bits = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      bits[i] = (raw[i >> 3] >> (7 - (i & 7))) & 1;
    }
    out.push({ adv, xOff, yOff, w, h, bits });
  }
  if (out.length !== 95) throw new Error(`atlas: expected 95 glyphs, got ${out.length}`);
  return out;
}

const GLYPHS = loadAtlas();

// ------------------------------------------------------------- text engine
// Serif text from the atlas. Sizes are em px; y is the TOP of the em box.
// One glyph is drawn with area-coverage anti-aliasing: each output pixel
// samples a 3x3 grid of points inside it, mapped back to the 64 px atlas,
// so one atlas serves every size from 12 px labels to the 28 px date.
// Bold smears each glyph 1-2 px to the right at draw time (metrics kept).

function blendPixel(x: number, y: number, c: RGB, a: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  px[i] = Math.round(px[i] * (1 - a) + c[0] * a);
  px[i + 1] = Math.round(px[i + 1] * (1 - a) + c[1] * a);
  px[i + 2] = Math.round(px[i + 2] * (1 - a) + c[2] * a);
}

// Draw one glyph's ink at (x, yTop) in em size `size`; returns advance px.
function drawGlyphAA(code: number, x: number, yTop: number, size: number, c: RGB, bold: boolean): number {
  const g = GLYPHS[code - 32];
  if (!g) return 0;
  const f = size / ATLAS_SIZE;
  const adv = g.adv * f;
  if (g.w === 0 || g.h === 0) return adv;
  const ix = x + g.xOff * f;
  const iy = yTop + g.yOff * f;
  const iw = g.w * f;
  const ih = g.h * f;
  const dx = bold ? Math.max(1, Math.round(size * 0.05)) : 0;
  const x0 = Math.floor(ix);
  const x1 = Math.ceil(ix + iw);
  const y0 = Math.floor(iy);
  const y1 = Math.ceil(iy + ih);
  for (let py = y0; py < y1; py++) {
    for (let qx = x0; qx < x1; qx++) {
      let cov = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const gx = Math.floor((qx + (sx + 0.5) / 3 - ix) / f);
          const gy = Math.floor((py + (sy + 0.5) / 3 - iy) / f);
          if (gx >= 0 && gx < g.w && gy >= 0 && gy < g.h && g.bits[gy * g.w + gx]) cov++;
        }
      }
      if (cov === 0) continue;
      const a = cov / 9;
      blendPixel(qx, py, c, a);
      if (dx > 0) blendPixel(qx + dx, py, c, a * 0.85);
    }
  }
  return adv;
}

function glyphAdvance(code: number, size: number): number {
  const g = GLYPHS[code - 32];
  return g ? (g.adv * size) / ATLAS_SIZE : 0;
}

// Advance width of a string (advances minus the last glyph's right side).
function textWidth(s: string, size: number): number {
  if (s.length === 0) return 0;
  let w = 0;
  let last = 32;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code <= 126) {
      w += glyphAdvance(code, size);
      last = code;
    } else {
      w += glyphAdvance(32, size);
    }
  }
  const g = GLYPHS[last - 32];
  if (g) w -= ((g.adv - (g.xOff + g.w)) * size) / ATLAS_SIZE;
  return w;
}

// True ink width (rightmost ink edge) of a string, for the fit check.
function textInkWidth(s: string, size: number): number {
  const f = size / ATLAS_SIZE;
  let x = 0;
  let right = 0;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    const g = code >= 32 && code <= 126 ? GLYPHS[code - 32] : undefined;
    if (!g) { x += glyphAdvance(32, size); continue; }
    if (g.w > 0) right = Math.max(right, x + (g.xOff + g.w) * f);
    x += g.adv * f;
  }
  return right;
}

// Lowest ink edge of one text line below its em-box top, in px.
function lineInkBottom(s: string, size: number): number {
  const f = size / ATLAS_SIZE;
  let bottom = 0;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    const g = code >= 32 && code <= 126 ? GLYPHS[code - 32] : undefined;
    if (!g || g.h === 0) continue;
    bottom = Math.max(bottom, (g.yOff + g.h) * f);
  }
  return bottom;
}

function drawText(s: string, x: number, y: number, size: number, c: RGB, bold = false): void {
  let cx = x;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code <= 126) {
      cx += drawGlyphAA(code, cx, y, size, c, bold);
    } else {
      cx += glyphAdvance(32, size);
    }
  }
}

function drawTextCentered(s: string, cx: number, y: number, size: number, c: RGB, bold = false): void {
  drawText(s, Math.round(cx - textWidth(s, size) / 2), y, size, c, bold);
}

function drawTextRight(s: string, right: number, y: number, size: number, c: RGB, bold = false): void {
  drawText(s, Math.round(right - textWidth(s, size)), y, size, c, bold);
}

// Greedy word wrap to a pixel width. A lone word wider than the box is
// hard-split by characters so nothing ever sticks out sideways.
function wrapText(s: string, maxWidth: number, size: number): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur === '' ? w : cur + ' ' + w;
    if (textWidth(test, size) <= maxWidth) {
      cur = test;
    } else {
      if (cur !== '') lines.push(cur);
      if (textWidth(w, size) > maxWidth) {
        let rest = w;
        while (textWidth(rest, size) > maxWidth) {
          let n = 1;
          while (n < rest.length && textWidth(rest.slice(0, n + 1), size) <= maxWidth) n++;
          lines.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        cur = rest;
      } else {
        cur = w;
      }
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

// --------------------------------------------------------------- page data
// All facts verified for Monday 23 November 2026 (research file).
// Certainty: CONFIRMED = 2+ outlets, OFFICIAL = on the record,
// REPORTED = one outlet, CLAIM = one side's account.
// Headline wording was shortened where the atlas measurement showed the
// research wording would wrap to an orphan third line or overflow:
//   L2 "Kyiv: we sank a Russian warship off Libya" -> dropped "off Libya"
//      (kept in the subline as "off Benghazi")
//   L3 "Gaza now a 'toxic wasteland', Oxfam finds" -> dropped ", Oxfam finds"
//      (Oxfam stays in the badge line)
//   G1 "Death toll in Kyiv-region strike hits 11" -> reworded, same facts
//   G2 "Seoul stocks plunge 3.3% on AI fears" -> "KOSPI plunges 3.3% on AI fears"
//   G6 "France unveils 15bn euros in new projects" -> "France unveils 15bn euros"
//   G7 "France downturn hits six-month low" -> "France downturn at six-month low"
//   G9 "Trump blames voters after midterm loss" -> "Trump blames voters after loss"
// Sublines were shortened the same way (see SUBLINE notes in the fit log).
// Badge lines: grid meta is 12px, not 13px -- at 13px the Euronews /
// Reuters / The Hindu badges overflow the 164px grid text box by up to
// 15px, and no cited source name is shorter; 12px keeps every card's
// certainty label AND source with no overflow. Card #7's source is
// shortened to "Hindu" for the same reason. Card #9's badge keeps the
// space after the pipe ("CONFIRMED| Euronews") -- the space before the
// pipe is dropped because at 12px the full "CONFIRMED | Euronews" overflows
// the 164px grid text box; the fit gate confirms this form at 12px in v2.
// The euro sign and the rupee sign are not in the ASCII atlas, so the
// G6 headline and the G4 subline spell the currency out in words.

type Certainty = 'CONFIRMED' | 'OFFICIAL' | 'REPORTED' | 'CLAIM';
type Motif = 'summit' | 'security' | 'conflict' | 'economy' | 'policy' | 'climate' | 'civic';

interface NewsCard {
  id: number;
  tier: 'lead' | 'grid';
  headline: string;
  subline: string;
  certainty: Certainty;
  source: string;
  accent: RGB;
  motif: Motif;
  /** Full badge line override; default is `${certainty} | ${source}`. */
  meta?: string;
}

const CARDS: NewsCard[] = [
  { id: 1, tier: 'lead', headline: 'Trump: sink ships that defy Iran blockade', subline: 'Fresh strikes may wait until 2027', certainty: 'CONFIRMED', source: 'Gulf News', accent: hex('#C0392B'), motif: 'security' },
  { id: 2, tier: 'lead', headline: 'Kyiv: we sank a Russian warship', subline: 'Zelenskyy confirms hit off Benghazi', certainty: 'OFFICIAL', source: 'AP', accent: hex('#1F3A5F'), motif: 'conflict' },
  { id: 3, tier: 'lead', headline: "Gaza now a 'toxic wasteland'", subline: 'Over 99% of Gaza is contaminated', certainty: 'CONFIRMED', source: 'Oxfam', accent: hex('#8C6A1F'), motif: 'climate' },
  { id: 4, tier: 'grid', headline: 'Kyiv-region strike death toll hits 11', subline: 'Rescuers search rubble', certainty: 'CONFIRMED', source: 'AA', accent: hex('#3B4A5A'), motif: 'conflict' },
  { id: 5, tier: 'grid', headline: 'KOSPI plunges 3.3% on AI fears', subline: 'Tech sell-off spreads', certainty: 'CONFIRMED', source: 'Yonhap', accent: hex('#B03A2E'), motif: 'economy' },
  { id: 6, tier: 'grid', headline: 'Singapore, China sign 29 deals', subline: '29 pacts at forum', certainty: 'CONFIRMED', source: 'CNA', accent: hex('#0E7C7B'), motif: 'summit' },
  { id: 7, tier: 'grid', headline: 'Modi hosts Nepal PM, unveils aid', subline: '15,000-crore package', certainty: 'CONFIRMED', source: 'Hindu', accent: hex('#D97B29'), motif: 'summit' },
  { id: 8, tier: 'grid', headline: 'Kenya, DR Congo restore full ties', subline: 'Full ties restored', certainty: 'CONFIRMED', source: 'BBC', accent: hex('#2E7D32'), motif: 'policy' },
  { id: 9, tier: 'grid', headline: 'France unveils 15bn euros', subline: 'Pledged in Paris', certainty: 'CONFIRMED', source: 'Euronews', accent: hex('#1D4ED8'), motif: 'economy', meta: 'CONFIRMED| Euronews' },
  { id: 10, tier: 'grid', headline: 'France downturn at six-month low', subline: 'Services PMI 46.6', certainty: 'CONFIRMED', source: 'Reuters', accent: hex('#5B6B7C'), motif: 'economy' },
  { id: 11, tier: 'grid', headline: 'Atalanta 4-4 Inter in eight-goal epic', subline: 'Eight-goal thriller', certainty: 'CONFIRMED', source: 'Serie A', accent: hex('#6C3483'), motif: 'civic' },
  { id: 12, tier: 'grid', headline: 'Trump blames voters after loss', subline: 'Ignored Iran warnings', certainty: 'REPORTED', source: 'AA', accent: hex('#922B21'), motif: 'policy' },
  { id: 13, tier: 'grid', headline: 'Australia warns of slower growth', subline: 'Slower growth ahead', certainty: 'REPORTED', source: 'SMH', accent: hex('#B7950B'), motif: 'economy' },
];

const KPIS: Array<[string, string]> = [
  ['11', 'killed in Dymer strike'],
  ['3.3%', 'KOSPI fall on AI fears'],
  ['29', 'Singapore-China deals'],
  ['EUR 15bn', 'Choose France pledges'],
];

const ALSO: string[] = [
  'Guterres rues COP31 flop',
  'Iran imposes power cuts',
  'Venezuela talks conclude',
  'Gaza lead-poisoning death',
  'UK: Burnham eyes EU reset',
  'Wall St futures climb',
];

const TICKER = 'TOP STORY  |  Trump: sink ships that defy Iran blockade';
const DATE_LINE = 'MONDAY, 23 NOVEMBER 2026';
const BRAND_LINE = 'THE WORLD IN ONE DAY';
const DATE_CHECK = 'DATE CHECK: COP31 collapse, Bahrain radar claim and 186 drones were 22 NOV - NOT today.';
const LEGEND = "CONFIRMED = 2+ outlets  |  OFFICIAL = on the record  |  REPORTED = one outlet  |  CLAIM = one side's account";

// ------------------------------------------------------------------- layout
// Canvas 1024x1024, marginX 38, content 948, gapY 8, top margin 12.
const MARGIN_X = 38;
const CONTENT_W = 1024 - MARGIN_X * 2;
const MASTHEAD = { y: 12, h: 56 };
const TICKER_BAND = { y: 76, h: 30 };
const KPI_BAND = { y: 114, h: 72 };
const LEAD = { y: 194, h: 280, gapX: 16, w: 305, artRatio: 0.55, headSize: 22 };
const GRID = { y: 482, cols: 5, rows: 2, gapX: 12, gapY: 8, w: 180, h: 204, artH: 105, headSize: 16 };
const ALSO_BAND = { y: 906, h: 64 };
const FOOTER = { y: 978, h: 42 };

// ---------------------------------------------------------- card illustration
// Dense scenes (v2): every panel is sky + environment + subject + foreground,
// so no panel reads as one shape in empty space. One focused subject per
// card, one ground line, one directional cast shadow (fixed offset
// down-right, drawn flat in the shadow colour; the shadow follows the
// subject's silhouette, not its bounding box, so sparse subjects do not sit
// on a black panel). Motifs differ by subject shape, not by scattered
// small icons.

// Dense-scene helpers (v2). No circles anywhere (the grep for them must
// stay at zero): suns are diamonds, smoke is stacked offset rects, clouds
// are flat rect clusters, delegates are small squares, drones are crossed
// lines.

function cloudAt(x: number, y: number, s: number, c: RGB): void {
  fillRect(x, y + Math.round(s * 0.5), Math.round(s * 3), Math.round(s * 0.5), c);
  fillRect(x + Math.round(s * 0.7), y, Math.round(s * 1.4), Math.round(s * 0.6), c);
}

function birdAt(x: number, y: number, c: RGB): void {
  line(x, y, x + 4, y - 3, 2, c);
  line(x + 4, y - 3, x + 8, y, 2, c);
}

function sunDiamond(cx: number, cy: number, r: number, c: RGB): void {
  fillPoly([[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]], c);
}

function skylineRow(x: number, groundY: number, w: number, c: RGB, win: RGB): void {
  const n = 4;
  const bw = Math.floor(w / n);
  for (let i = 0; i < n; i++) {
    const bh = 14 + ((i * 7) % 16);
    const bx = x + i * bw;
    fillRect(bx, groundY - bh, bw - 3, bh, c);
    fillRect(bx + 3, groundY - bh + 4, 3, 3, win);
    fillRect(bx + 9, groundY - bh + 9, 3, 3, win);
  }
}

function smokeCol(x: number, yBase: number, h: number, c: RGB): void {
  const steps = 4;
  const sh = Math.round(h / steps);
  for (let i = 0; i < steps; i++) {
    fillRect(x - i * 3, yBase - (i + 1) * sh, 8 + i * 3, sh, i % 2 === 0 ? c : GREY);
  }
}

function figureAt(x: number, groundY: number, h: number, cHead: RGB, cBody: RGB): void {
  const hw = Math.max(3, Math.round(h * 0.18));
  fillRect(x, groundY - h, hw, hw, cHead);
  fillRect(x - 1, groundY - h + hw + 1, hw + 2, Math.round(h * 0.45), cBody);
  vline(x + 1, groundY - Math.round(h * 0.32), groundY, 2, cBody);
  vline(x + hw - 1, groundY - Math.round(h * 0.32), groundY, 2, cBody);
}

function flagAt(x: number, yBase: number, h: number, w: number, cols: RGB[]): void {
  vline(x, yBase - h, yBase, 2, LIGHT);
  const bh = Math.round(h * 0.32);
  const n = cols.length;
  for (let i = 0; i < n; i++) {
    fillRect(x + 1, yBase - h + Math.round((bh / n) * i), w, Math.ceil(bh / n), cols[i]);
  }
}

function skyFor(m: Motif): [RGB, RGB] {
  switch (m) {
    case 'security': return [hex('#2A1A20'), hex('#1B2740')];
    case 'conflict': return [hex('#0F1B2E'), hex('#1D2F4A')];
    case 'climate': return [hex('#2A2620'), hex('#3A3226')];
    case 'economy': return [hex('#16233A'), hex('#22314F')];
    case 'summit': return [hex('#2B2118'), hex('#24344E')];
    case 'policy': return [hex('#1A2233'), hex('#26364F')];
    default: return [hex('#141A2E'), hex('#1E2A44')];
  }
}

interface ArtBox { x: number; y: number; w: number; h: number }

function drawIllustration(card: NewsCard, box: ArtBox): void {
  const pad = 8;
  const ix = box.x + pad;
  const iy = box.y + pad;
  const iw = Math.max(24, box.w - pad * 2);
  const ih = Math.max(24, box.h - pad * 2);

  // Dense scene (v2): the sky gradient fills the whole panel first, so the
  // top is never empty; a ground band + horizon line anchor the bottom.
  const [skyTop, skyBot] = skyFor(card.motif);
  fillVGrad(ix, iy, iw, ih, skyTop, skyBot);
  const groundY = iy + Math.round(ih * 0.76);
  fillRect(ix, groundY, iw, iy + ih - groundY, ART_BG);
  hline(ix + 6, ix + iw - 6, groundY, 2, ART_LINE);

  const sw = Math.min(Math.round(iw * 0.5), 130);
  const sh = Math.min(Math.round(ih * 0.52), 84);
  const cx = ix + Math.round((iw - sw) / 2);
  const cy = groundY - sh;
  const midX = cx + Math.round(sw / 2);
  const acc = card.accent;

  // One cast shadow, same offset for every card: each motif draws its
  // own silhouette first, shifted down-right in the shadow colour, then
  // the subject in full colour. A flat bounding-box shadow read as a
  // black panel behind sparse subjects (the warship most of all), so the
  // shadow now follows the subject's shape instead.

  switch (card.motif) {
    case 'security': {
      // Blockade at dusk: sea, two small ships flanking a layered shield.
      cloudAt(ix + 14, iy + 10, 8, GREY_DARK);
      cloudAt(ix + 196, iy + 18, 7, GREY_DARK);
      birdAt(ix + 118, iy + 14, MUTED);
      birdAt(ix + 140, iy + 24, MUTED);
      // Sea band + waves.
      fillRect(ix, groundY - 16, iw, iy + ih - groundY + 16, hex('#12233A'));
      hline(ix + 8, ix + iw - 8, groundY + 6, 2, KPI_NUM);
      hline(ix + 22, ix + iw - 22, groundY + 11, 2, GREY_DARK);
      // Small tanker, left; small patrol ship, right.
      fillRect(ix + 14, groundY - 10, 44, 10, GREY_DARK);
      triangle(ix + 58, groundY - 10, ix + 58, groundY, ix + 70, groundY, GREY_DARK);
      vline(ix + 30, groundY - 22, groundY - 10, 2, LIGHT);
      fillRect(ix + 30, groundY - 22, 12, 6, acc);
      fillRect(ix + iw - 62, groundY - 8, 44, 8, GREY_DARK);
      vline(ix + iw - 44, groundY - 18, groundY - 8, 2, LIGHT);
      fillRect(ix + iw - 44, groundY - 18, 10, 5, KPI_NUM);
      // Shield: layered body + inner panel + rib + handle + highlight,
      // never a single flat diamond.
      const pts: Pt[] = [
        [midX, cy],
        [cx + sw, cy + Math.round(sh * 0.35)],
        [midX, cy + sh],
        [cx, cy + Math.round(sh * 0.35)],
      ];
      fillPoly(pts.map(([x, y]) => [x + 6, y + 4] as Pt), SHADOW);
      fillPoly(pts, hex('#7B241C'));
      const mid: Pt[] = [
        [midX, cy + 8],
        [cx + sw - 10, cy + Math.round(sh * 0.36)],
        [midX, cy + sh - 6],
        [cx + 10, cy + Math.round(sh * 0.36)],
      ];
      fillPoly(mid, acc);
      const inner: Pt[] = [
        [midX, cy + 16],
        [cx + sw - 20, cy + Math.round(sh * 0.38)],
        [midX, cy + sh - 12],
        [cx + 20, cy + Math.round(sh * 0.38)],
      ];
      fillPoly(inner, hex('#E74C3C'));
      strokePoly(pts, 2, INK);
      vline(midX, cy + Math.round(sh * 0.3), cy + Math.round(sh * 0.72), 3, INK);
      fillRect(midX - 14, cy + sh - 10, 28, 4, INK);
      fillPoly([[midX - 18, cy + 26], [midX - 13, cy + 31], [midX - 18, cy + 36], [midX - 23, cy + 31]], hex('#F5B7B1'));
      break;
    }
    case 'conflict': {
      if (card.id === 2) {
        // Warship at night: stars, drone, tracer, distant ship, sea, waves.
        const stars: Array<[number, number]> = [[18, 10], [52, 22], [120, 8], [170, 16], [240, 10], [36, 34], [210, 30]];
        for (const [sx, sy] of stars) fillRect(ix + sx, iy + sy, 2, 2, WHITE);
        // Drone (crossed lines) + tracer from the sea.
        line(ix + 226, iy + 26, ix + 242, iy + 42, 2, WHITE);
        line(ix + 242, iy + 26, ix + 226, iy + 42, 2, WHITE);
        line(ix + 60, groundY - 4, ix + 234, iy + 34, 1, hex('#D4A017'));
        // Sea band + waves.
        fillRect(ix, groundY - 12, iw, iy + ih - groundY + 12, hex('#12233A'));
        hline(ix + 8, ix + iw - 8, groundY + 6, 2, KPI_NUM);
        hline(ix + 22, ix + iw - 22, groundY + 11, 2, GREY_DARK);
        // Distant ship silhouette, left.
        fillRect(ix + 12, groundY - 8, 34, 7, GREY_DARK);
        vline(ix + 24, groundY - 16, groundY - 8, 2, GREY_DARK);
        // Main warship: stack smoke, mast + flag, hull, bow, portholes.
        smokeCol(cx + Math.round(sw * 0.62), cy + Math.round(sh * 0.3), Math.round(sh * 0.5), GREY);
        fillRect(cx + 6, cy + 4 + Math.round(sh * 0.55), sw, Math.round(sh * 0.3), SHADOW);
        triangle(cx + sw + 6, cy + 4 + Math.round(sh * 0.55), cx + sw + 6, cy + 4 + Math.round(sh * 0.85), cx + sw + Math.round(sw * 0.22) + 6, cy + 4 + Math.round(sh * 0.85), SHADOW);
        fillRect(cx, cy + Math.round(sh * 0.55), sw, Math.round(sh * 0.3), LIGHT);
        triangle(cx + sw, cy + Math.round(sh * 0.55), cx + sw, cy + Math.round(sh * 0.85), cx + sw + Math.round(sw * 0.22), cy + Math.round(sh * 0.85), LIGHT);
        fillRect(cx, cy + Math.round(sh * 0.55), sw, 6, acc);
        vline(cx + Math.round(sw * 0.3), cy + Math.round(sh * 0.1), cy + Math.round(sh * 0.55), 3, LIGHT);
        fillRect(cx + Math.round(sw * 0.3), cy + Math.round(sh * 0.1), Math.round(sw * 0.28), Math.round(sh * 0.16), acc);
        fillRect(cx + Math.round(sw * 0.55), cy + Math.round(sh * 0.28), Math.round(sw * 0.1), Math.round(sh * 0.22), GREY_DARK);
        for (let i = 0; i < 4; i++) {
          fillRect(cx + 10 + i * Math.round(sw * 0.22), cy + Math.round(sh * 0.64), 5, 5, hex('#0F172A'));
        }
        line(cx + sw + 4, groundY + 2, cx + sw + 16, groundY - 4, 2, WHITE);
        line(cx + sw + 16, groundY - 4, cx + sw + 28, groundY + 2, 2, WHITE);
      } else {
        // Struck apartment block: smoke, skyline, block, fire, rubble, rescuer.
        const stars: Array<[number, number]> = [[14, 8], [44, 18], [120, 10], [148, 20]];
        for (const [sx, sy] of stars) fillRect(ix + sx, iy + sy, 2, 2, WHITE);
        line(ix + 128, iy + 14, ix + 138, iy + 24, 2, WHITE);
        line(ix + 138, iy + 14, ix + 128, iy + 24, 2, WHITE);
        fillRect(ix + 8, groundY - 26, 26, 26, hex('#0A0F18'));
        fillRect(ix + iw - 36, groundY - 20, 28, 20, hex('#0A0F18'));
        fillRect(ix + 14, groundY - 20, 3, 3, hex('#D4A017'));
        fillRect(ix + iw - 28, groundY - 14, 3, 3, hex('#D4A017'));
        smokeCol(cx + Math.round(sw * 0.6), cy + 4, 22, GREY);
        smokeCol(cx + Math.round(sw * 0.3), cy + 8, 18, GREY_DARK);
        fillRect(cx + 6, cy + 4 + Math.round(sh * 0.2), sw, Math.round(sh * 0.8), SHADOW);
        fillRect(cx, cy + Math.round(sh * 0.2), sw, Math.round(sh * 0.8), GREY);
        line(cx, cy + Math.round(sh * 0.2), cx + Math.round(sw * 0.45), cy, 2, INK);
        line(cx + Math.round(sw * 0.45), cy, cx + sw, cy + Math.round(sh * 0.2), 2, INK);
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < 3; c++) {
            const lit = (r + c) % 2 === 0;
            fillRect(cx + 6 + c * Math.round(sw / 3), cy + Math.round(sh * 0.38) + r * Math.round(sh * 0.24), Math.round(sw * 0.16), Math.round(sh * 0.12), lit ? KPI_NUM : hex('#0F172A'));
          }
        }
        triangle(cx + Math.round(sw * 0.32), cy + Math.round(sh * 0.2), cx + Math.round(sw * 0.5), cy - Math.round(sh * 0.28), cx + Math.round(sw * 0.68), cy + Math.round(sh * 0.2), acc);
        triangle(cx + Math.round(sw * 0.42), cy + Math.round(sh * 0.2), cx + Math.round(sw * 0.5), cy - Math.round(sh * 0.14), cx + Math.round(sw * 0.58), cy + Math.round(sh * 0.2), hex('#D4A017'));
        triangle(cx + 4, groundY, cx + 14, groundY - 8, cx + 24, groundY, GREY_DARK);
        triangle(cx + 26, groundY, cx + 36, groundY - 6, cx + 46, groundY, GREY);
        figureAt(cx + Math.round(sw * 0.72), groundY, 16, INK, KPI_NUM);
        vline(cx + Math.round(sw * 0.86), groundY - 18, groundY, 2, LIGHT);
        hline(cx + Math.round(sw * 0.86) - 4, cx + Math.round(sw * 0.86) + 4, groundY - 14, 2, LIGHT);
        hline(cx + Math.round(sw * 0.86) - 4, cx + Math.round(sw * 0.86) + 4, groundY - 8, 2, LIGHT);
      }
      break;
    }
    case 'climate': {
      // Toxic wasteland, literal: smoke, haze, three ruined slabs, rubble,
      // cracks, a lone figure; the warning triangle is a small detail only.
      cloudAt(ix + 16, iy + 12, 8, GREY_DARK);
      smokeCol(ix + 60, iy + 44, 30, GREY);
      smokeCol(ix + 216, iy + 40, 26, GREY_DARK);
      fillRect(ix, iy + Math.round(ih * 0.42), iw, 5, hex('#3A2F1E'));
      // Left ruined slab (tall, jagged top) + centre slab + right low slab.
      const s1x = cx;
      const s1w = Math.round(sw * 0.3);
      fillRect(s1x, cy + 12, s1w, Math.round(sh * 0.8) - 12, GREY_DARK);
      line(s1x, cy + 12, s1x + Math.round(s1w * 0.5), cy + 2, 2, INK);
      line(s1x + Math.round(s1w * 0.5), cy + 2, s1x + s1w, cy + 12, 2, INK);
      fillRect(s1x + 4, cy + 30, 4, 4, hex('#0F172A'));
      fillRect(s1x + 14, cy + 42, 4, 4, hex('#0F172A'));
      const s2x = cx + Math.round(sw * 0.36);
      const s2w = Math.round(sw * 0.4);
      fillRect(s2x + 6, cy + 4 + Math.round(sh * 0.3), s2w, Math.round(sh * 0.7), SHADOW);
      fillRect(s2x, cy + Math.round(sh * 0.3), s2w, Math.round(sh * 0.7), GREY);
      line(s2x, cy + Math.round(sh * 0.3), s2x + Math.round(s2w * 0.5), cy + Math.round(sh * 0.12), 2, INK);
      line(s2x + Math.round(s2w * 0.5), cy + Math.round(sh * 0.12), s2x + s2w, cy + Math.round(sh * 0.3), 2, INK);
      fillRect(s2x + 5, cy + Math.round(sh * 0.5), 5, 5, hex('#0F172A'));
      fillRect(s2x + 18, cy + Math.round(sh * 0.62), 5, 5, KPI_NUM);
      const s3x = cx + Math.round(sw * 0.8);
      const s3w = sw - Math.round(sw * 0.8);
      fillRect(s3x, cy + Math.round(sh * 0.55), s3w, Math.round(sh * 0.45), GREY_DARK);
      line(s3x, cy + Math.round(sh * 0.55), s3x + Math.round(s3w * 0.5), cy + Math.round(sh * 0.42), 2, INK);
      line(s3x + Math.round(s3w * 0.5), cy + Math.round(sh * 0.42), s3x + s3w, cy + Math.round(sh * 0.55), 2, INK);
      // Rubble at the base + cracks.
      triangle(cx + 4, groundY, cx + 14, groundY - 9, cx + 26, groundY, GREY_DARK);
      triangle(cx + 28, groundY, cx + 38, groundY - 7, cx + 50, groundY, GREY);
      triangle(cx + Math.round(sw * 0.7), groundY, cx + Math.round(sw * 0.78), groundY - 8, cx + Math.round(sw * 0.86), groundY, GREY_DARK);
      line(cx + Math.round(sw * 0.2), groundY, cx + Math.round(sw * 0.34), groundY + 6, 2, GREY_DARK);
      // A lone figure + a small warning triangle (a detail, not the subject).
      figureAt(cx + Math.round(sw * 0.56), groundY, 18, INK, MUTED);
      const tx = ix + iw - 44;
      const ty = groundY - 34;
      triangle(tx, ty, tx + 20, ty, tx + 10, ty - 18, acc);
      vline(tx + 10, ty - 13, ty - 5, 2, INK);
      fillRect(tx + 9, ty - 3, 2, 2, INK);
      break;
    }
    case 'economy': {
      // Bars. Downturn cards (Seoul plunge, France PMI) fall left to right;
      // the rest rise. A trend line ties the three bars together, with an
      // arrowhead at its end; each story gets its own backdrop.
      for (let g = 0; g < 3; g++) {
        hline(ix + 6, ix + iw - 6, iy + 14 + g * Math.round(ih * 0.22), 1, CARD_LINE);
      }
      const down = card.id === 5 || card.id === 10;
      if (card.id === 9) {
        // Paris: Eiffel silhouette left, sun diamond right.
        const tx = ix + 12;
        triangle(tx, groundY, tx + 16, groundY - 46, tx + 32, groundY, GREY_DARK);
        hline(tx + 6, tx + 26, groundY - 30, 2, GREY_DARK);
        hline(tx + 9, tx + 23, groundY - 16, 2, GREY_DARK);
        sunDiamond(ix + iw - 24, iy + 16, 7, hex('#D4A017'));
      } else if (card.id === 10) {
        // Factory with chimney + smoke, rain streaks.
        fillRect(ix + 10, groundY - 26, 40, 26, hex('#0A0F18'));
        fillRect(ix + 52, groundY - 40, 8, 40, hex('#0A0F18'));
        smokeCol(ix + 56, groundY - 40, 22, GREY);
        for (let r = 0; r < 4; r++) vline(ix + 120 + r * 10, iy + 12, iy + 24, 1, GREY_DARK);
      } else if (card.id === 13) {
        // Sydney tower with spire + sun.
        fillRect(ix + 12, groundY - 34, 16, 34, GREY_DARK);
        vline(ix + 20, groundY - 48, groundY - 34, 2, GREY_DARK);
        sunDiamond(ix + iw - 24, iy + 16, 7, hex('#D4A017'));
        cloudAt(ix + 60, iy + 12, 7, GREY_DARK);
      } else {
        // Seoul exchange block behind the bars.
        fillRect(ix + 10, groundY - 24, 34, 24, hex('#0A0F18'));
        fillRect(ix + 16, groundY - 18, 3, 3, hex('#D4A017'));
        fillRect(ix + 26, groundY - 18, 3, 3, hex('#D4A017'));
        cloudAt(ix + 100, iy + 12, 7, GREY_DARK);
      }
      const barW = Math.max(10, Math.round(sw * 0.24));
      const heights = down
        ? [sh, Math.round(sh * 0.62), Math.round(sh * 0.3)]
        : [Math.round(sh * 0.34), Math.round(sh * 0.64), sh];
      const cols: RGB[] = down ? [acc, GREY, GREY_DARK] : [GREY_DARK, GREY, acc];
      for (let i = 0; i < 3; i++) {
        const bx = cx + i * Math.round((sw - barW) / 2);
        fillRect(bx + 6, cy + 4 + sh - heights[i], barW, heights[i], SHADOW);
        fillRect(bx, cy + sh - heights[i], barW, heights[i], cols[i]);
      }
      const yA = cy + sh - heights[0] - 4;
      const yB = cy + sh - heights[2] - 4;
      const xA = cx + Math.round(barW / 2);
      const xB = cx + sw - Math.round(barW / 2);
      line(xA, yA, xB, yB, 2, acc);
      if (down) {
        triangle(xB, yB, xB - 10, yB - 2, xB - 2, yB + 8, acc);
      } else {
        triangle(xB, yB, xB - 10, yB + 2, xB - 2, yB - 8, acc);
      }
      if (!down) {
        fillRect(cx + Math.round(sw * 0.55), cy + 2, 7, 7, hex('#D4A017'));
        fillRect(cx + Math.round(sw * 0.7), cy + 8, 7, 7, hex('#D4A017'));
      }
      break;
    }
    case 'summit': {
      // Negotiating table: sky, skyline, flags (behind), delegates, documents.
      cloudAt(ix + 12, iy + 10, 7, GREY_DARK);
      cloudAt(ix + 110, iy + 16, 6, GREY_DARK);
      birdAt(ix + 70, iy + 12, MUTED);
      skylineRow(ix + 6, groundY, iw - 12, hex('#0A0F18'), hex('#D4A017'));
      // Flags first (poles behind the delegates' heads).
      if (card.id === 6) {
        // Singapore (red over white) | China (red + gold squares) | teal.
        flagAt(cx + 12, cy + Math.round(sh * 0.6), Math.round(sh * 0.5), 18, [hex('#C0392B'), WHITE]);
        flagAt(cx + Math.round(sw * 0.42), cy + Math.round(sh * 0.6), Math.round(sh * 0.5), 18, [hex('#C0392B')]);
        fillRect(cx + Math.round(sw * 0.42) + 2, cy + Math.round(sh * 0.14), 3, 3, hex('#D4A017'));
        fillRect(cx + Math.round(sw * 0.42) + 8, cy + Math.round(sh * 0.18), 3, 3, hex('#D4A017'));
        flagAt(cx + Math.round(sw * 0.8), cy + Math.round(sh * 0.6), Math.round(sh * 0.5), 18, [hex('#0E7C7B')]);
      } else {
        // India (saffron/white/green) | Nepal (blue/red).
        flagAt(cx + 12, cy + Math.round(sh * 0.6), Math.round(sh * 0.5), 18, [hex('#D97B29'), WHITE, hex('#2E7D32')]);
        flagAt(cx + Math.round(sw * 0.42), cy + Math.round(sh * 0.6), Math.round(sh * 0.5), 18, [hex('#1D4ED8'), hex('#C0392B')]);
      }
      // Table with accent band.
      fillRect(cx + 6, cy + 4 + Math.round(sh * 0.6), sw, Math.round(sh * 0.14), SHADOW);
      fillRect(cx, cy + Math.round(sh * 0.6), sw, Math.round(sh * 0.14), LIGHT);
      fillRect(cx, cy + Math.round(sh * 0.6), sw, 5, acc);
      // Delegates: heads + shoulders behind the table.
      for (let i = 0; i < 3; i++) {
        const hx = cx + 10 + i * Math.round((sw - 20) / 3);
        fillRect(hx, cy + Math.round(sh * 0.3), 10, 10, INK);
        fillRect(hx - 3, cy + Math.round(sh * 0.48), 16, Math.round(sh * 0.14), i === 1 ? acc : LIGHT);
      }
      // Documents on the table.
      for (let i = 0; i < 3; i++) {
        fillRect(cx + 8 + i * Math.round(sw / 3), cy + Math.round(sh * 0.6) + 3, 12, 4, WHITE);
      }
      // The Nepal train link, along the ground (id 7 only).
      if (card.id === 7) {
        const trx = cx + Math.round(sw * 0.72);
        fillRect(trx, groundY - 12, 34, 12, GREY_DARK);
        fillRect(trx + 4, groundY - 9, 5, 5, KPI_NUM);
        fillRect(trx + 14, groundY - 9, 5, 5, KPI_NUM);
        fillRect(trx + 24, groundY - 9, 5, 5, KPI_NUM);
      }
      break;
    }
    case 'policy': {
      // Parliament front + flags + figures; per story the foreground differs.
      cloudAt(ix + 12, iy + 10, 7, GREY_DARK);
      birdAt(ix + 110, iy + 14, MUTED);
      skylineRow(ix + 6, groundY, iw - 12, hex('#0A0F18'), hex('#D4A017'));
      // Parliament: beam, three columns, base.
      fillRect(cx + 6, cy + 4, sw, Math.round(sh * 0.16), SHADOW);
      fillRect(cx, cy, sw, Math.round(sh * 0.16), acc);
      for (let i = 0; i < 3; i++) {
        const colX = cx + 4 + i * Math.round((sw - 8) / 3);
        fillRect(colX + 6, cy + 4 + Math.round(sh * 0.2), Math.round(sw * 0.2), Math.round(sh * 0.62), SHADOW);
        fillRect(colX, cy + Math.round(sh * 0.2), Math.round(sw * 0.2), Math.round(sh * 0.62), LIGHT);
      }
      fillRect(cx, cy + Math.round(sh * 0.84), sw, Math.round(sh * 0.16), GREY_DARK);
      if (card.id === 8) {
        // Kenya (black/red/green) | DR Congo (blue/red) + two figures.
        flagAt(cx + 2, cy + Math.round(sh * 0.2), Math.round(sh * 0.55), 14, [hex('#1A1A1A'), hex('#C0392B'), hex('#2E7D32')]);
        flagAt(cx + sw - 16, cy + Math.round(sh * 0.2), Math.round(sh * 0.55), 14, [hex('#1D4ED8'), hex('#C0392B')]);
        figureAt(cx + Math.round(sw * 0.32), groundY, 18, INK, LIGHT);
        figureAt(cx + Math.round(sw * 0.58), groundY, 18, INK, acc);
        fillRect(cx + Math.round(sw * 0.44), groundY - 12, 10, 4, KPI_NUM);
      } else {
        // Capitol dome behind + ballot box + voter + small flag.
        triangle(cx + Math.round(sw * 0.2), cy + Math.round(sh * 0.2), cx + Math.round(sw * 0.5), cy - 4, cx + Math.round(sw * 0.8), cy + Math.round(sh * 0.2), GREY_DARK);
        flagAt(cx + sw - 18, cy + Math.round(sh * 0.2), Math.round(sh * 0.55), 14, [hex('#C0392B'), WHITE, hex('#C0392B')]);
        const bx = cx + Math.round(sw * 0.45);
        fillRect(bx + 11, groundY - 22, 8, 6, WHITE);
        fillRect(bx, groundY - 16, 30, 16, GREY_DARK);
        fillRect(bx + 4, groundY - 16, 22, 2, hex('#0F172A'));
        figureAt(cx + Math.round(sw * 0.1), groundY, 18, INK, LIGHT);
      }
      break;
    }
    default: {
      // Stadium at night: floodlights, stands with crowd, pitch, goal, ball,
      // and a HIGH-CONTRAST scoreboard (dark score on a light panel).
      const stars: Array<[number, number]> = [[14, 8], [60, 14], [120, 10], [148, 20]];
      for (const [sx, sy] of stars) fillRect(ix + sx, iy + sy, 2, 2, WHITE);
      // Floodlight masts + beams.
      vline(ix + 10, iy + 8, iy + 34, 2, LIGHT);
      vline(ix + iw - 10, iy + 8, iy + 34, 2, LIGHT);
      line(ix + 10, iy + 10, ix + 50, groundY - 8, 1, GREY_DARK);
      line(ix + iw - 10, iy + 10, ix + iw - 50, groundY - 8, 1, GREY_DARK);
      // Stands: two tiers with crowd dots.
      fillRect(ix + 6, iy + 34, iw - 12, 14, hex('#0A0F18'));
      fillRect(ix + 6, iy + 50, iw - 12, 12, hex('#111827'));
      for (let i = 0; i < 10; i++) {
        fillRect(ix + 10 + i * 15, iy + 38, 3, 3, i % 2 === 0 ? KPI_NUM : MUTED);
        fillRect(ix + 12 + i * 15, iy + 54, 3, 3, i % 3 === 0 ? acc : GREY);
      }
      // Pitch + centre line + goal + ball.
      fillRect(ix, groundY - 12, iw, iy + ih - groundY + 12, hex('#14301F'));
      hline(ix + 6, ix + iw - 6, groundY - 6, 1, WHITE);
      vline(ix + 14, groundY - 12, groundY + 2, 2, WHITE);
      vline(ix + 30, groundY - 12, groundY + 2, 2, WHITE);
      hline(ix + 14, ix + 30, groundY - 12, 2, WHITE);
      fillRect(ix + 46, groundY - 10, 6, 6, WHITE);
      vline(ix + 49, groundY - 10, groundY - 4, 1, hex('#0F172A'));
      hline(ix + 46, ix + 52, groundY - 7, 1, hex('#0F172A'));
      // Scoreboard: light panel, dark score (contrast fix vs v1).
      fillRect(cx + 6, cy + 4 + Math.round(sh * 0.18), sw, Math.round(sh * 0.6), SHADOW);
      fillRect(cx, cy + Math.round(sh * 0.18), sw, Math.round(sh * 0.6), LIGHT);
      strokeRect(cx, cy + Math.round(sh * 0.18), sw, Math.round(sh * 0.6), 2, acc);
      const score = '4 - 4';
      const ss = Math.min(24, Math.round(sh * 0.34));
      drawText(score, cx + Math.round((sw - textWidth(score, ss)) / 2), cy + Math.round(sh * 0.3), ss, hex('#0F172A'), true);
      break;
    }
  }

  strokeRect(ix, iy, iw, ih, 1, ART_LINE);
}

// ------------------------------------------------------------------ one card
interface FitRow {
  id: number;
  tier: string;
  lines: number;
  headlineFits: boolean;
  sublineDrawn: boolean;
  metaFits: boolean;
}

const FIT_ROWS: FitRow[] = [];

function renderCard(card: NewsCard, bx: number, by: number, bw: number, bh: number): void {
  const isLead = card.tier === 'lead';
  const pad = isLead ? 10 : 8;
  const artH = isLead ? Math.round((bh - pad * 2) * LEAD.artRatio) : GRID.artH;
  const artGap = isLead ? 10 : 7;
  const metaSize = isLead ? 14 : 12;
  const headSize = isLead ? LEAD.headSize : GRID.headSize;
  const headGap = isLead ? 6 : 5;
  const headLh = isLead ? 27 : 19;
  const subSize = isLead ? 13 : 12;

  const artBox: ArtBox = { x: bx + pad, y: by + pad, w: bw - pad * 2, h: artH };
  const textX = bx + pad;
  const textW = bw - pad * 2;
  const textY = artBox.y + artBox.h + artGap;
  const textBottom = by + bh - pad;

  fillRect(bx, by, bw, bh, CARD_BG);
  strokeRect(bx, by, bw, bh, 2, CARD_LINE);
  fillRect(bx, by, bw, 4, card.accent);

  drawIllustration(card, artBox);

  // Badge line: certainty + short source, never wrapped, never shrunk.
  const meta = card.meta ?? `${card.certainty} | ${card.source}`;
  const metaFits = textWidth(meta, metaSize) <= textW && textInkWidth(meta, metaSize) <= textW;
  drawText(meta, textX, textY, metaSize, card.accent, true);

  // Headline: wrapped, measured before drawing, font never reduced.
  const lines = wrapText(card.headline, textW, headSize);
  const headTop = textY + metaSize + headGap;
  const lastTop = headTop + (lines.length - 1) * headLh;
  const lastBottom = lastTop + lineInkBottom(lines[lines.length - 1], headSize);
  const headlineFits =
    lines.every((ln) => textWidth(ln, headSize) <= textW && textInkWidth(ln, headSize) <= textW) &&
    lastBottom <= textBottom;
  lines.forEach((ln, i) => {
    drawText(ln, textX, headTop + i * headLh, headSize, INK, true);
  });

  // Subline: one line, only when it fits under the headline inside the box.
  let sublineDrawn = false;
  const subTop = headTop + lines.length * headLh + (isLead ? 6 : 4);
  if (
    textWidth(card.subline, subSize) <= textW &&
    textInkWidth(card.subline, subSize) <= textW &&
    subTop + subSize * ((ATLAS_ASCENT + ATLAS_DESCENT) / ATLAS_SIZE) <= textBottom
  ) {
    drawText(card.subline, textX, subTop, subSize, MUTED, false);
    sublineDrawn = true;
  }

  FIT_ROWS.push({
    id: card.id,
    tier: card.tier,
    lines: lines.length,
    headlineFits,
    sublineDrawn,
    metaFits,
  });
}

// --------------------------------------------------------------------- page
function render(): void {
  fillRect(0, 0, W, H, BG);

  // Masthead: the date is the title; the brand line sits right-aligned.
  fillRect(MARGIN_X, MASTHEAD.y, CONTENT_W, MASTHEAD.h, PANEL);
  drawText(DATE_LINE, MARGIN_X + 16, MASTHEAD.y + 14, 28, INK, true);
  drawTextRight(BRAND_LINE, MARGIN_X + CONTENT_W - 16, MASTHEAD.y + 22, 13, DIM, true);

  // Ticker: one line, the lead story, centred on a red band.
  fillRect(MARGIN_X, TICKER_BAND.y, CONTENT_W, TICKER_BAND.h, TICKER_BG);
  drawTextCentered(TICKER, 512, TICKER_BAND.y + 7, 17, WHITE, true);

  // KPI strip: four numbers, each with a one-line label underneath.
  fillRect(MARGIN_X, KPI_BAND.y, CONTENT_W, KPI_BAND.h, PANEL);
  const colW = CONTENT_W / 4;
  KPIS.forEach(([value, label], i) => {
    const kx = MARGIN_X + i * colW + 14;
    drawText(value, kx, KPI_BAND.y + 12, 28, KPI_NUM, true);
    drawText(label, kx, KPI_BAND.y + 48, 14, MUTED, false);
    if (i > 0) vline(Math.round(MARGIN_X + i * colW), KPI_BAND.y + 12, KPI_BAND.y + KPI_BAND.h - 12, 1, CARD_LINE);
  });

  // Lead cards (3) and grid cards (10).
  const leads = CARDS.filter((c) => c.tier === 'lead');
  leads.forEach((card, i) => {
    renderCard(card, MARGIN_X + i * (LEAD.w + LEAD.gapX), LEAD.y, LEAD.w, LEAD.h);
  });
  const grid = CARDS.filter((c) => c.tier === 'grid');
  grid.forEach((card, i) => {
    const col = i % GRID.cols;
    const row = Math.floor(i / GRID.cols);
    renderCard(
      card,
      MARGIN_X + col * (GRID.w + GRID.gapX),
      GRID.y + row * (GRID.h + GRID.gapY),
      GRID.w,
      GRID.h,
    );
  });

  // ALSO strip: six short items in two rows of three.
  fillRect(MARGIN_X, ALSO_BAND.y, CONTENT_W, ALSO_BAND.h, PANEL);
  const rowA = `ALSO  |  ${ALSO.slice(0, 3).join('  |  ')}`;
  const rowB = ALSO.slice(3).join('  |  ');
  drawText(rowA, MARGIN_X + 14, ALSO_BAND.y + 9, 15, INK, false);
  drawText(rowB, MARGIN_X + 14, ALSO_BAND.y + 35, 15, INK, false);

  // Footer: DATE CHECK on line one, the certainty legend on line two.
  fillRect(MARGIN_X, FOOTER.y, CONTENT_W, FOOTER.h, hex('#111720'));
  drawText(DATE_CHECK, MARGIN_X + 14, FOOTER.y + 5, 15, INK, true);
  drawText(LEGEND, MARGIN_X + 14, FOOTER.y + 24, 12, DIM, false);
}

// --------------------------------------------------------------------- main
function main(): void {
  const outDir = process.argv[2] ?? '/output';
  render();

  const bad = FIT_ROWS.filter((r) => !r.headlineFits || !r.metaFits);
  const lines = FIT_ROWS.map(
    (r) =>
      `  #${r.id} ${r.tier.padEnd(4)} lines=${r.lines} headline=${r.headlineFits ? 'FIT' : 'OVERFLOW'} meta=${r.metaFits ? 'FIT' : 'OVERFLOW'} subline=${r.sublineDrawn ? 'drawn' : 'omitted'}`,
  );
  console.log('headline fit:');
  for (const ln of lines) console.log(ln);
  console.log(`cards: ${FIT_ROWS.length} (lead ${FIT_ROWS.filter((r) => r.tier === 'lead').length}, grid ${FIT_ROWS.filter((r) => r.tier === 'grid').length}), ALSO: ${ALSO.length}, KPIs: ${KPIS.length}`);
  if (bad.length > 0) {
    console.error(`OVERFLOW: ${bad.map((r) => `#${r.id}`).join(', ')} -- shorten the wording, never shrink the font`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  const png = encodePng();
  writeFileSync(join(outDir, 'entry.png'), png);
  const sha = createHash('sha256').update(png).digest('hex');
  console.log(`wrote entry.png: ${png.length} bytes, ${W}x${H}, sha256=${sha}`);
}

main();

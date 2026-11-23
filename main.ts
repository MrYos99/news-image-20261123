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
// shortened to "Hindu" and card #9's badge drops the space after the
// pipe ("CONFIRMED |Euronews") for the same reason.
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
  { id: 9, tier: 'grid', headline: 'France unveils 15bn euros', subline: 'Pledged in Paris', certainty: 'CONFIRMED', source: 'Euronews', accent: hex('#1D4ED8'), motif: 'economy', meta: 'CONFIRMED |Euronews' },
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
// One focused subject + one ground line + one directional cast shadow
// (fixed offset down-right, drawn flat in the shadow colour because the art
// background is flat; the shadow follows the subject's silhouette, not
// its bounding box, so sparse subjects do not sit on a black panel).
// Motifs differ by subject shape, not by scattered small icons.

interface ArtBox { x: number; y: number; w: number; h: number }

function drawIllustration(card: NewsCard, box: ArtBox): void {
  const pad = 8;
  const ix = box.x + pad;
  const iy = box.y + pad;
  const iw = Math.max(24, box.w - pad * 2);
  const ih = Math.max(24, box.h - pad * 2);

  fillRect(ix, iy, iw, ih, ART_BG);
  const groundY = iy + Math.round(ih * 0.76);
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
      // Shield: pointed diamond silhouette with a pale outline.
      const pts: Pt[] = [
        [midX, cy],
        [cx + sw, cy + Math.round(sh * 0.35)],
        [midX, cy + sh],
        [cx, cy + Math.round(sh * 0.35)],
      ];
      fillPoly(pts.map(([x, y]) => [x + 6, y + 4] as Pt), SHADOW);
      fillPoly(pts, acc);
      strokePoly(pts, 2, INK);
      vline(midX, cy + Math.round(sh * 0.3), cy + Math.round(sh * 0.72), 3, INK);
      break;
    }
    case 'conflict': {
      if (card.id === 2) {
        // Warship on the water: hull, bow triangle, mast, flag, wave lines.
        fillRect(cx + 6, cy + 4 + Math.round(sh * 0.55), sw, Math.round(sh * 0.3), SHADOW);
        triangle(cx + sw + 6, cy + 4 + Math.round(sh * 0.55), cx + sw + 6, cy + 4 + Math.round(sh * 0.85), cx + sw + Math.round(sw * 0.22) + 6, cy + 4 + Math.round(sh * 0.85), SHADOW);
        fillRect(cx, cy + Math.round(sh * 0.55), sw, Math.round(sh * 0.3), LIGHT);
        triangle(cx + sw, cy + Math.round(sh * 0.55), cx + sw, cy + Math.round(sh * 0.85), cx + sw + Math.round(sw * 0.22), cy + Math.round(sh * 0.85), LIGHT);
        fillRect(cx, cy + Math.round(sh * 0.55), sw, 6, acc);
        vline(cx + Math.round(sw * 0.3), cy + Math.round(sh * 0.1), cy + Math.round(sh * 0.55), 3, LIGHT);
        fillRect(cx + Math.round(sw * 0.3), cy + Math.round(sh * 0.1), Math.round(sw * 0.28), Math.round(sh * 0.16), acc);
        hline(cx - 6, cx + sw + 14, groundY + 5, 2, KPI_NUM);
        hline(cx + 10, cx + sw - 4, groundY + 10, 2, GREY_DARK);
      } else {
        // Struck apartment block: grey slab, broken roofline, fire, cracks.
        fillRect(cx + 6, cy + 4 + Math.round(sh * 0.2), sw, Math.round(sh * 0.8), SHADOW);
        fillRect(cx, cy + Math.round(sh * 0.2), sw, Math.round(sh * 0.8), GREY);
        line(cx, cy + Math.round(sh * 0.2), cx + Math.round(sw * 0.45), cy, 2, INK);
        line(cx + Math.round(sw * 0.45), cy, cx + sw, cy + Math.round(sh * 0.2), 2, INK);
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < 3; c++) {
            fillRect(cx + 6 + c * Math.round(sw / 3), cy + Math.round(sh * 0.38) + r * Math.round(sh * 0.24), Math.round(sw * 0.16), Math.round(sh * 0.12), KPI_NUM);
          }
        }
        triangle(cx + Math.round(sw * 0.32), cy + Math.round(sh * 0.2), cx + Math.round(sw * 0.5), cy - Math.round(sh * 0.28), cx + Math.round(sw * 0.68), cy + Math.round(sh * 0.2), acc);
        line(cx + Math.round(sw * 0.2), groundY, cx + Math.round(sw * 0.34), groundY + 6, 2, GREY_DARK);
      }
      break;
    }
    case 'climate': {
      // Ruined ground: two rubble slabs, crack lines, warning triangle.
      fillRect(cx + 6, cy + 4 + Math.round(sh * 0.45), Math.round(sw * 0.52), Math.round(sh * 0.55), SHADOW);
      fillRect(cx + 6 + Math.round(sw * 0.56), cy + 4 + Math.round(sh * 0.62), Math.round(sw * 0.44), Math.round(sh * 0.38), SHADOW);
      fillRect(cx, cy + Math.round(sh * 0.45), Math.round(sw * 0.52), Math.round(sh * 0.55), GREY_DARK);
      fillRect(cx + Math.round(sw * 0.56), cy + Math.round(sh * 0.62), Math.round(sw * 0.44), Math.round(sh * 0.38), GREY);
      line(cx + Math.round(sw * 0.1), groundY, cx + Math.round(sw * 0.24), groundY - Math.round(sh * 0.3), 2, GREY);
      line(cx + Math.round(sw * 0.24), groundY - Math.round(sh * 0.3), cx + Math.round(sw * 0.4), groundY - Math.round(sh * 0.18), 2, GREY);
      const tx = cx + Math.round(sw * 0.5);
      const ty = cy + Math.round(sh * 0.35);
      triangle(tx, ty, tx + Math.round(sw * 0.5), ty, tx + Math.round(sw * 0.25), ty - Math.round(sh * 0.45), acc);
      vline(tx + Math.round(sw * 0.25), ty - Math.round(sh * 0.32), ty - Math.round(sh * 0.1), 3, INK);
      break;
    }
    case 'economy': {
      // Bars. Downturn cards (Seoul plunge, France PMI) fall left to right;
      // the rest rise. A trend line ties the three bars together.
      const down = card.id === 5 || card.id === 10;
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
      line(cx + Math.round(barW / 2), yA, cx + sw - Math.round(barW / 2), yB, 2, acc);
      break;
    }
    case 'summit': {
      // Negotiating table with an accent top band and three small flags.
      fillRect(cx + 6, cy + 4 + Math.round(sh * 0.6), sw, Math.round(sh * 0.14), SHADOW);
      for (let i = 0; i < 3; i++) {
        const fx = cx + 8 + i * Math.round((sw - 16) / 3);
        vline(fx, cy + Math.round(sh * 0.08), cy + Math.round(sh * 0.6), 2, LIGHT);
        fillRect(fx, cy + Math.round(sh * 0.08), Math.round(sw * 0.2), Math.round(sh * 0.16), i === 1 ? acc : i === 0 ? LIGHT : KPI_NUM);
      }
      fillRect(cx, cy + Math.round(sh * 0.6), sw, Math.round(sh * 0.14), LIGHT);
      fillRect(cx, cy + Math.round(sh * 0.6), sw, 5, acc);
      for (let i = 0; i < 3; i++) {
        fillRect(cx + 6 + i * Math.round(sw / 3), cy + Math.round(sh * 0.78), Math.round(sw * 0.2), Math.round(sh * 0.22), GREY_DARK);
      }
      break;
    }
    case 'policy': {
      // Three columns under one beam: a small parliament front.
      fillRect(cx + 6, cy + 4, sw, Math.round(sh * 0.16), SHADOW);
      fillRect(cx, cy, sw, Math.round(sh * 0.16), acc);
      for (let i = 0; i < 3; i++) {
        const colX = cx + 4 + i * Math.round((sw - 8) / 3);
        fillRect(colX + 6, cy + 4 + Math.round(sh * 0.2), Math.round(sw * 0.2), Math.round(sh * 0.62), SHADOW);
        fillRect(colX, cy + Math.round(sh * 0.2), Math.round(sw * 0.2), Math.round(sh * 0.62), LIGHT);
      }
      fillRect(cx, cy + Math.round(sh * 0.84), sw, Math.round(sh * 0.16), GREY_DARK);
      break;
    }
    default: {
      // Civic (sport): a scoreboard panel with the 4-4 score.
      fillRect(cx + 6, cy + 4 + Math.round(sh * 0.18), sw, Math.round(sh * 0.6), SHADOW);
      fillRect(cx, cy + Math.round(sh * 0.18), sw, Math.round(sh * 0.6), hex('#0F172A'));
      strokeRect(cx, cy + Math.round(sh * 0.18), sw, Math.round(sh * 0.6), 2, acc);
      const score = '4 - 4';
      const ss = Math.min(24, Math.round(sh * 0.34));
      drawText(score, cx + Math.round((sw - textWidth(score, ss)) / 2), cy + Math.round(sh * 0.3), ss, acc, true);
      const bx = midX - Math.round(sw * 0.09);
      const by = groundY - Math.round(sh * 0.22);
      fillPoly([[bx, by - 6], [bx + 6, by], [bx, by + 6], [bx - 6, by]], acc);
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

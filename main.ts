// news-image-20261123 v6 — "The World in One Day", top-1 pattern.
//
// The image is entry.png beside this file, rendered outside the harness
// with PIL and a real serif font (Liberation Serif, Times-compatible); the
// program copies it to /output/entry.png. This is the kit's own simplest
// entry ("a repository holding the image and a one-line program that copies
// it there") and how the 21 Nov top-1 entry did it: the font never runs in
// Node. render.py in this repository is the script that drew the image.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const src = new URL('./entry.png', import.meta.url);
if (!existsSync(src)) {
  throw new Error('entry.png missing beside main.ts — render it first with: python3 render.py');
}
copyFileSync(src, join(process.env.MAKEFUN_OUTPUT_DIR ?? '/output', 'entry.png'));

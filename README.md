# Sum up 23 November's world news in one image

[![make.fun](https://make.fun/badge/news-image-20261123.svg)](https://make.fun/bounty/news-image-20261123)
[![rank](https://make.fun/badge/news-image-20261123/MrYos99/news-image-20261123/rank.svg)](https://make.fun/bounty/news-image-20261123/leaderboard)
[![reward](https://make.fun/badge/news-image-20261123/MrYos99/news-image-20261123/reward.svg)](https://make.fun/bounty/news-image-20261123)

A program that sums up the world's news of Monday, 23 November 2026 in one image.
Node 22 standard library only — no network, no external packages. It copies
the finished image (entry.png, 1024×1024, under 1 MiB, byte-identical across
runs) to `/output/entry.png`. The image was rendered outside the harness with
render.py (PIL + Liberation Serif, a real Times-compatible serif font) — the
kit's own simplest entry pattern, and how the 21 Nov top-1 entry did it: the
font never runs in Node. The page holds 33 numbered stories (13 illustrated
news cards + a 20-item ALSO list), a world map with numbered pins for stories
1–13, a UTC timeline strip, a region bar, a 6-number KPI strip and an expanded
DATE CHECK / LEFT OUT box.

Run it with:

```sh
node main.ts
```

Entry for the make.fun bounty
[Sum up 23 November's world news in one image](https://make.fun/bounty/news-image-20261123).

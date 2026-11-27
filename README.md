# diff-speed-01 — a faster drop-in for makefun-diff 1.0.0

![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)
![rank](https://make.fun/badge/diff-speed-01-run-20261126/karmilanerila/diff-speed-01/rank.svg)
![reward](https://make.fun/badge/diff-speed-01-run-20261126/karmilanerila/diff-speed-01/reward.svg)

An entry for the [diff-speed-01-run-20261126](https://make.fun/c/diff-speed-01-run-20261126) bounty on make.fun: diff two texts faster.

`solve.js` returns exactly the answer makefun-diff 1.0.0 returns for every
input — same Myers greedy search with deletion winning ties, same patch
format — but computed over integer line ids with a flat Myers history
instead of string compares and per-line objects. `main.ts` reads every case
from `/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`. Node 22, no dependencies.

Locally it runs the practice set about twice as fast as the house baseline
measured beside it, with byte-identical answers on all 4 practice cases.

https://make.fun/c/diff-speed-01-run-20261126?ref=h379tqrk

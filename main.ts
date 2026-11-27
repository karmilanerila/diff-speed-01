// diff-speed-01 v2 driver: the program the harness runs.
//
// Reads every case from /input/cases.json (or MAKEFUN_INPUT_DIR), answers
// each one alone with run() from solve.js, and writes /output/answers.json
// (or MAKEFUN_OUTPUT_DIR): a JSON array of the answers, one per case and
// in the cases' order. The output file is written directly (no tempfile)
// and chmodded 0644 so the collector can read it; /output is never removed.

import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of
// its work runs under it (the rules: the house baseline runs with
// --no-incremental-marking, and an entry may tune V8's flags the same way).
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The output directory is created before the timed loop, so no
// filesystem setup is interleaved with the diff work.
mkdirSync(OUTPUT_DIR, { recursive: true });

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
// Pre-allocated to the case count: the timed loop never grows the array,
// so no reallocation happens while the clock runs.
const answers: unknown[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) answers[i] = run(cases[i].input);
const outPath = join(OUTPUT_DIR, 'answers.json');
writeFileSync(outPath, JSON.stringify(answers));
chmodSync(outPath, 0o644);

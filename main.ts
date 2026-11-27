// The harness entrypoint: reads every case from /input/cases.json, answers
// each one with run() from solve.js, and writes /output/answers.json.
// Node 22 runs this TypeScript as it is. The input and output directories
// come from MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR outside a container.

import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Keep V8's incremental marking off for the whole run, before solve.js is
// loaded, so the diff work is never interrupted by marking steps.
setFlagsFromString('--no-incremental-marking');

/** solve.js next door, typed only by the contract its run() keeps. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(
  readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8'),
) as { id: string; input: unknown }[];

const answers: unknown[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) answers[i] = run(cases[i].input);

// Written straight to the answers file, no temporary file in between,
// and readable by the grader's collector afterwards.
const answersPath = join(OUTPUT_DIR, 'answers.json');
writeFileSync(answersPath, JSON.stringify(answers));
chmodSync(answersPath, 0o644);

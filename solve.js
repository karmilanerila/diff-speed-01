// Fast drop-in for makefun-diff 1.0.0: the same patch of two texts, computed
// with integer line ids and a flat Myers history instead of string compares
// and per-line objects. Written from the RULES.txt specification.
//
// A text is cut after every "\n"; a last line without "\n" is a line too.
// Lines are equal only as identical code units, newline included. The edit
// script keeps the common prefix, then the common suffix, and between them
// runs Myers's greedy search: on each diagonal the furthest point wins, a
// deletion wins a tie with an insertion, no move passes either text's end,
// and every run of equal lines is followed as far as it goes. The patch
// lists, per change run, its deletions before its insertions, shows up to
// 3 kept lines around each run, and merges runs at most 6 kept lines apart.

/** Split a text into lines, each keeping its trailing "\n" when it has one. */
function splitLines(text) {
  const lines = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl < 0) {
      if (start < text.length) lines.push(text.slice(start));
      break;
    }
    lines.push(text.slice(start, nl + 1));
    start = nl + 1;
  }
  return lines;
}

/**
 * Map every distinct line string to a small integer id, shared by both
 * texts, so the search compares integers instead of strings.
 */
function toIds(lines, ids, next) {
  const out = new Int32Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    let id = ids.get(s);
    if (id === undefined) {
      id = next.value;
      next.value = id + 1;
      ids.set(s, id);
    }
    out[i] = id;
  }
  return out;
}

/**
 * Myers's greedy search over the middle slices a[p..p+N), b[p..p+M).
 * Returns the edit distance D and the flat history of furthest-x values:
 * history[d*d + k + d] is the furthest old-line index reached on diagonal
 * k after d edits (and the snake that follows), or -1 when no path of d
 * edits reaches that diagonal at all.
 */
function myers(a, p, N, b, q, M) {
  let cap = 64;
  let hist = new Int32Array((cap + 1) * (cap + 1));
  let D = -1;
  outer: for (let d = 0; d <= N + M; d++) {
    if (d > cap) {
      const nextCap = cap * 2;
      const grown = new Int32Array((nextCap + 1) * (nextCap + 1));
      grown.set(hist);
      hist = grown;
      cap = nextCap;
    }
    const base = d * d;
    const prev = (d - 1) * (d - 1);
    // Row starts, so the inner loop indexes with one addition each:
    // hist[row + k] is this depth's V, hist[prow + kk] the previous depth's.
    const row = base + d;
    const prow = prev + d - 1;
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (d === 0) {
        x = 0;
      } else {
        let delX = -1;
        let insX = -1;
        if (k > -d) {
          const pv = hist[prow + k - 1];
          if (pv >= 0 && pv + 1 <= N) delX = pv + 1;
        }
        if (k < d) {
          const pv = hist[prow + k + 1];
          if (pv >= 0 && pv - (k + 1) + 1 <= M) insX = pv;
        }
        if (delX < 0 && insX < 0) {
          hist[row + k] = -1;
          continue;
        }
        // Deletion wins the tie: it reaches further into the old text.
        x = delX >= insX ? delX : insX;
      }
      let y = x - k;
      while (x < N && y < M && a[p + x] === b[q + y]) {
        x++;
        y++;
      }
      hist[row + k] = x;
      if (x >= N && y >= M) {
        D = d;
        break outer;
      }
    }
  }
  return { D, hist };
}

/**
 * Walk the history back from (N, M) and rebuild the middle edit script:
 * 0 keep, 1 delete, 2 insert. The array is filled from the end, so the
 * caller reads ops[oi .. N+M).
 */
function backtrack(hist, D, a, p, N, b, q, M) {
  const ops = new Uint8Array(N + M);
  let oi = N + M;
  let x = N;
  let y = M;
  for (let d = D; d > 0; d--) {
    const k = x - y;
    const prev = (d - 1) * (d - 1);
    const prow = prev + d - 1;
    let delX = -1;
    let insX = -1;
    if (k > -d) {
      const pv = hist[prow + k - 1];
      if (pv >= 0 && pv + 1 <= N) delX = pv + 1;
    }
    if (k < d) {
      const pv = hist[prow + k + 1];
      if (pv >= 0 && pv - (k + 1) + 1 <= M) insX = pv;
    }
    const isDel = delX >= insX;
    const prevK = isDel ? k - 1 : k + 1;
    const px = isDel ? delX : insX;
    // The snake from the post-edit point (px, py) to (x, y): all keeps.
    let keep = x - px;
    while (keep-- > 0) ops[--oi] = 0;
    ops[--oi] = isDel ? 1 : 2;
    x = hist[prow + prevK];
    y = x - prevK;
  }
  while (x > 0) {
    ops[--oi] = 0;
    x--;
    y--;
  }
  return { ops, oi };
}

/** One output line: the marker, the line, and a "%" line when bare. */
function emitLine(out, marker, line) {
  out.push(marker + line);
  if (!line.endsWith('\n')) {
    out.push('\n%\n');
  }
}

/**
 * Render the patch for the whole texts from the op list (0 keep, 1 delete,
 * 2 insert, aligned with the old/new line arrays).
 */
function render(oldLines, newLines, ops, total) {
  const nOld = oldLines.length;
  const nNew = newLines.length;
  // Find the change runs: [start, end) op ranges holding no keeps.
  const runs = [];
  let i = 0;
  let deleted = 0;
  let inserted = 0;
  while (i < total) {
    if (ops[i] === 0) {
      i++;
      continue;
    }
    const start = i;
    let d = 0;
    let ins = 0;
    while (i < total && ops[i] !== 0) {
      if (ops[i] === 1) d++;
      else ins++;
      i++;
    }
    runs.push({ start, end: i, del: d, ins });
    deleted += d;
    inserted += ins;
  }

  const out = [];
  if (runs.length === 0) {
    out.push(
      `makefun-diff/1 old=${nOld} new=${nNew} hunks=0 deleted=0 inserted=0\n`,
    );
    return out.join('');
  }

  // Group runs into hunks: runs at most 6 kept lines apart share one.
  const hunks = [];
  let group = [runs[0]];
  for (let r = 1; r < runs.length; r++) {
    const gap = runs[r].start - group[group.length - 1].end;
    if (gap <= 6) group.push(runs[r]);
    else {
      hunks.push(group);
      group = [runs[r]];
    }
  }
  hunks.push(group);

  out.push(
    `makefun-diff/1 old=${nOld} new=${nNew} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`,
  );

  // Op index -> old/new line index maps, built once per render.
  const oldAt = new Int32Array(total + 1);
  const newAt = new Int32Array(total + 1);
  let oi = 0;
  let ni = 0;
  for (let t = 0; t < total; t++) {
    oldAt[t] = oi;
    newAt[t] = ni;
    if (ops[t] !== 2) oi++;
    if (ops[t] !== 1) ni++;
  }
  oldAt[total] = oi;
  newAt[total] = ni;

  for (const g of hunks) {
    const first = g[0];
    const last = g[g.length - 1];
    const hStart = Math.max(0, first.start - 3);
    const hEnd = Math.min(total, last.end + 3);
    const os = oldAt[hStart] + 1;
    const ol = oldAt[hEnd] - oldAt[hStart];
    const ns = newAt[hStart] + 1;
    const nl = newAt[hEnd] - newAt[hStart];
    out.push(`@ ${os} ${ol} ${ns} ${nl}\n`);
    let t = hStart;
    while (t < hEnd) {
      if (ops[t] === 0) {
        emitLine(out, '=', oldLines[oldAt[t]]);
        t++;
        continue;
      }
      // A change run: all of its deletions, then all of its insertions.
      let u = t;
      while (u < hEnd && ops[u] !== 0) u++;
      for (let v = t; v < u; v++) {
        if (ops[v] === 1) emitLine(out, '-', oldLines[oldAt[v]]);
      }
      for (let v = t; v < u; v++) {
        if (ops[v] === 2) emitLine(out, '+', newLines[newAt[v]]);
      }
      t = u;
    }
  }
  return out.join('');
}

/** makefun-diff 1.0.0's answer for one case's input { old, new }. */
export function run(input) {
  const oldLines = splitLines(input.old);
  const newLines = splitLines(input.new);
  const ids = new Map();
  const next = { value: 0 };
  const a = toIds(oldLines, ids, next);
  const b = toIds(newLines, ids, next);
  const nA = a.length;
  const nB = b.length;

  let p = 0;
  while (p < nA && p < nB && a[p] === b[p]) p++;
  let sA = nA;
  let sB = nB;
  while (sA > p && sB > p && a[sA - 1] === b[sB - 1]) {
    sA--;
    sB--;
  }
  const N = sA - p;
  const M = sB - p;

  const { D, hist } = myers(a, p, N, b, p, M);
  const { ops, oi } = backtrack(hist, D, a, p, N, b, p, M);

  const full = new Uint8Array(nA + nB);
  let fi = 0;
  for (let t = 0; t < p; t++) full[fi++] = 0;
  for (let t = oi; t < N + M; t++) full[fi++] = ops[t];
  for (let t = 0; t < nA - sA; t++) full[fi++] = 0;
  return render(oldLines, newLines, full, fi);
}

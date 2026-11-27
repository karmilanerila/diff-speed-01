// diff-speed-01 v2: a faster drop-in for makefun-diff 1.0.0.
//
// The task (RULES.txt): for each case's { old, new }, return exactly the
// patch makefun-diff 1.0.0 returns. Lines are cut after every '\n'; a last
// line with no '\n' is a line too; two lines are equal only when they are
// the same code units, newline or its absence included. The edit script is
// Myers's greedy search (common prefix, then common suffix, then the greedy
// search from the first lines; on each diagonal the path reaching furthest
// into the old text; a deletion wins when it ties an insertion; never past
// either text's end; no edge diagonal pruned; every run of equal lines
// followed as far as it goes; the first path to reach both ends wins).
// The patch: a header line, then hunks with 3 lines of context, runs
// merged at most 6 kept lines apart, deletions before insertions in a run,
// '%' after a bare last line; identical texts are the header alone.
//
// Speed angle (the algorithm is fixed by the spec, so the win is in the
// constants of the search loop, which is ~80% of the runtime):
// - The search loop works on integer line ids, not strings.
// - The V history is one row-major Int32Array: row d starts at d*(d+1)/2,
//   so the two candidates for diagonal k at level d are the previous
//   row's entries j-1 and j, a plain counted loop with no index arithmetic
//   per step. The history doubles as the backtrack record: no second pass.
// - The interior of each row is unrolled two diagonals at a time, so the
//   middle V value is loaded once for both.
// - Both id arrays carry a sentinel past their end (-1 for old, -2 for
//   new, two values that can never be a real line id), so the snake loop
//   needs no bounds checks at all.
// - Line ids come from one shared Map keyed by the line's text without its
//   newline (only a bare last line needs a distinguishing suffix), built
//   from the native split('\n') instead of a hand-rolled scan.

const H_MAX_D = 12000;

// The V history, reused across cases and grown by doubling rows. Row d
// holds d+1 entries (diagonals k = -d, -d+2, ..., d) at offset d*(d+1)/2.
let hist = new Int32Array(0);
let histCapD = 0;

function ensureHist(d) {
  if (d <= histCapD) return;
  let nd = histCapD === 0 ? 1024 : histCapD * 2;
  while (nd < d) nd *= 2;
  if (nd > H_MAX_D) throw new Error('diff-speed-01: edit distance exceeds supported bound');
  const next = new Int32Array(((nd + 1) * (nd + 2)) / 2);
  next.set(hist.subarray(0, ((histCapD + 1) * (histCapD + 2)) / 2));
  hist = next;
  histCapD = nd;
}

// Split a text into lines and map every line to an integer id shared with
// the other text. Returns the parts (without newlines), the id array (one
// past-the-end sentinel slot included), the line count, and whether the
// text ends with a bare last line.
function lineIds(text, map, nextId, sentinel) {
  const parts = text.split('\n');
  const n = text === '' ? 0 : (text.endsWith('\n') ? parts.length - 1 : parts.length);
  const bare = n > 0 && !text.endsWith('\n');
  const ids = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const key = (bare && i === n - 1) ? parts[i] + '\n' : parts[i];
    let id = map.get(key);
    if (id === undefined) {
      id = nextId.value++;
      map.set(key, id);
    }
    ids[i] = id;
  }
  ids[n] = sentinel;
  return { parts, ids, n, bare };
}

// The greedy search on the middle (after prefix/suffix strip). a and b are
// the middle id arrays with their sentinels already placed just past the
// middle; N and M are the middle lengths. Returns D, the edit distance,
// and leaves every V row in `hist` for the backtrack.
function myers(a, b, N, M) {
  const max = N + M;
  // Level 0: the snake from (0, 0). The sentinel pair (-1 vs -2) stops it
  // exactly at the end of either text.
  let x = 0;
  let y = 0;
  while (a[x] === b[y]) {
    x++;
    y++;
  }
  ensureHist(1);
  hist[0] = x;
  if (x === N && y === M) return 0;
  let oPrev = 0;
  let oCur = 1;
  for (let d = 1; d <= max; d++) {
    ensureHist(d);
    // j = 0, k = -d: insertion only.
    let xx = hist[oPrev];
    if (xx > N) xx = N;
    let yy = xx + d;
    if (yy > M) {
      yy = M;
      xx = yy - d;
    }
    while (a[xx] === b[yy]) {
      xx++;
      yy++;
    }
    hist[oCur] = xx;
    if (xx === N && yy === M) return d;
    // Interior diagonals, two at a time. For j, the candidates are the
    // previous row's j-1 (deletion, x = v+1) and j (insertion, x = v); a
    // deletion wins the tie, so the insertion is taken only when its
    // reach is strictly greater than the deletion's.
    let j = 1;
    for (; j + 1 <= d - 1; j += 2) {
      const v0 = hist[oPrev + j - 1];
      const v1 = hist[oPrev + j];
      const v2 = hist[oPrev + j + 1];
      const k1 = 2 * j - d;
      let x1 = (v0 + 1 < v1) ? v1 : v0 + 1;
      if (x1 > N) x1 = N;
      let y1 = x1 - k1;
      if (y1 > M) {
        y1 = M;
        x1 = y1 + k1;
      }
      while (a[x1] === b[y1]) {
        x1++;
        y1++;
      }
      hist[oCur + j] = x1;
      if (x1 === N && y1 === M) return d;
      let x2 = (v1 + 1 < v2) ? v2 : v1 + 1;
      if (x2 > N) x2 = N;
      let y2 = x2 - k1 - 2;
      if (y2 > M) {
        y2 = M;
        x2 = y2 + k1 + 2;
      }
      while (a[x2] === b[y2]) {
        x2++;
        y2++;
      }
      hist[oCur + j + 1] = x2;
      if (x2 === N && y2 === M) return d;
    }
    // One leftover interior diagonal when d is even.
    for (; j <= d - 1; j++) {
      const k = 2 * j - d;
      let xt = (hist[oPrev + j - 1] + 1 < hist[oPrev + j]) ? hist[oPrev + j] : hist[oPrev + j - 1] + 1;
      if (xt > N) xt = N;
      let yt = xt - k;
      if (yt > M) {
        yt = M;
        xt = yt + k;
      }
      while (a[xt] === b[yt]) {
        xt++;
        yt++;
      }
      hist[oCur + j] = xt;
      if (xt === N && yt === M) return d;
    }
    // j = d, k = d: deletion only.
    let xd = hist[oPrev + d - 1] + 1;
    if (xd > N) xd = N;
    let yd = xd - d;
    if (yd > M) {
      yd = M;
      xd = yd + d;
    }
    while (a[xd] === b[yd]) {
      xd++;
      yd++;
    }
    hist[oCur + d] = xd;
    if (xd === N && yd === M) return d;
    oPrev = oCur;
    oCur += d + 1;
  }
  return -1;
}

// Op types for the backtracked script.
const KEEP = 0;
const DEL = 1;
const INS = 2;
// A merged DEL/INS run in the render (never produced by the backtrack).
const CHANGE = 3;

// Walk the search back from (N, M) and return the middle's op segments,
// forward order, as [type, count] pairs with adjacent equal types merged.
// The V rows in `hist` say, for each level, which diagonal the path came
// from; the snake between the edit step and the row's end is all keeps,
// counted arithmetically, never re-compared.
function backtrack(N, M, D) {
  const segs = [];
  const push = (type, count) => {
    if (count <= 0) return;
    const last = segs[segs.length - 1];
    if (last !== undefined && last[0] === type) last[1] += count;
    else segs.push([type, count]);
  };
  let x = N;
  let y = M;
  let k = N - M;
  for (let d = D; d >= 1; d--) {
    const oPrev = ((d - 1) * d) / 2;
    const j = (k + d) / 2;
    let kPrev;
    let xPrev;
    let isDel;
    if (j === 0) {
      kPrev = k + 1;
      xPrev = hist[oPrev];
      isDel = false;
    } else if (j === d) {
      kPrev = k - 1;
      xPrev = hist[oPrev + d - 1];
      isDel = true;
    } else if (hist[oPrev + j - 1] + 1 < hist[oPrev + j]) {
      kPrev = k + 1;
      xPrev = hist[oPrev + j];
      isDel = false;
    } else {
      kPrev = k - 1;
      xPrev = hist[oPrev + j - 1];
      isDel = true;
    }
    const yPrev = xPrev - kPrev;
    // The snake at this level ran from just past the edit step to (x, y).
    const xs = isDel ? xPrev + 1 : xPrev;
    push(KEEP, x - xs);
    push(isDel ? DEL : INS, 1);
    x = xPrev;
    y = yPrev;
    k = kPrev;
  }
  // The level-0 snake from (0, 0).
  push(KEEP, x);
  segs.reverse();
  return segs;
}

export function run(input) {
  const oldText = input.old;
  const newText = input.new;
  const map = new Map();
  const nextId = { value: 0 };
  const o = lineIds(oldText, map, nextId, -1);
  const w = lineIds(newText, map, nextId, -2);
  const aAll = o.ids;
  const bAll = w.ids;
  const nOld = o.n;
  const nNew = w.n;

  // Common prefix, then common suffix, on ids.
  let pre = 0;
  while (pre < nOld && pre < nNew && aAll[pre] === bAll[pre]) pre++;
  let suf = 0;
  while (suf < nOld - pre && suf < nNew - pre && aAll[nOld - 1 - suf] === bAll[nNew - 1 - suf]) suf++;
  const N = nOld - pre - suf;
  const M = nNew - pre - suf;
  // Sentinels just past the middle: the middle's own end, so the snake
  // can never run into the suffix. (The suffix ids are never read again.)
  aAll[pre + N] = -1;
  bAll[pre + M] = -2;
  const a = aAll.subarray(pre, pre + N + 1);
  const b = bAll.subarray(pre, pre + M + 1);

  const D = myers(a, b, N, M);
  const mid = backtrack(N, M, D);

  // Full op segments: kept prefix, the middle's script, kept suffix.
  const segs = [];
  const pushSeg = (type, count) => {
    if (count <= 0) return;
    const last = segs[segs.length - 1];
    if (last !== undefined && last[0] === type) last[1] += count;
    else segs.push([type, count]);
  };
  pushSeg(KEEP, pre);
  for (const s of mid) pushSeg(s[0], s[1]);
  pushSeg(KEEP, suf);

  // Annotate every segment with the line spans it covers, then merge each
  // maximal DEL/INS run into one CHANGE segment. A run's deletions are
  // rendered before its insertions (the path's own order may interleave
  // them), so the render reads del/ins off the CHANGE, never the path order.
  const rich = [];
  {
    let oi = 0;
    let ni = 0;
    for (const s of segs) {
      if (s[0] === KEEP) {
        rich.push({ t: KEEP, n: s[1], oStart: oi, nStart: ni });
        oi += s[1];
        ni += s[1];
      } else if (s[0] === DEL) {
        rich.push({ t: DEL, n: s[1], oStart: oi, nStart: ni });
        oi += s[1];
      } else {
        rich.push({ t: INS, n: s[1], oStart: oi, nStart: ni });
        ni += s[1];
      }
    }
  }
  const merged = [];
  let deleted = 0;
  let inserted = 0;
  for (const r of rich) {
    if (r.t === KEEP) {
      merged.push(r);
      continue;
    }
    const last = merged[merged.length - 1];
    if (last !== undefined && last.t === CHANGE) {
      if (r.t === DEL) last.del += r.n;
      else last.ins += r.n;
    } else {
      merged.push({ t: CHANGE, del: r.t === DEL ? r.n : 0, ins: r.t === INS ? r.n : 0, oStart: r.oStart, nStart: r.nStart });
    }
    if (r.t === DEL) deleted += r.n;
    else inserted += r.n;
  }

  // Hunk spans. A run is one CHANGE segment; two runs at most 6 kept lines
  // apart share a hunk. oEnd/nEnd are the ends of the last CHANGE only:
  // the kept gap between runs is inside the hunk span by position, never
  // by extending the run's end across it.
  const spans = [];
  let run = null;
  for (const r of merged) {
    if (r.t === KEEP) {
      if (run !== null) run.gap += r.n;
    } else {
      const oEnd = r.oStart + r.del;
      const nEnd = r.nStart + r.ins;
      if (run === null || run.gap > 6) {
        if (run !== null) spans.push(run);
        run = { oStart: r.oStart, nStart: r.nStart, oEnd, nEnd, gap: 0 };
      } else {
        run.oEnd = oEnd;
        run.nEnd = nEnd;
        run.gap = 0;
      }
    }
  }
  if (run !== null) spans.push(run);
  const hSpans = spans.map((h) => ({
    oStart: Math.max(0, h.oStart - 3),
    nStart: Math.max(0, h.nStart - 3),
    oEnd: Math.min(nOld, h.oEnd + 3),
    nEnd: Math.min(nNew, h.nEnd + 3),
  }));

  // Single pass over the segments, emitting only the lines inside a hunk
  // span. Hunk spans are disjoint and ordered, so one cursor suffices.
  const out = [];
  out.push(`makefun-diff/1 old=${nOld} new=${nNew} hunks=${spans.length} deleted=${deleted} inserted=${inserted}\n`);
  let hIdx = 0;
  let headerDone = false;
  const pastHunk = (isOld, idx) => {
    const h = hSpans[hIdx];
    return h !== undefined && (isOld ? idx >= h.oEnd : idx >= h.nEnd);
  };
  const inHunk = (isOld, idx) => {
    const h = hSpans[hIdx];
    return h !== undefined && (isOld ? idx >= h.oStart && idx < h.oEnd : idx >= h.nStart && idx < h.nEnd);
  };
  const ensureHeader = () => {
    if (!headerDone) {
      const h = hSpans[hIdx];
      out.push(`@ ${h.oStart + 1} ${h.oEnd - h.oStart} ${h.nStart + 1} ${h.nEnd - h.nStart}\n`);
      headerDone = true;
    }
  };
  for (const r of merged) {
    if (r.t === KEEP) {
      for (let t = 0; t < r.n; t++) {
        const idx = r.oStart + t;
        while (pastHunk(true, idx)) {
          hIdx++;
          headerDone = false;
        }
        if (inHunk(true, idx)) {
          ensureHeader();
          out.push('=', o.parts[idx], '\n');
          if (o.bare && idx === nOld - 1) out.push('%\n');
        }
      }
    } else if (r.t === CHANGE) {
      for (let t = 0; t < r.del; t++) {
        const idx = r.oStart + t;
        while (pastHunk(true, idx)) {
          hIdx++;
          headerDone = false;
        }
        if (inHunk(true, idx)) {
          ensureHeader();
          out.push('-', o.parts[idx], '\n');
          if (o.bare && idx === nOld - 1) out.push('%\n');
        }
      }
      for (let t = 0; t < r.ins; t++) {
        const idx = r.nStart + t;
        while (pastHunk(false, idx)) {
          hIdx++;
          headerDone = false;
        }
        if (inHunk(false, idx)) {
          ensureHeader();
          out.push('+', w.parts[idx], '\n');
          if (w.bare && idx === nNew - 1) out.push('%\n');
        }
      }
    }
  }
  return out.join('');
}

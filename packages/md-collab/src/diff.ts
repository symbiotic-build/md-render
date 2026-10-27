// The word diff that shows how an annotated block changed. The sequence diff is copied from the
// operator's prompt-scope, `src/diff.ts` (`diffLines` and `myers`), and applied to words.

/** One diff operation: `=` equal, `-` only in A, `+` only in B. Indices are 0-based. */
type DiffOp = ['=', number, number] | ['-', number, null] | ['+', null, number];

/** Myers O(ND) diff over two arrays, comparing items by exact string equality. */
function diffSequences(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // Trim the common prefix and suffix first.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const ops: DiffOp[] = [];
  for (let index = 0; index < prefix; index++) ops.push(['=', index, index]);
  const middle = myers(a.slice(prefix, n - suffix), b.slice(prefix, m - suffix));
  for (const op of middle) {
    if (op[0] === '=') ops.push(['=', op[1] + prefix, op[2] + prefix]);
    else if (op[0] === '-') ops.push(['-', op[1] + prefix, null]);
    else ops.push(['+', null, op[2] + prefix]);
  }
  for (let index = 0; index < suffix; index++) ops.push(['=', n - suffix + index, m - suffix + index]);
  return ops;
}

function myers(left: string[], right: string[]): DiffOp[] {
  // Intern items as integers so the inner loop compares numbers.
  const ids = new Map<string, number>();
  const intern = (item: string): number => { let id = ids.get(item); if (id === undefined) { id = ids.size; ids.set(item, id); } return id; };
  const a = Int32Array.from(left, intern);
  const b = Int32Array.from(right, intern);
  const n = a.length;
  const m = b.length;
  if (n === 0) return right.map((_, index) => ['+', null, index] as DiffOp);
  if (m === 0) return left.map((_, index) => ['-', index, null] as DiffOp);
  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  // trace[d] keeps only diagonals -d..d, so memory grows with D squared, not D times (N + M).
  const trace: Int32Array[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) x = v[offset + k + 1]!;
      else x = v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const snapshot = trace[d]!;
    const at = (k: number): number => snapshot[k + d]!;
    const k = x - y;
    const previousK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) { x--; y--; ops.push(['=', x, y]); }
    if (x === previousX) { y--; ops.push(['+', null, y]); } else { x--; ops.push(['-', x, null]); }
  }
  while (x > 0 && y > 0) { x--; y--; ops.push(['=', x, y]); }
  ops.reverse();
  return ops;
}

/** One run of words: kept, only in the old text, or only in the new text. */
export interface WordChange { change: '=' | '-' | '+'; text: string }

/** The word-level difference from `before` to `after`, as runs of words joined by single spaces. */
export function diffWords(before: string, after: string): WordChange[] {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const runs: WordChange[] = [];
  for (const op of diffSequences(a, b)) {
    const change = op[0];
    const word = change === '+' ? b[op[2]]! : a[op[1]!]!;
    const last = runs.at(-1);
    if (last?.change === change) last.text += ' ' + word;
    else runs.push({ change, text: word });
  }
  return runs;
}

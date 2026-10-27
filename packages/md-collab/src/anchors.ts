// An anchor names one block of a snapshot of its document. At render time it follows that block
// through a block diff of the snapshot against the document now, as git carries review comments
// across versions: the same block, the block as updated since, or removed.
import type { Block, SiteView } from 'md-render';
import { diffArrays, diffWords } from 'diff';
import type { FileStore } from './store.js';
import type { Anchor } from './thread.js';
import { snapshotOf, type SnapshotBlock } from './versions.js';

export type AnchorState = 'same' | 'updated' | 'removed';

export interface ResolvedAnchor {
  anchor: Anchor;
  state: AnchorState;
  /** The block the anchor names now: the same block, or its updated version; null when removed. */
  block: Block | null;
  /** The block as the anchor's snapshot holds it; null when the snapshot cannot be read. */
  before: SnapshotBlock | null;
  /** Why the anchor shows as removed when its snapshot cannot be read. */
  problem: string | null;
}

type Carried = Pick<ResolvedAnchor, 'state' | 'block'> & { before: SnapshotBlock };

function documentBlocks(view: SiteView, path: string): readonly Block[] {
  return view.documents.find(document => document.path === path)?.blocks ?? [];
}

/**
 * Where each block of a snapshot is now, by jsdiff's array diff of the block texts. An equal block
 * is the same block. In a hunk, the removed blocks pair in order with the added blocks: each pair is
 * a block updated. A removed block left without a partner is removed; an added block without one
 * pairs with nothing.
 */
export function carryBlocks(before: readonly SnapshotBlock[], now: readonly Block[]): Map<string, Carried> {
  const carried = new Map<string, Carried>();
  let old = 0;
  let current = 0;
  let removed: SnapshotBlock[] = [];
  let added: Block[] = [];
  const endHunk = () => {
    removed.forEach((block, n) => carried.set(block.id, n < added.length ? { state: 'updated', block: added[n]!, before: block } : { state: 'removed', block: null, before: block }));
    removed = [];
    added = [];
  };
  for (const change of diffArrays(before.map(block => block.text), now.map(block => block.text))) {
    if (change.removed) removed.push(...before.slice(old, old += change.count));
    else if (change.added) added.push(...now.slice(current, current += change.count));
    else {
      endHunk();
      for (let n = 0; n < change.count; n++) {
        const block = before[old++]!;
        carried.set(block.id, { state: 'same', block: now[current++]!, before: block });
      }
    }
  }
  endHunk();
  return carried;
}

/** One run of an updated block's text: kept, only in the old text, or only in the new text. */
export interface WordChange { change: '=' | '-' | '+'; text: string }

/**
 * The word-level difference from `before` to `after`, by jsdiff's word diff. The spaces around a
 * changed run count as kept, so a run shows only the words that changed.
 */
export function wordChanges(before: string, after: string): WordChange[] {
  const runs: WordChange[] = [];
  const push = (change: WordChange['change'], text: string) => {
    const last = runs.at(-1);
    if (!text) return;
    if (last?.change === change) last.text += text;
    else runs.push({ change, text });
  };
  for (const part of diffWords(before, after)) {
    const change = part.added ? '+' : part.removed ? '-' : '=';
    const [, lead, words, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(part.value)!;
    push('=', lead!);
    push(change, words!);
    push('=', trail!);
  }
  return runs;
}

type Carry = Map<string, Carried>;

// One diff per snapshot per render: the view is the render's, and a snapshot never changes.
const carries = new WeakMap<SiteView, Map<string, Promise<Carry>>>();

/** Resolves anchors against one render; a snapshot that cannot be read makes its anchors removed. */
export async function resolveAnchor(anchor: Anchor, view: SiteView, store: FileStore, collection: string): Promise<ResolvedAnchor> {
  const byKey = carries.get(view) ?? new Map<string, Promise<Carry>>();
  carries.set(view, byKey);
  const key = `${store.root}\n${collection}\n${anchor.path}\n${anchor.snapshot}`;
  let carry = byKey.get(key);
  if (!carry) {
    carry = store.snapshot(collection, anchor.path, anchor.snapshot).then(blocks => carryBlocks(blocks, documentBlocks(view, anchor.path)));
    byKey.set(key, carry);
    // A snapshot restored later resolves at the next state request.
    carry.catch(() => byKey.delete(key));
  }
  let found: Carry;
  try { found = await carry; }
  catch (error) { return { anchor, state: 'removed', block: null, before: null, problem: (error as Error).message }; }
  const carried = found.get(anchor.block);
  if (!carried) return { anchor, state: 'removed', block: null, before: null, problem: `The snapshot of ${anchor.path} this passage was written on has no block ${anchor.block}` };
  return { anchor, ...carried, problem: null };
}

/** The anchor for one rendered block: its document, its ID and the hash of its document's snapshot. */
export function blockAnchor(view: SiteView, path: string, block: Block, role: Anchor['role']): Anchor {
  return { role, path, block: block.id, snapshot: snapshotOf(view, path).hash };
}

/**
 * Innermost touched blocks in document order. Blocks arrive in pre-order, with descendants
 * following their parent contiguously inside its source lines. A containing block gives way
 * when the next touched block is within it, even when the parent has text of its own.
 */
export function citedBlocks(touched: readonly Block[]): Block[] {
  return touched.filter((block, index) => {
    const next = touched[index + 1];
    return !next || next.lines[0] < block.lines[0] || next.lines[1] > block.lines[1];
  });
}

/** One anchor per cited block, in document order: the first takes `role`, the others are `also`. */
export function blockAnchors(view: SiteView, path: string, touched: readonly Block[], role: Anchor['role']): Anchor[] {
  return citedBlocks(touched).map((block, index) => blockAnchor(view, path, block, index ? 'also' : role));
}

/**
 * The anchors for a citation's source lines, which only an imported question list carries: one per
 * innermost block that the lines intersect, see citedBlocks. Lines that cover no rendered block are refused.
 */
export function anchorsAt(view: SiteView, path: string, lines: [number, number], role: Anchor['role']): Anchor[] {
  if (!view.documents.some(document => document.path === path)) throw new Error(`${path} is not a rendered document`);
  const anchors = blockAnchors(view, path, documentBlocks(view, path).filter(block => block.lines[0] <= lines[1] && block.lines[1] >= lines[0]), role);
  if (!anchors.length) throw new Error(`${path}:${lines[0]}-${lines[1]} covers no rendered text`);
  return anchors;
}

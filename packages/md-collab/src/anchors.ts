// Anchors point at text for one commit; at load they are found again by block ID, then quote, then lines.
import type { Block, SiteView } from 'md-render';
import type { Anchor } from './thread.js';

export type AnchorMethod = 'block' | 'quote' | 'lines' | 'orphan';

export interface ResolvedAnchor {
  anchor: Anchor;
  method: AnchorMethod;
  /** The blocks the anchor covers now, in source order; empty when orphaned. */
  blocks: Pick<Block, 'path' | 'id' | 'lines'>[];
}

const normalise = (text: string): string => text.replace(/\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();

function documentBlocks(view: SiteView, path: string): readonly Block[] {
  return view.documents.find(document => document.path === path)?.blocks ?? [];
}
function covering(blocks: readonly Block[], first: number, last: number): Block[] {
  return blocks.filter(block => block.lines[0] <= last && block.lines[1] >= first);
}
/** The blocks from `start` that span as many lines as the anchor did; saved lines start at their first block. */
function span(blocks: readonly Block[], start: Block, anchor: Anchor): Block[] {
  return covering(blocks, start.lines[0], start.lines[0] + (anchor.lines[1] - anchor.lines[0]));
}
const pick = (blocks: Block[]) => blocks.map(({ path, id, lines }) => ({ path, id, lines }));

/** Finds the anchor in the current documents; `commit` is the documents' current commit, if known. */
export function resolveAnchor(anchor: Anchor, view: SiteView, commit: string | null): ResolvedAnchor {
  const blocks = documentBlocks(view, anchor.path);
  if (anchor.block) {
    const start = blocks.find(block => block.id === anchor.block);
    if (start) return { anchor, method: 'block', blocks: pick(span(blocks, start, anchor)) };
  }
  if (anchor.quote) {
    const quote = normalise(anchor.quote);
    const matches = blocks.filter(block => normalise(block.text).includes(quote));
    if (matches.length) {
      const nearest = matches.reduce((best, block) => Math.abs(block.lines[0] - anchor.lines[0]) < Math.abs(best.lines[0] - anchor.lines[0]) ? block : best);
      return { anchor, method: 'quote', blocks: pick(span(blocks, nearest, anchor)) };
    }
  }
  if (commit && sameCommit(anchor.commit, commit)) {
    const found = covering(blocks, anchor.lines[0], anchor.lines[1]);
    if (found.length) return { anchor, method: 'lines', blocks: pick(found) };
  }
  return { anchor, method: 'orphan', blocks: [] };
}

/** Abbreviated and full commit hashes name the same commit when one is a prefix of the other. */
export function sameCommit(a: string, b: string): boolean {
  return a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a));
}

/**
 * Makes an anchor for source lines in the current documents: block ID and quote come from the
 * first rendered block with text that the lines cover, and the saved lines run from that block's first line to
 * the last covered block's last line, so resolution by block or quote covers the same blocks.
 * Lines that cover no rendered block are refused.
 */
export function anchorAt(view: SiteView, path: string, lines: [number, number], commit: string, role: Anchor['role']): Anchor {
  if (!view.documents.some(document => document.path === path)) throw new Error(`${path} is not a rendered document`);
  const found = covering(documentBlocks(view, path), lines[0], lines[1]);
  const first = found.find(block => block.text) ?? found[0];
  if (!first) throw new Error(`${path}:${lines[0]}-${lines[1]} covers no rendered text`);
  return { role, path, commit, lines: [first.lines[0], found.at(-1)!.lines[1]], block: first.id, quote: first.text.slice(0, 80) };
}

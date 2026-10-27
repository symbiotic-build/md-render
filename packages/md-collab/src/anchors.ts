// An anchor names one rendered block and keeps its text from when it was written. At load it is
// the same block, the block as updated since, or removed (operator decision of 2026-10-27).
import type { Block, SiteView } from 'md-render';
import type { Anchor } from './thread.js';

export type AnchorState = 'same' | 'updated' | 'removed';

export interface ResolvedAnchor {
  anchor: Anchor;
  state: AnchorState;
  /** The block the anchor names now: the same block, or its updated version; null when removed. */
  block: Block | null;
}

/** A block's section: the section ID its block ID starts with, `top` before the first heading. */
const sectionOf = (block: Block): string => block.heading ?? 'top';

function documentBlocks(view: SiteView, path: string): readonly Block[] {
  return view.documents.find(document => document.path === path)?.blocks ?? [];
}

/**
 * Finds the anchor's block in the current documents. The block with the anchor's ID is the same
 * block, since the ID ends in a hash of its text. Otherwise the block of the same tag at the same
 * position in the same section is that block updated. Otherwise the block is removed.
 */
export function resolveAnchor(anchor: Anchor, view: SiteView): ResolvedAnchor {
  const blocks = documentBlocks(view, anchor.path);
  const same = blocks.find(block => block.id === anchor.block);
  if (same) return { anchor, state: 'same', block: same };
  const section = anchor.block.slice(0, anchor.block.lastIndexOf('~'));
  const updated = blocks.filter(block => sectionOf(block) === section)[anchor.position - 1];
  if (updated?.tag === anchor.tag) return { anchor, state: 'updated', block: updated };
  return { anchor, state: 'removed', block: null };
}

/** The anchor for one rendered block: its ID, tag, position in its section from 1, and text. */
export function blockAnchor(view: SiteView, path: string, block: Block, role: Anchor['role']): Anchor {
  const position = documentBlocks(view, path).filter(other => sectionOf(other) === sectionOf(block)).indexOf(block) + 1;
  return { role, path, block: block.id, tag: block.tag, position, text: block.text };
}

/**
 * The anchor for a citation's source lines, which only an imported question list carries: the
 * first rendered block with text that the lines cover. Lines that cover no rendered block are refused.
 */
export function anchorAt(view: SiteView, path: string, lines: [number, number], role: Anchor['role']): Anchor {
  if (!view.documents.some(document => document.path === path)) throw new Error(`${path} is not a rendered document`);
  const found = documentBlocks(view, path).filter(block => block.lines[0] <= lines[1] && block.lines[1] >= lines[0]);
  const first = found.find(block => block.text) ?? found[0];
  if (!first) throw new Error(`${path}:${lines[0]}-${lines[1]} covers no rendered text`);
  return blockAnchor(view, path, first, role);
}

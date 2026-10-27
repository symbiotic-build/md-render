// A snapshot is a write-once copy of one document's rendered blocks, as an anchor was written on
// them: <store>/<collection>/versions/<path>~<sha256>.json. Anchors follow their blocks across
// versions with a block diff, as git carries review comments across commits.
import { createHash } from 'node:crypto';
import type { SiteView } from 'md-render';

/** One block as a snapshot keeps it. */
export interface SnapshotBlock { id: string; tag: string; text: string }

/** A snapshot ready to store: its document, the SHA-256 of its file content, and that content. */
export interface Snapshot { path: string; hash: string; content: string }

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const snapshotHash = /^[0-9a-f]{64}$/;

/**
 * The snapshot's file name: the document's corpus path, percent-encoded as a URL component so that
 * `/` becomes `%2F`, then `~` and the hash. `docs/storage.md` gives `docs%2Fstorage.md~<hash>.json`.
 */
export function snapshotFile(documentPath: string, hash: string): string {
  return `${encodeURIComponent(documentPath)}~${hash}.json`;
}

const cache = new WeakMap<SiteView, Map<string, Snapshot>>();

/** The snapshot of one rendered document, computed once per view. */
export function snapshotOf(view: SiteView, documentPath: string): Snapshot {
  let snapshots = cache.get(view);
  if (!snapshots) cache.set(view, snapshots = new Map());
  let snapshot = snapshots.get(documentPath);
  if (!snapshot) {
    const document = view.documents.find(item => item.path === documentPath);
    if (!document) throw new Error(`${documentPath} is not a rendered document`);
    const blocks: SnapshotBlock[] = document.blocks.map(({ id, tag, text }) => ({ id, tag, text }));
    const content = JSON.stringify(blocks, null, 2) + '\n';
    snapshot = { path: documentPath, hash: sha256(content), content };
    snapshots.set(documentPath, snapshot);
  }
  return snapshot;
}

/** The snapshots of the documents `paths` name, one per document. */
export function snapshotsOf(view: SiteView, paths: Iterable<string>): Snapshot[] {
  return [...new Set(paths)].map(item => snapshotOf(view, item));
}

/** Reads a snapshot file's content; refuses content that does not hash to its name or is not a block list. */
export function parseSnapshot(content: string, hash: string): SnapshotBlock[] {
  if (sha256(content) !== hash) throw new Error('its content does not match its hash');
  const blocks = JSON.parse(content) as unknown;
  if (!Array.isArray(blocks) || blocks.some(block => !block || typeof block.id !== 'string' || typeof block.tag !== 'string' || typeof block.text !== 'string')) {
    throw new Error('it is not a list of blocks with id, tag and text');
  }
  return blocks as SnapshotBlock[];
}

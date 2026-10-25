// The page's view of one collection: threads with resolved anchors and rendered text, plus settled decisions.
import { documentHtml, parseDocument, type SiteView } from 'md-render';
import { resolveAnchor, type AnchorMethod } from './anchors.js';
import { readSettled, type SettledDecision } from './settled.js';
import type { Collection, FileStore } from './store.js';
import { threadStatus, type Decider, type Entry, type Status, type ThreadKind } from './thread.js';

export interface PageAnchor {
  role: 'main' | 'also';
  path: string;
  label: string;
  method: AnchorMethod;
  blocks: string[];
}
export interface PageThread {
  id: string;
  kind: ThreadKind;
  title: string;
  decides: Decider[];
  number: number | null;
  priority: string | null;
  topic: string | null;
  status: Status;
  contextHtml: string;
  options: { n: number; html: string; recommended: boolean }[];
  anchors: PageAnchor[];
  entries: Entry[];
  settledAs: string | null;
  version: string;
}
export interface PageSettled {
  /** The chapter's corpus path and the decision's anchor, `path#anchor`: anchors repeat across chapters. */
  id: string;
  title: string;
  topic: string | null;
  date: string | null;
  decidedBy: Decider[];
  /** The decision's fields as plain text, which the page shows as text. */
  choice: string;
  authority: string;
  reason: string;
  rejected: string;
  anchors: PageAnchor[];
}
export interface PageState {
  collection: { name: string; title: string };
  commit: string | null;
  person: string;
  threads: PageThread[];
  settled: PageSettled[];
  orphans: { thread: string; path: string; lines: [number, number] }[];
}

/** Markdown from threads and decisions, through md-render's sanitizer; raw HTML stays escaped. */
export async function markdownHtml(markdown: string): Promise<string> {
  if (!markdown.trim()) return '';
  return documentHtml(parseDocument(markdown, ''));
}
async function inlineHtml(markdown: string): Promise<string> {
  return (await markdownHtml(markdown)).replace(/^<p>([\s\S]*)<\/p>$/, '$1');
}

/** The decisions of every settled chapter the collection names, from the text the view was rendered from. */
export function settledDecisions(collection: Collection, view: SiteView): SettledDecision[] {
  return collection.settled.flatMap(file => {
    const document = view.documents.find(item => item.path === file);
    if (!document) throw new Error(`Collection ${collection.name}: settled chapter ${file} is not a rendered document`);
    return readSettled(document);
  });
}

/** The page's state: the store's threads now, and the settled decisions of the rendered documents. */
export async function pageState(options: {
  store: FileStore; collection: Collection; view: SiteView; settled: SettledDecision[]; commit: string | null; person: string;
}): Promise<PageState> {
  const { view, commit } = options;
  const stored = await options.store.list(options.collection.name);
  const orphans: PageState['orphans'] = [];
  const threads = await Promise.all(stored.map(async ({ thread, version }): Promise<PageThread> => ({
    id: thread.id, kind: thread.kind, title: thread.title, decides: thread.decides ? [thread.decides] : [],
    number: thread.number ?? null, priority: thread.priority ?? null, topic: thread.topic ?? null,
    status: threadStatus(thread), contextHtml: await markdownHtml(thread.context),
    options: await Promise.all(thread.options.map(async option => ({ n: option.n, recommended: option.recommended, html: await inlineHtml(option.text.replace(/\s*\(recommended\)/, '')) }))),
    anchors: thread.anchors.map(anchor => {
      const resolved = resolveAnchor(anchor, view, commit);
      if (resolved.method === 'orphan') orphans.push({ thread: thread.id, path: anchor.path, lines: anchor.lines });
      return { role: anchor.role, path: anchor.path, label: `${anchor.path.split('/').pop()}:${anchor.lines[0]}${anchor.lines[1] !== anchor.lines[0] ? '-' + anchor.lines[1] : ''}`, method: resolved.method, blocks: resolved.blocks.map(block => block.id) };
    }),
    entries: thread.entries, settledAs: thread.settledAs ?? null, version,
  })));
  const settled: PageSettled[] = [];
  for (const decision of options.settled) {
    const file = decision.path;
    const blocks = view.documents.find(item => item.path === file)!.blocks.filter(block => block.heading === decision.id).map(block => block.id);
    settled.push({
      id: `${file}#${decision.id}`, title: decision.title, topic: decision.topic, date: decision.date, decidedBy: decision.decidedBy,
      choice: decision.choice, authority: decision.authority, reason: decision.reason, rejected: decision.rejected,
      anchors: [{ role: 'main', path: file, label: `${file.split('/').pop()}#${decision.id}`, method: blocks.length ? 'block' : 'orphan', blocks }],
    });
  }
  return { collection: { name: options.collection.name, title: options.collection.title }, commit, person: options.person, threads, settled, orphans };
}

// The page's view of one collection: threads with resolved anchors and rendered text, plus settled decisions.
import { documentHtml, parseDocument, type SiteView } from 'md-render';
import { resolveAnchor, type AnchorState } from './anchors.js';
import { diffWords, type WordChange } from './diff.js';
import { readSettled, type SettledDecision } from './settled.js';
import type { Collection, FileStore } from './store.js';
import { threadStatus, type Decider, type Entry, type Status, type ThreadKind } from './thread.js';

export interface PageAnchor {
  role: 'main' | 'also';
  path: string;
  label: string;
  state: AnchorState;
  /** The rendered blocks to mark and open: a thread's one block, or a decision's section; empty when removed. */
  blocks: string[];
  /** The text the anchor was written on; a removed block shows it. */
  text: string;
  /** For an updated block, its words from the written text to the text now. */
  diff: WordChange[] | null;
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
  /** The decision in the rendered page; History links to it. */
  anchors: PageAnchor[];
}
export interface PageState {
  collection: { name: string; title: string };
  person: string;
  threads: PageThread[];
  settled: PageSettled[];
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
  store: FileStore; collection: Collection; view: SiteView; settled: SettledDecision[]; person: string;
}): Promise<PageState> {
  const { view } = options;
  const stored = await options.store.list(options.collection.name);
  const threads = await Promise.all(stored.map(async ({ thread, version }): Promise<PageThread> => ({
    id: thread.id, kind: thread.kind, title: thread.title, decides: thread.decides ? [thread.decides] : [],
    number: thread.number ?? null, priority: thread.priority ?? null, topic: thread.topic ?? null,
    status: threadStatus(thread), contextHtml: await markdownHtml(thread.context),
    options: await Promise.all(thread.options.map(async option => ({ n: option.n, recommended: option.recommended, html: await inlineHtml(option.text.replace(/\s*\(recommended\)/, '')) }))),
    anchors: thread.anchors.map(anchor => {
      const { state, block } = resolveAnchor(anchor, view);
      return {
        role: anchor.role, path: anchor.path, label: anchor.text.length > 60 ? anchor.text.slice(0, 59) + '…' : anchor.text || anchor.block,
        state, blocks: block ? [block.id] : [], text: anchor.text, diff: state === 'updated' ? diffWords(anchor.text, block!.text) : null,
      };
    }),
    entries: thread.entries, settledAs: thread.settledAs ?? null, version,
  })));
  const settled: PageSettled[] = [];
  for (const decision of options.settled) {
    const file = decision.path;
    const blocks = view.documents.find(item => item.path === file)!.blocks.filter(block => block.heading === decision.id).map(block => block.id);
    settled.push({
      id: `${file}#${decision.id}`, title: decision.title, topic: decision.topic, date: decision.date, decidedBy: decision.decidedBy,
      anchors: [{ role: 'main', path: file, label: `${file.split('/').pop()}#${decision.id}`, state: blocks.length ? 'same' : 'removed', blocks, text: decision.title, diff: null }],
    });
  }
  return { collection: { name: options.collection.name, title: options.collection.title }, person: options.person, threads, settled };
}

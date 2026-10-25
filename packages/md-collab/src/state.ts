// The page's view of one collection: threads with resolved anchors and rendered text, plus settled decisions.
import { documentHtml, parseDocument, type SiteView } from 'md-render';
import { resolveAnchor, type AnchorMethod } from './anchors.js';
import { readSettled } from './settled.js';
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
  id: string;
  title: string;
  topic: string | null;
  date: string | null;
  decidedBy: Decider[];
  authorityHtml: string;
  contextHtml: string;
  /** The chapter that relative links in the decision's text start from. */
  basePath: string;
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

export async function pageState(options: {
  store: FileStore; collection: Collection; view: SiteView; corpusRoot: string; commit: string | null; person: string;
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
  for (const file of options.collection.settled) {
    const document = view.documents.find(item => item.path === file);
    if (!document) throw new Error(`Collection ${options.collection.name}: settled chapter ${file} is not a rendered document`);
    for (const decision of await readSettled(options.corpusRoot, file)) {
      const blocks = document.blocks.filter(block => block.heading === decision.id).map(block => block.id);
      settled.push({
        id: decision.id, title: decision.title, topic: decision.topic, date: decision.date, decidedBy: decision.decidedBy,
        authorityHtml: await inlineHtml(decision.authority),
        contextHtml: await markdownHtml([`**Choice:** ${decision.choice}`, decision.reason && `**Reason:** ${decision.reason}`, decision.rejected && `**Rejected alternatives:** ${decision.rejected}`].filter(Boolean).join('\n\n')),
        basePath: file,
        anchors: [{ role: 'main', path: file, label: `${file.split('/').pop()}#${decision.id}`, method: blocks.length ? 'block' : 'orphan', blocks }],
      });
    }
  }
  return { collection: { name: options.collection.name, title: options.collection.title }, commit, person: options.person, threads, settled, orphans };
}

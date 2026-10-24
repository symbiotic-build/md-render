// The local page: one loopback server. Every request needs the server's own Host, so a site that
// rebinds its name to 127.0.0.1 is refused; writes also need the page's own Origin.
import { randomBytes } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadCorpus, renderSinglePage, type RenderExtension, type SiteView } from 'md-render';
import { pageState } from './state.js';
import { ConflictError, FileStore } from './store.js';
import type { Anchor, Entry, Thread } from './thread.js';

const run = promisify(execFile);
const browserFile = (name: string) => new URL(`./browser/${name}`, import.meta.url);

export interface ServeOptions {
  documents: string;
  store: string;
  collection: string;
  /** Who answers in this page, as person:<login>. */
  person: string;
  port?: number;
  mermaid?: boolean;
}
export interface Session { url: string; close(): Promise<void> }

async function documentsCommit(root: string): Promise<string | null> {
  try { return (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim() || null; }
  catch { return null; }
}

/** The md-render extension that adds the sidebar; `onView` receives the corpus view of each render. */
export async function collabExtension(data: unknown, onView: (view: SiteView) => void): Promise<RenderExtension> {
  const [styles, script] = await Promise.all([readFile(browserFile('sidebar.css'), 'utf8'), readFile(browserFile('sidebar.js'), 'utf8')]);
  return { name: 'md-collab', prepare(view) { onView(view); return { styles, script, data, connect: true }; } };
}

function send(response: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8'): void {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
}
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Send JSON'), { status: 415 });
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 65_536) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Send a JSON object'), { status: 400 });
  return value as Record<string, unknown>;
}

export async function serve(options: ServeOptions): Promise<Session> {
  if (!/^person:\S+$/.test(options.person)) throw new Error(`--person must be person:<login>, not ${options.person}`);
  const store = new FileStore(path.resolve(options.store));
  const collection = await store.collection(options.collection);
  const corpus = await loadCorpus(options.documents);
  let view: SiteView | undefined;
  const extension = await collabExtension({ collection: collection.name }, next => { view = next; });
  let html = '';
  let commit: string | null = null;
  async function render(): Promise<void> {
    commit = await documentsCommit(corpus.root);
    html = (await renderSinglePage(options.documents, { mermaid: options.mermaid }, [extension])).html;
  }
  await render();
  // Checks every anchor once at start, so a broken collection fails before the page opens.
  await pageState({ store, collection, view: view!, corpusRoot: corpus.root, commit, person: options.person });

  // Open pages hear about changes: "changed" after a store write, "reload" after the documents change.
  const listeners = new Set<ServerResponse>();
  const notify = (event: string) => { for (const listener of listeners) listener.write(`event: ${event}\ndata: {}\n\n`); };
  let origin = '';
  const server = createServer((request, response) => {
    handle(request, response).catch(error => {
      const status = error instanceof ConflictError ? 409 : (error as { status?: number }).status ?? 400;
      send(response, status, { error: (error as Error).message });
    });
  });
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', origin);
    // This computer's two names; any other Host is a site that rebinds its name to 127.0.0.1.
    const host = request.headers.host ?? '';
    if (host !== new URL(origin).host && host !== `localhost:${new URL(origin).port}`) return send(response, 403, { error: `Open ${origin}` });
    if (request.method === 'GET' && url.pathname === '/') return send(response, 200, html, 'text/html; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/api/state') {
      return send(response, 200, await pageState({ store, collection, view: view!, corpusRoot: corpus.root, commit, person: options.person }));
    }
    if (request.method === 'GET' && url.pathname === '/api/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      response.write(': connected\n\n');
      listeners.add(response);
      request.on('close', () => listeners.delete(response));
      return;
    }
    if (request.method !== 'POST') return send(response, 404, { error: 'Not found' });
    if (request.headers.origin !== `http://${host}`) return send(response, 403, { error: 'Writes are accepted only from the md-collab page' });
    const body = await readJson(request);
    const at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const entryMatch = /^\/api\/threads\/([a-z0-9][a-z0-9-]*)\/entries$/.exec(url.pathname);
    if (entryMatch) {
      const kind = body.kind;
      if (kind !== 'answer' && kind !== 'comment' && kind !== 'reopened') return send(response, 400, { error: 'kind must be answer, comment or reopened' });
      const entry: Entry = { at, actor: options.person, kind, note: typeof body.note === 'string' ? body.note.trim() : '' };
      if (body.choice !== undefined && body.choice !== null) entry.choice = Number(body.choice);
      if (kind === 'answer' && entry.choice === undefined && !entry.note) return send(response, 400, { error: 'An answer needs a choice or a note' });
      const saved = await store.append(collection.name, entryMatch[1]!, entry, typeof body.version === 'string' ? body.version : undefined);
      return send(response, 200, { id: saved.thread.id, version: saved.version });
    }
    if (url.pathname === '/api/comments') {
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      const anchors = Array.isArray(body.anchors) ? body.anchors as Anchor[] : [];
      if (!note || !anchors.length) return send(response, 400, { error: 'A comment needs text and a selected passage' });
      const thread: Thread = {
        id: `c-${at.replace(/[^0-9]/g, '').slice(0, 14)}-${randomBytes(2).toString('hex')}`,
        kind: 'comment', title: note.split('\n')[0]!.slice(0, 80),
        anchors: anchors.map((anchor, index) => ({
          role: index === 0 ? 'main' : 'also', path: String(anchor.path), commit: commit ?? 'unknown',
          lines: [Number(anchor.lines?.[0]), Number(anchor.lines?.[1])],
          ...(anchor.block ? { block: String(anchor.block) } : {}), ...(anchor.quote ? { quote: String(anchor.quote).slice(0, 200) } : {}),
        })),
        context: '', options: [], entries: [{ at, actor: options.person, kind: 'comment', note }],
      };
      if (!thread.anchors.every(anchor => view!.documents.some(document => document.path === anchor.path))) return send(response, 400, { error: 'The selection is not in a rendered document' });
      const saved = await store.create(collection.name, thread);
      return send(response, 200, { id: saved.thread.id, version: saved.version });
    }
    return send(response, 404, { error: 'Not found' });
  }

  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve); });
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;

  // Agents write threads with the command line, so the page learns of changes from the store itself.
  let timer: NodeJS.Timeout | undefined;
  const watchers: FSWatcher[] = [
    watch(path.join(store.root, collection.name), { recursive: true }, () => notify('changed')),
    watch(corpus.root, { recursive: true }, (_event, file) => {
      if (!file || !/\.md$/i.test(String(file)) || String(file).split(path.sep).includes('.git')) return;
      clearTimeout(timer);
      timer = setTimeout(() => { render().then(() => notify('reload'), error => console.error(`md-collab: re-render failed: ${(error as Error).message}`)); }, 300);
    }),
  ];
  return {
    url: `${origin}/`,
    async close() {
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      for (const listener of listeners) listener.end();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

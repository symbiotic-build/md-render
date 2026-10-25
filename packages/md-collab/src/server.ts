// The local page: one loopback server. Every request needs the server's own Host, so a site that
// rebinds its name to 127.0.0.1 is refused; writes also need the page's own Origin.
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadCorpus, renderSinglePage, type RenderExtension, type SiteView } from 'md-render';
import type { SettledDecision } from './settled.js';
import { pageState, settledDecisions } from './state.js';
import { checkStoreOutside, ConflictError, FileStore } from './store.js';
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

/**
 * The modification time, by path, of each file in the folder that `pick` accepts, and with `deep`
 * also in its subfolders other than `.git` and `node_modules`. A folder that cannot be read, and a
 * file or folder that disappears during the walk, is skipped.
 */
async function modificationTimes(folder: string, pick: (name: string) => boolean, deep: boolean, times = new Map<string, number>()): Promise<Map<string, number>> {
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) { if (deep && entry.name !== '.git' && entry.name !== 'node_modules') await modificationTimes(file, pick, deep, times); }
    else if (entry.isFile() && pick(entry.name)) {
      const time = await stat(file).then(info => info.mtimeMs, () => undefined);
      if (time !== undefined) times.set(file, time);
    }
  }
  return times;
}
const sameTimes = (a: Map<string, number>, b: Map<string, number>) => a.size === b.size && [...a].every(([file, time]) => b.get(file) === time);

/** The md-render extension that adds the sidebar. */
export async function collabExtension(): Promise<RenderExtension> {
  const [styles, script] = await Promise.all([readFile(browserFile('sidebar.css'), 'utf8'), readFile(browserFile('sidebar.js'), 'utf8')]);
  return { name: 'md-collab', prepare: () => ({ styles, script, connect: true }) };
}

/**
 * One rendered generation: the page, the view and commit its anchors resolve against, and the settled
 * decisions read with it. The page carries its generation, a random identity of its render, so a page
 * can tell it is out of date, also after the server restarted.
 */
interface Snapshot { generation: string; html: string; view: SiteView; commit: string | null; settled: SettledDecision[] }

function send(response: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8'): void {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
}
/** The page's JSON request body. Only the page reaches it: the Host and Origin checks refuse other sites first. */
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

export async function serve(options: ServeOptions): Promise<Session> {
  if (!/^person:\S+$/.test(options.person)) throw new Error(`--person must be person:<login>, not ${options.person}`);
  const store = new FileStore(path.resolve(options.store));
  const collection = await store.collection(options.collection);
  const sidebar = await collabExtension();
  const { root } = await loadCorpus(options.documents);
  await checkStoreOutside(store.root, root);
  // A render builds a whole snapshot; only a successful one replaces the current snapshot. Its
  // settled decisions come from the text it rendered, so a failed render discards them too.
  async function render(): Promise<Snapshot> {
    const generation = randomBytes(8).toString('hex');
    const extension: RenderExtension = { name: sidebar.name, prepare: async view => ({ ...await sidebar.prepare(view), data: { generation } }) };
    const { html, view } = await renderSinglePage(options.documents, { mermaid: options.mermaid }, [extension]);
    return { generation, html, view, commit: await documentsCommit(root), settled: settledDecisions(collection, view) };
  }
  // The documents' modification times as last seen: recorded before the first render, and again by
  // each check that finds a change, before the render it starts reads its files. So an edit made
  // during a render starts the next one.
  const markdownTimes = () => modificationTimes(root, name => /\.md$/i.test(name), true);
  let documentTimes = await markdownTimes();
  let snapshot = await render();
  // Checks every anchor once at start, so a broken collection fails before the page opens.
  await pageState({ store, collection, view: snapshot.view, settled: snapshot.settled, commit: snapshot.commit, person: options.person });

  // Open pages hear about changes: "changed" after a store write, "reload" after the documents change,
  // "failed" when a re-render fails. A page that stops reading is disconnected; it reloads its state
  // when it reconnects.
  const listeners = new Set<ServerResponse>();
  const notify = (event: string, data: unknown = {}) => {
    for (const listener of listeners) {
      if (listener.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) continue;
      listeners.delete(listener);
      listener.destroy();
    }
  };
  // One render at a time; changes that arrive during a render start one more render after it. After
  // close, no render starts, and close waits for the one running.
  let rendering: Promise<void> | undefined;
  let again = false;
  let closed = false;
  function rerender(): void {
    if (closed) return;
    if (rendering) { again = true; return; }
    rendering = (async () => {
      do {
        again = false;
        try { snapshot = await render(); notify('reload'); }
        catch (error) {
          console.error(`md-collab: re-render failed: ${(error as Error).message}`);
          notify('failed', { error: (error as Error).message });
        }
      } while (again && !closed);
      rendering = undefined;
    })();
  }
  let origin = '';
  const server = createServer((request, response) => {
    handle(request, response).catch(error => {
      send(response, error instanceof ConflictError ? 409 : 400, { error: (error as Error).message });
    });
  });
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', origin);
    // This computer's two names; any other Host is a site that rebinds its name to 127.0.0.1.
    const host = request.headers.host ?? '';
    if (host !== new URL(origin).host && host !== `localhost:${new URL(origin).port}`) return send(response, 403, { error: `Open ${origin}` });
    if (request.method === 'GET' && url.pathname === '/') return send(response, 200, snapshot.html, 'text/html; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/api/state') {
      const { generation, view, settled, commit } = snapshot;
      return send(response, 200, { generation, ...await pageState({ store, collection, view, settled, commit, person: options.person }) });
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
          role: index === 0 ? 'main' : 'also', path: String(anchor.path), commit: snapshot.commit ?? 'unknown',
          lines: [Number(anchor.lines?.[0]), Number(anchor.lines?.[1])],
          ...(anchor.block ? { block: String(anchor.block) } : {}), ...(anchor.quote ? { quote: String(anchor.quote).slice(0, 200) } : {}),
        })),
        context: '', options: [], entries: [{ at, actor: options.person, kind: 'comment', note }],
      };
      if (!thread.anchors.every(anchor => snapshot.view.documents.some(document => document.path === anchor.path))) return send(response, 400, { error: 'The selection is not in a rendered document' });
      const saved = await store.create(collection.name, thread);
      return send(response, 200, { id: saved.thread.id, version: saved.version });
    }
    return send(response, 404, { error: 'Not found' });
  }

  // Agents write threads with the command line and authors edit the documents, so every second the
  // server reads the modification times of the thread files and of the Markdown files. A thread file
  // that changed, appeared or went sends "changed"; such a Markdown file starts a re-render. Drafts
  // start with a dot; only finished thread files are changes.
  const threads = path.join(store.root, collection.name, 'threads');
  await mkdir(threads, { recursive: true });
  const threadTimes = () => modificationTimes(threads, name => !name.startsWith('.'), false);
  let storeTimes = await threadTimes();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve); });
  let timer: NodeJS.Timeout | undefined;
  let polling: Promise<void> | undefined;
  const poll = () => {
    polling = (async () => {
      const [documentsNow, threadsNow] = await Promise.all([markdownTimes(), threadTimes()]);
      if (!sameTimes(threadsNow, storeTimes)) { storeTimes = threadsNow; notify('changed'); }
      if (!sameTimes(documentsNow, documentTimes)) { documentTimes = documentsNow; rerender(); }
      if (!closed) timer = setTimeout(poll, 1000);
    })();
  };
  timer = setTimeout(poll, 1000);
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
  return {
    url: `${origin}/`,
    async close() {
      // No check or render starts any more, and close waits for the ones running.
      closed = true;
      clearTimeout(timer);
      await polling;
      for (const listener of listeners) listener.end();
      await rendering;
      // A page that reconnects while the session stops holds a connection close would wait for.
      const stopped = new Promise<void>(resolve => server.close(() => resolve()));
      server.closeAllConnections();
      await stopped;
    },
  };
}

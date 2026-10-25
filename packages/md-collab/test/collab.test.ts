import { afterAll, beforeAll, expect, it } from 'vitest';
import { useBrowser } from '../../../test/browser-fixture.js';
import type { BrowserSession } from '../../../src/browser.js';
import { execFile, spawnSync } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { renderView, type SiteView } from 'md-render';
import { anchorAt, resolveAnchor } from '../src/anchors.js';
import { parseQuestionList, questionThreads } from '../src/import.js';
import { serve } from '../src/server.js';
import { decidersOf, readSettled } from '../src/settled.js';
import { pageState } from '../src/state.js';
import { ConflictError, FileStore } from '../src/store.js';
import { parseThread, serializeThread, threadStatus, type Thread } from '../src/thread.js';

const withBrowser = useBrowser();

const run = promisify(execFile);
let root: string;
let docs: string;
let commit: string;
let view: SiteView;
const spec = `# Storage

<a id="limits"></a>

## Limits

The write group is 4 MiB.

Identifiers may be long.
`;
const decisions = `# Decisions

## Storage choices

<a id="decision-fixed-group"></a>

### Decision: Fixed write group

**Choice:** Keep the write group at 4 MiB ([limits](storage.md#limits)).

**Authority:** Q12 = 1 in the operator decision log, 2026-10-12.

**Reason:** One size is simpler.

**Rejected alternatives:** A setting.

<a id="decision-redo"></a>

### Decision: Separate redo call

**Choice:** Two calls.

**Authority:** Lead decision, 2026-10-14. The operator delegated Q152: "decide for me".

**Reason:** Easier to test.

**Rejected alternatives:** One call.
`;
const moreDecisions = `# More decisions

<a id="decision-redo"></a>

### Decision: Redo in one place

**Choice:** One place.

**Authority:** Lead decision, 2026-10-15.
`;
const long = '# Long\n\nFirst line\nsecond line\nthird line.\n\nNext paragraph.\n';
const questionList = `# Questions

## Limits

### 1\\. How long may an identifier be?
\`FACT\` The spec says identifiers may be long ([storage.md:9](docs/storage.md)). \`FACT\` The settled group size is 4 MiB ([decisions.md:9-11](docs/decisions.md)).\\
Until this is answered, keys cannot be built.

1. **Cap at 256 bytes (recommended).**
2. No cap.

**Answer like so:**
\`\`\`text
 1. 1
\`\`\`
`;

beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'md-collab-')));
  docs = path.join(root, 'repo');
  await mkdir(path.join(docs, 'docs'), { recursive: true });
  await writeFile(path.join(docs, 'docs/storage.md'), spec);
  await writeFile(path.join(docs, 'docs/decisions.md'), decisions);
  await writeFile(path.join(docs, 'docs/more-decisions.md'), moreDecisions);
  await writeFile(path.join(docs, 'docs/long.md'), long);
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'docs']]) await run('git', ['-C', docs, ...args]);
  commit = (await run('git', ['-C', docs, 'rev-parse', 'HEAD'])).stdout.trim();
  view = (await renderView(path.join(docs, 'docs'), { mermaid: false })).view;
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

const question = (): Thread => ({
  id: 'q01-identifier-length', kind: 'question', title: 'How long may an identifier be?', decides: 'operator', number: 1, topic: 'Limits',
  anchors: [{ role: 'main', path: 'docs/storage.md', commit: 'abcdef1', lines: [9, 9], block: 'limits~x', quote: 'Identifiers may be long.' }],
  context: '`FACT` The spec says identifiers may be long.',
  options: [{ n: 1, text: '**Cap at 256 bytes (recommended).**', recommended: true }, { n: 2, text: 'No cap.', recommended: false }],
  entries: [{ at: '2026-10-22T13:09:00Z', actor: 'agent:claude-code/memory', kind: 'raised', note: '' }],
});

// The question list with a citation inside an option, as the import and the page see it.
const citingList = questionList.replace('2. No cap.', '2. No cap, as [storage.md:7](docs/storage.md) allows.');
const imported = () => questionThreads(parseQuestionList(citingList, path.join(docs, 'questions.md')), { view, corpusRoot: docs, commit, actor: 'agent:test/1', at: '2026-10-24T00:00:00Z', settled: ['docs/decisions.md'], base: docs });
const decode = new TextDecoder();
/** Reads a server-sent event stream until `text` arrives, or fails after `ms`. */
async function heard(reader: ReadableStreamDefaultReader<Uint8Array>, text: string, ms = 10_000): Promise<string> {
  let received = '';
  const deadline = Date.now() + ms;
  while (!received.includes(text)) {
    const timeout = delay(Math.max(0, deadline - Date.now())).then(() => { throw new Error(`Timed out waiting for ${text}; heard ${JSON.stringify(received)}`); });
    received += decode.decode((await Promise.race([reader.read(), timeout])).value);
  }
  return received;
}

it('writes and reads a thread file without loss, and derives status from its entries', () => {
  const thread = question();
  thread.context = 'A fenced example:\n\n```markdown\n## Entries\n\n### Example\n```\n\nChoice: not a field';
  const notes = ['Choice: 2 reads well', 'Source: the meeting', 'Settled as: nothing yet', '### Not an entry\nbody', 'Example:\n\n```\n## Entries\n### 2026-01-01T00:00:00Z person:x answer\n```', '\\## written with a backslash'];
  notes.forEach((note, index) => thread.entries.push({ at: `2026-10-24T09:4${index}:00Z`, actor: 'person:operator', kind: 'comment', note }));
  thread.entries.push({ at: '2026-10-24T09:50:00Z', actor: 'person:operator', kind: 'answer', choice: 1, note: 'Choice: 2\nKeep it short.' });
  const text = serializeThread(thread);
  // Fields end at the first line that is not a field; a note line that looks like one carries a backslash.
  expect(text).toContain('### 2026-10-24T09:50:00Z person:operator answer\n\nChoice: 1\n\n\\Choice: 2\nKeep it short.');
  const back = parseThread(text);
  expect(back).toEqual(thread);
  expect(threadStatus(back)).toBe('answered');
  expect(threadStatus({ entries: [...back.entries, { at: '2026-10-25T00:00:00Z', actor: 'person:operator', kind: 'reopened', note: '' }] })).toBe('open');
});

it('refuses an answer from an agent and other format errors', () => {
  const thread = question();
  thread.entries.push({ at: '2026-10-24T09:41:12Z', actor: 'agent:codex/w1', kind: 'answer', choice: 1, note: '' });
  expect(() => serializeThread(thread)).toThrow('Thread q01-identifier-length: only a person writes an answer');
  expect(() => serializeThread({ ...question(), options: [{ n: 2, text: 'x', recommended: false }] })).toThrow('options are numbered 1, 2, 3 without gaps');
  expect(() => parseThread('---\nid: x\nkind: comment\ntitle: t\ncolour: red\n---\n')).toThrow('unknown field colour');
});

it('appends entries and refuses a write against an old version', async () => {
  const store = new FileStore(path.join(root, 'store-a'));
  await store.createCollection({ name: 'spec', title: 'Spec review', settled: ['docs/decisions.md'] });
  expect(await store.collection('spec')).toEqual({ name: 'spec', title: 'Spec review', settled: ['docs/decisions.md'] });
  const created = await store.create('spec', question());
  await store.append('spec', created.thread.id, { at: '2026-10-24T10:00:00Z', actor: 'person:operator', kind: 'comment', note: 'First.' }, created.version);
  await expect(store.append('spec', created.thread.id, { at: '2026-10-24T10:01:00Z', actor: 'person:operator', kind: 'comment', note: 'Late.' }, created.version))
    .rejects.toBeInstanceOf(ConflictError);
  expect((await store.read('spec', created.thread.id)).thread.entries.map(entry => entry.note)).toEqual(['', 'First.']);
  await expect(store.create('spec', question())).rejects.toThrow('Thread q01-identifier-length already exists in spec; nothing was written');
});

it('keeps every entry when many writers append to one thread at once', async () => {
  const store = new FileStore(path.join(root, 'store-race'));
  await store.createCollection({ name: 'spec', title: 'Race', settled: [] });
  const { thread } = await store.create('spec', question());
  const notes = Array.from({ length: 12 }, (_, index) => `Writer ${index}.`);
  await Promise.all(notes.map((note, index) => store.append('spec', thread.id, { at: `2026-10-24T10:00:${String(index).padStart(2, '0')}Z`, actor: 'agent:test/race', kind: 'comment', note })));
  expect((await store.read('spec', thread.id)).thread.entries.slice(1).map(entry => entry.note).sort()).toEqual([...notes].sort());
});

it('refuses a repeated question number in a batch or in the collection and writes nothing', async () => {
  const store = new FileStore(path.join(root, 'store-numbers'));
  await store.createCollection({ name: 'spec', title: 'Numbers', settled: [] });
  await store.create('spec', question());
  const second: Thread = { ...question(), id: 'q02-other', number: 2 };
  await expect(store.createAll('spec', [second, { ...second, id: 'q02-twin' }])).rejects.toThrow('Question number 2 is used by both q02-other and q02-twin; nothing was written');
  await expect(store.createAll('spec', [second, { ...question(), id: 'q01-again' }])).rejects.toThrow('Question number 1 is used by both q01-identifier-length and q01-again; nothing was written');
  // Two creators of the same number at once: one wins, the other is refused.
  const results = await Promise.allSettled([store.create('spec', { ...second, id: 'q02-a' }), store.create('spec', { ...second, id: 'q02-b' })]);
  expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect((await store.list('spec')).map(({ thread }) => thread.number)).toEqual([1, 2]);
});

it('leaves no draft or lock behind when a write is refused, and takes over a lock left by a crashed process', async () => {
  const store = new FileStore(path.join(root, 'store-clean'));
  const directory = path.join(store.root, 'spec');
  await store.createCollection({ name: 'spec', title: 'Clean', settled: [] });
  const created = await store.create('spec', question());
  const comment = { at: '2026-10-24T10:00:00Z', actor: 'person:operator', kind: 'comment' as const, note: 'First.' };
  await store.append('spec', created.thread.id, comment, created.version);
  await expect(store.append('spec', created.thread.id, comment, created.version)).rejects.toBeInstanceOf(ConflictError);
  await expect(store.create('spec', question())).rejects.toThrow('already exists');
  await expect(store.createCollection({ name: 'spec', title: 'Again', settled: [] })).rejects.toThrow('Collection spec already exists');
  const files = ['collection.yaml', 'threads', 'threads/q01-identifier-length.md'];
  expect((await readdir(directory, { recursive: true })).sort()).toEqual(files);
  // A process that ended without removing its lock leaves its number behind; that process no longer exists.
  const { pid } = spawnSync(process.execPath, ['-e', '']);
  await writeFile(path.join(directory, '.lock'), `${pid} crashed`);
  await store.append('spec', created.thread.id, { ...comment, note: 'After the crash.' });
  expect((await store.read('spec', created.thread.id)).thread.entries.map(entry => entry.note)).toEqual(['', 'First.', 'After the crash.']);
  expect((await readdir(directory, { recursive: true })).sort()).toEqual(files);
});

it('finds an anchor again by block, then quote, then lines, and reports an orphan', async () => {
  const anchor = anchorAt(view, 'docs/storage.md', [9, 9], commit, 'main');
  expect(anchor).toMatchObject({ path: 'docs/storage.md', lines: [9, 9], quote: 'Identifiers may be long.' });
  expect(anchor.block).toMatch(/^limits~[0-9a-f]{6}$/);
  expect(resolveAnchor(anchor, view, commit)).toMatchObject({ method: 'block', blocks: [{ id: anchor.block, lines: [9, 9] }] });
  expect(resolveAnchor({ ...anchor, block: 'limits~000000', lines: [30, 30] }, view, null)).toMatchObject({ method: 'quote', blocks: [{ lines: [9, 9] }] });
  expect(resolveAnchor({ ...anchor, block: undefined, quote: undefined }, view, commit.slice(0, 7))).toMatchObject({ method: 'lines' });
  expect(resolveAnchor({ ...anchor, block: undefined, quote: 'Gone text.' }, view, 'f'.repeat(40))).toMatchObject({ method: 'orphan', blocks: [] });
  expect(() => anchorAt(view, 'docs/storage.md', [2, 2], commit, 'main')).toThrow('docs/storage.md:2-2 covers no rendered text');
});

it('covers every passage of a citation that starts inside its first paragraph', () => {
  // Lines 4-7 start inside the paragraph of lines 3-5 and end in the paragraph on line 7.
  const anchor = anchorAt(view, 'docs/long.md', [4, 7], commit, 'main');
  const expected = [{ path: 'docs/long.md', id: expect.stringMatching(/^long~/), lines: [3, 5] }, { path: 'docs/long.md', id: expect.stringMatching(/^long~/), lines: [7, 7] }];
  expect(resolveAnchor(anchor, view, 'f'.repeat(40))).toEqual({ anchor, method: 'block', blocks: expected });
  expect(resolveAnchor({ ...anchor, block: undefined }, view, 'f'.repeat(40))).toEqual({ anchor: { ...anchor, block: undefined }, method: 'quote', blocks: expected });
});

it('reads settled decisions with their dates and deciders from the specification', async () => {
  const settled = await readSettled(docs, 'docs/decisions.md');
  expect(settled.map(({ id, topic, date, decidedBy }) => ({ id, topic, date, decidedBy }))).toEqual([
    { id: 'decision-fixed-group', topic: 'Storage choices', date: '2026-10-12', decidedBy: ['operator'] },
    { id: 'decision-redo', topic: 'Storage choices', date: '2026-10-14', decidedBy: ['lead'] },
  ]);
  expect(decidersOf('Q73 and final Q162 in the log, with the lead clarification of 2026-10-14.')).toEqual(['operator', 'lead']);
  expect(decidersOf('anything', 'lead')).toEqual(['lead']);
  expect(decidersOf('Benchmark measurement on the reference host, 2026-10-16.')).toEqual(['measurement']);
  expect(() => decidersOf('Agreed in review, 2026-10-16.')).toThrow('Authority names no operator, lead or measurement; add a **Decided by:** line: Agreed in review, 2026-10-16.');
});

it('keeps decisions from two chapters apart when they share an anchor', async () => {
  const store = new FileStore(path.join(root, 'store-settled'));
  const collection = { name: 'spec', title: 'Settled', settled: ['docs/decisions.md', 'docs/more-decisions.md'] };
  await store.createCollection(collection);
  const state = await pageState({ store, collection, view, corpusRoot: docs, commit, person: 'person:operator' });
  expect(state.settled.map(decision => [decision.id, decision.title, decision.anchors[0]!.path])).toEqual([
    ['docs/decisions.md#decision-fixed-group', 'Fixed write group', 'docs/decisions.md'],
    ['docs/decisions.md#decision-redo', 'Separate redo call', 'docs/decisions.md'],
    ['docs/more-decisions.md#decision-redo', 'Redo in one place', 'docs/more-decisions.md'],
  ]);
});

it('imports a House Rules question list with its cited passages as anchors', () => {
  const listed = parseQuestionList(citingList, path.join(docs, 'questions.md'));
  expect(listed).toMatchObject([{ number: 1, topic: 'Limits', title: 'How long may an identifier be?', options: [{ n: 1, recommended: true }, { n: 2, recommended: false }] }]);
  const [thread] = imported();
  expect(thread!.id).toBe('q01-how-long-may-an-identifier-be');
  expect(thread!.anchors.map(anchor => [anchor.role, anchor.path, anchor.lines])).toEqual([['main', 'docs/storage.md', [9, 9]], ['also', 'docs/decisions.md', [9, 11]], ['also', 'docs/storage.md', [7, 7]]]);
  expect(thread!.context).toContain('([storage.md:9](#md-collab-anchor-0))');
  expect(thread!.context).toContain('([decisions.md:9-11](#md-collab-anchor-1))');
  expect(thread!.context).not.toContain('Answer like so');
  expect(thread!.options[1]!.text).toBe('No cap, as [storage.md:7](#md-collab-anchor-2) allows.');
});

it('serves the page only under its own host and accepts writes only from its own origin', async () => {
  const storeRoot = path.join(root, 'store-b');
  const store = new FileStore(storeRoot);
  await store.createCollection({ name: 'spec', title: 'Spec review', settled: ['docs/decisions.md'] });
  const [thread] = questionThreads(parseQuestionList(questionList, path.join(docs, 'questions.md')), { view, corpusRoot: docs, commit, actor: 'agent:test/1', at: '2026-10-24T00:00:00Z', settled: ['docs/decisions.md'], base: docs });
  const created = await store.create('spec', thread!);
  const session = await serve({ documents: path.join(docs, 'docs'), store: storeRoot, collection: 'spec', person: 'person:operator', mermaid: false });
  try {
    const origin = new URL(session.url).origin;
    const rebound = await new Promise<number>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: new URL(origin).port, path: '/', headers: { host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode!); }).on('error', reject);
    });
    expect(rebound).toBe(403);
    expect((await fetch(`http://localhost:${new URL(origin).port}/`)).status).toBe(200);
    const page = await fetch(session.url);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("connect-src 'self'");
    const headers = { 'content-type': 'application/json' };
    const state = await (await fetch(origin + '/api/state', { headers })).json();
    expect(state.threads[0]).toMatchObject({ id: created.thread.id, status: 'open', number: 1, anchors: [{ role: 'main', method: 'block' }, { role: 'also', method: 'block' }] });
    expect(state.settled.map((decision: { id: string; decidedBy: string[] }) => [decision.id, decision.decidedBy])).toEqual([['docs/decisions.md#decision-fixed-group', ['operator']], ['docs/decisions.md#decision-redo', ['lead']]]);
    const answer = JSON.stringify({ kind: 'answer', choice: 1, note: 'Yes.', version: created.version });
    expect((await fetch(origin + `/api/threads/${created.thread.id}/entries`, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: answer })).status).toBe(403);
    const saved = await fetch(origin + `/api/threads/${created.thread.id}/entries`, { method: 'POST', headers: { ...headers, origin }, body: answer });
    expect(saved.status).toBe(200);
    expect((await fetch(origin + `/api/threads/${created.thread.id}/entries`, { method: 'POST', headers: { ...headers, origin }, body: answer })).status).toBe(409);
    const file = await readFile(path.join(storeRoot, 'spec/threads', `${created.thread.id}.md`), 'utf8');
    expect(file).toMatch(/### \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ person:operator answer\n\nChoice: 1\n\nYes\./);
    // An open page hears about a change an agent writes straight to the store.
    const events = await fetch(origin + '/api/events');
    const reader = events.body!.getReader();
    await reader.read();
    await store.append('spec', created.thread.id, { at: '2026-10-24T12:00:00Z', actor: 'agent:test/1', kind: 'comment', note: 'Seen?' });
    let heard = '';
    while (!heard.includes('event: changed')) heard += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    const comment = await fetch(origin + '/api/comments', { method: 'POST', headers: { ...headers, origin }, body: JSON.stringify({ note: 'Is 4 MiB measured?', anchors: [{ path: 'docs/storage.md', lines: [7, 7], quote: 'The write group is 4 MiB.' }] }) });
    expect(comment.status).toBe(200);
    const after = await (await fetch(origin + '/api/state', { headers })).json();
    expect(after.threads.map((item: { kind: string; status: string }) => [item.kind, item.status])).toEqual([['comment', 'open'], ['question', 'answered']]);
  } finally { await session.close(); }
});

it('refuses a store inside the documents\' working tree', async () => {
  const inside = path.join(docs, 'annotations');
  await new FileStore(inside).createCollection({ name: 'spec', title: 'Inside', settled: [] });
  await expect(serve({ documents: path.join(docs, 'docs'), store: inside, collection: 'spec', person: 'person:operator', mermaid: false }))
    .rejects.toThrow(`The store ${inside} is inside the documents' working tree ${docs}; keep annotations in a separate folder`);
});

it('releases its file watchers when it cannot listen', async () => {
  const storeRoot = path.join(root, 'store-port');
  await new FileStore(storeRoot).createCollection({ name: 'spec', title: 'Port', settled: [] });
  const blocker = http.createServer();
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const watchers = () => process.getActiveResourcesInfo().filter(name => name === 'FSEventWrap').length;
  const before = watchers();
  try {
    await expect(serve({ documents: path.join(docs, 'docs'), store: storeRoot, collection: 'spec', person: 'person:operator', mermaid: false, port: (blocker.address() as { port: number }).port }))
      .rejects.toMatchObject({ code: 'EADDRINUSE' });
    // A closed watcher leaves the list on the next turn of the event loop.
    for (let turn = 0; turn < 100 && watchers() !== before; turn++) await delay(10);
    expect(watchers()).toBe(before);
  } finally { await new Promise(resolve => blocker.close(resolve)); }
});

it('keeps the last good page when a re-render fails and tells the open page', async () => {
  const documents = path.join(root, 'render-docs');
  await mkdir(documents, { recursive: true });
  await writeFile(path.join(documents, 'a.md'), '# A\n\nFirst text.\n');
  const storeRoot = path.join(root, 'store-render');
  await new FileStore(storeRoot).createCollection({ name: 'spec', title: 'Render', settled: [] });
  const session = await serve({ documents, store: storeRoot, collection: 'spec', person: 'person:operator', mermaid: false });
  try {
    const reader = (await fetch(session.url + 'api/events')).body!.getReader();
    await heard(reader, ': connected');
    // The file watcher starts asynchronously: rewrite the file until a re-render shows it is live.
    let live = false;
    const touching = (async () => { for (let attempt = 0; attempt < 30 && !live; attempt++) { await writeFile(path.join(documents, 'a.md'), '# A\n\nFirst text.\n'); await delay(300); } })();
    await heard(reader, 'event: reload');
    live = true;
    await touching;
    await writeFile(path.join(documents, 'a.md'), '---\ntitle: [1]\n---\n# A\n\nBroken text.\n');
    expect(await heard(reader, 'event: failed')).toContain('data: {"error":"');
    const page = await (await fetch(session.url)).text();
    expect([page.includes('First text.'), page.includes('Broken text.')]).toEqual([true, false]);
    await writeFile(path.join(documents, 'a.md'), '# A\n\nSecond text.\n');
    await heard(reader, 'event: reload');
    expect(await (await fetch(session.url)).text()).toContain('Second text.');
    await reader.cancel();
  } finally { await session.close(); }
});

// Records script errors, unhandled rejections and posts on the page, and keeps the sidebar's event stream reachable.
const pageScript = `window.pageErrors = [];
addEventListener('error', event => pageErrors.push(String(event.message)));
addEventListener('unhandledrejection', event => pageErrors.push('Unhandled rejection: ' + String(event.reason)));
window.posts = [];
const pageFetch = window.fetch;
window.fetch = (url, init) => { if (init?.method === 'POST') posts.push(String(url)); return pageFetch(url, init); };
const PageEvents = window.EventSource;
window.EventSource = class extends PageEvents { constructor(...args) { super(...args); window.sidebarEvents = this; } };`;
const until = (page: BrowserSession, expression: string) => page.evaluate(`new Promise((resolve, reject) => { const start = performance.now(); (function check() { const value = ${expression}; if (value) resolve(value); else if (performance.now() - start > 5000) reject(new Error('Timed out: ' + ${JSON.stringify(expression)})); else setTimeout(check, 50); })(); })`);
const agentComment = (id: string): Thread => ({ id, kind: 'comment', title: 'Agent note', anchors: [{ role: 'main', path: 'docs/storage.md', commit, lines: [7, 7] }], context: '', options: [],
  entries: [{ at: '2026-10-24T12:00:00Z', actor: 'agent:test/1', kind: 'comment', note: 'Agent note' }] });

/** Serves a store holding the imported question and opens the page in the test browser. */
async function sidebar(name: string, work: (page: BrowserSession, store: FileStore) => Promise<void>): Promise<void> {
  const storeRoot = path.join(root, name);
  const store = new FileStore(storeRoot);
  await store.createCollection({ name: 'spec', title: 'Spec review', settled: ['docs/decisions.md'] });
  await store.createAll('spec', imported());
  const session = await serve({ documents: path.join(docs, 'docs'), store: storeRoot, collection: 'spec', person: 'person:operator', mermaid: false });
  try {
    await withBrowser(async page => {
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: pageScript });
      await page.navigate(session.url);
      await until(page, `document.getElementById('ov-v-hn')?.textContent === '3'`);
      await work(page, store);
      expect(await page.evaluate(`window.pageErrors`)).toEqual([]);
    });
  } finally { await session.close(); }
}

it("shows the sidebar in a real browser and adds an agent's new thread without a reload", async () => {
  await sidebar('store-c', async (page, store) => {
    // The question's tag sits on its main passage, in the storage chapter.
    expect(await page.evaluate(`mdRender.show({ path: 'docs/storage.md' }).then(() => {
      const panel = document.getElementById('ov-panel'), title = document.querySelector('#ov-card-1 .ov-title');
      return { panel: panel.checkVisibility() && panel.getBoundingClientRect().width > 200, title: title.checkVisibility() ? title.firstChild.textContent : null,
        count: document.getElementById('ov-count').textContent, tags: [...document.querySelectorAll('.ov-tag')].filter(tag => tag.checkVisibility()).map(tag => tag.textContent) };
    })`)).toEqual({ panel: true, title: 'How long may an identifier be?', count: '0 / 1 answered', tags: ['Q1'] });
    // The page stays the same document while the agent's thread arrives.
    await page.evaluate(`window.sameDocument = true`);
    await store.create('spec', agentComment('c-agent-note'));
    expect(await until(page, `document.getElementById('ov-v-hn').textContent === '4'`)).toBe(true);
    expect(await page.evaluate(`window.sameDocument`)).toBe(true);
  });
});

it('shows a citation inside an option without answering the question', async () => {
  await sidebar('store-option', async page => {
    await page.evaluate(`document.querySelector('#ov-card-1 .ov-qh').click()`);
    expect(await page.evaluate(`(() => {
      document.querySelector('#ov-card-1 .ov-opt a[href="#md-collab-anchor-2"]').click();
      return { posts: window.posts, path: location.pathname, shown: mdRender.currentDocument() };
    })()`)).toEqual({ posts: [], path: '/', shown: 'docs/storage.md' });
  });
});

it('loads the threads again when the event stream opens again', async () => {
  await sidebar('store-reconnect', async (page, store) => {
    // Writes made while the page is disconnected send it no event.
    await page.evaluate(`window.sidebarEvents.close()`);
    await store.create('spec', agentComment('c-while-away'));
    await page.evaluate(`window.sidebarEvents.dispatchEvent(new Event('open'))`);
    expect(await until(page, `document.getElementById('ov-v-hn').textContent === '4'`)).toBe(true);
  });
});

it('shows a question that arrived while the reader typed once the note loses focus, keeping the draft', async () => {
  await sidebar('store-typing', async (page, store) => {
    await page.evaluate(`(() => {
      document.querySelector('#ov-card-1 .ov-qh').click();
      const note = document.getElementById('ov-note-1');
      note.focus(); note.value = 'Draft answer'; note.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await store.create('spec', { ...imported()[0]!, id: 'q02-second-question', title: 'Second question', number: 2 });
    await until(page, `document.getElementById('ov-count').textContent === '0 / 2 answered'`);
    expect(await page.evaluate(`!!document.getElementById('ov-card-2')`)).toBe(false);
    expect(await page.evaluate(`(() => { document.getElementById('ov-note-1').blur(); return { card: !!document.getElementById('ov-card-2'), draft: document.getElementById('ov-note-1').value }; })()`))
      .toEqual({ card: true, draft: 'Draft answer' });
  });
});

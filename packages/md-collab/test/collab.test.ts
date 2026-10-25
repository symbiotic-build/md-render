import { afterAll, beforeAll, expect, it } from 'vitest';
import { useBrowser } from '../../../test/browser-fixture.js';
import type { BrowserSession } from '../../../src/browser.js';
import { execFile, spawnSync } from 'node:child_process';
import http from 'node:http';
import { access, cp, mkdtemp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { renderView, type SiteView } from 'md-render';
import { anchorAt, resolveAnchor } from '../src/anchors.js';
import { parseQuestionList, questionThreads } from '../src/import.js';
import { serve, type Session } from '../src/server.js';
import { decidersOf, readSettled } from '../src/settled.js';
import { pageState, settledDecisions } from '../src/state.js';
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
/** Reads a server-sent event stream until `text` arrives; fails when the stream ends first or after `ms`. */
async function heard(reader: ReadableStreamDefaultReader<Uint8Array>, text: string, ms = 10_000): Promise<string> {
  let received = '';
  const decoder = new TextDecoder();
  const deadline = Date.now() + ms;
  while (!received.includes(text)) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${text}; heard ${JSON.stringify(received)}`)), Math.max(0, deadline - Date.now())); });
    try {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) throw new Error(`The event stream ended before ${text}; heard ${JSON.stringify(received)}`);
      received += decoder.decode(value, { stream: true });
    } finally { clearTimeout(timer); }
  }
  return received;
}

it('writes and reads a thread file without loss, and derives status from its entries', () => {
  const thread = question();
  thread.context = 'A fenced example:\n\n```markdown\n## Entries\n\n### Example\n```\n\nChoice: not a field';
  const notes = ['Choice: 2 reads well', 'Source: the meeting', 'Settled as: nothing yet', '### Not an entry\nbody', 'Example:\n\n```\n## Entries\n### 2026-01-01T00:00:00Z person:x answer\n```', '\\## written with a backslash',
    ' Choice: 2', '\tSource: chat', '  An indented first line\nand a second'];
  notes.forEach((note, index) => thread.entries.push({ at: `2026-10-24T09:${40 + index}:00Z`, actor: 'person:operator', kind: 'comment', note }));
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

it('creates a comment without reading the other threads, and checks a numbered question against them', async () => {
  const store = new FileStore(path.join(root, 'store-unread'));
  await store.createCollection({ name: 'spec', title: 'Unread', settled: [] });
  const broken = path.join(store.root, 'spec/threads/broken.md');
  await writeFile(broken, 'Not a thread.\n');
  const comment: Thread = { id: 'c-new', kind: 'comment', title: 'New', anchors: [], context: '', options: [], entries: [{ at: '2026-10-24T12:00:00Z', actor: 'agent:test/1', kind: 'comment', note: 'New.' }] };
  await store.create('spec', comment);
  expect(await readFile(path.join(store.root, 'spec/threads/c-new.md'), 'utf8')).toBe(serializeThread(comment));
  await expect(store.create('spec', question())).rejects.toThrow(`${broken}: Thread file must start with YAML front matter`);
});

it('leaves no draft or lock behind when a write is refused, and refuses to write past a lock left by a crashed process', async () => {
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
  const lock = path.join(directory, '.lock');
  await writeFile(lock, `${pid} crashed`);
  await expect(store.append('spec', created.thread.id, { ...comment, note: 'After the crash.' }))
    .rejects.toThrow(`Collection spec is locked by process ${pid}, which no longer runs; if no md-collab command is writing, delete ${lock}`);
  expect([(await store.read('spec', created.thread.id)).thread.entries.map(entry => entry.note), await readFile(lock, 'utf8')]).toEqual([['', 'First.'], `${pid} crashed`]);
  // The documented repair: delete the lock by hand, then write again.
  await rm(lock);
  await store.append('spec', created.thread.id, { ...comment, note: 'After the repair.' });
  expect((await store.read('spec', created.thread.id)).thread.entries.map(entry => entry.note)).toEqual(['', 'First.', 'After the repair.']);
  expect((await readdir(directory, { recursive: true })).sort()).toEqual(files);
});

it('reports a lock it could not remove after a write, and leaves it for the documented repair', async () => {
  const store = new FileStore(path.join(root, 'store-release'));
  await store.createCollection({ name: 'spec', title: 'Release', settled: [] });
  const lock = path.join(store.root, 'spec/.lock');
  const file = path.join(store.root, 'spec/threads/q01-identifier-length.md');
  // The thread is a named pipe, so the append holds the lock until the test writes the thread into
  // it. Meanwhile the lock becomes a folder, which the release cannot read.
  await run('mkfifo', [file]);
  const comment = { at: '2026-10-24T10:00:00Z', actor: 'person:operator', kind: 'comment' as const, note: 'Saved.' };
  const appending = store.append('spec', 'q01-identifier-length', comment);
  const outcome = appending.then(() => 'resolved', (error: Error) => error.message);
  for (const deadline = Date.now() + 10_000; !(await access(lock).then(() => true, () => false)); await delay(10)) {
    if (Date.now() > deadline) throw new Error('The append took no lock');
  }
  await rm(lock);
  await mkdir(lock);
  await writeFile(file, serializeThread(question()));
  expect(await outcome).toBe(`Could not remove the lock ${lock}: EISDIR: illegal operation on a directory, read; the change may be saved. If no md-collab command is writing, delete the lock`);
  expect([(await store.read('spec', 'q01-identifier-length')).thread.entries.map(entry => entry.note), await access(lock).then(() => true, () => false)]).toEqual([['', 'Saved.'], true]);
  // The documented repair: the change is saved, so delete the lock and carry on.
  await rm(lock, { recursive: true });
  await store.append('spec', 'q01-identifier-length', { ...comment, note: 'After the repair.' });
  expect((await store.read('spec', 'q01-identifier-length')).thread.entries.map(entry => entry.note)).toEqual(['', 'Saved.', 'After the repair.']);
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
  const settled = readSettled(view.documents.find(document => document.path === 'docs/decisions.md')!);
  expect(settled.map(({ id, topic, date, decidedBy }) => ({ id, topic, date, decidedBy }))).toEqual([
    { id: 'decision-fixed-group', topic: 'Storage choices', date: '2026-10-12', decidedBy: ['operator'] },
    { id: 'decision-redo', topic: 'Storage choices', date: '2026-10-14', decidedBy: ['lead'] },
  ]);
  expect(decidersOf('Q73 and final Q162 in the log, with the lead clarification of 2026-10-14.')).toEqual(['operator', 'lead']);
  expect(decidersOf('anything', 'lead')).toEqual(['lead']);
  expect(decidersOf('Benchmark measurement on the reference host, 2026-10-16.')).toEqual(['measurement']);
  expect(() => decidersOf('Agreed in review, 2026-10-16.')).toThrow('Authority names no operator, lead or measurement; add a **Decided by:** line: Agreed in review, 2026-10-16.');
});

it('reads the decisions md-render renders: none from a code fence, and one after a single-quoted anchor', async () => {
  const folder = path.join(root, 'fenced-decisions');
  await mkdir(folder);
  await writeFile(path.join(folder, 'decisions.md'), "# Decisions\n\n## Format\n\nAn example:\n\n```markdown\n### Decision: Only an example\n\n**Choice:** None.\n```\n\n<a id='decision-quoted'></a>\n\n### Decision: Quoted anchor\n\n**Choice:** Single quotes.\n\n**Authority:** Lead decision, 2026-10-20.\n");
  const { view: rendered } = await renderView(folder, { mermaid: false });
  expect(readSettled(rendered.documents[0]!).map(({ id, title, topic, choice, date, decidedBy }) => ({ id, title, topic, choice, date, decidedBy }))).toEqual([
    { id: 'decision-quoted', title: 'Quoted anchor', topic: 'Format', choice: 'Single quotes.', date: '2026-10-20', decidedBy: ['lead'] },
  ]);
});

it('takes settled decisions from the text md-render rendered, not from the file as it is now', async () => {
  const folder = path.join(root, 'rendered-decisions');
  await mkdir(folder);
  await writeFile(path.join(folder, 'decisions.md'), sizeDecision);
  const { view: rendered } = await renderView(folder, { mermaid: false });
  // The chapter changes after the render, as it may while a render runs.
  await writeFile(path.join(folder, 'decisions.md'), sizeDecision.replace('Fixed size', 'Changed size'));
  expect(settledDecisions({ name: 'spec', title: 'Rendered', settled: ['decisions.md'] }, rendered).map(decision => decision.title)).toEqual(['Fixed size']);
});

it('keeps decisions from two chapters apart when they share an anchor', async () => {
  const store = new FileStore(path.join(root, 'store-settled'));
  const collection = { name: 'spec', title: 'Settled', settled: ['docs/decisions.md', 'docs/more-decisions.md'] };
  await store.createCollection(collection);
  const state = await pageState({ store, collection, view, settled: settledDecisions(collection, view), commit, person: 'person:operator' });
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
    await heard(reader, ': connected');
    await store.append('spec', created.thread.id, { at: '2026-10-24T12:00:00Z', actor: 'agent:test/1', kind: 'comment', note: 'Seen?' });
    await heard(reader, 'event: changed');
    await reader.cancel();
    const comment = await fetch(origin + '/api/comments', { method: 'POST', headers: { ...headers, origin }, body: JSON.stringify({ note: 'Is 4 MiB measured?', anchors: [{ path: 'docs/storage.md', lines: [7, 7], quote: 'The write group is 4 MiB.' }] }) });
    expect(comment.status).toBe(200);
    const after = await (await fetch(origin + '/api/state', { headers })).json();
    expect(after.threads.map((item: { kind: string; status: string }) => [item.kind, item.status])).toEqual([['comment', 'open'], ['question', 'answered']]);
  } finally { await session.close(); }
});

it('tells an open page about every entry an agent appends to a thread', async () => {
  const storeRoot = path.join(root, 'store-appends');
  const store = new FileStore(storeRoot);
  await store.createCollection({ name: 'spec', title: 'Appends', settled: [] });
  const created = await store.create('spec', question());
  const session = await serve({ documents: path.join(docs, 'docs'), store: storeRoot, collection: 'spec', person: 'person:operator', mermaid: false });
  try {
    // Each append renames a new file over the thread; every one of them is a change. A fresh
    // connection per append hears only the changes made after it connected.
    for (const note of ['First.', 'Second.', 'Third.']) {
      const reader = (await fetch(session.url + 'api/events')).body!.getReader();
      await heard(reader, ': connected');
      await store.append('spec', created.thread.id, { at: '2026-10-24T12:00:00Z', actor: 'agent:test/1', kind: 'comment', note });
      await heard(reader, 'event: changed');
      await reader.cancel();
    }
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

const sizeDecision = `# Decisions

<a id="decision-size"></a>

### Decision: Fixed size

**Choice:** Keep the size.

**Authority:** Lead decision, 2026-10-12.
`;

it('keeps the last good page and its decisions when a re-render fails, and tells the open page', async () => {
  const documents = path.join(root, 'render-docs');
  await mkdir(documents, { recursive: true });
  await writeFile(path.join(documents, 'a.md'), '# A\n\nFirst text.\n');
  await writeFile(path.join(documents, 'decisions.md'), sizeDecision);
  const storeRoot = path.join(root, 'store-render');
  await new FileStore(storeRoot).createCollection({ name: 'spec', title: 'Render', settled: ['decisions.md'] });
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
    const shown = async () => {
      const [page, state] = await Promise.all([(await fetch(session.url)).text(), (await fetch(session.url + 'api/state')).json()]);
      return { first: page.includes('First text.'), decisions: state.settled.map((decision: { title: string }) => decision.title) };
    };
    // One edit renames the decision and breaks the render.
    await writeFile(path.join(documents, 'decisions.md'), '---\ntitle: [1]\n---\n' + sizeDecision.replace('Fixed size', 'Changed size'));
    expect(await heard(reader, 'event: failed')).toContain('data: {"error":"');
    expect(await shown()).toEqual({ first: true, decisions: ['Fixed size'] });
    await writeFile(path.join(documents, 'decisions.md'), sizeDecision.replace('Fixed size', 'Changed size'));
    await heard(reader, 'event: reload');
    expect(await shown()).toEqual({ first: true, decisions: ['Changed size'] });
    await reader.cancel();
  } finally { await session.close(); }
});

it('finishes a running re-render before the session closes', async () => {
  const documents = path.join(root, 'close-docs');
  await mkdir(documents, { recursive: true });
  await writeFile(path.join(documents, 'a.md'), '# A\n\nText.\n');
  const storeRoot = path.join(root, 'store-close');
  await new FileStore(storeRoot).createCollection({ name: 'spec', title: 'Close', settled: [] });
  // A diagram render starts a browser that keeps its profile in the temporary folder until the render ends.
  const profiles = path.join(root, 'close-profiles');
  await mkdir(profiles);
  const temporary = process.env.TMPDIR;
  process.env.TMPDIR = profiles;
  try {
    const session = await serve({ documents, store: storeRoot, collection: 'spec', person: 'person:operator', mermaid: true });
    await writeFile(path.join(documents, 'a.md'), '# A\n\n```mermaid\ngraph TD; A-->B\n```\n');
    for (const deadline = Date.now() + 10_000; !(await readdir(profiles)).length; await delay(10)) {
      if (Date.now() > deadline) { await session.close(); throw new Error('The re-render started no browser'); }
    }
    await session.close();
    expect(await readdir(profiles)).toEqual([]);
  } finally {
    if (temporary === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = temporary;
  }
});

// Records script errors, unhandled rejections and posts on the page, and keeps the sidebar's event stream reachable.
const pageScript = `window.pageErrors = [];
addEventListener('error', event => pageErrors.push(String(event.message)));
addEventListener('unhandledrejection', event => pageErrors.push('Unhandled rejection: ' + String(event.reason)));
window.posts = [];
const pageFetch = window.fetch;
// A test can hold posts back: set window.postGate to a promise, and posts wait for it.
window.fetch = async (url, init) => { if (init?.method === 'POST') { posts.push(String(url)); await window.postGate; } return pageFetch(url, init); };
const PageEvents = window.EventSource;
window.EventSource = class extends PageEvents { constructor(...args) { super(...args); window.sidebarEvents = this; } };`;
const until = (page: BrowserSession, expression: string) => page.evaluate(`new Promise((resolve, reject) => { const start = performance.now(); (function check() { const value = ${expression}; if (value) resolve(value); else if (performance.now() - start > 5000) reject(new Error('Timed out: ' + ${JSON.stringify(expression)})); else setTimeout(check, 50); })(); })`);
const agentComment = (id: string): Thread => ({ id, kind: 'comment', title: 'Agent note', anchors: [{ role: 'main', path: 'docs/storage.md', commit, lines: [7, 7] }], context: '', options: [],
  entries: [{ at: '2026-10-24T12:00:00Z', actor: 'agent:test/1', kind: 'comment', note: 'Agent note' }] });

/** Serves a store holding the imported question and opens the page in the test browser. */
async function sidebar(name: string, work: (page: BrowserSession, store: FileStore, session: Session) => Promise<void>, documents = path.join(docs, 'docs')): Promise<void> {
  const storeRoot = path.join(root, name);
  const store = new FileStore(storeRoot);
  await store.createCollection({ name: 'spec', title: 'Spec review', settled: ['docs/decisions.md'] });
  await store.createAll('spec', imported());
  const session = await serve({ documents, store: storeRoot, collection: 'spec', person: 'person:operator', mermaid: false });
  try {
    await withBrowser(async page => {
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: pageScript });
      await page.navigate(session.url);
      await until(page, `document.getElementById('ov-v-hn')?.textContent === '3'`);
      await work(page, store, session);
      expect(await page.evaluate(`window.pageErrors`)).toEqual([]);
    });
  } finally { await session.close(); }
}

it("shows the sidebar in a real browser and adds an agent's new thread without a reload", async () => {
  await sidebar('store-c', async (page, store) => {
    // A desktop window, where the sidebar stays open beside the documents.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    // The question's tag sits on its main passage, in the storage chapter.
    expect(await page.evaluate(`mdRender.show({ path: 'docs/storage.md' }).then(() => {
      // Seen means rendered, not hidden or transparent by CSS, and with an area inside the window.
      const seen = element => { const box = element.getBoundingClientRect();
        return element.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && box.width > 0 && box.height > 0 && box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight; };
      const panel = document.getElementById('ov-panel'), title = document.querySelector('#ov-card-1 .ov-title');
      return { panel: seen(panel) && panel.getBoundingClientRect().width > 200, title: seen(title) ? title.firstChild.textContent : null,
        count: document.getElementById('ov-count').textContent, tags: [...document.querySelectorAll('.ov-tag')].filter(seen).map(tag => tag.textContent) };
    })`)).toEqual({ panel: true, title: 'How long may an identifier be?', count: '0 / 1 answered', tags: ['Q1'] });
    // The page stays the same document while the agent's thread arrives.
    await page.evaluate(`window.sameDocument = true`);
    await store.create('spec', agentComment('c-agent-note'));
    expect(await until(page, `document.getElementById('ov-v-hn').textContent === '4'`)).toBe(true);
    expect(await page.evaluate(`window.sameDocument`)).toBe(true);
  });
});

it('shows the documents rendered while the event stream was closed once it opens again', async () => {
  const copy = path.join(root, 'repo-reconnect');
  await cp(docs, copy, { recursive: true });
  await sidebar('store-reconnect-render', async (page, _store, session) => {
    await page.evaluate(`window.sameDocument = true; window.sidebarEvents.close()`);
    await writeFile(path.join(copy, 'docs/long.md'), long.replace('Next paragraph.', 'Changed paragraph.'));
    for (const deadline = Date.now() + 10_000; !(await (await fetch(session.url)).text()).includes('Changed paragraph.'); await delay(50)) {
      if (Date.now() > deadline) throw new Error('The server did not render the changed document');
    }
    await page.waitForNavigation(() => page.evaluate(`window.sidebarEvents.dispatchEvent(new Event('open'))`));
    expect(await page.evaluate(`({ same: window.sameDocument ?? false, changed: document.body.textContent.includes('Changed paragraph.') })`)).toEqual({ same: false, changed: true });
  }, path.join(copy, 'docs'));
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

// The focus leaves the sidebar straight from the note, or first moves to a button in the sidebar.
it.each([
  ['from the note', `document.getElementById('ov-note-1').blur()`],
  ['through the Clear answer button', `document.querySelector('#ov-card-1 .ov-clear').focus(); document.querySelector('#ov-card-1 .ov-clear').blur()`],
])('shows a question that arrived while the reader typed once the focus leaves the sidebar %s, keeping the draft', async (name, leave) => {
  await sidebar('store-typing-' + name.split(' ').pop()!.toLowerCase(), async (page, store) => {
    await page.evaluate(`(() => {
      document.querySelector('#ov-card-1 .ov-qh').click();
      const note = document.getElementById('ov-note-1');
      note.focus(); note.value = 'Draft answer'; note.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await store.create('spec', { ...imported()[0]!, id: 'q02-second-question', title: 'Second question', number: 2 });
    await until(page, `document.getElementById('ov-count').textContent === '0 / 2 answered'`);
    expect(await page.evaluate(`!!document.getElementById('ov-card-2')`)).toBe(false);
    expect(await page.evaluate(`(() => { ${leave}; return { card: !!document.getElementById('ov-card-2'), draft: document.getElementById('ov-note-1').value }; })()`))
      .toEqual({ card: true, draft: 'Draft answer' });
  });
});

it('keeps what the reader typed while a save was running', async () => {
  await sidebar('store-save-typing', async page => {
    await page.evaluate(`(() => {
      document.querySelector('#ov-card-1 .ov-qh').click();
      const type = text => { const note = document.getElementById('ov-note-1'); note.value = text; note.dispatchEvent(new Event('input', { bubbles: true })); };
      type('First note');
      window.postGate = new Promise(resolve => { window.releasePosts = resolve; });
      document.querySelector('#ov-card-1 .ov-save').click();
      type('First note, then more');
      window.releasePosts();
    })()`);
    await until(page, `document.querySelector('#ov-card-1 .ov-saved')?.textContent.startsWith('Saved')`);
    expect(await page.evaluate(`document.getElementById('ov-note-1').value`)).toBe('First note, then more');
  });
});

it("opens the comment box even when an annotation carries the box's ID", async () => {
  await sidebar('store-control-id', async (page, store) => {
    await store.create('spec', { ...imported()[0]!, id: 'q02-control-id', title: 'Control ID', number: 2, context: 'An anchor <a id="ov-composer"></a>in the context.' });
    await until(page, `document.getElementById('ov-count').textContent === '0 / 2 answered'`);
    await page.evaluate(`(() => {
      document.querySelector('#ov-card-2 .ov-qh').click();
      const paragraph = [...document.querySelectorAll('[data-source-path="docs/storage.md"] p')].find(p => p.textContent.includes('4 MiB'));
      const range = document.createRange(); range.selectNodeContents(paragraph);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    })()`);
    await until(page, `getComputedStyle(document.getElementById('ov-sel')).display === 'block'`);
    expect(await page.evaluate(`(() => { document.getElementById('ov-selbtn').click(); return document.querySelector('div.ov-composer').checkVisibility(); })()`)).toBe(true);
  });
});

it('shows the documents of a server restarted on the same port once the page connects again', async () => {
  const copy = path.join(root, 'repo-restart');
  await cp(docs, copy, { recursive: true });
  await sidebar('store-restart', async (page, _store, session) => {
    await page.evaluate(`window.sameDocument = true; window.sidebarEvents.close()`);
    await session.close();
    await writeFile(path.join(copy, 'docs/long.md'), long.replace('Next paragraph.', 'Changed paragraph.'));
    const restarted = await serve({ documents: path.join(copy, 'docs'), store: path.join(root, 'store-restart'), collection: 'spec', person: 'person:operator', mermaid: false, port: Number(new URL(session.url).port) });
    try {
      await page.waitForNavigation(() => page.evaluate(`window.sidebarEvents.dispatchEvent(new Event('open'))`));
      expect(await page.evaluate(`({ same: window.sameDocument ?? false, changed: document.body.textContent.includes('Changed paragraph.') })`)).toEqual({ same: false, changed: true });
    } finally { await restarted.close(); }
  }, path.join(copy, 'docs'));
});

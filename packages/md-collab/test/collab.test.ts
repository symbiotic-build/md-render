import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { useBrowser } from '../../../test/browser-fixture.js';
import type { BrowserSession } from '../../../src/browser.js';
import { execFile, spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { access, chmod, cp, mkdtemp, mkdir, readdir, readFile, realpath, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { renderView, type SiteView } from 'md-render';
import { anchorAt, resolveAnchor } from '../src/anchors.js';
import { parseQuestionList, questionThreads } from '../src/import.js';
import { serve, type Session } from '../src/server.js';
import { decidersOf, readSettled } from '../src/settled.js';
import { pageState, settledDecisions, type PageState } from '../src/state.js';
import { ConflictError, FileStore } from '../src/store.js';
import { parseThread, serializeThread, threadStatus, type Thread } from '../src/thread.js';

const withBrowser = useBrowser();

const run = promisify(execFile);
let root: string;
let docs: string;
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
  view = (await renderView(path.join(docs, 'docs'), { mermaid: false })).view;
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

const question = (): Thread => ({
  id: 'q01-identifier-length', kind: 'question', title: 'How long may an identifier be?', decides: 'operator', number: 1, topic: 'Limits',
  anchors: [{ role: 'main', path: 'docs/storage.md', block: 'limits~000000', tag: 'p', position: 3, text: 'Identifiers may be long.' }],
  context: '`FACT` The spec says identifiers may be long.',
  options: [{ n: 1, text: '**Cap at 256 bytes (recommended).**', recommended: true }, { n: 2, text: 'No cap.', recommended: false }],
  entries: [{ at: '2026-10-22T13:09:00Z', actor: 'agent:claude-code/memory', kind: 'raised', note: '' }],
});

// The question list with a citation inside an option, as the import and the page see it.
const citingList = questionList.replace('2. No cap.', '2. No cap, as [storage.md:7](docs/storage.md) allows.');
const imported = () => questionThreads(parseQuestionList(citingList, path.join(docs, 'questions.md')), { view, corpusRoot: docs, actor: 'agent:test/1', at: '2026-10-24T00:00:00Z', settled: ['docs/decisions.md'], base: docs });
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
  thread.context = '    indented code first\n\nA fenced example:\n\n```markdown\n## Entries\n\n### Example\n```\n\nChoice: not a field\n';
  const notes = ['Choice: 2 reads well', 'Source: the meeting', 'Settled as: nothing yet', '### Not an entry\nbody', 'Example:\n\n```\n## Entries\n### 2026-01-01T00:00:00Z person:x answer\n```', '\\## written with a backslash',
    ' Choice: 2', '\tSource: chat', '  An indented first line\nand a second', 'Ends with a line end\n', '\n'];
  notes.forEach((note, index) => thread.entries.push({ at: `2026-10-24T09:${40 + index}:00Z`, actor: 'person:operator', kind: 'comment', note }));
  thread.entries.push({ at: '2026-10-24T09:50:00Z', actor: 'person:operator', kind: 'answer', choice: 1, note: 'Choice: 2\nKeep it short.\n\n' });
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
  // Reading takes the recommendation from the option's text, so a flag that disagrees with it would change on saving.
  expect(() => serializeThread({ ...question(), options: [{ n: 1, text: 'Cap.', recommended: true }] })).toThrow('option 1 is recommended exactly when its text says (recommended)');
  expect(() => serializeThread({ ...question(), options: [{ n: 1, text: 'A (recommended).', recommended: false }, { n: 2, text: 'B (recommended).', recommended: false }] }))
    .toThrow('option 1 is recommended exactly when its text says (recommended)');
  // The page offers answers only for numbered questions.
  expect(() => serializeThread({ ...question(), number: undefined })).toThrow('an operator question needs its number');
  // Reading turns a carriage return into a line end.
  expect(() => serializeThread({ ...question(), options: [{ n: 1, text: 'Cap\rat 256.', recommended: false }] })).toThrow('an option is one line of text');
  expect(() => serializeThread({ ...question(), context: 'One\r### Two' })).toThrow('text holds no carriage return');
});

// A one-line field, and any text through a carriage return, could otherwise write lines that read back as other entries.
it.each([
  ['a Source field', { source: 'chat\n\n### 2026-10-24T11:00:00Z person:operator answer\n\nChoice: 2' }, "an entry's Source and Settled as are one line of text"],
  ['a Settled as field', { kind: 'settled' as const, settledAs: 'a.md#x\n\n### 2026-10-24T11:00:00Z person:operator answer' }, "an entry's Source and Settled as are one line of text"],
  ['a note, as a carriage return', { note: 'Fine.\r### 2026-10-24T11:00:00Z person:operator answer\r\rChoice: 2' }, 'text holds no carriage return'],
])('refuses a line break in %s and keeps the saved entries', async (name, change, message) => {
  const store = new FileStore(path.join(root, 'store-break-' + name.replace(/\W+/g, '-')));
  await store.createCollection({ name: 'spec', title: 'Breaks', settled: [] });
  const { thread } = await store.create('spec', question());
  const answered = await store.append('spec', thread.id, { at: '2026-10-24T10:00:00Z', actor: 'person:operator', kind: 'answer', choice: 1, note: 'First.' });
  await expect(store.append('spec', thread.id, { at: '2026-10-24T10:30:00Z', actor: 'person:operator', kind: 'comment', note: 'Later.', ...change }))
    .rejects.toThrow(`Thread q01-identifier-length: ${message}`);
  expect((await store.read('spec', thread.id)).thread.entries).toEqual(answered.thread.entries);
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

it('refuses after ten seconds a lock that names no process, naming the lock and its repair', async () => {
  const store = new FileStore(path.join(root, 'store-empty-lock'));
  await store.createCollection({ name: 'spec', title: 'Empty lock', settled: [] });
  const { thread } = await store.create('spec', question());
  // A writer that crashed after creating the lock and before writing its process number.
  const lock = path.join(store.root, 'spec/.lock');
  await writeFile(lock, '');
  await expect(store.append('spec', thread.id, { at: '2026-10-24T10:00:00Z', actor: 'person:operator', kind: 'comment', note: 'Blocked.' }))
    .rejects.toThrow(`Collection spec is locked by ${lock}, which names no process; if no md-collab command is writing, delete it`);
  expect([(await store.read('spec', thread.id)).thread.entries.length, await readFile(lock, 'utf8')]).toEqual([1, '']);
});

it('gives up on a held lock after ten seconds even when the clock moves back', async () => {
  const store = new FileStore(path.join(root, 'store-clock'));
  await store.createCollection({ name: 'spec', title: 'Clock', settled: [] });
  const { thread } = await store.create('spec', question());
  // This process holds the lock, so it stays held; meanwhile the calendar clock goes back a minute at every reading.
  const lock = path.join(store.root, 'spec/.lock');
  await writeFile(lock, `${process.pid} held`);
  let now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now -= 60_000));
  let timer: NodeJS.Timeout | undefined;
  try {
    const outcome = store.append('spec', thread.id, { at: '2026-10-24T10:00:00Z', actor: 'person:operator', kind: 'comment', note: 'Waiting.' }).then(() => 'saved', (error: Error) => error.message);
    const late = new Promise<string>(resolve => { timer = setTimeout(() => resolve('still waiting after 20 s'), 20_000); });
    expect(await Promise.race([outcome, late])).toBe(`Collection spec is locked by process ${process.pid}; try again when it finishes`);
  } finally {
    clearTimeout(timer);
    clock.mockRestore();
    await rm(lock);
  }
});

// Edits to the storage chapter after a comment was written on its "Identifiers may be long." paragraph.
it.each([
  ['the text is unchanged', (text: string) => text, { state: 'same', blocks: 1, diff: null }],
  ['a paragraph is added before it', (text: string) => text.replace('The write group', 'A new rule.\n\nThe write group'), { state: 'same', blocks: 1, diff: null }],
  ['its section heading is renamed under the same explicit anchor', (text: string) => text.replace('## Limits', '## Caps'), { state: 'same', blocks: 1, diff: null }],
  ['its words change', (text: string) => text.replace('may be long', 'may be very long'), { state: 'updated', blocks: 1, diff: [{ change: '=', text: 'Identifiers may be' }, { change: '+', text: 'very' }, { change: '=', text: 'long.' }] }],
  ['it is deleted', (text: string) => text.replace('\nIdentifiers may be long.\n', ''), { state: 'removed', blocks: 0, diff: null }],
  ['it becomes a list item', (text: string) => text.replace('Identifiers may be long.', '- Identifiers may be long.'), { state: 'removed', blocks: 0, diff: null }],
  ['its section gets another name', (text: string) => text.replace('<a id="limits"></a>\n\n## Limits', '## Caps'), { state: 'removed', blocks: 0, diff: null }],
])('shows a passage whose chapter changed as the same block, updated or removed when %s', async (name, edit, expected) => {
  const copy = path.join(root, 'edit-' + name.replace(/\W+/g, '-'));
  await cp(docs, copy, { recursive: true });
  await writeFile(path.join(copy, 'docs/storage.md'), edit(spec));
  const edited = (await renderView(path.join(copy, 'docs'), { mermaid: false })).view;
  const store = new FileStore(path.join(root, 'store-edit-' + name.replace(/\W+/g, '-')));
  const collection = { name: 'spec', title: 'Edits', settled: [] };
  await store.createCollection(collection);
  await store.create('spec', { ...agentComment('c-on-identifiers'), anchors: [anchorAt(view, 'docs/storage.md', [9, 9], 'main')] });
  const [anchor] = (await pageState({ store, collection, view: edited, settled: [], person: 'person:operator' })).threads[0]!.anchors;
  expect({ state: anchor!.state, blocks: anchor!.blocks.length, text: anchor!.text, diff: anchor!.diff }).toEqual({ ...expected, text: 'Identifiers may be long.' });
});

it('anchors a citation to the first block with text that its lines cover', () => {
  // Lines 4-7 start inside the paragraph of lines 3-5, the second block of the Long section.
  expect(anchorAt(view, 'docs/long.md', [4, 7], 'main')).toEqual({ role: 'main', path: 'docs/long.md', block: expect.stringMatching(/^long~[0-9a-f]{6}$/), tag: 'p', position: 2, text: 'First line second line third line.' });
  expect(() => anchorAt(view, 'docs/storage.md', [2, 2], 'main')).toThrow('docs/storage.md:2-2 covers no rendered text');
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
  expect(readSettled(rendered.documents[0]!)).toEqual([
    { id: 'decision-quoted', title: 'Quoted anchor', topic: 'Format', path: 'decisions.md', date: '2026-10-20', decidedBy: ['lead'] },
  ]);
});

it("keeps a decision's own Authority when its fenced example shows field lines", async () => {
  const folder = path.join(root, 'example-fields');
  await mkdir(folder);
  await writeFile(path.join(folder, 'decisions.md'), '# Decisions\n\n### Decision: Example fields\n\n**Choice:** The real choice.\n\n**Authority:** Lead decision, 2026-10-20.\n\nA decision is written like this:\n\n```markdown\n**Choice:** Example only\n\n**Authority:** Operator decision, 2030-01-01.\n```\n');
  const { view: rendered } = await renderView(folder, { mermaid: false });
  expect(readSettled(rendered.documents[0]!)).toEqual([
    { id: 'decision-example-fields', title: 'Example fields', topic: null, path: 'decisions.md', date: '2026-10-20', decidedBy: ['lead'] },
  ]);
});

// Markdown's two hard line breaks: a backslash and two spaces at the end of the line.
it.each([['a backslash', '\\'], ['two spaces', '  ']])('reads the decider and date of an Authority with a hard line break written with %s', async (name, mark) => {
  const folder = path.join(root, 'hard-break-' + name.split(' ').pop());
  await mkdir(folder);
  await writeFile(path.join(folder, 'decisions.md'), `# Decisions\n\n### Decision: Broken line\n\n**Choice:** One.\n\n**Authority:** Lead${mark}\ndecision, 2026-10-20.\n`);
  const { view: rendered } = await renderView(folder, { mermaid: false });
  expect(readSettled(rendered.documents[0]!)).toEqual([
    { id: 'decision-broken-line', title: 'Broken line', topic: null, path: 'decisions.md', date: '2026-10-20', decidedBy: ['lead'] },
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

it('shows each settled decision with its title, date, decider and a link to its heading, apart from a decision of another chapter with the same anchor', async () => {
  const store = new FileStore(path.join(root, 'store-settled'));
  const collection = { name: 'spec', title: 'Settled', settled: ['docs/decisions.md', 'docs/more-decisions.md'] };
  await store.createCollection(collection);
  const state = await pageState({ store, collection, view, settled: settledDecisions(collection, view), person: 'person:operator' });
  // History opens the first block of a decision's passage.
  const opened = (anchor: PageState['settled'][number]['anchors'][number]) => {
    const block = view.documents.find(document => document.path === anchor.path)!.blocks.find(item => item.id === anchor.blocks[0]);
    return `${anchor.path} ${block?.tag} ${block?.text}`;
  };
  expect(state.settled.map(({ anchors, ...decision }) => ({ ...decision, opens: anchors.map(opened) }))).toEqual([
    { id: 'docs/decisions.md#decision-fixed-group', title: 'Fixed write group', topic: 'Storage choices', date: '2026-10-12', decidedBy: ['operator'], opens: ['docs/decisions.md h3 Decision: Fixed write group'] },
    { id: 'docs/decisions.md#decision-redo', title: 'Separate redo call', topic: 'Storage choices', date: '2026-10-14', decidedBy: ['lead'], opens: ['docs/decisions.md h3 Decision: Separate redo call'] },
    { id: 'docs/more-decisions.md#decision-redo', title: 'Redo in one place', topic: null, date: '2026-10-15', decidedBy: ['lead'], opens: ['docs/more-decisions.md h3 Decision: Redo in one place'] },
  ]);
});

it('imports a House Rules question list with its cited passages as anchors', () => {
  const listed = parseQuestionList(citingList, path.join(docs, 'questions.md'));
  expect(listed).toMatchObject([{ number: 1, topic: 'Limits', title: 'How long may an identifier be?', options: [{ n: 1, recommended: true }, { n: 2, recommended: false }] }]);
  const [thread] = imported();
  expect(thread!.id).toBe('q01-how-long-may-an-identifier-be');
  // Each citation names the first block with text that its lines cover.
  expect(thread!.anchors.map(anchor => [anchor.role, anchor.path, anchor.text])).toEqual([['main', 'docs/storage.md', 'Identifiers may be long.'], ['also', 'docs/decisions.md', 'Choice: Keep the write group at 4 MiB (limits).'], ['also', 'docs/storage.md', 'The write group is 4 MiB.']]);
  expect(thread!.context).toContain('([storage.md:9](#md-collab-anchor-0))');
  expect(thread!.context).toContain('([decisions.md:9-11](#md-collab-anchor-1))');
  expect(thread!.context).not.toContain('Answer like so');
  expect(thread!.options[1]!.text).toBe('No cap, as [storage.md:7](#md-collab-anchor-2) allows.');
});

it('refuses a question list whose question holds a fenced code block', () => {
  // The example's question-shaped heading and numbered lines would otherwise become another question and its options.
  const fenced = questionList.replace('Until this is answered, keys cannot be built.', 'An example:\n\n```markdown\n### 9\\. Example question\n\n1. Example option\n```');
  expect(() => parseQuestionList(fenced, path.join(docs, 'questions.md'))).toThrow('Question 1: import does not read a fenced code block in a question; move the example into the documents and cite it');
});

it('serves the page only under its own host and accepts writes only from its own origin', async () => {
  const storeRoot = path.join(root, 'store-b');
  const store = new FileStore(storeRoot);
  await store.createCollection({ name: 'spec', title: 'Spec review', settled: ['docs/decisions.md'] });
  const [thread] = questionThreads(parseQuestionList(questionList, path.join(docs, 'questions.md')), { view, corpusRoot: docs, actor: 'agent:test/1', at: '2026-10-24T00:00:00Z', settled: ['docs/decisions.md'], base: docs });
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
    expect(state.threads[0]).toMatchObject({ id: created.thread.id, status: 'open', number: 1, anchors: [{ role: 'main', state: 'same' }, { role: 'also', state: 'same' }] });
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
    const comment = await fetch(origin + '/api/comments', { method: 'POST', headers: { ...headers, origin }, body: JSON.stringify({ generation: state.generation, note: 'Is 4 MiB measured?', path: 'docs/storage.md', block: groupBlock() }) });
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

/** Serves a copy of the documents, with a store holding one question, and connects a page to its events. */
async function connected(name: string, work: (copy: string, store: FileStore, reader: ReadableStreamDefaultReader<Uint8Array>, session: Session) => Promise<void>, prepare?: (copy: string) => Promise<void>): Promise<void> {
  const copy = path.join(root, 'repo-' + name);
  await cp(docs, copy, { recursive: true });
  await prepare?.(copy);
  const store = new FileStore(path.join(root, 'store-' + name));
  await store.createCollection({ name: 'spec', title: 'Changes', settled: [] });
  await store.create('spec', question());
  const session = await serve({ documents: path.join(copy, 'docs'), store: store.root, collection: 'spec', person: 'person:operator', mermaid: false });
  try {
    const reader = (await fetch(session.url + 'api/events')).body!.getReader();
    await heard(reader, ': connected');
    await work(copy, store, reader, session);
    await reader.cancel();
  } finally { await session.close(); }
}

// One change while a page is connected; the page hears of it within a few seconds, and the page or
// the state it then loads shows the change.
it.each([
  ['an edit to a document', 'reload', 'Identifiers are short.', (copy: string) => writeFile(path.join(copy, 'docs/storage.md'), spec.replace('Identifiers may be long.', 'Identifiers are short.'))],
  ['a new document', 'reload', 'A new chapter.', (copy: string) => writeFile(path.join(copy, 'docs/new.md'), '# New\n\nA new chapter.\n')],
  ["an agent's append to a thread", 'changed', 'Seen by the agent.', (_copy: string, store: FileStore) => store.append('spec', 'q01-identifier-length', { at: '2026-10-24T12:00:00Z', actor: 'agent:test/1', kind: 'comment', note: 'Seen by the agent.' })],
  ['a new thread file', 'changed', 'Agent note', (_copy: string, store: FileStore) => store.create('spec', agentComment('c-agent-note'))],
])('tells an open page about %s within a few seconds', async (name, event, text, change) => {
  await connected('change-' + name.replace(/\W+/g, '-'), async (copy, store, reader, session) => {
    await change(copy, store);
    await heard(reader, `event: ${event}`, 5000);
    const shown = event === 'reload' ? await (await fetch(session.url)).text() : JSON.stringify(await (await fetch(session.url + 'api/state')).json());
    expect(shown.includes(text)).toBe(true);
  });
});

it('re-renders each time a document is replaced by rename, also when the replacement keeps the modification time and size', async () => {
  // Whole seconds, so a replacement can carry exactly the time of the file it replaces.
  const kept = new Date('2026-10-24T12:00:00Z'), later = new Date('2026-10-24T13:00:00Z');
  await connected('rename', async (copy, _store, reader, session) => {
    const file = path.join(copy, 'docs/storage.md');
    // Every replacement has the original's size; the first and third keep the time of the file they replace.
    for (const [n, time] of [[1, kept], [2, later], [3, later]] as const) {
      await writeFile(file + '.new', spec.replace('Identifiers may be long.', `Identifiers are short ${n}.`));
      await utimes(file + '.new', time, time);
      await rename(file + '.new', file);
      await heard(reader, 'event: reload', 5000);
      expect((await (await fetch(session.url)).text()).includes(`Identifiers are short ${n}.`)).toBe(true);
    }
  }, copy => utimes(path.join(copy, 'docs/storage.md'), kept, kept));
});

it('refuses a comment or a kept-open choice from a page of an older render, and saves a comment from the current page', async () => {
  await connected('stale-comment', async (copy, store, reader, session) => {
    const state = async () => (await fetch(session.url + 'api/state')).json() as Promise<{ generation: string }>;
    const comment = (generation: string) => fetch(session.url + 'api/comments', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: new URL(session.url).origin },
      body: JSON.stringify({ generation, note: 'Is 4 MiB measured?', path: 'docs/storage.md', block: groupBlock() }),
    });
    const old = (await state()).generation;
    await writeFile(path.join(copy, 'docs/storage.md'), spec.replace('Identifiers may be long.', 'Identifiers are short.'));
    await heard(reader, 'event: reload', 5000);
    const keptOpen = await fetch(session.url + 'api/threads/q01-identifier-length/entries', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: new URL(session.url).origin }, body: JSON.stringify({ generation: old, kind: 'kept-open', note: '' }),
    });
    const stale = await comment(old);
    const refused = { error: 'The documents changed since this page was loaded; reload the page and try again' };
    expect([keptOpen.status, await keptOpen.json(), stale.status, await stale.json()]).toEqual([409, refused, 409, refused]);
    expect((await comment((await state()).generation)).status).toBe(200);
    expect((await store.list('spec')).map(({ thread }) => thread.kind)).toEqual(['comment', 'question']);
  });
});

it('serves the documents and shows an edit beside a folder it cannot read', async () => {
  let locked = '';
  try {
    await connected('unreadable', async (copy, _store, reader, session) => {
      await writeFile(path.join(copy, 'docs/storage.md'), spec.replace('Identifiers may be long.', 'Identifiers are short.'));
      await heard(reader, 'event: reload', 5000);
      expect((await (await fetch(session.url)).text()).includes('Identifiers are short.')).toBe(true);
    }, async copy => {
      locked = path.join(copy, 'private');
      await mkdir(locked);
      await writeFile(path.join(locked, 'notes.md'), '# Private\n');
      await chmod(locked, 0);
    });
  } finally { if (locked) await chmod(locked, 0o755); }
});

// The command ends after a failed start and after Ctrl+C; a change check left running would keep it alive.
const collabCli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
it.each([
  ['a failed start', true],
  ['Ctrl+C', false],
])('md-collab serve ends after %s', async (name, busy) => {
  const storeRoot = path.join(root, 'store-end-' + name.split(' ').pop()!.toLowerCase().replace(/\W/g, ''));
  await new FileStore(storeRoot).createCollection({ name: 'spec', title: 'End', settled: [] });
  const blocker = http.createServer();
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const port = busy ? ['--port', String((blocker.address() as { port: number }).port)] : [];
  const child = spawn(process.execPath, [collabCli, 'serve', path.join(docs, 'docs'), '--store', storeRoot, '--collection', 'spec', '--person', 'person:operator', '--no-mermaid', ...port], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { const before = output; output += chunk; if (!before.includes('md-collab: open') && output.includes('md-collab: open')) child.kill('SIGINT'); });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    const ended = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`md-collab serve did not end within 10 s; printed ${JSON.stringify(output)}`)), 10_000);
      child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
    expect({ ...ended, output }).toEqual({ code: busy ? 1 : 0, signal: null, output: busy ? expect.stringContaining('EADDRINUSE') : expect.stringMatching(/^md-collab: open http:\/\/127\.0\.0\.1:\d+\/\nPress Ctrl\+C to stop\.\n$/) });
  } finally {
    child.kill('SIGKILL');
    await new Promise(resolve => blocker.close(resolve));
  }
});

it('md-collab serve stopped during its first render removes the render\'s browser profile and ends without printing an address', async () => {
  const documents = path.join(root, 'stop-docs');
  await mkdir(documents);
  await writeFile(path.join(documents, 'a.md'), '# A\n\n```mermaid\ngraph TD; A-->B\n```\n');
  const storeRoot = path.join(root, 'store-stop');
  await new FileStore(storeRoot).createCollection({ name: 'spec', title: 'Stop', settled: [] });
  // The diagram render starts a browser that keeps its profile in the temporary folder until the render ends.
  const profiles = path.join(root, 'stop-profiles');
  await mkdir(profiles);
  const child = spawn(process.execPath, [collabCli, 'serve', documents, '--store', storeRoot, '--collection', 'spec', '--person', 'person:operator'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: profiles } });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exit = new Promise<{ code: number | null; signal: string | null }>(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    for (const deadline = Date.now() + 10_000; !(await readdir(profiles)).length; await delay(10)) {
      if (Date.now() > deadline) throw new Error(`The first render started no browser; printed ${JSON.stringify(output)}`);
    }
    child.kill('SIGTERM');
    let timer: NodeJS.Timeout | undefined;
    const ended = await Promise.race([exit, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`md-collab serve did not end within 20 s; printed ${JSON.stringify(output)}`)), 20_000); })]);
    clearTimeout(timer);
    expect({ ...ended, output, profiles: await readdir(profiles) }).toEqual({ code: 0, signal: null, output: '', profiles: [] });
  } finally { child.kill('SIGKILL'); }
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
    // What the page shows: the other chapter's text and the decision heading, and the History's decisions.
    const shown = async () => {
      const [page, state] = await Promise.all([(await fetch(session.url)).text(), (await fetch(session.url + 'api/state')).json()]);
      return { first: page.includes('First text.'), heading: /Decision: (\w+ size)/.exec(page)?.[1] ?? null, decisions: state.settled.map((decision: { title: string }) => decision.title) };
    };
    const reader = (await fetch(session.url + 'api/events')).body!.getReader();
    await heard(reader, ': connected');
    // One edit renames the decision and breaks the render; the current render stays.
    await writeFile(path.join(documents, 'decisions.md'), '---\ntitle: [1]\n---\n' + sizeDecision.replace('Fixed size', 'Changed size'));
    expect(await heard(reader, 'event: failed', 5000)).toContain('data: {"error":"');
    expect(await shown()).toEqual({ first: true, heading: 'Fixed size', decisions: ['Fixed size'] });
    await writeFile(path.join(documents, 'decisions.md'), sizeDecision.replace('Fixed size', 'Changed size'));
    await heard(reader, 'event: reload', 5000);
    expect(await shown()).toEqual({ first: true, heading: 'Changed size', decisions: ['Changed size'] });
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
    // One edit adds a diagram; the next check starts its render.
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
const agentComment = (id: string): Thread => ({ id, kind: 'comment', title: 'Agent note', anchors: [anchorAt(view, 'docs/storage.md', [7, 7], 'main')], context: '', options: [],
  entries: [{ at: '2026-10-24T12:00:00Z', actor: 'agent:test/1', kind: 'comment', note: 'Agent note' }] });
/** The block ID of the storage chapter's 4 MiB paragraph, as the page sends it with a comment. */
const groupBlock = () => view.documents.find(document => document.path === 'docs/storage.md')!.blocks.find(block => block.text === 'The write group is 4 MiB.')!.id;

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

/** Selects the storage chapter's 4 MiB paragraph and opens the comment box on it. */
async function openComposer(page: BrowserSession): Promise<void> {
  await page.evaluate(`(() => {
    const paragraph = [...document.querySelectorAll('[data-source-path="docs/storage.md"] p')].find(p => p.textContent.includes('4 MiB'));
    const range = document.createRange(); range.selectNodeContents(paragraph);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  })()`);
  await until(page, `getComputedStyle(document.getElementById('ov-sel')).display === 'block'`);
  await page.evaluate(`document.getElementById('ov-selbtn').click()`);
}

it('shows a question that arrives while the reader writes a comment on selected text, keeping the comment', async () => {
  await sidebar('store-typing-comment', async (page, store) => {
    await openComposer(page);
    await page.evaluate(`(() => { const box = document.getElementById('ov-comment'); box.value = 'Draft comment'; box.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await store.create('spec', { ...imported()[0]!, id: 'q02-second-question', title: 'Second question', number: 2 });
    await until(page, `document.getElementById('ov-count').textContent === '0 / 2 answered'`);
    expect(await page.evaluate(`({ card: !!document.getElementById('ov-card-2'), typing: document.activeElement === document.getElementById('ov-comment'), comment: document.getElementById('ov-comment').value })`))
      .toEqual({ card: true, typing: true, comment: 'Draft comment' });
  });
});

it('keeps what the reader typed in the comment box while its save was running', async () => {
  await sidebar('store-comment-typing', async page => {
    await openComposer(page);
    await page.evaluate(`(() => {
      const box = document.getElementById('ov-comment');
      box.value = 'First comment';
      window.postGate = new Promise(resolve => { window.releasePosts = resolve; });
      document.getElementById('ov-comment-save').click();
      box.value = 'First comment, then more';
      window.releasePosts();
    })()`);
    await until(page, `document.getElementById('ov-toast').textContent === 'Comment saved.'`);
    expect(await page.evaluate(`({ open: !document.getElementById('ov-composer').hidden, comment: document.getElementById('ov-comment').value })`))
      .toEqual({ open: true, comment: 'First comment, then more' });
  });
});

it("names a question's note box by its label even when an annotation carries the box's ID", async () => {
  await sidebar('store-label-id', async (page, store) => {
    await store.create('spec', { ...imported()[0]!, id: 'q02-label-id', title: 'Label ID', number: 2, context: 'An anchor <a id="ov-note-2"></a>in the context.' });
    await until(page, `document.getElementById('ov-count').textContent === '0 / 2 answered'`);
    expect(await page.evaluate(`[...document.querySelector('#ov-card-2 textarea').labels].map(label => label.textContent)`)).toEqual(['Your note']);
  });
});

/** Opens a thread's row in History and returns what its changed-passage box shows: the deleted and inserted words, or the old text. */
async function changeBox(page: BrowserSession, id: string): Promise<{ text: string; deleted: string[]; inserted: string[]; actions: string[] }> {
  await page.evaluate(`document.getElementById('ov-v-h').click()`);
  await page.evaluate(`[...document.getElementById('ov-list').children].find(row => row.id === 'ov-h-${id}').querySelector('.ov-hh').click()`);
  return page.evaluate(`(() => { const box = [...document.getElementById('ov-list').children].find(row => row.id === 'ov-h-${id}').querySelector('.ov-change');
    return box ? { text: box.querySelector('.ov-was').textContent, deleted: [...box.querySelectorAll('del')].map(e => e.textContent), inserted: [...box.querySelectorAll('ins')].map(e => e.textContent), actions: [...box.querySelectorAll('button')].map(b => b.textContent) } : null; })()`);
}

it('anchors a comment on a selection to the block where it starts, and shows the words that changed in that block', async () => {
  const copy = path.join(root, 'repo-selection');
  await cp(docs, copy, { recursive: true });
  await sidebar('store-selection', async (page, store) => {
    // From inside the first paragraph of the Long chapter into the next one.
    await page.evaluate(`(() => {
      const [first, second] = [...document.querySelectorAll('[data-source-path="docs/long.md"] p')];
      const range = document.createRange(); range.setStart(first.firstChild, 11); range.setEnd(second.firstChild, 4);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    })()`);
    await until(page, `getComputedStyle(document.getElementById('ov-sel')).display === 'block'`);
    await page.evaluate(`(() => { document.getElementById('ov-selbtn').click(); document.getElementById('ov-comment').value = 'Two lines are enough.'; document.getElementById('ov-comment-save').click(); })()`);
    await until(page, `document.getElementById('ov-toast').textContent === 'Comment saved.'`);
    const [comment] = (await store.list('spec')).filter(({ thread }) => thread.kind === 'comment');
    expect(comment!.thread.anchors.map(({ path: file, tag, position, text }) => ({ file, tag, position, text }))).toEqual([{ file: 'docs/long.md', tag: 'p', position: 2, text: 'First line second line third line.' }]);
    await page.waitForNavigation(() => writeFile(path.join(copy, 'docs/long.md'), long.replace('second line', 'second row')));
    await until(page, `document.getElementById('ov-v-hn').textContent === '4'`);
    expect(await changeBox(page, comment!.thread.id)).toEqual({ text: 'Updated since this was written: First line second line row third line.', deleted: ['line'], inserted: ['row'], actions: ['Mark done', 'Keep open', 'Send to a fix run'] });
  }, path.join(copy, 'docs'));
});

// The reader's three choices on a passage whose words changed, and what each records for agents.
it.each([
  ['Mark done', 'settled', 'settled', 'updated'],
  ['Keep open', 'kept-open', 'open', 'same'],
  ['Send to a fix run', 'fix-requested', 'open', 'updated'],
])('records "%s" on a commented passage whose words changed', async (label, kind, status, state) => {
  const copy = path.join(root, 'repo-choice-' + kind);
  await cp(docs, copy, { recursive: true });
  await writeFile(path.join(copy, 'docs/long.md'), long.replace('Next paragraph.', 'Next paragraph, edited.'));
  const edited = (await renderView(path.join(copy, 'docs'), { mermaid: false })).view;
  await sidebar('store-choice-' + kind, async (page, store) => {
    await store.create('spec', { ...agentComment('c-next'), anchors: [anchorAt(view, 'docs/long.md', [7, 7], 'main')] });
    await until(page, `document.getElementById('ov-v-hn').textContent === '4'`);
    expect((await changeBox(page, 'c-next'))?.inserted).toEqual(['edited.']);
    await page.evaluate(`[...document.querySelectorAll('#ov-h-c-next .ov-change button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`);
    for (const deadline = Date.now() + 5000; (await store.read('spec', 'c-next')).thread.entries.length < 2; await delay(50)) {
      if (Date.now() > deadline) throw new Error(`${label} wrote no entry`);
    }
    const { thread } = await store.read('spec', 'c-next');
    expect({ kind: thread.entries.at(-1)!.kind, status: threadStatus(thread), state: resolveAnchor(thread.anchors[0]!, edited).state }).toEqual({ kind, status, state });
  }, path.join(copy, 'docs'));
});

it('shows a commented passage that was removed with its old text, and records a note for an agent and closing', async () => {
  const copy = path.join(root, 'repo-removed');
  await cp(docs, copy, { recursive: true });
  await writeFile(path.join(copy, 'docs/long.md'), long.replace('\nNext paragraph.\n', ''));
  await sidebar('store-removed-passage', async (page, store) => {
    await store.create('spec', { ...agentComment('c-next'), anchors: [anchorAt(view, 'docs/long.md', [7, 7], 'main')] });
    await until(page, `document.getElementById('ov-v-hn').textContent === '4'`);
    expect(await changeBox(page, 'c-next')).toEqual({ text: 'Removed. It read: Next paragraph.', deleted: [], inserted: [], actions: ['Close', 'Save note'] });
    await page.evaluate(`(() => { const row = document.getElementById('ov-h-c-next'); row.querySelector('.ov-change textarea').value = 'Say where this went.'; [...row.querySelectorAll('.ov-change button')].find(b => b.textContent === 'Save note').click(); })()`);
    for (const deadline = Date.now() + 5000; (await store.read('spec', 'c-next')).thread.entries.length < 2; await delay(50)) {
      if (Date.now() > deadline) throw new Error('Save note wrote no entry');
    }
    await until(page, `[...document.querySelectorAll('#ov-h-c-next .ov-change button')].some(b => b.textContent === 'Close')`);
    await page.evaluate(`[...document.querySelectorAll('#ov-h-c-next .ov-change button')].find(b => b.textContent === 'Close').click()`);
    for (const deadline = Date.now() + 5000; (await store.read('spec', 'c-next')).thread.entries.length < 3; await delay(50)) {
      if (Date.now() > deadline) throw new Error('Close wrote no entry');
    }
    const { thread } = await store.read('spec', 'c-next');
    expect({ entries: thread.entries.slice(1).map(({ actor, kind, note }) => ({ actor, kind, note })), status: threadStatus(thread) }).toEqual({
      entries: [{ actor: 'person:operator', kind: 'comment', note: 'Say where this went.' }, { actor: 'person:operator', kind: 'withdrawn', note: 'Closed: the passage was removed.' }], status: 'withdrawn',
    });
  }, path.join(copy, 'docs'));
});

it('redraws the list without a question removed while the reader typed when the reader opens its card', async () => {
  await sidebar('store-removed-question', async (page, store) => {
    await store.create('spec', { ...imported()[0]!, id: 'q02-second-question', title: 'Second question', number: 2 });
    await until(page, `document.getElementById('ov-count').textContent === '0 / 2 answered'`);
    // The reader types a note, so the list is not redrawn when the question goes.
    await page.evaluate(`(() => {
      document.querySelector('#ov-card-1 .ov-qh').click();
      const note = document.getElementById('ov-note-1');
      note.focus(); note.value = 'Draft answer'; note.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await rm(path.join(store.root, 'spec/threads/q02-second-question.md'));
    await until(page, `document.getElementById('ov-count').textContent === '0 / 1 answered'`);
    expect(await page.evaluate(`(() => { document.querySelector('#ov-card-2 .ov-qh').click(); return { card: !!document.getElementById('ov-card-2'), first: !!document.getElementById('ov-card-1') }; })()`))
      .toEqual({ card: false, first: true });
  });
});

it('moves the highlight of an open question with the passage an agent moved it to', async () => {
  await sidebar('store-moved', async (page, store) => {
    // Without transitions, a computed background is the one the reader sees.
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.evaluate(`document.querySelector('#ov-card-1 .ov-qh').click()`);
    const lit = (text: string) => `getComputedStyle([...document.querySelectorAll('[data-block]')].find(element => element.localName === 'p' && element.textContent.includes(${JSON.stringify(text)}))).backgroundColor !== 'rgba(0, 0, 0, 0)'`;
    expect(await page.evaluate(lit('Identifiers may be long.'))).toBe(true);
    const { thread } = await store.read('spec', 'q01-how-long-may-an-identifier-be');
    const moved = { ...thread, anchors: [anchorAt(view, 'docs/long.md', [7, 7], 'main'), ...thread.anchors.slice(1)] };
    await writeFile(path.join(store.root, 'spec/threads', thread.id + '.md'), serializeThread(moved));
    await until(page, lit('Next paragraph.'));
    expect(await page.evaluate(`({ old: ${lit('Identifiers may be long.')}, now: ${lit('Next paragraph.')} })`)).toEqual({ old: false, now: true });
  });
});

it('keeps warning about a failed re-render after the threads change, until a render succeeds', async () => {
  const copy = path.join(root, 'repo-failed');
  await cp(docs, copy, { recursive: true });
  await sidebar('store-failed', async (page, store) => {
    const warned = `document.getElementById('ov-status').textContent.includes('rendering them failed')`;
    await writeFile(path.join(copy, 'docs/long.md'), '---\ntitle: [1]\n---\n' + long);
    await until(page, warned);
    // An agent's thread arrives after the failure; the page loads the threads again.
    await store.create('spec', agentComment('c-after-failure'));
    await until(page, `document.getElementById('ov-v-hn').textContent === '4'`);
    expect(await page.evaluate(warned)).toBe(true);
    await page.waitForNavigation(() => writeFile(path.join(copy, 'docs/long.md'), long));
    await until(page, `document.getElementById('ov-status').textContent.startsWith('Answers are saved')`);
  }, path.join(copy, 'docs'));
});

it('says live updates are disconnected when the event stream fails, and saves an answer meanwhile', async () => {
  await sidebar('store-stream-lost', async (page, store) => {
    await page.evaluate(`(() => { window.sidebarEvents.close(); window.sidebarEvents.dispatchEvent(new Event('error')); })()`);
    expect(await page.evaluate(`document.getElementById('ov-status').textContent`)).toBe('Live updates from md-collab are disconnected; this page tries to reconnect. If md-collab stopped, restart it and reload.');
    await page.evaluate(`(() => { document.querySelector('#ov-card-1 .ov-qh').click(); document.querySelector('#ov-card-1 .ov-opt').click(); })()`);
    await until(page, `document.querySelector('#ov-card-1 .ov-saved')?.textContent.startsWith('Saved')`);
    expect((await store.read('spec', 'q01-how-long-may-an-identifier-be')).thread.entries.map(entry => [entry.kind, entry.choice])).toEqual([['raised', undefined], ['answer', 1]]);
  });
});

it('counts each item once in the History filters for its topic and for each chapter it cites', async () => {
  await sidebar('store-filters', async page => {
    // The question cites the storage chapter twice and the decisions chapter once; the two settled decisions sit in the decisions chapter.
    expect(await page.evaluate(`({ topics: [...document.getElementById('ov-f-topic').options].map(o => o.text), chapters: [...document.getElementById('ov-f-chapter').options].map(o => o.text) })`))
      .toEqual({ topics: ['All topics', 'Limits (1)', 'Storage choices (2)'], chapters: ['All chapters', 'Decisions (3)', 'Storage (1)'] });
  });
});

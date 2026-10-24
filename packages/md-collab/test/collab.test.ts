import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { renderSinglePage, type SiteView } from 'md-render';
import { anchorAt, resolveAnchor } from '../src/anchors.js';
import { parseQuestionList, questionThreads } from '../src/import.js';
import { serve } from '../src/server.js';
import { decidersOf, readSettled } from '../src/settled.js';
import { ConflictError, FileStore } from '../src/store.js';
import { parseThread, serializeThread, threadStatus, type Thread } from '../src/thread.js';

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
  await writeFile(path.join(docs, 'questions.md'), questionList);
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'docs']]) await run('git', ['-C', docs, ...args]);
  commit = (await run('git', ['-C', docs, 'rev-parse', 'HEAD'])).stdout.trim();
  view = (await renderSinglePage(path.join(docs, 'docs'), { mermaid: false })).view;
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

const question = (): Thread => ({
  id: 'q01-identifier-length', kind: 'question', title: 'How long may an identifier be?', decides: 'operator', number: 1, topic: 'Limits',
  anchors: [{ role: 'main', path: 'docs/storage.md', commit: 'abcdef1', lines: [9, 9], block: 'limits~x', quote: 'Identifiers may be long.' }],
  context: '`FACT` The spec says identifiers may be long.',
  options: [{ n: 1, text: '**Cap at 256 bytes (recommended).**', recommended: true }, { n: 2, text: 'No cap.', recommended: false }],
  entries: [{ at: '2026-10-22T13:09:00Z', actor: 'agent:claude-code/memory', kind: 'raised', note: '' }],
});

it('writes and reads a thread file without loss, and derives status from its entries', () => {
  const thread = question();
  thread.entries.push({ at: '2026-10-24T09:41:12Z', actor: 'person:operator', kind: 'answer', choice: 1, note: 'Keep it short.\n## not a heading' });
  const text = serializeThread(thread);
  expect(text).toContain('### 2026-10-24T09:41:12Z person:operator answer\n\nChoice: 1\n\nKeep it short.\n\\## not a heading');
  const back = parseThread(text);
  expect(back.entries[1]).toEqual({ ...thread.entries[1], note: 'Keep it short.\n\\## not a heading' });
  expect(back.options).toEqual(thread.options);
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
  await expect(store.create('spec', question())).rejects.toMatchObject({ code: 'EEXIST' });
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

it('reads settled decisions with their dates and deciders from the specification', async () => {
  const settled = await readSettled(docs, 'docs/decisions.md');
  expect(settled.map(({ id, topic, date, decidedBy }) => ({ id, topic, date, decidedBy }))).toEqual([
    { id: 'decision-fixed-group', topic: 'Storage choices', date: '2026-10-12', decidedBy: ['operator'] },
    { id: 'decision-redo', topic: 'Storage choices', date: '2026-10-14', decidedBy: ['lead'] },
  ]);
  expect(decidersOf('Q73 and final Q162 in the log, with the lead clarification of 2026-10-14.')).toEqual(['operator', 'lead']);
  expect(decidersOf('anything', 'lead')).toEqual(['lead']);
});

it('imports a House Rules question list with its cited passages as anchors', () => {
  const listed = parseQuestionList(questionList, path.join(docs, 'questions.md'));
  expect(listed).toMatchObject([{ number: 1, topic: 'Limits', title: 'How long may an identifier be?', options: [{ n: 1, recommended: true }, { n: 2, recommended: false }] }]);
  const [thread] = questionThreads(listed, { view, corpusRoot: docs, commit, actor: 'agent:test/1', at: '2026-10-24T00:00:00Z', settled: ['docs/decisions.md'], base: docs });
  expect(thread!.id).toBe('q01-how-long-may-an-identifier-be');
  expect(thread!.anchors.map(anchor => [anchor.role, anchor.path, anchor.lines])).toEqual([['main', 'docs/storage.md', [9, 9]], ['also', 'docs/decisions.md', [9, 11]]]);
  expect(thread!.context).toContain('([storage.md:9](#md-collab-anchor-0))');
  expect(thread!.context).toContain('([decisions.md:9-11](#md-collab-anchor-1))');
  expect(thread!.context).not.toContain('Answer like so');
});

it('serves the page only with the session token and accepts writes only from its own origin', async () => {
  const storeRoot = path.join(root, 'store-b');
  const store = new FileStore(storeRoot);
  await store.createCollection({ name: 'spec', title: 'Spec review', settled: ['docs/decisions.md'] });
  const [thread] = questionThreads(parseQuestionList(questionList, path.join(docs, 'questions.md')), { view, corpusRoot: docs, commit, actor: 'agent:test/1', at: '2026-10-24T00:00:00Z', settled: ['docs/decisions.md'], base: docs });
  const created = await store.create('spec', thread!);
  const session = await serve({ documents: path.join(docs, 'docs'), store: storeRoot, collection: 'spec', person: 'person:operator', mermaid: false });
  try {
    const origin = new URL(session.url).origin;
    expect((await fetch(origin + '/')).status).toBe(403);
    const page = await fetch(session.url);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("connect-src 'self'");
    expect(html).toContain('id="md-render-extension-data-md-collab"');
    const headers = { 'x-md-collab-token': session.token, 'content-type': 'application/json' };
    const state = await (await fetch(origin + '/api/state', { headers })).json();
    expect(state.threads[0]).toMatchObject({ id: created.thread.id, status: 'open', number: 1, anchors: [{ role: 'main', method: 'block' }, { role: 'also', method: 'block' }] });
    expect(state.settled.map((decision: { id: string; decidedBy: string[] }) => [decision.id, decision.decidedBy])).toEqual([['decision-fixed-group', ['operator']], ['decision-redo', ['lead']]]);
    const answer = JSON.stringify({ kind: 'answer', choice: 1, note: 'Yes.', version: created.version });
    expect((await fetch(origin + `/api/threads/${created.thread.id}/entries`, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: answer })).status).toBe(403);
    const saved = await fetch(origin + `/api/threads/${created.thread.id}/entries`, { method: 'POST', headers: { ...headers, origin }, body: answer });
    expect(saved.status).toBe(200);
    expect((await fetch(origin + `/api/threads/${created.thread.id}/entries`, { method: 'POST', headers: { ...headers, origin }, body: answer })).status).toBe(409);
    const file = await readFile(path.join(storeRoot, 'spec/threads', `${created.thread.id}.md`), 'utf8');
    expect(file).toMatch(/### \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ person:operator answer\n\nChoice: 1\n\nYes\./);
    const comment = await fetch(origin + '/api/comments', { method: 'POST', headers: { ...headers, origin }, body: JSON.stringify({ note: 'Is 4 MiB measured?', anchors: [{ path: 'docs/storage.md', lines: [7, 7], quote: 'The write group is 4 MiB.' }] }) });
    expect(comment.status).toBe(200);
    const after = await (await fetch(origin + '/api/state', { headers })).json();
    expect(after.threads.map((item: { kind: string; status: string }) => [item.kind, item.status])).toEqual([['comment', 'open'], ['question', 'answered']]);
  } finally { await session.close(); }
});

// A thread is one annotation file: YAML front matter, Markdown context, options, dated entries.
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export type ThreadKind = 'comment' | 'question';
export type Decider = 'operator' | 'lead' | 'measurement';
export type EntryKind = 'raised' | 'comment' | 'answer' | 'settled' | 'reopened' | 'withdrawn';
export type Status = 'open' | 'answered' | 'settled' | 'withdrawn';

/** A pointer to a place in a document, valid for one commit; block and quote re-find it later. */
export interface Anchor {
  role: 'main' | 'also';
  path: string;
  commit: string;
  lines: [number, number];
  block?: string;
  quote?: string;
}

export interface Option { n: number; text: string; recommended: boolean }

/** One dated step. Only a person writes an answer; `source: chat` marks an answer an agent copied from chat. */
export interface Entry {
  at: string;
  actor: string;
  kind: EntryKind;
  choice?: number;
  source?: string;
  settledAs?: string;
  note: string;
}

export interface Thread {
  id: string;
  kind: ThreadKind;
  title: string;
  decides?: Decider;
  number?: number;
  priority?: string;
  topic?: string;
  anchors: Anchor[];
  settledAs?: string;
  context: string;
  options: Option[];
  entries: Entry[];
}

const idPattern = /^[a-z0-9][a-z0-9-]*$/;
const actorPattern = /^(?:person|agent):\S+$/;
const entryKinds: EntryKind[] = ['raised', 'comment', 'answer', 'settled', 'reopened', 'withdrawn'];
const timestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;
const frontKeys = new Set(['id', 'kind', 'title', 'decides', 'number', 'priority', 'topic', 'anchors', 'settled_as']);

// Text that could be read as file structure: a heading, which ends a section or an entry, or an
// entry field. Context and note lines that start so get one more backslash in the file, fenced
// code included, so the parser never needs to track fences; reading removes exactly one.
const structure = /^\\*(?:#|Choice: |Source: |Settled as: )/;
const escapeText = (text: string): string => text.split('\n').map(line => structure.test(line) ? '\\' + line : line).join('\n');
const unescapeText = (text: string): string => text.split('\n').map(line => /^\\/.test(line) && structure.test(line.slice(1)) ? line.slice(1) : line).join('\n');

/** The status the entries give: the latest of raised, reopened, answer, settled and withdrawn decides. */
export function threadStatus(thread: Pick<Thread, 'entries'>): Status {
  let status: Status = 'open';
  for (const entry of thread.entries) {
    if (entry.kind === 'raised' || entry.kind === 'reopened') status = 'open';
    else if (entry.kind === 'answer') status = 'answered';
    else if (entry.kind === 'settled') status = 'settled';
    else if (entry.kind === 'withdrawn') status = 'withdrawn';
  }
  return status;
}

/** Refuses a thread that breaks the format; the message names the thread and the field. */
export function validateThread(thread: Thread): void {
  const fail = (message: string): never => { throw new Error(`Thread ${thread.id || '(no id)'}: ${message}`); };
  if (!idPattern.test(thread.id)) fail('id must be lower case letters, digits and hyphens');
  if (thread.kind !== 'comment' && thread.kind !== 'question') fail(`unknown kind ${String(thread.kind)}`);
  if (!thread.title.trim()) fail('title is empty');
  if (thread.kind === 'question') {
    if (!['operator', 'lead', 'measurement'].includes(thread.decides ?? '')) fail('a question needs decides: operator, lead or measurement');
    if (thread.number !== undefined && (thread.decides !== 'operator' || !Number.isSafeInteger(thread.number) || thread.number < 1)) {
      fail('number is a positive integer on operator questions only');
    }
    if (thread.options.filter(option => option.recommended).length > 1) fail('more than one option is recommended');
    thread.options.forEach((option, index) => { if (option.n !== index + 1) fail('options are numbered 1, 2, 3 without gaps'); });
    if (thread.options.some(option => option.text.includes('\n'))) fail('an option is one line of text');
  } else if (thread.decides || thread.number !== undefined || thread.options.length) {
    fail('a comment has no decides, number or options');
  }
  for (const anchor of thread.anchors) {
    if (anchor.role !== 'main' && anchor.role !== 'also') fail('anchor role is main or also');
    if (!anchor.path || !anchor.commit) fail('an anchor needs path and commit');
    const [first, last] = anchor.lines ?? [];
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first! < 1 || last! < first!) fail(`anchor lines are invalid for ${anchor.path}`);
  }
  if (thread.anchors.filter(anchor => anchor.role === 'main').length > 1) fail('more than one main anchor');
  for (const entry of thread.entries) {
    if (!timestamp.test(entry.at)) fail(`entry time ${entry.at} is not an ISO 8601 UTC timestamp`);
    if (!actorPattern.test(entry.actor)) fail(`entry actor ${entry.actor} is not person:<login> or agent:<name>`);
    if (!entryKinds.includes(entry.kind)) fail(`unknown entry kind ${entry.kind}`);
    if (entry.kind === 'answer' && !entry.actor.startsWith('person:')) fail('only a person writes an answer');
    if (entry.choice !== undefined && !thread.options.some(option => option.n === entry.choice)) fail(`choice ${entry.choice} is not an option`);
  }
}

function optionText(line: string): Option {
  const match = /^(\d+)\. (.*)$/s.exec(line)!;
  const text = match[2]!.trim();
  return { n: Number(match[1]), text, recommended: /\(recommended\)/.test(text) };
}

/** Parses one thread file; any format error names the file's thread. */
export function parseThread(source: string): Thread {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(source.replace(/\r\n?/g, '\n'));
  if (!match) throw new Error('Thread file must start with YAML front matter');
  const front = parseYaml(match[1]!) as Record<string, unknown>;
  if (!front || typeof front !== 'object' || Array.isArray(front)) throw new Error('Thread front matter must be a mapping');
  for (const key of Object.keys(front)) if (!frontKeys.has(key)) throw new Error(`Thread ${String(front.id)}: unknown field ${key}`);
  const body = match[2]!;
  const sections = body.split(/^## (Options|Entries)\n/m);
  const context = unescapeText(sections[0]!.trim());
  let options: Option[] = [];
  let entries: Entry[] = [];
  for (let index = 1; index < sections.length; index += 2) {
    const name = sections[index]!;
    const text = sections[index + 1] ?? '';
    if (name === 'Options') {
      options = text.split(/\n(?=\d+\. )/).map(part => part.trim()).filter(Boolean)
        .map(part => optionText(part.split('\n').map(line => line.trim()).join(' ')));
    } else {
      entries = text.split(/^### /m).slice(1).map(part => {
        const [head, ...rest] = part.split('\n');
        const parts = head!.trim().split(' ');
        if (parts.length !== 3) throw new Error(`Thread ${String(front.id)}: entry heading "${head}" needs time, actor and kind`);
        const entry: Entry = { at: parts[0]!, actor: parts[1]!, kind: parts[2] as EntryKind, note: '' };
        // The fields and the note are told apart before any whitespace is touched, so a note line
        // that starts with a space stays note text; the note keeps its leading whitespace.
        const lines = rest;
        if (lines[0] === '') lines.shift();
        let fields = 0;
        for (let field; lines.length && (field = /^(Choice|Source|Settled as): (.+)$/.exec(lines[0]!)); fields++) {
          if (field[1] === 'Choice') entry.choice = Number(field[2]);
          else if (field[1] === 'Source') entry.source = field[2]!;
          else entry.settledAs = field[2]!;
          lines.shift();
        }
        if (fields && lines[0] === '') lines.shift();
        entry.note = unescapeText(lines.join('\n').replace(/\n+$/, ''));
        return entry;
      });
    }
  }
  const thread: Thread = {
    id: String(front.id ?? ''), kind: front.kind as ThreadKind, title: String(front.title ?? ''),
    ...(front.decides !== undefined ? { decides: front.decides as Decider } : {}),
    ...(front.number !== undefined && front.number !== null ? { number: Number(front.number) } : {}),
    ...(front.priority ? { priority: String(front.priority) } : {}),
    ...(front.topic ? { topic: String(front.topic) } : {}),
    anchors: ((front.anchors ?? []) as Anchor[]).map(anchor => ({ ...anchor, commit: String(anchor.commit), lines: [Number(anchor.lines?.[0]), Number(anchor.lines?.[1])] as [number, number] })),
    ...(front.settled_as ? { settledAs: String(front.settled_as) } : {}),
    context, options, entries,
  };
  validateThread(thread);
  return thread;
}

/** Writes one thread file; parseThread(serializeThread(t)) equals t. */
export function serializeThread(thread: Thread): string {
  validateThread(thread);
  const front: Record<string, unknown> = { id: thread.id, kind: thread.kind, title: thread.title };
  if (thread.decides) front.decides = thread.decides;
  if (thread.number !== undefined) front.number = thread.number;
  if (thread.priority) front.priority = thread.priority;
  if (thread.topic) front.topic = thread.topic;
  front.anchors = thread.anchors.map(anchor => ({
    role: anchor.role, path: anchor.path, commit: anchor.commit, lines: anchor.lines,
    ...(anchor.block ? { block: anchor.block } : {}), ...(anchor.quote ? { quote: anchor.quote } : {}),
  }));
  if (thread.settledAs) front.settled_as = thread.settledAs;
  const parts = [`---\n${stringifyYaml(front, { lineWidth: 0, flowCollectionPadding: false }).trimEnd()}\n---`, ''];
  if (thread.context) parts.push(escapeText(thread.context), '');
  if (thread.options.length) parts.push('## Options', '', ...thread.options.map(option => `${option.n}. ${option.text}`), '');
  parts.push('## Entries', '');
  for (const entry of thread.entries) {
    parts.push(`### ${entry.at} ${entry.actor} ${entry.kind}`, '');
    const fields = [
      entry.choice !== undefined ? `Choice: ${entry.choice}` : '',
      entry.source ? `Source: ${entry.source}` : '',
      entry.settledAs ? `Settled as: ${entry.settledAs}` : '',
    ].filter(Boolean);
    if (fields.length) parts.push(fields.join('\n'), '');
    if (entry.note) parts.push(escapeText(entry.note), '');
  }
  return parts.join('\n').replace(/\n+$/, '\n');
}

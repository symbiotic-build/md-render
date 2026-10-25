// The file store: <store>/<collection>/collection.yaml and <store>/<collection>/threads/<id>.md.
// Every write holds the collection's lock file, so one process at a time reads, checks and writes.
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { link, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parseThread, serializeThread, threadStatus, type Entry, type Thread } from './thread.js';

/** A collection's settings: its title and the specification chapters that hold settled decisions. */
export interface Collection { name: string; title: string; settled: string[] }

/** A thread as read, with the version that a write must name to replace it. */
export interface StoredThread { thread: Thread; version: string }

/** Raised when a file changed between its read and a write that named the old version. */
export class ConflictError extends Error {
  constructor(id: string) { super(`Thread ${id} changed since it was read; reload and try again`); }
}

const collectionName = /^[a-z0-9][a-z0-9-]*$/;
const version = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);
const lockWaitMs = 10_000;
const code = (error: unknown) => (error as NodeJS.ErrnoException).code;
const temporary = (file: string) => path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(4).toString('hex')}.tmp`);

/** Publishes a complete file under `file`, refusing when it exists; nobody sees it half written. */
async function publish(file: string, text: string): Promise<void> {
  const draft = temporary(file);
  try {
    await writeFile(draft, text, { flag: 'wx' });
    await link(draft, file);
  } finally { await rm(draft, { force: true }); }
}

/** A lock's owner is alive while its process exists; a lock from a crashed process is stale. */
function alive(owner: string): boolean {
  const pid = Number(owner.split(' ')[0]);
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return code(error) === 'EPERM'; }
}

/** Removes a stale lock; when another process replaced it meanwhile, puts that live lock back. */
async function breakLock(lock: string, stale: string): Promise<void> {
  const aside = `${lock}.${randomBytes(4).toString('hex')}.stale`;
  try { await rename(lock, aside); }
  catch (error) { if (code(error) === 'ENOENT') return; throw error; }
  try {
    if (await readFile(aside, 'utf8') !== stale) await link(aside, lock).catch(() => undefined);
  } finally { await rm(aside, { force: true }); }
}

export class FileStore {
  constructor(readonly root: string) {}

  private directory(collection: string): string {
    if (!collectionName.test(collection)) throw new Error(`Invalid collection name: ${collection}`);
    return path.join(this.root, collection);
  }
  private file(collection: string, id: string): string {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Invalid thread id: ${id}`);
    return path.join(this.directory(collection), 'threads', `${id}.md`);
  }

  /** Runs `work` while this process holds `<collection>/.lock`, which names its process. */
  private async locked<T>(collection: string, work: () => Promise<T>): Promise<T> {
    const lock = path.join(this.directory(collection), '.lock');
    const owner = `${process.pid} ${randomBytes(8).toString('hex')}`;
    const start = Date.now();
    for (;;) {
      try { await publish(lock, owner); break; }
      catch (error) { if (code(error) !== 'EEXIST') throw error; }
      const current = await readFile(lock, 'utf8').catch(() => null);
      if (current !== null && !alive(current)) { await breakLock(lock, current); continue; }
      if (Date.now() - start > lockWaitMs) throw new Error(`Collection ${collection} is locked by process ${current?.split(' ')[0]}; try again when it finishes`);
      await delay(10);
    }
    try { return await work(); }
    finally { await rm(lock, { force: true }); }
  }

  async collection(name: string): Promise<Collection> {
    const file = path.join(this.directory(name), 'collection.yaml');
    let text: string;
    try { text = await readFile(file, 'utf8'); }
    catch (error) {
      if (code(error) === 'ENOENT') throw new Error(`No collection ${name} in ${this.root}: ${file} is missing`);
      throw error;
    }
    const value = parseYaml(text) as Record<string, unknown> | null;
    const settled = value?.settled ?? [];
    if (!Array.isArray(settled) || settled.some(item => typeof item !== 'string')) throw new Error(`${file}: settled must be a list of document paths`);
    return { name, title: String(value?.title ?? name), settled: settled as string[] };
  }

  async createCollection(collection: Collection): Promise<void> {
    const directory = this.directory(collection.name);
    await mkdir(path.join(directory, 'threads'), { recursive: true });
    try { await publish(path.join(directory, 'collection.yaml'), stringifyYaml({ title: collection.title, settled: collection.settled })); }
    catch (error) {
      if (code(error) === 'EEXIST') throw new Error(`Collection ${collection.name} already exists in ${this.root}`);
      throw error;
    }
  }

  async list(collection: string): Promise<StoredThread[]> {
    const directory = path.join(this.directory(collection), 'threads');
    let names: string[];
    try { names = (await readdir(directory)).filter(name => name.endsWith('.md') && !name.startsWith('.')).sort(); }
    catch (error) {
      if (code(error) === 'ENOENT') return [];
      throw error;
    }
    const threads = await Promise.all(names.map(name => this.read(collection, name.slice(0, -3))));
    const numbers = new Map<number, string>();
    for (const { thread } of threads) {
      if (thread.number === undefined) continue;
      const other = numbers.get(thread.number);
      if (other) throw new Error(`Question number ${thread.number} is used by both ${other} and ${thread.id}`);
      numbers.set(thread.number, thread.id);
    }
    return threads;
  }

  async read(collection: string, id: string): Promise<StoredThread> {
    const text = await readFile(this.file(collection, id), 'utf8');
    let thread: Thread;
    try { thread = parseThread(text); }
    catch (error) { throw new Error(`${this.file(collection, id)}: ${(error as Error).message}`, { cause: error }); }
    if (thread.id !== id) throw new Error(`${this.file(collection, id)}: id ${thread.id} does not match the file name`);
    return { thread, version: version(text) };
  }

  /** Writes one new thread; see createAll. */
  async create(collection: string, thread: Thread): Promise<StoredThread> {
    return (await this.createAll(collection, [thread]))[0]!;
  }

  /**
   * Writes new threads. Refuses the whole batch, before writing any, when an id exists or repeats
   * or a question number is already used in the collection or in the batch.
   */
  async createAll(collection: string, threads: Thread[]): Promise<StoredThread[]> {
    const texts = threads.map(serializeThread);
    return this.locked(collection, async () => {
      const ids = new Set<string>();
      const numbers = new Map<number, string>();
      for (const { thread } of await this.list(collection)) {
        ids.add(thread.id);
        if (thread.number !== undefined) numbers.set(thread.number, thread.id);
      }
      for (const thread of threads) {
        if (ids.has(thread.id)) throw new Error(`Thread ${thread.id} already exists in ${collection}; nothing was written`);
        ids.add(thread.id);
        if (thread.number === undefined) continue;
        const other = numbers.get(thread.number);
        if (other) throw new Error(`Question number ${thread.number} is used by both ${other} and ${thread.id}; nothing was written`);
        numbers.set(thread.number, thread.id);
      }
      await mkdir(path.join(this.directory(collection), 'threads'), { recursive: true });
      for (const [index, thread] of threads.entries()) await publish(this.file(collection, thread.id), texts[index]!);
      return threads.map((thread, index) => ({ thread, version: version(texts[index]!) }));
    });
  }

  /** Appends one entry, refusing when the file is no longer at `expected`. */
  async append(collection: string, id: string, entry: Entry, expected?: string): Promise<StoredThread> {
    return this.locked(collection, async () => {
      const current = await this.read(collection, id);
      if (expected !== undefined && current.version !== expected) throw new ConflictError(id);
      if (entry.kind === 'answer' && current.thread.kind !== 'question') throw new Error(`Thread ${id} is a comment and takes no answer`);
      const next: Thread = { ...current.thread, entries: [...current.thread.entries, entry] };
      if (entry.kind === 'settled' && entry.settledAs) next.settledAs = entry.settledAs;
      const text = serializeThread(next);
      const file = this.file(collection, id);
      // Write beside the file, then rename: readers never see half a file.
      const draft = temporary(file);
      try {
        await writeFile(draft, text, { flag: 'wx' });
        await rename(draft, file);
      } finally { await rm(draft, { force: true }); }
      return { thread: next, version: version(text) };
    });
  }
}

/**
 * Refuses a store inside the documents' git working tree, or inside the documents' folder when it
 * has no git: annotations must never ride on the documents' branches.
 */
export async function checkStoreOutside(store: string, documentsRoot: string): Promise<void> {
  let top = documentsRoot;
  try { top = (await promisify(execFile)('git', ['-C', documentsRoot, 'rev-parse', '--show-toplevel'])).stdout.trim() || documentsRoot; }
  catch { /* not in git: the documents' folder is the boundary */ }
  const relative = path.relative(await realpath(top), await realpath(store));
  if (relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))) {
    throw new Error(`The store ${store} is inside the documents' working tree ${top}; keep annotations in a separate folder`);
  }
}

export { threadStatus };

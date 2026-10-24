// The file store: <store>/<collection>/collection.yaml and <store>/<collection>/threads/<id>.md.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

  async collection(name: string): Promise<Collection> {
    const file = path.join(this.directory(name), 'collection.yaml');
    let text: string;
    try { text = await readFile(file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`No collection ${name} in ${this.root}: ${file} is missing`);
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
    await writeFile(path.join(directory, 'collection.yaml'), stringifyYaml({ title: collection.title, settled: collection.settled }), { flag: 'wx' });
  }

  async list(collection: string): Promise<StoredThread[]> {
    const directory = path.join(this.directory(collection), 'threads');
    let names: string[];
    try { names = (await readdir(directory)).filter(name => name.endsWith('.md')).sort(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
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

  /** Writes a new thread; refuses an id that exists. */
  async create(collection: string, thread: Thread): Promise<StoredThread> {
    const text = serializeThread(thread);
    const file = this.file(collection, thread.id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text, { flag: 'wx' });
    return { thread, version: version(text) };
  }

  /** Appends one entry, refusing when the file is no longer at `expected`. */
  async append(collection: string, id: string, entry: Entry, expected?: string): Promise<StoredThread> {
    const current = await this.read(collection, id);
    if (expected !== undefined && current.version !== expected) throw new ConflictError(id);
    if (entry.kind === 'answer' && current.thread.kind !== 'question') throw new Error(`Thread ${id} is a comment and takes no answer`);
    const next: Thread = { ...current.thread, entries: [...current.thread.entries, entry] };
    if (entry.kind === 'settled' && entry.settledAs) next.settledAs = entry.settledAs;
    const text = serializeThread(next);
    const file = this.file(collection, id);
    // Write beside the file, then rename: readers never see half a file.
    const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporary, text, { flag: 'wx' });
    const again = version(await readFile(file, 'utf8'));
    if (again !== current.version) {
      await rm(temporary);
      throw new ConflictError(id);
    }
    await rename(temporary, file);
    return { thread: next, version: version(text) };
  }
}

export { threadStatus };

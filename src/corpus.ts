import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

/** A Markdown source and its location relative to the selected source root. */
export interface SourceFile { path: string; markdown: string }
/** Manifest navigation retains section order, including multiple sections in one file. */
export interface MapEntry { path: string; anchor?: string; label: string; summary?: string }
/** A document and its chapters in manifest order; paths are deduplicated within each document. */
export interface DocumentGroup { title?: string; paths: string[] }
/** A resolved entity home; its meaning is read from Markdown during rendering. */
export interface EntityHome { path: string; anchor: string }
/** In-memory source snapshot. No registry or index is persisted. */
export interface Corpus {
  root: string;
  files: SourceFile[];
  map: MapEntry[];
  documents: DocumentGroup[];
  entities: EntityHome[];
  /** Inventory classifications; unrendered entries remain references to original inputs. */
  inventory: Map<string, string>;
}

/** Resolves a local input without allowing paths outside the selected source root. */
export function within(root: string, relative: string): string {
  const absolute = path.resolve(root, relative);
  const rel = path.relative(root, absolute);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes source root: ${relative}`);
  }
  return absolute;
}

/** Reads regular UTF-8 inputs; symbolic links and malformed encoding fail visibly. */
export async function readSource(root: string, relative: string): Promise<Buffer> {
  const absolute = within(root, relative);
  if (!(await lstat(absolute)).isFile() || await realpath(absolute) !== absolute) {
    throw new Error(`Input must be a regular file without symlinks: ${relative}`);
  }
  return readFile(absolute);
}

async function optionalJson(root: string, relative: string): Promise<unknown | undefined> {
  try {
    const bytes = await readSource(root, relative);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Cannot read ${relative}: ${(error as Error).message}`, { cause: error });
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be nonempty text`);
  return value;
}
function version(value: unknown, label: string): Record<string, unknown> {
  const result = object(value, label);
  if (result.version !== 1) throw new Error(`${label}: unsupported version ${String(result.version)}`);
  return result;
}
const portable = (value: string): string => value.split(path.sep).join('/');

async function markdownFiles(root: string, relative = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(within(root, relative), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link in input folder: ${name}`);
    if (entry.isDirectory()) files.push(...await markdownFiles(root, name));
    else if (/\.md$/i.test(name)) files.push(portable(name));
  }
  return files.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

/** Loads metadata first, then reads each selected Markdown file once in reading order. */
export async function loadCorpus(input: string): Promise<Corpus> {
  const requested = path.resolve(input);
  const stat = await lstat(requested);
  if (stat.isSymbolicLink()) throw new Error('The selected input must not be a symbolic link');
  const selected = await realpath(requested);
  if (!stat.isDirectory() && !(stat.isFile() && /\.md$/i.test(selected))) {
    throw new Error('Select a Markdown file or a folder');
  }
  const single = stat.isFile();
  let root = await realpath(single ? path.dirname(selected) : selected);
  // A selected docs folder uses the same repository-relative manifest paths as a repository root.
  const inDocs = path.basename(root) === 'docs';
  let metadataRoot = inDocs ? path.dirname(root) : root;
  let manifest = await optionalJson(metadataRoot, 'docs/DOCUMENTS.json');
  let entityIndex = await optionalJson(metadataRoot, 'docs/ENTITIES.json');
  // A selected corpus's metadata wins. Otherwise repository links may leave the
  // selected folder, but never the source repository.
  if (manifest === undefined && entityIndex === undefined) {
    for (let candidate = root; ; candidate = path.dirname(candidate)) {
      try {
        await lstat(path.join(candidate, '.git'));
        metadataRoot = candidate;
        root = candidate;
        manifest = await optionalJson(metadataRoot, 'docs/DOCUMENTS.json');
        entityIndex = await optionalJson(metadataRoot, 'docs/ENTITIES.json');
        break;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (path.dirname(candidate) === candidate) break;
    }
  }
  if (manifest !== undefined || entityIndex !== undefined) root = metadataRoot;
  const selectedRelative = portable(path.relative(root, selected));
  const map: MapEntry[] = [];
  const documents: DocumentGroup[] = [];
  const sections = new Map<string, string>();
  const inventory = new Map<string, string>();
  if (manifest !== undefined) {
    const data = version(manifest, 'DOCUMENTS.json');
    for (const value of array(data.inventory, 'inventory')) {
      const entry = object(value, 'inventory entry');
      const file = portable(string(entry.path, 'inventory.path'));
      within(root, file);
      const kind = string(entry.kind, 'inventory.kind');
      if (!['specification', 'design', 'other', 'generated'].includes(kind)) {
        throw new Error(`DOCUMENTS.json: unsupported inventory kind ${kind}`);
      }
      inventory.set(file, kind);
    }
    for (const value of array(data.documents, 'documents')) {
      const document = object(value, 'document');
      const id = string(document.id, 'document.id');
      const group: DocumentGroup = { title: document.title === undefined ? undefined : string(document.title, 'document.title'), paths: [] };
      documents.push(group);
      for (const value of array(document.sections, 'sections')) {
        const section = object(value, 'section');
        const file = portable(string(section.path, 'section.path'));
        within(root, file);
        const key = `${id}#${string(section.id, 'section.id')}`;
        if (sections.has(key)) throw new Error(`Duplicate section: ${key}`);
        sections.set(key, file);
        if ((!single || file === selectedRelative) && !file.endsWith('/') &&
            inventory.get(file) !== 'other' && inventory.get(file) !== 'generated') {
          if (!group.paths.includes(file)) group.paths.push(file);
          map.push({ path: file, anchor: string(section.anchor, 'section.anchor'),
            label: String(section.title ?? section.id),
            summary: section.summary === undefined ? undefined : string(section.summary, 'section.summary') });
        }
      }
      if (!single && document.navigation !== undefined) {
        const navigation = object(document.navigation, 'navigation');
        const file = portable(string(navigation.path, 'navigation.path'));
        // Navigation may be a declared generated file or a region in an authored file.
        within(root, file);
        if (!group.paths.includes(file)) group.paths.push(file);
        if (!map.some((entry) => entry.path === file)) {
          map.push({ path: file, label: `${String(document.title ?? id)} — overview` });
        }
      }
    }
  }
  const ordered = [...new Set(map.map((entry) => entry.path))];
  // A manifest is authoritative: first section occurrence wins, then its navigation file.
  // Only folders without a manifest use recursive discovery. Single-file selection stays explicit.
  const available = single ? [selectedRelative] : manifest === undefined ? await markdownFiles(root, selectedRelative) : [];
  const remaining = available.filter((file) => !ordered.includes(file));
  const selectedIndex = path.posix.join(selectedRelative, 'index.md').toLowerCase();
  remaining.sort((a, b) => Number(b.toLowerCase() === selectedIndex) - Number(a.toLowerCase() === selectedIndex));
  for (const file of remaining) {
    ordered.push(file);
    map.push({ path: file, label: path.basename(file, path.extname(file)) });
  }
  if (remaining.length) documents.push({ paths: remaining });
  if (!ordered.length) throw new Error('No Markdown files found');
  const files: SourceFile[] = [];
  for (const file of ordered) {
    const bytes = await readSource(root, file);
    files.push({ path: file, markdown: new TextDecoder('utf-8', { fatal: true }).decode(bytes) });
  }
  const entities: EntityHome[] = [];
  if (entityIndex !== undefined) {
    const data = version(entityIndex, 'ENTITIES.json');
    for (const [id, value] of Object.entries(object(data.entities, 'entities'))) {
      const home = object(object(value, id).home, `${id}.home`);
      const key = string(home.section, `${id}.home.section`);
      const file = sections.get(key);
      if (!file) throw new Error(`Entity ${id}: unknown home section ${key}; DOCUMENTS.json is required to resolve homes`);
      if (files.some((source) => source.path === file)) entities.push({ path: file, anchor: string(home.anchor, `${id}.home.anchor`) });
    }
  }
  return { root, files, map, documents, entities, inventory };
}

import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

/** A Markdown source and its location relative to the selected source root. */
export interface SourceFile { path: string; markdown: string }
/** Manifest navigation retains section order, including multiple sections in one file. */
export interface MapEntry { path: string; anchor?: string; label: string; summary?: string }
/** A resolved entity home; its meaning is read from Markdown during rendering. */
export interface EntityHome { path: string; anchor: string }
/** In-memory source snapshot. No registry or index is persisted. */
export interface Corpus {
  root: string;
  files: SourceFile[];
  map: MapEntry[];
  entities: EntityHome[];
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
  const metadataRoot = inDocs ? path.dirname(root) : root;
  const manifest = await optionalJson(metadataRoot, 'docs/DOCUMENTS.json');
  const entityIndex = await optionalJson(metadataRoot, 'docs/ENTITIES.json');
  if (manifest !== undefined || entityIndex !== undefined) root = metadataRoot;
  const selectedRelative = portable(path.relative(root, selected));
  const available = single ? [selectedRelative] : await markdownFiles(root, portable(path.relative(root, await realpath(selected))));
  const availableSet = new Set(available);
  const map: MapEntry[] = [];
  const sections = new Map<string, string>();
  if (manifest !== undefined) {
    const data = version(manifest, 'DOCUMENTS.json');
    for (const value of array(data.documents, 'documents')) {
      const document = object(value, 'document');
      const id = string(document.id, 'document.id');
      for (const value of array(document.sections, 'sections')) {
        const section = object(value, 'section');
        const file = portable(string(section.path, 'section.path'));
        within(root, file);
        const key = `${id}#${string(section.id, 'section.id')}`;
        if (sections.has(key)) throw new Error(`Duplicate section: ${key}`);
        sections.set(key, file);
        if (!single || file === selectedRelative) {
          map.push({ path: file, anchor: string(section.anchor, 'section.anchor'),
            label: String(section.title ?? section.id),
            summary: section.summary === undefined ? undefined : string(section.summary, 'section.summary') });
        }
      }
      if (!single && document.navigation !== undefined) {
        const navigation = object(document.navigation, 'navigation');
        const file = portable(string(navigation.path, 'navigation.path'));
        if (availableSet.has(file) && !map.some((entry) => entry.path === file)) {
          map.push({ path: file, label: `${String(document.title ?? id)} — overview` });
        }
      }
    }
  }
  const ordered = [...new Set(map.map((entry) => entry.path))];
  // Metadata controls listed files; all other Markdown remains visible, in lexical order.
  const remaining = available.filter((file) => !ordered.includes(file));
  remaining.sort((a, b) => Number(b.toLowerCase() === 'index.md') - Number(a.toLowerCase() === 'index.md'));
  for (const file of remaining) {
    ordered.push(file);
    map.push({ path: file, label: path.basename(file, path.extname(file)) });
  }
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
  return { root, files, map, entities };
}

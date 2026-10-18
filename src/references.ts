import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { visit } from 'unist-util-visit';
import type { Corpus } from './corpus.js';
import { parseDocument, textDocument, transformUrls, type ParsedDocument } from './markdown.js';

const run = promisify(execFile);
const portable = (file: string): string => file.split(path.sep).join('/');
const inside = (root: string, file: string): boolean => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function displayPath(root: string, absolute: string): Promise<string> {
  if (inside(root, absolute)) return portable(path.relative(root, absolute));
  for (let directory = path.dirname(absolute); ; directory = path.dirname(directory)) {
    try {
      await lstat(path.join(directory, '.git'));
      const { stdout } = await run('git', ['-C', directory, 'rev-parse', '--short', 'HEAD']);
      return `${path.basename(directory)} @ ${stdout.trim()}: ${portable(path.relative(directory, absolute))}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (directory === path.dirname(directory)) break;
  }
  return path.basename(absolute);
}

/** One build's local destination, including visible exceptions to bundling. */
export interface ReferenceTarget {
  key?: string;
  label: string;
  kind: 'markdown' | 'text' | 'binary' | 'missing' | 'directory' | 'omitted' | 'unbundled';
  size?: number;
}

/** Resolves original source paths separately from their portable output destinations. */
export interface BundledReferences {
  target(file: string, pathname: string): ReferenceTarget;
}

/** Bundles direct input links before URL rewriting, reusing the shared parsed documents. */
export async function bundleReferences(corpus: Corpus, docs: Map<string, ParsedDocument>, files: Map<string, Buffer>, maxFileBytes: number): Promise<BundledReferences> {
  const sources = new Map([...docs.keys()].map(file => [file, path.join(corpus.root, file)]));
  const targets = new Map<string, ReferenceTarget>([...sources].map(([key, absolute]) => [absolute, { key, label: key, kind: 'markdown' }]));
  const resolve = (file: string, pathname: string): string => pathname.startsWith('/')
    ? path.resolve(corpus.root, '.' + pathname) : path.resolve(path.dirname(sources.get(file)!), pathname);
  let sequence = 0;
  // Initial input pages precede appended references: all direct targets are registered first.
  // Reference-page links can reuse those targets, but never discover another bundled page.
  for (const [file, doc] of docs) {
    const discovered = new Set<string>();
    transformUrls(doc, (url, image) => {
      if (!image && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) {
        const pathname = decodeURIComponent(url.split(/[?#]/)[0]!);
        if (pathname) discovered.add(resolve(file, pathname));
      }
      return { url };
    });
    for (const absolute of discovered) {
      if (targets.has(absolute)) continue;
      const label = await displayPath(corpus.root, absolute);
      if (doc.displayPath !== undefined) {
        targets.set(absolute, { label, kind: 'unbundled' });
        continue;
      }
      let info;
      try { info = await (inside(corpus.root, absolute) ? lstat(absolute) : stat(absolute)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        targets.set(absolute, { label, kind: 'missing' });
        continue;
      }
      if (inside(corpus.root, absolute) && await realpath(absolute) !== absolute) throw new Error(`Linked input must be a regular file without symlinks: ${label} (${absolute})`);
      if (info.isDirectory()) {
        targets.set(absolute, { label, kind: 'directory' });
        continue;
      }
      if (!info.isFile()) throw new Error(`Linked input must be a regular file without symlinks: ${label} (${absolute})`);
      if (info.size > maxFileBytes) {
        targets.set(absolute, { label, kind: 'omitted', size: info.size });
        continue;
      }
      const bytes = await readFile(absolute);
      // Check the actual snapshot too, in case the file grew after stat.
      if (bytes.length > maxFileBytes) {
        targets.set(absolute, { label, kind: 'omitted', size: bytes.length });
        continue;
      }
      let text: string | undefined;
      if (!bytes.includes(0)) {
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch (error) { if (!(error instanceof TypeError)) throw error; }
      }
      const kind = text === undefined ? 'binary' : /\.md$/i.test(absolute) ? 'markdown' : 'text';
      const basename = path.basename(absolute);
      const key = kind === 'markdown' && inside(corpus.root, absolute)
        ? portable(path.relative(corpus.root, absolute))
        : `_md-render/references/${sequence++}/${basename}${kind === 'text' ? '.md' : ''}`;
      targets.set(absolute, { key, label, kind });
      if (kind === 'binary') files.set(key, bytes);
      else {
        const reference = kind === 'markdown' ? parseDocument(text!, basename) : textDocument(text!, basename);
        reference.displayPath = label;
        docs.set(key, reference);
        sources.set(key, absolute);
      }
    }
  }
  // Authored absolute input/home paths can occur in prose, code or link titles too.
  const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const absolutePaths = new RegExp(`(?:${[corpus.root, homedir()].map(escaped).join('|')})(?:/[^\\s<>"'\x60)\\],;]+)?`, 'g');
  for (const doc of docs.values()) {
    const values = new Set<string>([doc.title, ...doc.headings.map(heading => heading.title), ...doc.meanings.values()]);
    visit(doc.tree, node => {
      if ('value' in node && typeof node.value === 'string') values.add(node.value);
      if ('title' in node && typeof node.title === 'string') values.add(node.title);
    });
    const replacements = new Map<string, string>();
    for (const value of values) {
      let result = value;
      for (const match of value.matchAll(absolutePaths)) {
        const absolute = match[0];
        result = result.replace(absolute, await displayPath(corpus.root, absolute));
      }
      replacements.set(value, result);
    }
    visit(doc.tree, node => {
      if ('value' in node && typeof node.value === 'string') node.value = replacements.get(node.value) ?? node.value;
      if ('title' in node && typeof node.title === 'string') node.title = replacements.get(node.title) ?? node.title;
    });
    doc.title = replacements.get(doc.title) ?? doc.title;
    for (const heading of doc.headings) heading.title = replacements.get(heading.title) ?? heading.title;
    for (const [anchor, meaning] of doc.meanings) doc.meanings.set(anchor, replacements.get(meaning) ?? meaning);
  }
  return { target: (file, pathname) => targets.get(pathname ? resolve(file, pathname) : sources.get(file)!)! };
}

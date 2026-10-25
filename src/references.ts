import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { visit } from 'unist-util-visit';
import { readLimitedFile, type Corpus } from './corpus.js';
import type { Nodes as MarkdownNodes } from 'mdast';
import type { Nodes as HtmlNodes } from 'hast';
import { parseDocument, textDocument, transformUrls, type ParsedDocument, type SourceDocument } from './markdown.js';

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

/** Replaces authored machine paths using offsets in the original text only. */
export async function portableText(root: string, value: string): Promise<string> {
  const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const absolutePaths = new RegExp(`(?:${[root, homedir()].map(escaped).join('|')})(?:/[^\\s<>"'\x60)\\],;]+)?`, 'g');
  let result = '';
  let end = 0;
  for (const match of value.matchAll(absolutePaths)) {
    result += value.slice(end, match.index) + await displayPath(root, match[0]);
    end = match.index + match[0].length;
  }
  return result + value.slice(end);
}

/** One build's local destination, including visible exceptions to bundling. */
export interface ReferenceTarget {
  key?: string;
  label: string;
  kind: 'markdown' | 'text' | 'binary' | 'missing' | 'directory' | 'omitted' | 'unbundled';
  size?: number;
  /** Captured source bytes reused when the same target is also an image. */
  bytes?: Buffer;
}

/** Resolves original source paths separately from their portable output destinations. */
export interface BundledReferences {
  target(file: string, pathname: string): ReferenceTarget;
  resolve(file: string, pathname: string): string;
  bytes(absolute: string): Buffer | undefined;
}

/** Bundles direct input links before URL rewriting, reusing the shared parsed documents. */
export async function bundleReferences(corpus: Corpus, docs: Map<string, SourceDocument>, files: Map<string, Buffer>, maxFileBytes: number): Promise<BundledReferences> {
  const sources = new Map([...docs.keys()].map(file => [file, path.join(corpus.root, file)]));
  const targets = new Map<string, ReferenceTarget>([...sources].map(([key, absolute]) => [absolute, { key, label: key, kind: 'markdown' }]));
  const resolve = (file: string, pathname: string): string => pathname.startsWith('/')
    ? path.resolve(corpus.root, '.' + pathname) : path.resolve(path.dirname(sources.get(file)!), pathname);
  let sequence = 0;
  const discover = (file: string, doc: ParsedDocument, images = false): Set<string> => {
    const discovered = new Set<string>();
    transformUrls(doc, (url, image) => {
      if (image === images && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) {
        const pathname = decodeURIComponent(url.split(/[?#]/)[0]!);
        if (pathname) discovered.add(resolve(file, pathname));
      }
      return { url };
    });
    return discovered;
  };
  // All retained targets use this classification, including preliminary in-root Markdown.
  const include = async (absolute: string, inputPage = false): Promise<void> => {
    if (targets.has(absolute)) return;
    const label = await displayPath(corpus.root, absolute);
    let info;
    try { info = await (inside(corpus.root, absolute) ? lstat(absolute) : stat(absolute)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      targets.set(absolute, { label, kind: 'missing' });
      return;
    }
    if (inside(corpus.root, absolute) && await realpath(absolute) !== absolute) throw new Error(`Linked input must be a regular file without symlinks: ${label} (${absolute})`);
    if (info.isDirectory()) {
      targets.set(absolute, { label, kind: 'directory' });
      return;
    }
    if (!info.isFile()) throw new Error(`Linked input must be a regular file without symlinks: ${label} (${absolute})`);
    if (info.size > maxFileBytes) {
      targets.set(absolute, { label, kind: 'omitted', size: info.size });
      return;
    }
    const bytes = await readLimitedFile(absolute, maxFileBytes);
    if (typeof bytes === 'number') {
      targets.set(absolute, { label, kind: 'omitted', size: bytes });
      return;
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
    targets.set(absolute, { key, label, kind, bytes });
    if (kind === 'binary') files.set(key, bytes);
    else {
      const reference = kind === 'markdown' ? parseDocument(text!, inputPage ? 'Untitled chapter' : basename) : textDocument(text!, basename);
      if (!inputPage || kind !== 'markdown') reference.displayPath = label;
      docs.set(key, reference);
      sources.set(key, absolute);
    }
  };
  // One-hop in-root Markdown belongs to the input's rendered pages. Classify it
  // before discovering outgoing references, without recursively promoting more pages.
  for (const { path: file } of corpus.files) {
    for (const absolute of discover(file, docs.get(file)!)) {
      if (inside(corpus.root, absolute) && /\.md$/i.test(absolute)) await include(absolute, true);
    }
  }
  for (const [file, doc] of docs) {
    if (doc.displayPath !== undefined) continue;
    for (const absolute of discover(file, doc)) await include(absolute);
  }
  // Register every included image before classifying links from bundled pages.
  // Image confinement, symlink refusal and content reads remain with the image owner.
  for (const [file, doc] of docs) {
    for (const absolute of discover(file, doc, true)) {
      if (!targets.has(absolute)) targets.set(absolute, {
        key: portable(path.relative(corpus.root, absolute)), label: await displayPath(corpus.root, absolute), kind: 'binary',
      });
    }
  }
  for (const [file, doc] of docs) {
    if (doc.displayPath === undefined) continue;
    for (const absolute of discover(file, doc)) {
      if (!targets.has(absolute)) targets.set(absolute, { label: await displayPath(corpus.root, absolute), kind: 'unbundled' });
    }
  }
  for (const [file, doc] of docs) {
    for (const id of doc.anchors) {
      if (id.includes(corpus.root) || id.includes(homedir())) {
        throw new Error(`Authored anchor contains an absolute input or home path: ${doc.displayPath ?? file}#${id}`);
      }
    }
  }
  // Authored absolute input/home paths can occur in prose, code or link titles too.
  for (const doc of docs.values()) {
    // Mermaid and generated source blocks keep their text in HTML children.
    const transformText = (transform: (value: string) => string): void => {
      const apply = (node: MarkdownNodes | HtmlNodes): void => {
        if ('value' in node && typeof node.value === 'string') node.value = transform(node.value);
        if ('title' in node && typeof node.title === 'string') node.title = transform(node.title);
        if ('alt' in node && typeof node.alt === 'string') node.alt = transform(node.alt);
      };
      visit(doc.tree, node => {
        apply(node);
        for (const child of node.data?.hChildren ?? []) visit(child, apply);
      });
    };
    const values = new Set<string>([doc.title, ...doc.headings.map(heading => heading.title), ...doc.meanings.values()]);
    transformText(value => { values.add(value); return value; });
    const replacements = new Map<string, string>();
    for (const value of values) {
      replacements.set(value, await portableText(corpus.root, value));
    }
    transformText(value => replacements.get(value) ?? value);
    doc.title = replacements.get(doc.title) ?? doc.title;
    for (const heading of doc.headings) heading.title = replacements.get(heading.title) ?? heading.title;
    for (const [anchor, meaning] of doc.meanings) doc.meanings.set(anchor, replacements.get(meaning) ?? meaning);
  }
  for (const group of corpus.documents) {
    if (group.title !== undefined) group.title = await portableText(corpus.root, group.title);
  }
  return { resolve, bytes: absolute => targets.get(absolute)?.bytes, target: (file, pathname) => targets.get(pathname ? resolve(file, pathname) : sources.get(file)!)! };
}

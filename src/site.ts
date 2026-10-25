import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCorpus, readSource, within, type Corpus } from './corpus.js';
import { bundleReferences, type ReferenceTarget } from './references.js';
import { renderDiagrams } from './diagrams.js';
import { documentOutline, parseDocument, renderDocument, transformUrls, type OutlineEntry, type ParsedDocument } from './markdown.js';

const assets = '_md-render';
/** Static rendering options. Mermaid can be disabled to exercise the offline fallback. */
export interface RenderOptions {
  theme?: string;
  mermaid?: boolean;
  /** Versioned retained-export policy for additional linked files, in bytes. */
  bundle?: { version: 1; maxFileBytes?: number };
  /** Versioned session policy; bounds HTML requests and HTTP asset freshness. */
  navigation?: { version: 1; cachePages?: number; assetMaxAgeSeconds?: number };
}

/** One rendered Markdown block, as extensions see it. */
export interface Block {
  readonly id: string;
  readonly path: string;
  readonly lines: readonly [number, number];
  readonly tag: string;
  readonly text: string;
  readonly heading: string | null;
}
/**
 * Read-only view of the rendered corpus, in reading order; md-render freezes it. `markdown` is the
 * text md-render read and rendered, so an extension never reads the file again.
 */
export interface SiteView {
  readonly documents: readonly { readonly path: string; readonly title: string; readonly markdown: string; readonly anchors: readonly string[]; readonly blocks: readonly Block[] }[];
}
/** What an extension adds to every page. `connect` allows fetch to the page's own origin. */
export interface ExtensionOutput { styles?: string; script?: string; data?: unknown; connect?: boolean }
/** A render-time extension of the single page; `prepare` runs once, after rendering and before the page is written. */
export interface RenderExtension { name: string; prepare(view: SiteView): ExtensionOutput | Promise<ExtensionOutput> }
/** A prepared extension's output, ready to embed. */
export interface PreparedExtension extends ExtensionOutput { name: string }
const extensionName = /^[a-z][a-z0-9-]*$/;
/** Script text safe inside an HTML script element. */
const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');
const sha256 = (value: string): string => `'sha256-${createHash('sha256').update(value).digest('base64')}'`;
/** Output summary. All files are rebuildable from the input corpus and theme. */
export interface RenderResult { directory: string; pages: string[]; links: number; mermaid: boolean; warnings: string[] }

/** Escapes text and attribute values in the surrounding HTML page. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const pagePath = (file: string): string => file.replace(/\.md$/i, '.html');
const urlPath = (file: string): string => file.split('/').map(encodeURIComponent).join('/');
function relativeUrl(from: string, to: string): string {
  return urlPath(path.posix.relative(path.posix.dirname(pagePath(from)), to));
}

async function themeAssets(files: Map<string, Buffer>, theme: string): Promise<string | undefined> {
  const builtIn = theme === 'default' || theme === 'symbiotic';
  const source = builtIn ? fileURLToPath(new URL(`../themes/${theme}.css`, import.meta.url)) : path.resolve(theme);
  const css = await readFile(source, 'utf8');
  files.set(`${assets}/theme.css`, Buffer.from(css));
  // A theme's optional logo sits beside its CSS: example.css + example.logo.svg/png/webp.
  let logo: string | undefined;
  for (const extension of ['svg', 'png', 'webp']) {
    const name = source.replace(/\.css$/i, `.logo.${extension}`);
    try {
      const bytes = await readFile(name);
      if (logo) throw new Error(`Theme has more than one logo: ${source}`);
      files.set(`${assets}/logo.${extension}`, bytes);
      logo = `logo.${extension}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return logo;
}

/** Builds the shared reading shell with either external or embedded resources. */
export function page(corpus: Corpus, docs: Map<string, ParsedDocument>, file: string, body: string, logo: string | undefined, themeInit: string, cachePages: number, single?: SinglePage, extensions: PreparedExtension[] = []): string {
  const doc = docs.get(file)!;
  const href = (target: string): string => escapeHtml(single ? single.url(target) : relativeUrl(file, target));
  // Compare titles in menu order, including section links and group headings.
  let previousTitle: string | undefined;
  const outlineHtml = (entries: OutlineEntry[], chapter: string): string => entries.length ? `<ol>${entries.map((entry) => {
    previousTitle = entry.title;
    return `<li><a href="${single ? escapeHtml(single.url(pagePath(chapter), entry.id)) : `${chapter === file ? '' : escapeHtml(relativeUrl(file, pagePath(chapter)))}#${encodeURIComponent(entry.id)}`}">${escapeHtml(entry.title)}</a>${outlineHtml(entry.children, chapter)}</li>`;
  }).join('')}</ol>` : '';
  let chapterId = 0;
  const chapters = (paths: string[], groupTitle?: string, referenced = false): string => paths.map((chapter, index) => {
    const target = single ? single.url(pagePath(chapter)) : relativeUrl(file, pagePath(chapter));
    const chapterDoc = docs.get(chapter)!;
    let label = paths.length === 1 && groupTitle ? groupTitle : chapterDoc.title;
    if (paths.length > 1 && index === 0 && label === groupTitle) {
      label = chapterDoc.headings.find((heading) => heading.depth === 2)?.title ?? 'Introduction';
    }
    const entries = referenced ? [] : documentOutline(chapterDoc);
    // A heading used as the chapter label already has a link; retain its children.
    if (entries[0]?.title === label) entries.splice(0, 1, ...entries[0].children);
    if ((referenced ? label + chapter : label) === previousTitle) label += ` — ${chapter}`;
    previousTitle = referenced ? label + chapter : label;
    const title = escapeHtml(label);
    const outline = outlineHtml(entries, chapter);
    const id = `chapter-sections-${chapterId++}`;
    const current = chapter === file;
    return `<li><div class="chapter-row">${outline ? `<button class="chapter-toggle" type="button" aria-label="Toggle ${title}" aria-expanded="${current}" aria-controls="${id}"><span aria-hidden="true">›</span></button>` : ''}<a href="${escapeHtml(target)}"${current ? ' aria-current="page"' : ''}>${title}${referenced ? `<small class="reference-path">${escapeHtml(chapterDoc.displayPath ?? chapter)}</small>` : ''}</a></div>${outline ? `<div id="${id}"${current ? '' : ' hidden'}>${outline}</div>` : ''}</li>`;
  }).join('');
  const references = [...docs.keys()].filter((chapter) => !corpus.files.some((source) => source.path === chapter));
  let sidebar = corpus.documents.filter((group) => group.paths.length).map((group) => {
    const heading = group.paths.length > 1 ? group.title ?? 'Documentation' : undefined;
    if (heading !== undefined) previousTitle = heading;
    return `<section class="document-group">${heading !== undefined ? `<h2>${escapeHtml(heading)}</h2>` : ''}<ol>${chapters(group.paths, group.title)}</ol></section>`;
  }).join('');
  if (references.length) {
    previousTitle = 'Referenced files';
    sidebar += `<details class="document-group referenced"${references.includes(file) ? ' open' : ''}><summary>Referenced files</summary><ol>${chapters(references, undefined, true)}</ol></details>`;
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${single ? single.policy : `default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' ${sha256(themeInit)}; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'`}">
<meta name="md-render-navigation" content="${escapeHtml(JSON.stringify({ version: 1, cachePages }))}">
<script>${themeInit}</script><title>${escapeHtml(doc.title)}</title>${single ? `<style>${single.styles}</style>` : `<link rel="stylesheet" href="${href(`${assets}/base.css`)}"><link rel="stylesheet" href="${href(`${assets}/theme.css`)}">`}${extensions.map(extension => extension.styles ? `<style data-md-render-extension="${extension.name}">${extension.styles.replace(/<\/style/gi, '\\3c /style')}</style>` : '').join('')}</head>
<body><a class="skip-link" href="#md-render-content">Skip to document</a>
<header class="menu-bar"><button id="menu-button" type="button" aria-expanded="true" aria-controls="document-menu">Menu</button><a class="site-title" href="${href(pagePath(corpus.files[0]!.path))}">${logo ? `<img src="${href(`${assets}/${logo}`)}" alt="Theme logo">` : ''}<span>Documentation</span></a></header>
<aside class="sidebar" id="document-menu" aria-label="Documentation menu"><button id="menu-close" type="button">Close menu</button><nav aria-label="Document map">${sidebar}</nav><div class="theme-switch" role="group" aria-label="Appearance">${[
  ['light', 'Light', '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path>'],
  ['system', 'System', '<rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path>'],
  ['dark', 'Dark', '<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"></path>'],
].map(([value, label, icon]) => `<button type="button" value="${value}" aria-label="${label}" title="${label}" aria-pressed="${value === 'system'}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></button>`).join('')}</div></aside>
<main id="md-render-content">${single ? single.content : pageContent(corpus, docs, file, body, href)}</main>
${extensions.map(extension => extension.data === undefined ? '' : `<script type="application/json" id="md-render-extension-data-${extension.name}">${scriptJson(extension.data)}</script>`).join('')}${single ? `<script>${single.script}</script>` : `<script src="${href(`${assets}/navigation.js`)}" defer></script>`}
${extensions.map(extension => extension.script ? `<script>${extension.script}</script>` : '').join('')}</body></html>`;
}

/** Page shell inputs for an embedded export; all resources are already resolved. */
export interface SinglePage {
  url(target: string, fragment?: string): string;
  content: string;
  styles: string;
  script: string;
  policy: string;
}

/** Shared page metadata, article and reading-order controls. */
export function pageContent(corpus: Corpus, docs: Map<string, ParsedDocument>, file: string, body: string, href: (target: string) => string): string {
  const index = corpus.files.findIndex((source) => source.path === file);
  const adjacent = (offset: number, label: string): string => {
    const source = index < 0 ? undefined : corpus.files[index + offset];
    return source ? `<a href="${href(pagePath(source.path))}"><small>${label}</small>${escapeHtml(docs.get(source.path)!.title)}</a>` : '<span></span>';
  };
  return `<header class="page-meta"><span>${escapeHtml(docs.get(file)!.displayPath ?? file)}</span><span>${index < 0 ? 'Referenced file' : `${index + 1} / ${corpus.files.length}`}</span></header><article class="sd-doc">${body}</article><nav class="adjacent" aria-label="Reading order">${adjacent(-1, 'Previous')}${adjacent(1, 'Next')}</nav>`;
}

/** Validated rendering snapshot shared by retained export formats. */
export interface PreparedSite {
  corpus: Corpus;
  docs: Map<string, ParsedDocument>;
  bodies: string[];
  files: Map<string, Buffer>;
  logo: string | undefined;
  themeInit: string;
  cachePages: number;
  links: number;
  mermaid: boolean;
  warnings: string[];
  /** The rendered corpus as extensions see it; built only when a caller asks for it. */
  view?: SiteView;
  extensions: PreparedExtension[];
}

/** Runs each extension once on the rendered snapshot; a failure stops the render. */
async function prepareExtensions(view: SiteView, extensions: RenderExtension[]): Promise<PreparedExtension[]> {
  const names = new Set<string>();
  for (const { name } of extensions) {
    if (!extensionName.test(name)) throw new Error(`Invalid extension name: ${name}`);
    if (names.has(name)) throw new Error(`Duplicate extension name: ${name}`);
    names.add(name);
  }
  const prepared: PreparedExtension[] = [];
  for (const extension of extensions) {
    let output: ExtensionOutput;
    try { output = await extension.prepare(view); }
    catch (error) { throw new Error(`Extension ${extension.name} failed: ${(error as Error).message}`, { cause: error }); }
    if (output.script && /<\/script/i.test(output.script)) throw new Error(`Extension ${extension.name} failed: its script contains </script`);
    prepared.push({ name: extension.name, ...output });
  }
  return prepared;
}

/** Freezes the view and everything in it, so no extension can change what another one sees. */
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

/**
 * Renders every source before writing pages. Links resolve against the same parsed snapshot.
 * The view, with every document's blocks, is built only for extensions or when `withView` asks for it.
 * Without `page`, only the view is wanted: theme files, page HTML and diagrams are skipped.
 */
export async function prepareSite(input: string, options: RenderOptions = {}, bundle = false, extensionList: RenderExtension[] = [], withView = extensionList.length > 0, page = true): Promise<PreparedSite> {
  const maxFileBytes = options.bundle?.maxFileBytes ?? 5_000_000;
  if (options.bundle && options.bundle.version !== 1 || !Number.isSafeInteger(maxFileBytes) || maxFileBytes < 0) {
    throw new Error('Invalid version-1 bundle configuration');
  }
  const navigation = options.navigation;
  const cachePages = navigation?.cachePages ?? 6;
  const assetMaxAgeSeconds = navigation?.assetMaxAgeSeconds ?? 3600;
  if (navigation && navigation.version !== 1 || !Number.isSafeInteger(cachePages) || cachePages < 1 ||
      !Number.isSafeInteger(assetMaxAgeSeconds) || assetMaxAgeSeconds < 0) {
    throw new Error('Invalid version-1 navigation configuration');
  }
  const corpus = await loadCorpus(input);
  const files = new Map<string, Buffer>();
  if (page) for (const name of ['base.css', 'navigation.js']) files.set(`${assets}/${name}`, await readFile(fileURLToPath(new URL(`../themes/${name}`, import.meta.url))));
  const logo = page ? await themeAssets(files, options.theme ?? 'default') : undefined;
  const themeInit = page ? await readFile(fileURLToPath(new URL('../themes/theme-init.js', import.meta.url)), 'utf8') : '';
  const docs = new Map(corpus.files.map((file) => [file.path, parseDocument(file.markdown, 'Untitled chapter')]));
  if (corpus.files.some(file => file.path === assets || file.path.startsWith(assets + '/'))) throw new Error('Input uses reserved directory: ' + assets);
  // Only initial documents discover references. Parse all direct targets before URL validation.
  for (const { path: file } of bundle ? [] : corpus.files) {
    const doc = docs.get(file)!;
    const targets = new Set<string>();
    transformUrls(doc, (url, image) => {
      if (!image && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) {
        const pathname = decodeURIComponent(url.split(/[?#]/)[0]!);
        if (/\.md$/i.test(pathname)) {
          const target = path.posix.normalize(pathname.startsWith('/') ? pathname.slice(1) : path.posix.join(path.posix.dirname(file), pathname));
          if (!docs.has(target) && !target.startsWith('../')) targets.add(target);
        }
      }
      return { url };
    });
    for (const target of targets) {
      let bytes: Buffer;
      try {
        bytes = await readSource(corpus.root, target);
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`Markdown link is outside rendered corpus: ${file} -> ${target}`, { cause: error });
        }
        throw error;
      }
      docs.set(target, parseDocument(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'Untitled chapter'));
    }
  }
  const references = bundle ? await bundleReferences(corpus, docs, files, maxFileBytes) : undefined;
  const destinations = new Map<string, string>();
  for (const file of docs.keys()) {
    const destination = path.posix.normalize(pagePath(file));
    const previous = destinations.get(destination);
    if (previous !== undefined) throw new Error(`Duplicate generated page destination: ${destination} (${previous}, ${file})`);
    destinations.set(destination, file);
  }
  const meanings = new Map<string, string>();
  for (const home of corpus.entities) {
    const meaning = docs.get(home.path)?.meanings.get(home.anchor);
    if (!meaning) throw new Error(`Entity home needs an anchor, heading and first paragraph: ${home.path}#${home.anchor}`);
    meanings.set(`${home.path}#${home.anchor}`, meaning);
  }
  const copiedAssets = new Set<string>();
  let links = 0;
  const warnings: string[] = [];
  const warnedUnbundled = new Set<ReferenceTarget>();
  const warnedFragments = new Set<string>();
  for (const [file, doc] of docs) {
    for (const entry of corpus.map.filter((entry) => entry.path === file && entry.anchor)) {
      if (!doc.anchors.has(entry.anchor!)) throw new Error(`Missing manifest anchor: ${file}#${entry.anchor}`);
    }
    transformUrls(doc, (url, image) => {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) {
        if (bundle && (url.includes(corpus.root) || url.includes(homedir()))) {
          throw new Error(`External URL contains an absolute input or home path: ${file} -> ${url}`);
        }
        if (image && !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(url)) throw new Error(`Remote or unsupported image in ${file}: ${url}`);
        if (!image && !/^(?:https?:|mailto:|tel:|\/\/)/i.test(url)) throw new Error(`Unsupported link in ${file}: ${url}`);
        return { url };
      }
      const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url)!;
      const pathname = decodeURIComponent(match[1]!);
      const query = match[2] ?? '';
      const fragment = match[3] ?? '';
      const target = pathname ? image && references
        ? path.relative(corpus.root, references.resolve(file, pathname)).split(path.sep).join('/')
        : path.posix.normalize(pathname.startsWith('/') ? pathname.slice(1) : path.posix.join(path.posix.dirname(file), pathname)) : file;
      const absolute = path.resolve(corpus.root, target);
      const outside = path.relative(corpus.root, absolute).startsWith(`..${path.sep}`) || path.relative(corpus.root, absolute) === '..';
      if (target === 'index.html' || [...docs.keys()].some((source) => pagePath(source) === target)) {
        throw new Error(`Attachment collides with rendered page: ${target}`);
      }
      if (!image && references) {
        const reference = references.target(file, pathname);
        if (reference.kind === 'unbundled') {
          if (!warnedUnbundled.has(reference)) {
            warnedUnbundled.add(reference);
            warnings.push(`${doc.displayPath ?? file}: ${reference.label} not bundled`);
          }
          return { url: '', remove: true, suffix: ` (not bundled: ${reference.label})` };
        }
        if (reference.kind === 'missing') {
          warnings.push(`${doc.displayPath ?? file}: external local reference ${reference.label}; missing file`);
          return { url: '', remove: true };
        }
        if (reference.kind === 'directory') {
          warnings.push(`${doc.displayPath ?? file}: external local reference ${reference.label}; directory not bundled`);
          return { url: '', remove: true, suffix: ' (directory not bundled)' };
        }
        if (reference.kind === 'omitted') {
          warnings.push(`${doc.displayPath ?? file}: ${reference.label} omitted: ${reference.size} bytes`);
          return { url: '', remove: true, suffix: ` (omitted: ${reference.size} bytes)` };
        }
        if (reference.kind === 'binary') return { url: relativeUrl(file, reference.key!) + query + fragment, title: reference.label, download: path.basename(reference.key!) };
        const destination = docs.get(reference.key!)!;
        let id = decodeURIComponent(fragment.slice(1));
        let valid = !id || destination.anchors.has(id);
        if (id && reference.kind === 'text') {
          const line = /^L([1-9][0-9]*)(?:-L([1-9][0-9]*))?$/.exec(id);
          valid = !!line && Number(line[1]) <= destination.sourceLines! &&
            (!line[2] || Number(line[2]) >= Number(line[1]) && Number(line[2]) <= destination.sourceLines!);
          if (valid) id = `L${line![1]}`;
        }
        if (!valid) {
          if (doc.displayPath === undefined) {
            throw new Error(reference.kind === 'text' ? `Invalid source line fragment: ${reference.label}#${id}` :
              `Missing anchor: ${file} -> ${reference.label}#${id}`);
          }
          const target = `${reference.key}#${id}`;
          if (!warnedFragments.has(target)) {
            warnedFragments.add(target);
            warnings.push(`${doc.displayPath}: missing fragment ${reference.label}#${id}; linked to page top`);
          }
          id = '';
        }
        links++;
        return { url: (pathname ? relativeUrl(file, pagePath(reference.key!)) : '') + query + (id ? '#' + encodeURIComponent(id) : ''), title: meanings.get(`${reference.key}#${id}`) ?? reference.label };
      }
      if (!image && (outside || pathname && !docs.has(target))) {
        const message = `${file}: external local reference ${url}; ${outside ? 'outside selected input' : 'not a rendered document'}, open the original file`;
        warnings.push(message);
        return { url: pathToFileURL(absolute).href + query + fragment, title: target };
      }
      within(corpus.root, target);
      if (!image && (docs.has(target) || !pathname)) {
        const destination = docs.get(target);
        if (!destination) throw new Error(`Markdown link is outside rendered corpus: ${file} -> ${url}`);
        const id = decodeURIComponent(fragment.slice(1));
        if (id && !destination.anchors.has(id)) throw new Error(`Missing anchor: ${file} -> ${url}`);
        links++;
        return { url: (pathname ? relativeUrl(file, pagePath(target)) : '') + query + fragment,
          title: meanings.get(`${target}#${id}`) };
      }
      if (target === assets || target.startsWith(`${assets}/`)) throw new Error(`Input asset uses reserved directory: ${target}`);
      copiedAssets.add(target);
      return { url: relativeUrl(file, target) + query + fragment };
    });
  }
  for (const file of copiedAssets) {
    const bytes = references?.bytes(path.resolve(corpus.root, file)) ?? await readSource(corpus.root, file);
    files.set(file, bytes);
  }
  const rendered = await Promise.all([...docs.values()].map(doc => renderDocument(doc, { blocks: withView, mark: extensionList.length > 0, html: page })));
  const view: SiteView | undefined = withView ? freeze({ documents: [...docs].map(([path, doc], index) => ({
    path, title: doc.title, markdown: doc.markdown, anchors: [...doc.anchors], blocks: rendered[index]!.blocks.map(block => ({ ...block, path })),
  })) }) : undefined;
  const extensions = view ? await prepareExtensions(view, extensionList) : [];
  const diagrams = page ? await renderDiagrams(rendered.map(result => result.html), options.mermaid !== false) : { pages: rendered.map(result => result.html), available: false };
  return { corpus, docs, bodies: diagrams.pages.map(html => bundle ? html.replace(/file:/gi, value => value.slice(0, -1) + '&#58;') : html), files, logo, themeInit, cachePages, links, mermaid: diagrams.available, warnings, view, extensions };
}

/** Writes the existing folder layout from one validated snapshot. */
export async function writeSite(site: PreparedSite, output: string): Promise<RenderResult> {
  const { corpus, docs, bodies, files, logo, themeInit, cachePages, links, mermaid, warnings } = site;
  const directory = path.resolve(output);
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length) throw new Error(`Output directory must be empty: ${directory}`);
  await mkdir(path.join(directory, assets));
  for (const [file, bytes] of files) {
    const target = within(directory, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  const pages: string[] = [];
  for (const [index, file] of [...docs.keys()].entries()) {
    if (file.startsWith(`${assets}/`) && !docs.get(file)!.displayPath) throw new Error(`Input uses reserved directory: ${file}`);
    const target = within(directory, pagePath(file));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, page(corpus, docs, file, bodies[index]!, logo, themeInit, cachePages));
    pages.push(pagePath(file));
  }
  if (!pages.includes('index.html')) {
    const first = escapeHtml(urlPath(pages[0]!));
    await writeFile(path.join(directory, 'index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${first}"><title>Documentation</title><a href="${first}">Open documentation</a>`);
  }
  return { directory, pages, links, mermaid, warnings };
}

/** Renders a folder export; temporary viewers use this same folder-only API. */
export async function renderSite(input: string, output: string, options: RenderOptions = {}): Promise<RenderResult> {
  return writeSite(await prepareSite(input, options), output);
}

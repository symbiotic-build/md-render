import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCorpus, readSource, within, type Corpus } from './corpus.js';
import { renderDiagrams } from './diagrams.js';
import { documentHtml, documentOutline, parseDocument, transformUrls, type OutlineEntry, type ParsedDocument } from './markdown.js';

const assets = '_md-render';
/** Static rendering options. Mermaid can be disabled to exercise the offline fallback. */
export interface RenderOptions {
  theme?: string;
  mermaid?: boolean;
  /** Versioned session policy; bounds HTML requests and HTTP asset freshness. */
  navigation?: { version: 1; cachePages?: number; assetMaxAgeSeconds?: number };
}
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

async function themeAssets(directory: string, theme: string): Promise<string | undefined> {
  const builtIn = theme === 'default' || theme === 'symbiotic';
  const source = builtIn ? fileURLToPath(new URL(`../themes/${theme}.css`, import.meta.url)) : path.resolve(theme);
  const css = await readFile(source, 'utf8');
  await writeFile(path.join(directory, assets, 'theme.css'), css);
  // A theme's optional logo sits beside its CSS: example.css + example.logo.svg/png/webp.
  let logo: string | undefined;
  for (const extension of ['svg', 'png', 'webp']) {
    const name = source.replace(/\.css$/i, `.logo.${extension}`);
    try {
      const bytes = await readFile(name);
      if (logo) throw new Error(`Theme has more than one logo: ${source}`);
      await writeFile(path.join(directory, assets, `logo.${extension}`), bytes);
      logo = `logo.${extension}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return logo;
}

function page(corpus: Corpus, docs: Map<string, ParsedDocument>, file: string, body: string, logo: string | undefined, themeInit: string, cachePages: number): string {
  const doc = docs.get(file)!;
  const href = (target: string): string => escapeHtml(relativeUrl(file, target));
  // Compare titles in menu order, including section links and group headings.
  let previousTitle: string | undefined;
  const outlineHtml = (entries: OutlineEntry[], chapter: string): string => entries.length ? `<ol>${entries.map((entry) => {
    previousTitle = entry.title;
    return `<li><a href="${chapter === file ? '' : escapeHtml(relativeUrl(file, pagePath(chapter)))}#${encodeURIComponent(entry.id)}">${escapeHtml(entry.title)}</a>${outlineHtml(entry.children, chapter)}</li>`;
  }).join('')}</ol>` : '';
  let chapterId = 0;
  const chapters = (paths: string[], groupTitle?: string, referenced = false): string => paths.map((chapter, index) => {
    const target = relativeUrl(file, pagePath(chapter));
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
    return `<li><div class="chapter-row">${outline ? `<button class="chapter-toggle" type="button" aria-label="Toggle ${title}" aria-expanded="${current}" aria-controls="${id}"><span aria-hidden="true">›</span></button>` : ''}<a href="${escapeHtml(target)}"${current ? ' aria-current="page"' : ''}>${title}${referenced ? `<small class="reference-path">${escapeHtml(chapter)}</small>` : ''}</a></div>${outline ? `<div id="${id}"${current ? '' : ' hidden'}>${outline}</div>` : ''}</li>`;
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
  const index = corpus.files.findIndex((source) => source.path === file);
  const adjacent = (offset: number, label: string): string => {
    const source = index < 0 ? undefined : corpus.files[index + offset];
    return source ? `<a href="${href(pagePath(source.path))}"><small>${label}</small>${escapeHtml(docs.get(source.path)!.title)}</a>` : '<span></span>';
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'sha256-${createHash('sha256').update(themeInit).digest('base64')}'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="md-render-navigation" content="${escapeHtml(JSON.stringify({ version: 1, cachePages }))}">
<script>${themeInit}</script><title>${escapeHtml(doc.title)}</title><link rel="stylesheet" href="${href(`${assets}/base.css`)}"><link rel="stylesheet" href="${href(`${assets}/theme.css`)}"></head>
<body><a class="skip-link" href="#md-render-content">Skip to document</a>
<header class="menu-bar"><button id="menu-button" type="button" aria-expanded="true" aria-controls="document-menu">Menu</button><a class="site-title" href="${href(pagePath(corpus.files[0]!.path))}">${logo ? `<img src="${href(`${assets}/${logo}`)}" alt="Theme logo">` : ''}<span>Documentation</span></a></header>
<aside class="sidebar" id="document-menu" aria-label="Documentation menu"><button id="menu-close" type="button">Close menu</button><nav aria-label="Document map">${sidebar}</nav><div class="theme-switch" role="group" aria-label="Appearance">${[
  ['light', 'Light', '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path>'],
  ['system', 'System', '<rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path>'],
  ['dark', 'Dark', '<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"></path>'],
].map(([value, label, icon]) => `<button type="button" value="${value}" aria-label="${label}" title="${label}" aria-pressed="${value === 'system'}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></button>`).join('')}</div></aside>
<main id="md-render-content"><header class="page-meta"><span>${escapeHtml(file)}</span><span>${index < 0 ? 'Referenced file' : `${index + 1} / ${corpus.files.length}`}</span></header><article class="sd-doc">${body}</article><nav class="adjacent" aria-label="Reading order">${adjacent(-1, 'Previous')}${adjacent(1, 'Next')}</nav></main>
<script src="${href(`${assets}/navigation.js`)}" defer></script>
</body></html>`;
}

/** Renders every source before writing pages. Links resolve against the same parsed snapshot. */
export async function renderSite(input: string, output: string, options: RenderOptions = {}): Promise<RenderResult> {
  const navigation = options.navigation;
  const cachePages = navigation?.cachePages ?? 6;
  const assetMaxAgeSeconds = navigation?.assetMaxAgeSeconds ?? 3600;
  if (navigation && navigation.version !== 1 || !Number.isSafeInteger(cachePages) || cachePages < 1 ||
      !Number.isSafeInteger(assetMaxAgeSeconds) || assetMaxAgeSeconds < 0) {
    throw new Error('Invalid version-1 navigation configuration');
  }
  const corpus = await loadCorpus(input);
  const directory = path.resolve(output);
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length) throw new Error(`Output directory must be empty: ${directory}`);
  await mkdir(path.join(directory, assets));
  await cp(fileURLToPath(new URL('../themes/base.css', import.meta.url)), path.join(directory, assets, 'base.css'));
  await cp(fileURLToPath(new URL('../themes/navigation.js', import.meta.url)), path.join(directory, assets, 'navigation.js'));
  const logo = await themeAssets(directory, options.theme ?? 'default');
  const themeInit = await readFile(fileURLToPath(new URL('../themes/theme-init.js', import.meta.url)), 'utf8');
  const docs = new Map(corpus.files.map((file) => [file.path, parseDocument(file.markdown, 'Untitled chapter')]));
  // Only initial documents discover references. Parse all direct targets before URL validation.
  for (const { path: file } of corpus.files) {
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
      try { bytes = await readSource(corpus.root, target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Markdown link is outside rendered corpus: ${file} -> ${target}`, { cause: error });
        throw error;
      }
      docs.set(target, parseDocument(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'Untitled chapter'));
    }
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
  for (const [file, doc] of docs) {
    for (const entry of corpus.map.filter((entry) => entry.path === file && entry.anchor)) {
      if (!doc.anchors.has(entry.anchor!)) throw new Error(`Missing manifest anchor: ${file}#${entry.anchor}`);
    }
    transformUrls(doc, (url, image) => {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) {
        if (image && !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(url)) throw new Error(`Remote or unsupported image in ${file}: ${url}`);
        if (!image && !/^(?:https?:|mailto:|tel:|\/\/)/i.test(url)) throw new Error(`Unsupported link in ${file}: ${url}`);
        return { url };
      }
      const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url)!;
      const pathname = decodeURIComponent(match[1]!);
      const query = match[2] ?? '';
      const fragment = match[3] ?? '';
      const target = pathname ? path.posix.normalize(pathname.startsWith('/') ? pathname.slice(1) : path.posix.join(path.posix.dirname(file), pathname)) : file;
      const absolute = path.resolve(corpus.root, target);
      const outside = path.relative(corpus.root, absolute).startsWith(`..${path.sep}`) || path.relative(corpus.root, absolute) === '..';
      if (target === 'index.html' || [...docs.keys()].some((source) => pagePath(source) === target)) {
        throw new Error(`Attachment collides with rendered page: ${target}`);
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
    const bytes = await readSource(corpus.root, file);
    const target = within(directory, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  const bodies = await Promise.all([...docs.values()].map(documentHtml));
  const diagrams = await renderDiagrams(bodies, options.mermaid !== false);
  const mermaid = diagrams.available;
  const pages: string[] = [];
  for (const [index, file] of [...docs.keys()].entries()) {
    if (file.startsWith(`${assets}/`)) throw new Error(`Input uses reserved directory: ${file}`);
    const target = within(directory, pagePath(file));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, page(corpus, docs, file, diagrams.pages[index]!, logo, themeInit, cachePages));
    pages.push(pagePath(file));
  }
  if (!pages.includes('index.html')) {
    const first = escapeHtml(urlPath(pages[0]!));
    await writeFile(path.join(directory, 'index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${first}"><title>Documentation</title><a href="${first}">Open documentation</a>`);
  }
  return { directory, pages, links, mermaid, warnings };
}

import { createRequire } from 'node:module';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCorpus, readSource, within, type Corpus } from './corpus.js';
import { documentHtml, documentOutline, parseDocument, transformUrls, type OutlineEntry, type ParsedDocument } from './markdown.js';

const assets = '_md-render';
/** Static rendering options. Mermaid can be disabled to exercise the offline fallback. */
export interface RenderOptions { theme?: string; mermaid?: boolean }
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

async function mermaidAsset(directory: string, enabled: boolean): Promise<boolean> {
  if (!enabled) return false;
  const require = createRequire(import.meta.url);
  let packageFile: string;
  try { packageFile = require.resolve('mermaid/package.json'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') return false;
    throw error;
  }
  const pkg = JSON.parse(await readFile(packageFile, 'utf8')) as { version: string };
  if (pkg.version !== '12.2.0') throw new Error(`Expected offline Mermaid 12.2.0, found ${pkg.version}`);
  await cp(path.join(path.dirname(packageFile), 'dist', 'mermaid.min.js'), path.join(directory, assets, 'mermaid.min.js'));
  await cp(path.join(path.dirname(packageFile), 'LICENSE'), path.join(directory, assets, 'MERMAID-LICENSE'));
  await writeFile(path.join(directory, assets, 'diagrams.js'), `
const figures = document.querySelectorAll('.mermaid-diagram');
try {
  if (!globalThis.mermaid) throw new Error('Offline Mermaid failed to load');
  globalThis.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true });
  let index = 0;
  for (const figure of figures) {
    const source = figure.querySelector('code').textContent;
    const caption = figure.querySelector('figcaption');
    try {
      const { svg } = await globalThis.mermaid.render('md-render-diagram-' + index++, source);
      const drawing = document.createElement('div');
      drawing.innerHTML = svg;
      figure.insertBefore(drawing, caption);
      caption.textContent = 'Diagram source';
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'View Mermaid source';
      details.append(summary, figure.querySelector('pre'));
      figure.append(details);
    } catch (error) { caption.textContent = 'Mermaid rendering failed — source retained: ' + error.message; }
  }
} catch (error) {
  for (const figure of figures) figure.querySelector('figcaption').textContent = 'Mermaid unavailable — source retained: ' + error.message;
}
`);
  return true;
}

function page(corpus: Corpus, docs: Map<string, ParsedDocument>, file: string, body: string, logo: string | undefined, mermaid: boolean): string {
  const doc = docs.get(file)!;
  const href = (target: string): string => escapeHtml(relativeUrl(file, target));
  const outlineHtml = (entries: OutlineEntry[]): string => entries.length ? `<ol>${entries.map((entry) =>
    `<li><a href="#${encodeURIComponent(entry.id)}">${escapeHtml(entry.title)}</a>${outlineHtml(entry.children)}</li>`).join('')}</ol>` : '';
  const contents = outlineHtml(documentOutline(doc));
  const sidebar = corpus.files.map((source) => {
    const entry = corpus.map.find((entry) => entry.path === source.path)!;
    const target = relativeUrl(file, pagePath(entry.path)) + (entry.anchor ? `#${encodeURIComponent(entry.anchor)}` : '');
    const label = entry.anchor ? entry.label : docs.get(entry.path)!.title;
    return `<li><a href="${escapeHtml(target)}"${entry.path === file ? ' aria-current="page"' : ''}${entry.summary ? ` title="${escapeHtml(entry.summary)}"` : ''}>${escapeHtml(label)}</a>${entry.path === file ? contents : ''}</li>`;
  }).join('');
  const index = corpus.files.findIndex((source) => source.path === file);
  const adjacent = (offset: number, label: string): string => {
    const source = corpus.files[index + offset];
    return source ? `<a href="${href(pagePath(source.path))}"><small>${label}</small>${escapeHtml(docs.get(source.path)!.title)}</a>` : '<span></span>';
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(doc.title)}</title><link rel="stylesheet" href="${href(`${assets}/base.css`)}"><link rel="stylesheet" href="${href(`${assets}/theme.css`)}"></head>
<body${contents ? ' class="has-contents"' : ''}><a class="skip-link" href="#md-render-content">Skip to document</a>
<aside class="sidebar"><a class="site-title" href="${href(pagePath(corpus.files[0]!.path))}">${logo ? `<img src="${href(`${assets}/${logo}`)}" alt="Theme logo">` : ''}<span>Documentation</span></a><nav aria-label="Document map"><p class="eyebrow">Document map · ${corpus.files.length} files</p><ol>${sidebar}</ol></nav></aside>
${contents ? `<aside class="contents"><nav aria-label="On this page"><p class="eyebrow">On this page</p>${contents}</nav></aside>` : ''}
<main id="md-render-content"><header class="page-meta"><span>${escapeHtml(file)}</span><span>${index + 1} / ${corpus.files.length}</span></header><article class="sd-doc">${body}</article><nav class="adjacent" aria-label="Reading order">${adjacent(-1, 'Previous')}${adjacent(1, 'Next')}</nav></main>
${mermaid ? `<script src="${href(`${assets}/mermaid.min.js`)}"></script><script type="module" src="${href(`${assets}/diagrams.js`)}"></script>` : ''}</body></html>`;
}

/** Renders every source before writing pages. Links resolve against the same parsed snapshot. */
export async function renderSite(input: string, output: string, options: RenderOptions = {}): Promise<RenderResult> {
  const corpus = await loadCorpus(input);
  const directory = path.resolve(output);
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length) throw new Error(`Output directory must be empty: ${directory}`);
  await mkdir(path.join(directory, assets));
  await cp(fileURLToPath(new URL('../themes/base.css', import.meta.url)), path.join(directory, assets, 'base.css'));
  const logo = await themeAssets(directory, options.theme ?? 'default');
  const mermaid = await mermaidAsset(directory, options.mermaid !== false);
  const docs = new Map(corpus.files.map((file) => [file.path, parseDocument(file.markdown, path.basename(file.path, '.md'))]));
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
      const unrendered = !docs.has(target) && (corpus.inventory.has(target) ||
        [...corpus.inventory.keys()].some((entry) => entry.endsWith('/') &&
          (target === entry.slice(0, -1) || target.startsWith(entry))));
      if ((outside || unrendered) && !image) {
        const message = `${file}: external local reference ${url}; ${outside ? 'outside selected input' : 'not a rendered document'}, open the original file`;
        warnings.push(message);
        return { url: pathToFileURL(absolute).href + query + fragment, title: message };
      }
      within(corpus.root, target);
      if (!image && (docs.has(target) || /\.md$/i.test(target) || !pathname)) {
        const destination = docs.get(target);
        if (!destination) throw new Error(`Markdown link is outside rendered corpus: ${file} -> ${url}`);
        const id = decodeURIComponent(fragment.slice(1));
        if (id && !destination.anchors.has(id)) throw new Error(`Missing anchor: ${file} -> ${url}`);
        links++;
        return { url: (pathname ? relativeUrl(file, pagePath(target)) : '') + query + fragment,
          title: meanings.get(`${target}#${id}`) };
      }
      if (target === assets || target.startsWith(`${assets}/`)) throw new Error(`Input asset uses reserved directory: ${target}`);
      if (target === 'index.html' || corpus.files.some((source) => pagePath(source.path) === target)) {
        throw new Error(`Attachment collides with rendered page: ${target}`);
      }
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
  const pages: string[] = [];
  for (const [file, doc] of docs) {
    if (file.startsWith(`${assets}/`)) throw new Error(`Input uses reserved directory: ${file}`);
    const target = within(directory, pagePath(file));
    await mkdir(path.dirname(target), { recursive: true });
    let body = await documentHtml(doc);
    if (mermaid) body = body.replaceAll('Mermaid diagram — source (offline renderer unavailable)', 'Mermaid diagram — source (loading offline renderer)');
    await writeFile(target, page(corpus, docs, file, body, logo, mermaid));
    pages.push(pagePath(file));
  }
  if (!pages.includes('index.html')) {
    const first = escapeHtml(urlPath(pages[0]!));
    await writeFile(path.join(directory, 'index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${first}"><title>Documentation</title><a href="${first}">Open documentation</a>`);
  }
  return { directory, pages, links, mermaid, warnings };
}

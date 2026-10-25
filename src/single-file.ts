import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { escapeHtml, page, pageContent, prepareSite, writeSite, type PreparedSite, type RenderExtension, type RenderOptions, type SiteView } from './site.js';

const mimeTypes: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' };
function dataUri(file: string, bytes: Buffer): string {
  const mime = mimeTypes[path.extname(file).toLowerCase()];
  return `data:${mime ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`;
}

interface CssResource { start: number; end: number; value: string; condition?: string }

function cssResources(css: string): CssResource[] {
  // CSS Syntax Level 3 §4.3: consume whole tokens before recognizing resources.
  // Offsets stay in the authored text; code points are preprocessed as in §3.3.
  let i = 0;
  const point = (at = i): string => {
    const value = css.codePointAt(at);
    if (value === undefined) return '';
    if (value === 13 || value === 12) return '\n';
    return value === 0 || value >= 0xd800 && value <= 0xdfff ? '\ufffd' : String.fromCodePoint(value);
  };
  const consume = (): string => {
    const value = point();
    if (css[i] === '\r' && css[i + 1] === '\n') i += 2;
    else i += value.length || 1;
    return value;
  };
  const whitespace = (value: string): boolean => value === ' ' || value === '\n' || value === '\t';
  const identStart = (value: string): boolean => /[a-zA-Z_]/.test(value) || (value.codePointAt(0) ?? 0) >= 0x80;
  const identPoint = (value: string): boolean => identStart(value) || /[0-9-]/.test(value);
  const validEscape = (at = i): boolean => point(at) === '\\' && point(at + 1) !== '\n';
  const startsIdent = (): boolean => identStart(point()) || validEscape() ||
    point() === '-' && (identStart(point(i + 1)) || point(i + 1) === '-' || validEscape(i + 1));
  const spaces = (): void => { while (whitespace(point())) consume(); };
  const escaped = (): string => {
    consume(); // Backslash.
    const start = i;
    while (i - start < 6 && /[0-9a-fA-F]/.test(point()) && point()) consume();
    if (i === start) return i < css.length ? consume() : '\ufffd';
    const value = parseInt(css.slice(start, i), 16);
    if (whitespace(point())) consume();
    return value === 0 || value >= 0xd800 && value <= 0xdfff || value > 0x10ffff ? '\ufffd' : String.fromCodePoint(value);
  };
  const ident = (): string => {
    let value = '';
    while (i < css.length) {
      if (identPoint(point())) value += consume();
      else if (validEscape()) value += escaped();
      else break;
    }
    return value;
  };
  type Token = { kind: string; value: string; start: number; end: number };
  const token = (): Token => {
    while (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
    }
    const start = i;
    const result = (kind: string, value = ''): Token => ({ kind, value, start, end: i });
    if (i >= css.length) return result('eof');
    if (whitespace(point())) { spaces(); return result('space'); }
    if (point() === '"' || point() === "'") {
      const quote = consume();
      let value = '';
      while (i < css.length) {
        if (point() === quote) { consume(); break; }
        if (point() === '\n') return result('bad-string');
        if (point() !== '\\') value += consume();
        else if (point(i + 1) === '\n') { consume(); consume(); }
        else if (i + 1 === css.length) consume();
        else value += escaped();
      }
      return result('string', value);
    }
    if (point() === '#') {
      consume();
      return identPoint(point()) || validEscape() ? result('hash', ident()) : result('delim', '#');
    }
    if (point() === '@') {
      consume();
      return startsIdent() ? result('at-keyword', ident()) : result('delim', '@');
    }
    // Numeric tokens consume their dimension's ident sequence, never a URL function.
    const number = /^[+-]?(?:[0-9]*\.[0-9]+|[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(css.slice(i));
    if (number) {
      i += number[0].length;
      if (startsIdent()) ident();
      else if (point() === '%') consume();
      return result('numeric');
    }
    if (startsIdent()) {
      const name = ident();
      if (point() !== '(') return result('ident', name);
      consume();
      if (name.toLowerCase() !== 'url') return result('function', name);
      spaces();
      if (point() === '"' || point() === "'") return result('function', name);
      let value = '';
      while (i < css.length) {
        if (point() === ')') { consume(); return result('url', value); }
        if (whitespace(point())) {
          spaces();
          if (point() === ')' || i >= css.length) {
            if (point() === ')') consume();
            return result('url', value);
          }
          break;
        }
        if (point() === '"' || point() === "'" || point() === '(' || /[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(point())) break;
        if (point() === '\\') {
          if (!validEscape()) break;
          value += escaped();
        } else value += consume(); // Comment-shaped text is literal inside a url-token.
      }
      if (i >= css.length) return result('url', value);
      // §4.3.15: consume a bad URL through its first unescaped closing parenthesis.
      while (i < css.length) {
        if (point() === ')') { consume(); break; }
        if (validEscape()) escaped();
        else consume();
      }
      return result('bad-url');
    }
    return result('delim', consume());
  };
  const next = (): Token => {
    let value = token();
    while (value.kind === 'space') value = token();
    return value;
  };
  const resourceValue = (first: Token): string | undefined => {
    if (first.kind === 'url') return first.value;
    if (first.kind !== 'function' || first.value.toLowerCase() !== 'url') return undefined;
    const value = next();
    const closing = next();
    if (value.kind !== 'string' || closing.kind !== 'delim' || closing.value !== ')') throw new Error('Unsupported stylesheet url()');
    return value.value;
  };
  const resources: CssResource[] = [];
  for (let current = next(); current.kind !== 'eof'; current = next()) {
    if (current.kind === 'at-keyword' && current.value.toLowerCase() === 'import') {
      const first = next();
      const value = first.kind === 'string' ? first.value : resourceValue(first);
      if (value === undefined) throw new Error('Unsupported stylesheet import');
      const conditionStart = i;
      let depth = 0;
      let end = next();
      while (end.kind !== 'eof' && !(end.kind === 'delim' && end.value === ';' && depth === 0)) {
        if (end.kind === 'function' || end.kind === 'delim' && ['(', '[', '{'].includes(end.value)) depth++;
        if (end.kind === 'delim' && [')', ']', '}'].includes(end.value)) depth--;
        end = next();
      }
      if (end.kind === 'eof') throw new Error('Unsupported stylesheet import');
      resources.push({ start: current.start, end: end.end, value, condition: css.slice(conditionStart, end.start).trim() });
    } else {
      const value = resourceValue(current);
      if (value !== undefined) resources.push({ start: current.start, end: i, value });
    }
  }
  return resources;
}

async function inlineCss(source: string, active = new Set<string>()): Promise<string> {
  if (active.has(source)) throw new Error(`Cyclic stylesheet import: ${source}`);
  active.add(source);
  let css = await readFile(source, 'utf8');
  const local = (value: string): string => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) throw new Error(`Cannot embed remote stylesheet resource: ${value}`);
    // Decide on the parsed URL that becomes the path: parsing drops characters the text check sees.
    const url = new URL(value, pathToFileURL(source));
    if (url.protocol !== 'file:' || url.host !== '') throw new Error(`Cannot embed remote stylesheet resource: ${value}`);
    return fileURLToPath(url);
  };
  // Replace from right to left so scanner offsets still refer to the original text.
  // Each imported stylesheet resolves its own resources before insertion.
  for (const resource of cssResources(css).reverse()) {
    const url = resource.value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
    let replacement: string;
    if (resource.condition !== undefined) {
      const imported = await inlineCss(local(url), new Set(active));
      const condition = resource.condition;
      if (/\b(?:layer|supports)\b/i.test(condition)) throw new Error(`Unsupported stylesheet import condition: ${condition}`);
      replacement = condition ? `@media ${condition}{${imported}}` : imported;
    } else {
      if (url.startsWith('#') || url.startsWith('data:')) continue;
      const file = local(url);
      const fragment = url.includes('#') ? url.slice(url.indexOf('#')) : '';
      const embedded = (dataUri(file, await readFile(file)) + fragment).replace(/["\\\x00-\x1f\x7f]/g, character =>
        character === '"' || character === '\\' ? '\\' + character : '\\' + character.charCodeAt(0).toString(16) + ' ');
      replacement = `url("${embedded}")`;
    }
    css = css.slice(0, resource.start) + css.slice(resource.start).replace(css.slice(resource.start, resource.end), () => replacement);
  }
  return css.replace(/<\/style/gi, '\\3c /style');
}

function automaticName(title: string): string {
  let name = title.normalize('NFC').replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'documentation';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `documentation-${name}`;
  return name + '.html';
}

async function standalone(site: PreparedSite, options: RenderOptions): Promise<string> {
  const paths = [...site.docs.keys()];
  const pageIds = new Map(paths.map((file, i) => [file.replace(/\.md$/i, '.html'), `page-${i}`]));
  const url = (target: string, fragment?: string): string => {
    const id = pageIds.get(target);
    if (!id) {
      const bytes = site.files.get(target);
      if (!bytes) throw new Error(`Missing embedded resource: ${target}`);
      return dataUri(target, bytes) + (fragment ? '#' + encodeURIComponent(fragment) : '');
    }
    return '#' + encodeURIComponent(id + (fragment ? '--' + fragment : ''));
  };
  const bodies = site.bodies.map((body, index) => {
    const file = paths[index]!;
    const prefix = `page-${index}--`;
    // Bodies are already sanitized and rendered. Rewrite only HTML attributes;
    // SVG owns its document-wide IDs and all of their references, including CSS.
    let svgDepth = 0;
    return body.replace(/<(\/?)([a-z][\w:-]*)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi, (tag, closing: string, name: string) => {
      if (name.toLowerCase() === 'svg') svgDepth += closing ? -1 : 1;
      if (svgDepth || name.toLowerCase() === 'svg') return tag;
      return tag.replace(/\s(id|aria-describedby|aria-labelledby|href|src)="([^"]*)"/gi, (_attribute: string, key: string, encoded: string) => {
        const value = encoded.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_entity: string, code: string) => {
          if (code[0] === '#') return String.fromCodePoint(parseInt(code.slice(code[1]?.toLowerCase() === 'x' ? 2 : 1), code[1]?.toLowerCase() === 'x' ? 16 : 10));
          return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[code.toLowerCase()]!;
        });
        let rewritten: string;
        if (key === 'id') rewritten = prefix + value;
        else if (key.startsWith('aria-')) rewritten = value.split(/\s+/).map(id => prefix + id).join(' ');
        else {
          if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return _attribute;
          const match = /^([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/.exec(value)!;
          const target = match[1] ? path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(match[1]))) : file.replace(/\.md$/i, '.html');
          rewritten = url(target, match[2] ? decodeURIComponent(match[2]) : undefined);
        }
        return ` ${key}="${escapeHtml(rewritten)}"`;
      });
    });
  });
  const content = paths.map((file, index) => `<section class="single-page" id="page-${index}" data-title="${escapeHtml(site.docs.get(file)!.title)}"${site.extensions.length ? ` data-source-path="${escapeHtml(file)}"` : ''}>${pageContent(site.corpus, site.docs, file, bodies[index]!, target => escapeHtml(url(target)))}</section>`).join('\n');
  const theme = options.theme ?? 'default';
  const themePath = theme === 'default' || theme === 'symbiotic' ? fileURLToPath(new URL(`../themes/${theme}.css`, import.meta.url)) : path.resolve(theme);
  const styles = await inlineCss(fileURLToPath(new URL('../themes/base.css', import.meta.url))) + '\n' + await inlineCss(themePath) + '\n.single-page[hidden="until-found"]{display:block!important;content-visibility:hidden}@media print{.single-page[hidden="until-found"]{content-visibility:visible}}';
  // Pages with extensions also get the browser interface, which needs the single page's routing.
  const script = site.files.get('_md-render/navigation.js')!.toString('utf8') +
    (site.extensions.length ? '\n' + await readFile(fileURLToPath(new URL('../themes/extension-api.js', import.meta.url)), 'utf8') : '');
  const hash = (value: string) => `'sha256-${createHash('sha256').update(value).digest('base64')}'`;
  const extensionHashes = site.extensions.filter(extension => extension.script).map(extension => ' ' + hash(extension.script!)).join('');
  const connect = site.extensions.some(extension => extension.connect) ? "'self'" : "'none'";
  const policy = `default-src 'none'; style-src 'unsafe-inline' data:; script-src ${hash(site.themeInit)} ${hash(script)}${extensionHashes}; img-src data:; font-src data:; connect-src ${connect}; base-uri 'none'; form-action 'none'`;
  return page(site.corpus, site.docs, paths[0]!, '', site.logo, site.themeInit, site.cachePages, { url, content, styles, script, policy }, site.extensions);
}

/** The single-file page, the corpus view and the corpus root, kept in memory, for servers that render on demand. */
export async function renderSinglePage(input: string, options: RenderOptions = {}, extensions: RenderExtension[] = []): Promise<{ html: string; view: SiteView; root: string; warnings: string[] }> {
  const site = await prepareSite(input, options, true, extensions, true);
  return { html: await standalone(site, options), view: site.view!, root: site.corpus.root, warnings: site.warnings };
}

/** The corpus view and root without building a page, for tools that only need to find blocks. */
export async function renderView(input: string, options: RenderOptions = {}): Promise<{ view: SiteView; root: string; warnings: string[] }> {
  const site = await prepareSite(input, options, true, [], true);
  return { view: site.view!, root: site.corpus.root, warnings: site.warnings };
}

/** Retained export destinations. At least one destination must be provided. */
export interface ExportTargets { out?: string; singleFile?: string }
/** Exports folder output when requested and exactly one self-contained HTML file. */
export async function exportSite(input: string, targets: ExportTargets, options: RenderOptions = {}) {
  if (!targets.out && !targets.singleFile) throw new Error('An export destination is required');
  if (targets.singleFile && !/\.html$/i.test(targets.singleFile)) throw new Error('Single-file destination must end in .html');
  const site = await prepareSite(input, options, true);
  const singleFile = path.resolve(targets.singleFile ?? path.join(targets.out!, automaticName(site.docs.values().next().value!.title)));
  try {
    await lstat(singleFile);
    throw new Error(`Single-file target already exists: ${singleFile}`);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (targets.out) {
    const relative = path.relative(path.resolve(targets.out), singleFile).split(path.sep).join('/');
    if (site.files.has(relative) || relative === 'index.html' || [...site.docs.keys()].some(file => file.replace(/\.md$/i, '.html') === relative) || [...site.files.keys(), ...site.docs.keys()].some(file => file.startsWith(relative + '/') || relative.startsWith(file.replace(/\.md$/i, '.html') + '/'))) {
      throw new Error(`Single-file target collides with folder output: ${singleFile}`);
    }
  }
  const html = await standalone(site, options);
  const folder = targets.out ? await writeSite(site, targets.out) : undefined;
  await mkdir(path.dirname(singleFile), { recursive: true });
  await writeFile(singleFile, html, { flag: 'wx' });
  return { directory: folder?.directory, pages: [...site.docs.keys()].map(file => file.replace(/\.md$/i, '.html')), links: site.links, mermaid: site.mermaid, warnings: site.warnings, singleFile, bytes: Buffer.byteLength(html) };
}

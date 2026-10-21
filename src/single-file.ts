import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, page, pageContent, prepareSite, writeSite, type PreparedSite, type RenderOptions } from './site.js';

const mimeTypes: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' };
function dataUri(file: string, bytes: Buffer): string {
  const mime = mimeTypes[path.extname(file).toLowerCase()];
  return `data:${mime ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`;
}

async function inlineCss(source: string, active = new Set<string>()): Promise<string> {
  if (active.has(source)) throw new Error(`Cyclic stylesheet import: ${source}`);
  active.add(source);
  let css = await readFile(source, 'utf8');
  const local = (value: string): string => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) throw new Error(`Cannot embed remote stylesheet resource: ${value}`);
    if (value.includes('\\')) throw new Error(`Cannot embed escaped stylesheet resource: ${value}`);
    return path.resolve(path.dirname(source), decodeURIComponent(value.split(/[?#]/)[0]!));
  };
  // Expand local imports before URLs so each stylesheet keeps its own resource base.
  for (const match of [...css.matchAll(/@import\s+(?:url\(\s*(['"]?)(.*?)\1\s*\)|(['"])(.*?)\3)\s*([^;]*);/gi)]) {
    const imported = await inlineCss(local((match[2] ?? match[4])!), new Set(active));
    const condition = match[5]!.trim();
    if (/\b(?:layer|supports)\b/i.test(condition)) throw new Error(`Unsupported stylesheet import condition: ${condition}`);
    css = css.replace(match[0], condition ? `@media ${condition}{${imported}}` : imported);
  }
  if (/@import\b/i.test(css)) throw new Error(`Unsupported stylesheet import: ${source}`);
  for (const match of [...css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)]) {
    const url = match[2]!.trim();
    if (url.startsWith('#') || url.startsWith('data:')) continue;
    const file = local(url);
    const fragment = url.includes('#') ? url.slice(url.indexOf('#')) : '';
    css = css.replace(match[0], `url("${dataUri(file, await readFile(file))}${fragment}")`);
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
  const content = paths.map((file, index) => `<section class="single-page" id="page-${index}" data-title="${escapeHtml(site.docs.get(file)!.title)}">${pageContent(site.corpus, site.docs, file, bodies[index]!, target => escapeHtml(url(target)))}</section>`).join('\n');
  const theme = options.theme ?? 'default';
  const themePath = theme === 'default' || theme === 'symbiotic' ? fileURLToPath(new URL(`../themes/${theme}.css`, import.meta.url)) : path.resolve(theme);
  const styles = await inlineCss(fileURLToPath(new URL('../themes/base.css', import.meta.url))) + '\n' + await inlineCss(themePath) + '\n.single-page[hidden="until-found"]{display:block!important;content-visibility:hidden}@media print{.single-page[hidden="until-found"]{content-visibility:visible}}';
  const script = site.files.get('_md-render/navigation.js')!.toString('utf8');
  const hash = (value: string) => `'sha256-${createHash('sha256').update(value).digest('base64')}'`;
  const policy = `default-src 'none'; style-src 'unsafe-inline' data:; script-src ${hash(site.themeInit)} ${hash(script)}; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
  return page(site.corpus, site.docs, paths[0]!, '', site.logo, site.themeInit, site.cachePages, { url, content, styles, script, policy });
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

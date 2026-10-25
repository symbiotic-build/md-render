// unified/remark -> explicit AST transforms -> sanitized HTML.
import { createHash } from 'node:crypto';
import type { Definition, Nodes, Root, RootContent } from 'mdast';
import type { Root as HtmlRoot, Element } from 'hast';
import { toString } from 'mdast-util-to-string';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit, SKIP } from 'unist-util-visit';
import { parse as parseYaml } from 'yaml';

const parser = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm);
const writer = unified().use(remarkRehype).use(rehypeSanitize, {
  ...defaultSchema,
  // Exact source IDs are the public link contract. Browser code uses module-local bindings,
  // never named properties on window/document. Raw HTML remains outside the allow-list below.
  clobberPrefix: '',
  protocols: { ...defaultSchema.protocols, href: ['http', 'https', 'mailto', 'tel', 'file'] },
  attributes: { ...defaultSchema.attributes, figure: ['className'], figcaption: [],
    a: ['download', ...(defaultSchema.attributes?.a ?? []).filter((attribute) => !Array.isArray(attribute) || attribute[0] !== 'className'), ['className', 'local-file']],
    code: [['className', /^language-./]], div: ['className', 'role', 'ariaLabel', 'tabIndex'] },
  tagNames: [...(defaultSchema.tagNames ?? []), 'figure', 'figcaption'],
}).use(rehypeStringify);

/** Parsed document, reused for links, entity meanings and HTML generation. */
export interface ParsedDocument {
  title: string;
  /** Portable source label used by retained exports. */
  displayPath?: string;
  /** Number of source lines when this is a read-only text page. */
  sourceLines?: number;
  tree: Root;
  anchors: Set<string>;
  headings: { id: string; title: string; depth: number }[];
  meanings: Map<string, string>;
}

function anchorIds(value: string): string[] {
  const ids: string[] = [];
  let end = 0;
  for (const match of value.matchAll(/<a\s+id\s*=\s*(?:"([^"<>]+)"|'([^'<>]+)')\s*>\s*(?:<\/a>)?/gi)) {
    if (value.slice(end, match.index).trim()) return [];
    ids.push((match[1] ?? match[2])!);
    end = match.index + match[0].length;
  }
  return value.slice(end).trim() ? [] : ids;
}
function blockAnchors(node: Nodes | undefined): string[] {
  if (node?.type === 'html') return anchorIds(node.value);
  if (node?.type === 'paragraph') {
    if (node.children.every((child) => child.type === 'html' || (child.type === 'text' && !child.value.trim()))) {
      const ids = anchorIds(node.children.map((child) => 'value' in child ? child.value : '').join(''));
      if (ids.length) return ids;
    }
    // Mixed all-HTML paragraphs retain their existing first-anchor behaviour.
    if (node.children.every((child) => child.type === 'html')) {
      return node.children.flatMap((child) => child.type === 'html' ? anchorIds(child.value) : []).slice(0, 1);
    }
  }
  return [];
}
function slug(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
}
function element(tag: string, properties: Element['properties'], children: Element['children']): RootContent {
  return { type: 'paragraph', children: [], data: { hName: tag, hProperties: properties, hChildren: children } };
}

function navigationMapNodes(tree: Root): Set<Nodes> {
  const omitted = new Set<Nodes>();
  let start: number | undefined;
  for (const [index, node] of tree.children.entries()) {
    if (node.type !== 'html') continue;
    if (/^<!-- spec-docs:navigation document="[^"<>]+" -->$/.test(node.value)) {
      start = index + 1;
    } else if (node.value === '<!-- /spec-docs:navigation -->' && start !== undefined) {
      let hiding = false;
      for (let i = start; i < index; i++) {
        const child = tree.children[i]!;
        if (child.type === 'heading' && child.depth <= 2) {
          hiding = child.depth === 2 && toString(child) === 'Document map';
        }
        // An explicit anchor before the next section belongs to that section.
        const next = tree.children[i + 1];
        if (blockAnchors(child).length && next?.type === 'heading' && next.depth <= 2) continue;
        if (hiding) visit(child, (descendant) => { omitted.add(descendant); });
      }
      start = undefined;
    }
  }
  return omitted;
}

/** Parses ordinary Markdown, preserving only explicit empty HTML anchors as markup. */
export function parseDocument(markdown: string, fallbackTitle: string): ParsedDocument {
  const tree = parser.parse(markdown.replace(/\r\n?/g, '\n')) as Root;
  const omitted = navigationMapNodes(tree);
  const anchors = new Set<string>();
  const headings: ParsedDocument['headings'] = [];
  const meanings = new Map<string, string>();
  let title = '';
  function addAnchor(id: string): void {
    if (anchors.has(id)) throw new Error(`Duplicate anchor: ${id}`);
    anchors.add(id);
  }
  // Reserve explicit anchors before generating heading IDs, including anchors in table cells.
  visit(tree, 'html', (node) => { for (const id of anchorIds(node.value)) addAnchor(id); });
  visit(tree, 'heading', (node, index, parent) => {
    const text = toString(node);
    if (!title) title = toString(node, { includeHtml: false });
    const base = slug(text);
    let id = base;
    let n = 0;
    while (anchors.has(id)) id = `${base}-${++n}`;
    addAnchor(id);
    node.data = { ...node.data, hProperties: { id } };
    // Read authored anchors before the HTML transform; keep generated IDs as valid targets too.
    const explicit = index !== undefined && parent ? blockAnchors(parent.children[index - 1]).at(-1) : undefined;
    if (!omitted.has(node)) headings.push({ id: explicit ?? id, title: toString(node, { includeHtml: false }), depth: node.depth });
  });
  // Home anchor, heading, first paragraph: the format's canonical one-line meaning.
  for (let i = 0; i < tree.children.length; i++) {
    const node = tree.children[i]!;
    const ids = blockAnchors(node);
    if (!ids.length) continue;
    const heading = tree.children[i + 1];
    const paragraph = tree.children[i + 2];
    if (heading?.type === 'heading' && paragraph?.type === 'paragraph') {
      const meaning = toString(paragraph).replace(/\s+/g, ' ').trim();
      for (const id of ids) meanings.set(id, meaning);
    }
  }
  // Assign all source IDs first so omission cannot change later slugs or break inbound links.
  // Keep definitions too: retained sections can reference definitions inside the omitted map.
  tree.children = tree.children.flatMap((node) => {
    if (!omitted.has(node)) return [node];
    const retained: RootContent[] = [];
    visit(node, (child) => {
      if (child.type === 'html') {
        for (const id of anchorIds(child.value)) retained.push(element('a', { id }, []));
      } else {
        const id = child.data?.hProperties?.id;
        if (typeof id === 'string') retained.push(element('a', { id }, []));
      }
      if (child.type === 'definition') retained.push(child);
    });
    return retained;
  });
  visit(tree, (node, index, parent) => {
    if (index === undefined || !parent) return;
    if (node.type === 'yaml') {
      const meta: unknown = parseYaml(node.value);
      if (meta !== null && (typeof meta !== 'object' || Array.isArray(meta))) throw new Error('Frontmatter must be an object');
      const value = (meta as Record<string, unknown> | null)?.title;
      if (value !== undefined && typeof value !== 'string') throw new Error('Frontmatter title must be text');
      if (!title && typeof value === 'string' && value.trim()) title = value;
      parent.children.splice(index, 1);
      return index;
    }
    if (node.type === 'html') {
      const ids = anchorIds(node.value);
      const replacements = ids.length ? ids.map(id => element('a', { id }, [])) : [
        /^\s*(?:<\/a>|<!--[\s\S]*-->)\s*$/i.test(node.value) ? { type: 'text' as const, value: '' } :
        { type: 'text' as const, value: node.value }];
      parent.children.splice(index, 1, ...replacements as never[]);
      return index + replacements.length;
    }
    if (node.type === 'code' && node.lang === 'mermaid') {
      // The figure and its source keep the fence's position, so both are blocks with source lines.
      parent.children[index] = { ...element('figure', { className: ['mermaid-diagram'] }, [
        { type: 'element', tagName: 'figcaption', properties: {}, children: [
          { type: 'text', value: 'Mermaid diagram — source (offline renderer unavailable)' },
        ] },
        { type: 'element', tagName: 'pre', properties: {}, children: [
          { type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: node.value }] },
        ] },
      ]) as never;
    }
    if (node.type === 'table') {
      // Preserve native GFM handling; wrap the resulting table in the HTML stage below.
      node.data = { ...node.data };
    }
  });
  return { title: title || fallbackTitle, tree, anchors, headings, meanings };
}

/** A plain-text heading link with its nested subsection links. */
export interface OutlineEntry { id: string; title: string; children: OutlineEntry[] }

/** Derives contents in source order; level-three headings nest under the preceding level two. */
export function documentOutline(doc: ParsedDocument): OutlineEntry[] {
  const outline: OutlineEntry[] = [];
  let section: OutlineEntry | undefined;
  for (const heading of doc.headings) {
    if (heading.depth !== 2 && heading.depth !== 3) continue;
    const entry: OutlineEntry = { id: heading.id, title: heading.title, children: [] };
    if (heading.depth === 2) {
      outline.push(entry);
      section = entry;
    } else {
      (section?.children ?? outline).push(entry);
    }
  }
  return outline;
}

/** Builds a read-only source page without interpreting the source as Markdown. */
export function textDocument(text: string, label: string): ParsedDocument {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const doc = parseDocument('', label);
  doc.sourceLines = lines.length;
  for (let index = 0; index < lines.length; index++) doc.anchors.add(`L${index + 1}`);
  doc.tree.children = [
    { type: 'heading', depth: 1, children: [{ type: 'text', value: label }] },
    { type: 'code', value: lines.join('\n') },
  ];
  return doc;
}

/** A URL rewrite, attachment download, or visible non-link replacement. */
export interface UrlTransform { url: string; title?: string; download?: string; remove?: boolean; suffix?: string }

/** Visits native Markdown links, definitions, and images before HTML sanitization. */
export function transformUrls(doc: ParsedDocument, transform: (url: string, image: boolean) => UrlTransform): void {
  const definitions = new Map<string, Definition>();
  visit(doc.tree, 'definition', node => {
    // Markdown resolves duplicate identifiers to their first definition.
    if (!definitions.has(node.identifier)) definitions.set(node.identifier, node);
  });
  visit(doc.tree, (node, index, parent) => {
    if ((node.type === 'linkReference' || node.type === 'imageReference') && parent && index !== undefined) {
      const definition = definitions.get(node.identifier);
      if (!definition) return;
      // Each occurrence owns its image/link semantics, even with a shared definition.
      node = node.type === 'imageReference'
        ? { type: 'image', url: definition.url, title: definition.title, alt: node.alt, data: node.data }
        : { type: 'link', url: definition.url, title: definition.title, children: node.children, data: node.data };
      parent.children[index] = node as never;
    }
    if (node.type !== 'link' && node.type !== 'image') return;
    const result = transform(node.url, node.type === 'image');
    if (node.type !== 'image' && result.remove && parent && index !== undefined) {
      parent.children.splice(index, 1, ...node.children, ...(result.suffix ? [{ type: 'text' as const, value: result.suffix }] : []));
      return index + node.children.length + (result.suffix ? 1 : 0);
    }
    node.url = result.url;
    if ('title' in node && result.title) node.title = result.title;
    if (node.type !== 'image' && (result.url.startsWith('file:') || result.download)) {
      node.data = { ...node.data, hProperties: { className: ['local-file'], ...(result.download ? { download: result.download } : {}) } };
    }
  });
}

/** One rendered Markdown block: its stable ID, source lines and text. */
export interface RenderedBlock {
  id: string;
  lines: [number, number];
  tag: string;
  text: string;
  heading: string | null;
}

const blockTags = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'pre', 'blockquote', 'figure']);
function textContent(node: HtmlRoot | Element): string {
  return node.children.map(child => child.type === 'text' ? child.value : child.type === 'element' ? textContent(child) : '').join('');
}
function anchorOnly(node: Element): string | undefined {
  const anchors = node.children.filter(child => child.type !== 'text' || child.value.trim());
  const last = anchors.at(-1);
  return anchors.length && anchors.every(child => child.type === 'element' && child.tagName === 'a' && typeof child.properties.id === 'string' && !child.children.length)
    ? String((last as Element).properties.id) : undefined;
}

/**
 * Marks every Markdown block with its source lines and a block ID: the nearest heading's ID
 * (an explicit anchor before the heading wins), "~", and six hex digits of the SHA-256 of
 * the block's whitespace-normalised text. Repeats in one document get "-2", "-3".
 */
function markBlocks(tree: HtmlRoot, mark: boolean): RenderedBlock[] {
  const blocks: RenderedBlock[] = [];
  const seen = new Map<string, number>();
  let heading: string | null = null;
  let pendingAnchor: string | undefined;
  visit(tree, 'element', (node) => {
    if (node.tagName === 'p') {
      const anchor = anchorOnly(node);
      if (anchor) { pendingAnchor = anchor; return; }
    }
    if (!blockTags.has(node.tagName) || !node.position) return;
    if (/^h[1-6]$/.test(node.tagName)) {
      heading = pendingAnchor ?? (typeof node.properties.id === 'string' ? node.properties.id : heading);
    }
    pendingAnchor = undefined;
    const text = textContent(node).replace(/\s+/g, ' ').trim();
    const base = `${heading ?? 'top'}~${createHash('sha256').update(text).digest('hex').slice(0, 6)}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    const lines: [number, number] = [node.position.start.line, node.position.end.line];
    if (mark) {
      node.properties.dataSourceLines = `${lines[0]}-${lines[1]}`;
      node.properties.dataBlock = id;
    }
    blocks.push({ id, lines, tag: node.tagName, text, heading });
  });
  return blocks;
}

/** Produces sanitized HTML; table wrappers make wide fact tables keyboard-scrollable. */
export async function documentHtml(doc: ParsedDocument): Promise<string> {
  return (await renderDocument(doc)).html;
}

/**
 * Produces sanitized HTML and, with `blocks`, its blocks; source pages have no blocks. With `mark`,
 * every block element also carries `data-source-lines` and `data-block`; renders with extensions set it.
 */
export async function renderDocument(doc: ParsedDocument, options: { blocks?: boolean; mark?: boolean } = {}): Promise<{ html: string; blocks: RenderedBlock[] }> {
  const tree = await writer.run(doc.tree) as HtmlRoot;
  const blocks = doc.sourceLines === undefined && (options.blocks || options.mark) ? markBlocks(tree, options.mark === true) : [];
  visit(tree, 'element', (node, index, parent) => {
    if (doc.sourceLines !== undefined && node.tagName === 'pre') {
      const code = node.children[0];
      if (code?.type !== 'element') throw new Error('Source page is missing its code block');
      const text = code.children.map(child => child.type === 'text' ? child.value : '').join('').replace(/\n$/, '');
      node.properties.className = ['source-code'];
      code.children = text.split('\n').flatMap((line, index): Element['children'] => {
        const id = `L${index + 1}`;
        return [{ type: 'element', tagName: 'span', properties: { id, className: ['source-line'] }, children: [
          { type: 'element', tagName: 'a', properties: { href: `#${id}`, className: ['line-number'], ariaLabel: `Line ${index + 1}` }, children: [{ type: 'text', value: String(index + 1) }] },
          { type: 'text', value: line },
        ] }];
      });
    }
    if (node.tagName === 'table' && parent && index !== undefined) {
      parent.children[index] = { type: 'element', tagName: 'div', properties: {
        className: ['table-scroll'], role: 'region', ariaLabel: 'Table', tabIndex: 0,
      }, children: [node] };
      return SKIP;
    }
  });
  return { html: writer.stringify(tree), blocks };
}

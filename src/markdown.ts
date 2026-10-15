// Adapted from @symbiotic/docs: unified/remark -> explicit AST transforms -> sanitized HTML.
import type { Nodes, Root, RootContent } from 'mdast';
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
    code: [['className', /^language-./]], div: ['className', 'role', 'ariaLabel', 'tabIndex'] },
  tagNames: [...(defaultSchema.tagNames ?? []), 'figure', 'figcaption'],
}).use(rehypeStringify);

/** Parsed document, reused for links, entity meanings and HTML generation. */
export interface ParsedDocument {
  title: string;
  tree: Root;
  anchors: Set<string>;
  headings: { id: string; title: string; depth: number }[];
  meanings: Map<string, string>;
}

function anchor(value: string): string | undefined {
  const match = /^<a\s+id\s*=\s*(?:"([^"<>]+)"|'([^'<>]+)')\s*>\s*(?:<\/a>)?$/i.exec(value.trim());
  return match?.[1] ?? match?.[2];
}
function blockAnchor(node: Nodes | undefined): string | undefined {
  if (node?.type === 'html') return anchor(node.value);
  if (node?.type === 'paragraph' && node.children.every((child) => child.type === 'html')) {
    return node.children.map((child) => child.type === 'html' ? anchor(child.value) : undefined).find(Boolean);
  }
  return undefined;
}
function slug(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
}
function element(tag: string, properties: Element['properties'], children: Element['children']): RootContent {
  return { type: 'paragraph', children: [], data: { hName: tag, hProperties: properties, hChildren: children } };
}

/** Parses ordinary Markdown, preserving only explicit empty HTML anchors as markup. */
export function parseDocument(markdown: string, fallbackTitle: string): ParsedDocument {
  const tree = parser.parse(markdown.replace(/\r\n?/g, '\n')) as Root;
  const anchors = new Set<string>();
  const headings: ParsedDocument['headings'] = [];
  const meanings = new Map<string, string>();
  let title = '';
  function addAnchor(id: string): void {
    if (anchors.has(id)) throw new Error(`Duplicate anchor: ${id}`);
    anchors.add(id);
  }
  // Reserve explicit anchors before generating heading IDs, including anchors in table cells.
  visit(tree, 'html', (node) => { const id = anchor(node.value); if (id) addAnchor(id); });
  visit(tree, 'heading', (node, index, parent) => {
    const text = toString(node);
    if (node.depth === 1 && !title) title = text;
    const base = slug(text);
    let id = base;
    let n = 0;
    while (anchors.has(id)) id = `${base}-${++n}`;
    addAnchor(id);
    node.data = { ...node.data, hProperties: { id } };
    // Read authored anchors before the HTML transform; keep generated IDs as valid targets too.
    const explicit = index !== undefined && parent ? blockAnchor(parent.children[index - 1]) : undefined;
    headings.push({ id: explicit ?? id, title: toString(node, { includeHtml: false }), depth: node.depth });
  });
  // Home anchor, heading, first paragraph: the format's canonical one-line meaning.
  for (let i = 0; i < tree.children.length; i++) {
    const node = tree.children[i]!;
    const id = blockAnchor(node);
    if (!id) continue;
    const heading = tree.children[i + 1];
    const paragraph = tree.children[i + 2];
    if (heading?.type === 'heading' && paragraph?.type === 'paragraph') {
      meanings.set(id, toString(paragraph).replace(/\s+/g, ' ').trim());
    }
  }
  visit(tree, (node, index, parent) => {
    if (index === undefined || !parent) return;
    if (node.type === 'yaml') {
      const meta: unknown = parseYaml(node.value);
      if (meta !== null && (typeof meta !== 'object' || Array.isArray(meta))) throw new Error('Frontmatter must be an object');
      const value = (meta as Record<string, unknown> | null)?.title;
      if (value !== undefined && typeof value !== 'string') throw new Error('Frontmatter title must be text');
      if (typeof value === 'string' && value.trim()) title = value;
      parent.children.splice(index, 1);
      return index;
    }
    if (node.type === 'html') {
      const id = anchor(node.value);
      const replacement = id ? element('a', { id }, []) :
        /^\s*(?:<\/a>|<!--[\s\S]*-->)\s*$/i.test(node.value) ? { type: 'text' as const, value: '' } :
        { type: 'text' as const, value: node.value };
      parent.children[index] = replacement as never;
      return;
    }
    if (node.type === 'code' && node.lang === 'mermaid') {
      parent.children[index] = element('figure', { className: ['mermaid-diagram'] }, [
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
  if (doc.headings.filter((heading) => heading.depth === 2).length < 2) return [];
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

/** Visits native Markdown links, definitions, and images before HTML sanitization. */
export function transformUrls(doc: ParsedDocument, transform: (url: string, image: boolean) => { url: string; title?: string }): void {
  const imageReferences = new Set<string>();
  visit(doc.tree, 'imageReference', (node) => { imageReferences.add(node.identifier); });
  visit(doc.tree, (node) => {
    if (node.type !== 'link' && node.type !== 'definition' && node.type !== 'image') return;
    const result = transform(node.url, node.type === 'image' || (node.type === 'definition' && imageReferences.has(node.identifier)));
    node.url = result.url;
    if (result.title) node.title = result.title;
    if (result.url.startsWith('file:') && node.type === 'link') node.children.push({ type: 'text', value: ' (external local file)' });
  });
}

/** Produces sanitized HTML; table wrappers make wide fact tables keyboard-scrollable. */
export async function documentHtml(doc: ParsedDocument): Promise<string> {
  const tree = await writer.run(doc.tree) as HtmlRoot;
  visit(tree, 'element', (node, index, parent) => {
    if (node.tagName === 'table' && parent && index !== undefined) {
      parent.children[index] = { type: 'element', tagName: 'div', properties: {
        className: ['table-scroll'], role: 'region', ariaLabel: 'Table', tabIndex: 0,
      }, children: [node] };
      return SKIP;
    }
  });
  return writer.stringify(tree);
}

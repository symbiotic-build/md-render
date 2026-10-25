// Settled decisions stay in the specification; md-collab only reads its `### Decision:` sections,
// from the text and structure md-render rendered.
import { parseDocument, type ParsedDocument, type SiteView } from 'md-render';
import type { Decider } from './thread.js';

export interface SettledDecision {
  /** The decision heading's anchor, as md-render names its section, for example `decision-bounded-decimal`. */
  id: string;
  title: string;
  topic: string | null;
  path: string;
  choice: string;
  reason: string;
  rejected: string;
  authority: string;
  date: string | null;
  decidedBy: Decider[];
}

const fieldNames = ['Choice', 'Authority', 'Reason', 'Rejected alternatives', 'Decided by', 'Date'] as const;
type FieldName = (typeof fieldNames)[number];
const isoDate = /\b(\d{4}-\d\d-\d\d)\b/g;

/**
 * Who decided, from an explicit **Decided by** field or else from the Authority text. Authority
 * text that names none of operator, lead and measurement is refused rather than guessed.
 */
export function decidersOf(authority: string, explicit?: string): Decider[] {
  const text = explicit ?? authority;
  if (explicit !== undefined) {
    const named = (['operator', 'lead', 'measurement'] as Decider[]).filter(decider => new RegExp(`\\b${decider}\\b`, 'i').test(text));
    if (!named.length) throw new Error(`Decided by names no operator, lead or measurement: ${explicit}`);
    return named;
  }
  if (/^\s*Lead (?:decision|clarification|proposal)\b/i.test(text)) return ['lead'];
  const named: Decider[] = [];
  if (/\boperator\b|\bQ\d+/i.test(text)) named.push('operator');
  if (/\blead (?:decision|clarification|proposal)s?\b/i.test(text)) named.push('lead');
  if (/\bmeasurement\b/i.test(text)) named.push('measurement');
  if (!named.length) throw new Error(`Authority names no operator, lead or measurement; add a **Decided by:** line: ${authority}`);
  return named;
}

/** A Markdown node as md-render's parser builds it, with only the parts plain text needs. */
type MarkdownNode = { type: string; value?: string; alt?: string | null; children?: MarkdownNode[] };
type TopLevel = ParsedDocument['tree']['children'][number];
/** The text a reader sees in a node: link and image text without their targets, and no markup. */
function plainText(node: MarkdownNode): string {
  if (node.type === 'html') return '';
  return node.value ?? node.alt ?? (node.children ?? []).map(plainText).join('');
}

/**
 * Reads every decision section of one rendered chapter, from md-render's parse of the text it
 * rendered. A section is a top-level level-three heading whose source line is `### Decision: <title>`,
 * so a heading inside a code fence, list or quote is none. Its anchor is the one md-render gives the
 * heading's blocks: an explicit anchor before the heading, otherwise the heading's own ID. A field is
 * a top-level paragraph of the section that starts with a bold `<Field>:`; its value is the rest of
 * that paragraph as plain text. Code blocks, lists and quotes are never fields.
 */
export function readSettled(document: SiteView['documents'][number]): SettledDecision[] {
  const lines = document.markdown.replace(/\r\n?/g, '\n').split('\n');
  const source = (node: TopLevel) => lines[(node.position?.start.line ?? 0) - 1] ?? '';
  const decisions: SettledDecision[] = [];
  let topic: string | null = null;
  let section: { heading: TopLevel; title: string; id: string; fields: Partial<Record<FieldName, string>> } | undefined;
  const finish = () => {
    if (!section) return;
    const { fields, heading, title, id } = section;
    if (!fields.Choice || !fields.Authority) throw new Error(`${document.path}:${heading.position?.start.line}: decision "${title}" needs Choice and Authority`);
    const dates = fields.Date ? [fields.Date] : [...fields.Authority.matchAll(isoDate)].map(match => match[1]!).sort();
    decisions.push({
      id, title, topic, path: document.path,
      choice: fields.Choice, reason: fields.Reason ?? '', rejected: fields['Rejected alternatives'] ?? '',
      authority: fields.Authority, date: dates.at(-1) ?? null,
      decidedBy: decidersOf(fields.Authority, fields['Decided by']),
    });
    section = undefined;
  };
  for (const node of parseDocument(document.markdown, '').tree.children) {
    if (node.type === 'heading' && node.depth <= 3) {
      finish();
      if (node.depth === 2) topic = source(node).replace(/^##\s+/, '').trim();
      const title = node.depth === 3 ? /^### Decision: (.+)$/.exec(source(node))?.[1] : undefined;
      const id = document.blocks.find(block => block.tag === 'h3' && block.lines[0] === node.position?.start.line)?.heading;
      if (title && id) section = { heading: node, title: title.trim(), id, fields: {} };
    } else if (section && node.type === 'paragraph' && node.children[0]?.type === 'strong') {
      const name = plainText(node.children[0]).replace(/:$/, '') as FieldName;
      if (plainText(node.children[0]).endsWith(':') && fieldNames.includes(name)) {
        section.fields[name] = node.children.slice(1).map(plainText).join('').replace(/\s+/g, ' ').trim();
      }
    }
  }
  finish();
  return decisions;
}

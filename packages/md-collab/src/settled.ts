// Settled decisions stay in the specification; md-collab only reads its `### Decision:` sections,
// from the text and structure md-render rendered.
import type { SiteView } from 'md-render';
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
const fieldLine = new RegExp(`^\\*\\*(${fieldNames.join('|')}):\\*\\*\\s*(.*)$`);
const isoDate = /\b(\d{4}-\d\d-\d\d)\b/g;

/**
 * Who decided, from an explicit **Decided by** field or else from the Authority text. Authority
 * text that names none of operator, lead and measurement is refused rather than guessed.
 */
export function decidersOf(authority: string, explicit?: string): Decider[] {
  const text = (explicit ?? authority).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
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

/**
 * Reads every decision section of one rendered chapter. A section is a level-three heading that
 * md-render rendered and whose source line is `### Decision: <title>`, so a heading inside a code
 * fence is none. Its anchor is the one md-render gives the heading's blocks: an explicit anchor
 * before the heading, otherwise the heading's own ID. Its fields are the source lines of its blocks.
 */
export function readSettled(document: SiteView['documents'][number]): SettledDecision[] {
  const lines = document.markdown.replace(/\r\n?/g, '\n').split('\n');
  const source = (line: number) => lines[line - 1] ?? '';
  const { blocks } = document;
  const decisions: SettledDecision[] = [];
  let topic: string | null = null;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    if (block.tag === 'h2') topic = source(block.lines[0]).replace(/^##\s+/, '').trim();
    const heading = block.tag === 'h3' ? /^### Decision: (.+)$/.exec(source(block.lines[0])) : null;
    if (!heading) continue;
    const fields: Partial<Record<(typeof fieldNames)[number], string>> = {};
    let current: (typeof fieldNames)[number] | undefined;
    // The section runs to the next heading of level one to three; a block inside another, such as a
    // list item's paragraph, is read once.
    let read = block.lines[1];
    for (; index + 1 < blocks.length && !/^h[1-3]$/.test(blocks[index + 1]!.tag); index++) {
      const [first, last] = blocks[index + 1]!.lines;
      for (let line = Math.max(first, read + 1); line <= last; line++) {
        const field = fieldLine.exec(source(line));
        if (field) { current = field[1] as (typeof fieldNames)[number]; fields[current] = field[2]!; }
        else if (current && source(line).trim()) fields[current] += '\n' + source(line);
      }
      read = Math.max(read, last);
    }
    if (!fields.Choice || !fields.Authority) throw new Error(`${document.path}:${block.lines[0]}: decision "${heading[1]}" needs Choice and Authority`);
    const dates = fields.Date ? [fields.Date.trim()] : [...fields.Authority.matchAll(isoDate)].map(match => match[1]!).sort();
    decisions.push({
      id: block.heading!, title: heading[1]!.trim(), topic, path: document.path,
      choice: fields.Choice.trim(), reason: (fields.Reason ?? '').trim(), rejected: (fields['Rejected alternatives'] ?? '').trim(),
      authority: fields.Authority.trim(), date: dates.at(-1) ?? null,
      decidedBy: decidersOf(fields.Authority, fields['Decided by']),
    });
  }
  return decisions;
}

// Settled decisions stay in the specification; md-collab only reads its `### Decision:` sections.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Decider } from './thread.js';

export interface SettledDecision {
  /** The decision's explicit anchor, for example `decision-bounded-decimal`. */
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

/** Who decided, from an explicit **Decided by** field or else from the Authority text. */
export function decidersOf(authority: string, explicit?: string): Decider[] {
  const text = (explicit ?? authority).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  if (explicit !== undefined) {
    const named = (['operator', 'lead', 'measurement'] as Decider[]).filter(decider => new RegExp(`\\b${decider}\\b`, 'i').test(text));
    if (!named.length) throw new Error(`Decided by names no operator, lead or measurement: ${explicit}`);
    return named;
  }
  if (/^\s*Lead (?:decision|clarification|proposal)\b/i.test(text)) return ['lead'];
  const operator = /\boperator\b|\bQ\d+/i.test(text);
  const lead = /\blead (?:decision|clarification|proposal)s?\b/i.test(text);
  return operator && lead ? ['operator', 'lead'] : lead ? ['lead'] : ['operator'];
}

/** Reads every decision section of one chapter; `file` is the chapter's corpus path. */
export async function readSettled(root: string, file: string): Promise<SettledDecision[]> {
  const lines = (await readFile(path.join(root, file), 'utf8')).replace(/\r\n?/g, '\n').split('\n');
  const decisions: SettledDecision[] = [];
  let topic: string | null = null;
  let anchor: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.startsWith('## ')) topic = line.slice(3).trim();
    const anchorMatch = /^<a id="([^"]+)"><\/a>$/.exec(line.trim());
    if (anchorMatch) { anchor = anchorMatch[1]!; continue; }
    const heading = /^### Decision: (.+)$/.exec(line);
    if (!heading) continue;
    if (!anchor) throw new Error(`${file}:${index + 1}: decision "${heading[1]}" has no anchor before its heading`);
    const fields: Partial<Record<(typeof fieldNames)[number], string>> = {};
    let current: (typeof fieldNames)[number] | undefined;
    let next = index + 1;
    for (; next < lines.length && !/^#{1,3} /.test(lines[next]!) && !/^<a id="/.test(lines[next]!.trim()); next++) {
      const field = fieldLine.exec(lines[next]!);
      if (field) { current = field[1] as (typeof fieldNames)[number]; fields[current] = field[2]!; }
      else if (current && lines[next]!.trim()) fields[current] += '\n' + lines[next];
    }
    if (!fields.Choice || !fields.Authority) throw new Error(`${file}:${index + 1}: decision "${heading[1]}" needs Choice and Authority`);
    const dates = fields.Date ? [fields.Date.trim()] : [...fields.Authority.matchAll(isoDate)].map(match => match[1]!).sort();
    decisions.push({
      id: anchor, title: heading[1]!.trim(), topic, path: file,
      choice: fields.Choice.trim(), reason: (fields.Reason ?? '').trim(), rejected: (fields['Rejected alternatives'] ?? '').trim(),
      authority: fields.Authority.trim(), date: dates.at(-1) ?? null,
      decidedBy: decidersOf(fields.Authority, fields['Decided by']),
    });
    anchor = null;
    index = next - 1;
  }
  return decisions;
}

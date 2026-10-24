// A House Rules operator question list becomes question threads; each cited line range becomes an anchor.
import path from 'node:path';
import type { SiteView } from 'md-render';
import { anchorAt } from './anchors.js';
import type { Anchor, Option, Thread } from './thread.js';

export interface ListedQuestion {
  number: number;
  topic: string | null;
  title: string;
  context: string;
  options: Option[];
  /** Citations in reading order: absolute file path and line range. */
  citations: { file: string; lines: [number, number] }[];
  /** An explicit `Main passage:` citation, when the question names one. */
  main?: { file: string; lines: [number, number] };
}

const citation = /\[`?([^\]`]+?\.md):([0-9][0-9,\s–-]*)`?\]\(([^)\s]+)\)/g;
function spans(text: string): [number, number][] {
  return text.split(',').map(part => part.trim().replace('–', '-')).filter(Boolean).map(part => {
    const [first, last] = part.split('-').map(Number);
    return [first!, last ?? first!] as [number, number];
  });
}
function cited(markdown: string, base: string): { file: string; lines: [number, number] }[] {
  const found: { file: string; lines: [number, number] }[] = [];
  for (const match of markdown.matchAll(citation)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(match[3]!)) continue;
    const file = path.resolve(base, decodeURIComponent(match[3]!.split('#')[0]!));
    for (const lines of spans(match[2]!)) {
      if (!found.some(item => item.file === file && item.lines[0] === lines[0] && item.lines[1] === lines[1])) found.push({ file, lines });
    }
  }
  return found;
}

/**
 * Reads the House Rules question format: `## Topic`, `### 1\. Title`, context lines, a numbered option
 * list with one "(recommended)", and an optional "**Answer like so:**" block, which is ignored.
 */
export function parseQuestionList(markdown: string, file: string): ListedQuestion[] {
  const base = path.dirname(file);
  const questions: ListedQuestion[] = [];
  let topic: string | null = null;
  const parts = markdown.replace(/\r\n?/g, '\n').split(/^(## .+|### \d+\\?\. .+)$/m);
  for (let index = 1; index < parts.length; index++) {
    const part = parts[index]!;
    if (part.startsWith('## ')) { topic = part.slice(3).trim(); continue; }
    const heading = /^### (\d+)\\?\. (.+)$/.exec(part);
    if (!heading) continue;
    const body = (parts[index + 1] ?? '').split('**Answer like so:**')[0]!;
    index++;
    const context: string[] = [];
    const options: Option[] = [];
    let main: ListedQuestion['main'];
    for (const line of body.split('\n')) {
      const option = /^(\d+)\. (.+)$/.exec(line);
      if (option) { options.push({ n: Number(option[1]), text: option[2]!.trim(), recommended: /\(recommended\)/.test(option[2]!) }); continue; }
      const mainLine = /^Main passage: (.+)$/.exec(line.trim());
      if (mainLine) { main = cited(mainLine[1]!, base)[0]; if (!main) throw new Error(`Question ${heading[1]}: Main passage needs a citation link`); continue; }
      if (line.trim()) context.push(line.replace(/\\$/, ''));
    }
    const text = context.join('\n\n');
    questions.push({ number: Number(heading[1]), topic, title: heading[2]!.trim(), context: text, options, citations: cited(text, base), ...(main ? { main } : {}) });
  }
  if (!questions.length) throw new Error(`${file}: no questions in the House Rules format (### 1\\. Title)`);
  return questions;
}

const slug = (text: string): string => text.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 6).join('-');

/**
 * Turns listed questions into threads. The main anchor is the explicit Main passage, else the first
 * citation outside the settled chapters; every other citation is an also anchor.
 */
export function questionThreads(questions: ListedQuestion[], options: {
  view: SiteView; corpusRoot: string; commit: string; actor: string; at: string; settled: string[]; idPrefix?: string;
  /** The question list's folder, which its relative links start from. */
  base: string;
  /** Receives one line per citation that was kept as text because it names no rendered document. */
  skipped?: string[];
}): Thread[] {
  const corpusPath = (file: string): string => path.relative(options.corpusRoot, file).split(path.sep).join('/');
  return questions.map(question => {
    const anchors: Anchor[] = [];
    const add = (citation: { file: string; lines: [number, number] }, role: Anchor['role']) => {
      const target = corpusPath(citation.file);
      // A citation of a file outside the rendered documents stays text in the context.
      if (!options.view.documents.some(document => document.path === target)) {
        options.skipped?.push(`question ${question.number}: ${target}:${citation.lines[0]}-${citation.lines[1]} is not a rendered document`);
        return;
      }
      if (anchors.some(anchor => anchor.path === target && anchor.lines[0] === citation.lines[0] && anchor.lines[1] === citation.lines[1])) return;
      anchors.push(anchorAt(options.view, target, citation.lines, options.commit, role));
    };
    const rendered = (item: { file: string }) => options.view.documents.some(document => document.path === corpusPath(item.file));
    const main = question.main ?? question.citations.find(item => rendered(item) && !options.settled.includes(corpusPath(item.file))) ?? question.citations.find(rendered);
    if (main) add(main, 'main');
    for (const item of question.citations) add(item, 'also');
    // Citation links become jumps to their anchor; other local links keep only their text.
    const context = question.context.replace(citation, (link, name: string, lines: string, target: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return link;
      const file = corpusPath(path.resolve(options.base, decodeURIComponent(target.split('#')[0]!)));
      const first = spans(lines)[0]!;
      const index = anchors.findIndex(anchor => anchor.path === file && anchor.lines[0] === first[0] && anchor.lines[1] === first[1]);
      return index < 0 ? `\`${name}:${lines}\`` : `[${name}:${lines}](#md-collab-anchor-${index})`;
    }).replace(/\[([^\]]+)\]\((?![a-z][a-z0-9+.-]*:|#)[^)\s]+\)/gi, '$1');
    return {
      id: `${options.idPrefix ?? 'q'}${String(question.number).padStart(2, '0')}-${slug(question.title)}`,
      kind: 'question', title: question.title, decides: 'operator', number: question.number,
      ...(question.topic ? { topic: question.topic } : {}),
      anchors, context, options: question.options,
      entries: [{ at: options.at, actor: options.actor, kind: 'raised', note: '' }],
    };
  });
}

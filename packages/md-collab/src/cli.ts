#!/usr/bin/env node
// md-collab: comments, questions and decisions on Markdown documents, for people and agents.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { renderView } from 'md-render';
import { resolveAnchor } from './anchors.js';
import { snapshotsOf } from './versions.js';
import { parseQuestionList, questionThreads } from './import.js';
import { serve } from './server.js';
import { checkStoreOutside, FileStore } from './store.js';
import { threadStatus, type Entry } from './thread.js';

const usage = `Usage:
  md-collab init --store <dir> --collection <name> --title <text> [--settled <corpus path>]...
  md-collab serve <documents> --store <dir> --collection <name> --person person:<login> [--port <n>]
  md-collab import <questions.md> <documents> --store <dir> --collection <name> --by <actor> [--at <UTC timestamp>]
  md-collab list --store <dir> --collection <name> [--status open|answered|settled|withdrawn] [--json]
  md-collab answer <id> --store <dir> --collection <name> --by person:<login> [--choice <n>] [--note <text>] [--source chat]
  md-collab comment <id> --store <dir> --collection <name> --by <actor> --note <text>
  md-collab resolve <id> --store <dir> --collection <name> --by <actor> --settled-as <path#anchor> [--note <text>]
  md-collab check <documents> --store <dir> --collection <name>

An actor is person:<login> or agent:<product>/<session>. Only a person answers; an agent that copies an
answer from chat records it as the person with --source chat.`;

const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
    store: { type: 'string' }, collection: { type: 'string' }, title: { type: 'string' }, settled: { type: 'string', multiple: true },
    person: { type: 'string' }, port: { type: 'string' }, by: { type: 'string' }, status: { type: 'string' }, json: { type: 'boolean' },
    at: { type: 'string' }, choice: { type: 'string' }, note: { type: 'string' }, source: { type: 'string' }, 'settled-as': { type: 'string' }, 'no-mermaid': { type: 'boolean' },
  } });
  if (!command || command === 'help' || command === '--help') { console.log(usage); return command ? 0 : 2; }
  const need = (name: keyof typeof values): string => {
    const value = values[name];
    if (typeof value !== 'string' || !value) throw new Error(`--${name} is required\n\n${usage}`);
    return value;
  };
  const store = new FileStore(path.resolve(need('store')));
  const collection = need('collection');
  const append = async (id: string, entry: Entry) => {
    const saved = await store.append(collection, id, entry);
    console.log(`${id}: ${entry.kind} recorded; status ${threadStatus(saved.thread)}`);
  };
  switch (command) {
    case 'init':
      await store.createCollection({ name: collection, title: need('title'), settled: values.settled ?? [] });
      console.log(`Created collection ${collection} in ${store.root}`);
      return 0;
    case 'serve': {
      // Ctrl+C is heard from the start: a stop during the first render lets it finish and clean up,
      // then closes the session without printing its address.
      let stopped = false;
      const stop = new Promise<void>(resolve => { const end = () => { stopped = true; resolve(); }; process.once('SIGINT', end); process.once('SIGTERM', end); });
      const session = await serve({ documents: positionals[0] ?? '.', store: store.root, collection, person: need('person'), mermaid: !values['no-mermaid'], ...(values.port ? { port: Number(values.port) } : {}) });
      if (!stopped) console.log(`md-collab: open ${session.url}\nPress Ctrl+C to stop.`);
      await stop;
      await session.close();
      return 0;
    }
    case 'import': {
      const [file, documents] = positionals;
      if (!file || !documents) throw new Error(`import needs the question file and the documents\n\n${usage}`);
      const info = await store.collection(collection);
      const { view, root } = await renderView(documents, { mermaid: false });
      await checkStoreOutside(store.root, root);
      const skipped: string[] = [];
      const threads = questionThreads(parseQuestionList(await readFile(file, 'utf8'), path.resolve(file)), {
        skipped,
        view, corpusRoot: root, actor: need('by'), at: values.at ?? now(), settled: info.settled, base: path.dirname(path.resolve(file)),
      });
      // Refuses the whole list, before writing, when a number repeats in it or is already in the collection.
      await store.createAll(collection, threads, snapshotsOf(view, threads.flatMap(thread => thread.anchors.map(anchor => anchor.path))));
      console.log(`Imported ${threads.length} questions into ${collection}`);
      for (const line of skipped) console.log(`  kept as text, no anchor: ${line}`);
      return 0;
    }
    case 'list': {
      const threads = (await store.list(collection)).map(({ thread }) => ({ ...thread, status: threadStatus(thread) }))
        .filter(thread => !values.status || thread.status === values.status);
      if (values.json) { console.log(JSON.stringify(threads, null, 2)); return 0; }
      for (const thread of threads) {
        const answer = thread.entries.filter(entry => entry.kind === 'answer').pop();
        console.log(`${thread.id}\t${thread.status}\t${thread.number ?? ''}\t${thread.title}${thread.status === 'answered' && answer ? `\n\tanswer: ${answer.choice ?? '-'}${answer.note ? ' — ' + answer.note.replace(/\n/g, ' ') : ''}` : ''}`);
      }
      return 0;
    }
    case 'answer': {
      const entry: Entry = { at: now(), actor: need('by'), kind: 'answer', note: values.note ?? '' };
      if (values.choice) entry.choice = Number(values.choice);
      if (values.source) entry.source = values.source;
      if (entry.choice === undefined && !entry.note) throw new Error('An answer needs --choice or --note');
      await append(positionals[0] ?? '', entry);
      return 0;
    }
    case 'comment':
      await append(positionals[0] ?? '', { at: now(), actor: need('by'), kind: 'comment', note: need('note') });
      return 0;
    case 'resolve':
      await append(positionals[0] ?? '', { at: now(), actor: need('by'), kind: 'settled', settledAs: need('settled-as'), note: values.note ?? '' });
      return 0;
    case 'check': {
      const { view } = await renderView(positionals[0] ?? '.', { mermaid: false });
      let problems = 0;
      // A settled or withdrawn thread no longer needs its passage.
      for (const { thread } of await store.list(collection)) {
        if (['settled', 'withdrawn'].includes(threadStatus(thread))) continue;
        for (const anchor of thread.anchors) {
          const { state, problem } = await resolveAnchor(anchor, view, store, collection);
          if (state === 'same') continue;
          problems++;
          console.log(`${state}\t${thread.id}\t${anchor.path}\t${anchor.block}${problem ? `\t${problem}` : ''}`);
        }
      }
      const info = await store.collection(collection);
      for (const file of info.settled) if (!view.documents.some(document => document.path === file)) { problems++; console.log(`missing settled chapter\t${file}`); }
      console.log(problems ? `${problems} problems` : 'All anchors resolve');
      return problems ? 1 : 0;
    }
    default:
      console.error(`Unknown command ${command}\n\n${usage}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
  console.error(`md-collab: ${(error as Error).message}`);
  process.exitCode = 1;
});

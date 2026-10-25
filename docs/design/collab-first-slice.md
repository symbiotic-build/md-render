---
status: draft
issue: none yet (offline slug branch `collab-first-slice`; the issue is opened when the branch is first pushed)
---

# md-collab first slice: annotations on rendered documents

This design implements the approved framework for people and agents working on the same Markdown documents. The framework itself, with its owners, layers and operator decisions of 2026-10-24, is in the operator handoff `collaborative-docs-framework.md`; its decisions are repeated under [Key decisions](#key-decisions) so this file stands alone.

The first slice serves one need: the operator answers the open questions about a specification while reading it, and sees every earlier decision with who made it and when.

## Scope

- **md-render** gains block identity, source lines, a render-time extension interface for the single page, a browser interface and an in-memory single-page render. Its non-goals stay: it does not edit Markdown, host remotely or reload live.
- **md-collab** is a new package in this repository. It stores annotations as files, resolves their anchors, offers agent commands, and serves a local page with the decisions sidebar and the history view.
- **Not in this slice:** tags, suggested edits, agent-attached data, a database store, hosting, and the client portal's or Mission Control's adoption.

## md-render additions

### Block identity and source lines

In a render with at least one extension, every rendered block element of a Markdown page carries two attributes. Renders without extensions write the same bytes as before this slice, in folder and single-file output, and do no block work:

- `data-source-lines="72-73"`: the first and last source line of the block, from the parser's positions. One line is written `72-72`.
- `data-block="decimal~3f9a1c"`: the block ID.

A block is a `p`, `li`, `h1`–`h6`, `tr`, `pre`, `blockquote` or `figure` element. A Mermaid fence becomes a `figure` and its source `pre`, and both carry the fence's lines, with or without the diagram renderer. `FACT`: remark keeps each node's source position through `remark-rehype` and `rehype-sanitize`; a probe on this repository at `dd43046` printed `p:3-4 li:6-6 tr:11-11` for a small document.

A block ID is the ID of the nearest preceding heading, `~`, and the first six hexadecimal digits of the SHA-256 of the block's whitespace-normalised text. A block before the first heading uses `top`. A second block with the same ID in the same document gets `-2`, a third `-3`. This is the client portal's block rule (portal design §3.3), adopted so both name blocks the same way. It keeps the ID when lines move and changes it when the block's text or its section heading changes.

Source pages for non-Markdown text files keep their existing `L<n>` line IDs and get no block IDs.

### Site view and extensions

```ts
/** One rendered block, as extensions see it. */
export interface Block {
  readonly id: string;                 // "decimal~3f9a1c"
  readonly path: string;               // corpus path: "docs/specs/memory-storage/schemas-and-values.md"
  readonly lines: readonly [number, number];  // first and last source line
  readonly tag: string;                // "p", "li", "h2", "tr", …
  readonly text: string;               // whitespace-normalised text content
  readonly heading: string | null;     // ID of the nearest preceding heading
}

/** Read-only view of the rendered corpus; md-render freezes it, so no extension changes what another sees. */
export interface SiteView {
  readonly documents: readonly { readonly path: string; readonly title: string; readonly anchors: readonly string[]; readonly blocks: readonly Block[] }[];
}

/** What an extension adds to every rendered page. */
export interface ExtensionOutput {
  styles?: string;            // CSS, inlined in a <style> element
  script?: string;            // JavaScript, inlined after md-render's own script
  data?: unknown;             // JSON, readable through mdRender.extensionData(name)
  connect?: boolean;          // allow fetch to the page's own origin
}

export interface RenderExtension {
  name: string;               // [a-z][a-z0-9-]*, unique per render
  prepare(view: SiteView): ExtensionOutput | Promise<ExtensionOutput>;
}

export function renderSinglePage(input: string, options?: RenderOptions, extensions?: RenderExtension[]):
  Promise<{ html: string; view: SiteView; root: string; warnings: string[] }>;

export function renderView(input: string, options?: RenderOptions):
  Promise<{ view: SiteView; root: string; warnings: string[] }>;
```

md-render calls `prepare` once, after every page is parsed and rendered and before the page is written. An error thrown by `prepare` stops the render with `Extension <name> failed: <message>`. md-render writes each extension's output into the page and adds the script's SHA-256 hash to the page's Content Security Policy. `connect: true` sets `connect-src 'self'`; otherwise the single-file policy keeps `connect-src 'none'`.

`renderSinglePage` returns the single-file page without writing a file, for servers such as md-collab's. `renderView` returns only the view, for commands that find blocks but show no page. Both return the corpus root, so callers read the corpus once.

### Browser interface

In a single page rendered with extensions, md-render's script defines one frozen global before extension scripts run. Pages without extensions do not get it:

```ts
interface MdRender {
  version: 1;
  documents(): { path: string; title: string }[];
  currentDocument(): string | null;                                   // corpus path shown now
  blocks(path: string, first: number, last: number): Element[];       // blocks overlapping the lines, on the shown page
  block(path: string, id: string): Element | null;
  show(target: { path: string; block?: string; anchor?: string }): Promise<Element | null>;  // opens the chapter, scrolls
  onNavigate(listener: (path: string) => void): void;                 // after the shown document changes
  extensionData(name: string): unknown;
}
declare const mdRender: MdRender;
```

Extensions apply to the single page only, where every document is present, so `blocks`, `block` and `show` reach any document. Folder output and its viewer take no extensions. `show` also sets the fragment to the shown chapter, as find-in-page does, so a later link back to the previous chapter still navigates.

## md-collab

### Terms

- **Thread:** one annotation: a kind, anchors, kind fields and dated entries. One file.
- **Collection:** a folder of threads about one document set, such as `memory-storage`.
- **Store:** the folder that holds collections. The first store is a directory in a git checkout outside the documents' working tree.
- **Entry:** one dated step in a thread: `raised`, `comment`, `answer`, `settled`, `reopened` or `withdrawn`.
- **Actor:** who wrote an entry: `person:<github-login>` or `agent:<product>/<session>`.

### Thread file

```markdown
---
id: d1-decimal-schema-source
kind: question
title: How should a schema declare a decimal or bigdecimal field so that a host can submit it?
decides: operator
number: 1
priority: P1
topic: Exact numbers in schemas
anchors:
  - role: main
    path: docs/specs/memory-storage/schemas-and-values.md
    commit: 7aaff7d
    lines: [73, 73]
    block: decimal~3f9a1c
    quote: "logical notation, not submittable source"
  - role: also
    path: docs/specs/memory-storage/decisions.md
    commit: 7aaff7d
    lines: [461, 472]
settled_as: null
---

`FACT` You settled two exact number types … `ASSESSMENT` Until this is answered, nobody can build the schema parser.

## Options

1. **Write Cedar's own `decimal` type plus one Memory annotation … (recommended).**
2. Use carrier types …

## Entries

### 2026-10-22T13:09:00Z agent:claude-code/memory-design raised

### 2026-10-24T09:41:12Z person:operator answer

Choice: 1

Keep the annotation names short.
```

- Field and file names are lower snake case. The front matter is YAML.
- The body has the context, then `## Options` and `## Entries`. Each entry starts with `### <time> <actor> <kind>`, then its fields (`Choice:`, `Source:`, `Settled as:`), one per line, then a blank line and the note.
- A line of context or note text that starts with `#`, `Choice: `, `Source: ` or `Settled as: `, after any number of backslashes, is written with one more backslash, inside fenced code too; reading removes exactly one. So no text can end a section or an entry or be read as a field, the parser never tracks fences, and an unclosed fence cannot swallow the entries. An option is one line.
- `kind` is `comment` or `question` in this slice. A comment has no options, `decides` or `number`.
- `decides` is `operator`, `lead` or `measurement`. `number` is the operator question number in its collection, unique there.
- An anchor needs `path`, `commit` and `lines`; `block` and `quote` are written by the tool when it can. The tool saves `lines` from the first line of the block it names to the last line of the last block cited, so resolution by block or quote covers the same blocks.
- The status comes from the entries: the last of `raised`, `reopened`, `answered`, `settled` and `withdrawn` decides it, and `comment` entries never change it. `answer` makes it `answered`.
- Only a `person:` actor writes an `answer`. An agent that records an answer the operator gave in chat writes it as the person with the line `Source: chat` in the entry.

### Settled decisions

md-collab reads `### Decision:` sections from the decision chapters a collection names in its `collection.yaml`. Each becomes a read-only settled item: anchor = its decision heading, date and decider from **Authority**. They are never written to the store; the specification remains their home.

- The page names a settled item `<chapter path>#<anchor>`, because two chapters may use the same anchor.
- The decider is the explicit **Decided by** line when there is one. Otherwise the **Authority** text decides: a `Q<n>` or `operator` names the operator, "lead decision", "lead clarification" or "lead proposal" names the lead, and `measurement` names measurement. Authority text that names none of them is refused with a request for a **Decided by** line, instead of being attributed to the operator.

### Anchor resolution

At every load, each anchor is matched against the current `SiteView`:

1. the block with the same `block` ID in the same path;
2. otherwise the block in that path whose text contains `quote`, nearest to the old lines;
3. otherwise, when the store's `commit` equals the documents' current commit, the blocks overlapping `lines`;
4. otherwise the anchor is orphaned. The page lists orphaned anchors, and `md-collab check` reports them with exit code 1.

### Commands

Every command takes `--store <dir>` and `--collection <name>`. An actor is `person:<login>` or `agent:<product>/<session>`.

```text
md-collab init --store <dir> --collection <name> --title <text> [--settled <corpus path>]...
md-collab import <questions.md> <documents> --store <dir> --collection <name> --by <actor> [--at <UTC timestamp>]
md-collab serve <documents> --store <dir> --collection <name> --person person:<login> [--port <n>] [--no-mermaid]
md-collab list --store <dir> --collection <name> [--status open|answered|settled|withdrawn] [--json]
md-collab answer <id> --store <dir> --collection <name> --by person:<login> [--choice <n>] [--note <text>] [--source chat]
md-collab comment <id> --store <dir> --collection <name> --by <actor> --note <text>
md-collab resolve <id> --store <dir> --collection <name> --by <actor> --settled-as <path#anchor> [--note <text>]
md-collab check <documents> --store <dir> --collection <name>
```

Setting up a review:

1. **Prerequisites.** The documents are in a git checkout. The store is a folder outside that checkout's working tree; `import` and `serve` refuse a store inside it.
2. **Create the collection.** `init` writes `<store>/<collection>/collection.yaml` and prints `Created collection <name> in <store>`. It refuses a collection that exists. `--settled` names each decision chapter by its corpus path, for example `docs/specs/memory-storage/decisions.md`.
3. **Import the questions.** `import` reads a House Rules question list, anchors each citation in the documents at their current commit and prints `Imported <n> questions into <collection>`, plus one line per citation kept as text because it names no rendered document. It refuses the whole list, before writing anything, when a question number repeats in the list or is already in the collection.
4. **Serve the page.** `serve` prints `md-collab: open http://127.0.0.1:<port>/` and runs until Ctrl+C. The operator answers there.
5. **Read the answers.** `list` prints one line per thread with its status and latest answer; `--json` prints the threads. `answer`, `comment` and `resolve` print `<id>: <kind> recorded; status <status>`.
6. **Check anchors.** `check` prints each orphaned anchor and each missing settled chapter and exits 1 when there is one; otherwise it prints `All anchors resolve`.

### Store writes

One function in `store.ts` owns every write to a collection. It holds the collection's lock while it reads, checks and writes:

- **Lock.** The lock is the file `<store>/<collection>/.lock`, holding the owner's process number and a random token. A writer creates it only if it is absent, and owns it from that moment; when writing its content fails, the writer removes it again. A writer that finds a lock waits, polling every 10 ms, and gives up after 10 seconds with `Collection <name> is locked by process <n>`. A writer removes the lock when it finishes, and only when the lock still holds its own token.
- **A lock left by a crashed process.** A lock whose process no longer exists is never taken over. A writer that finds one refuses at once with `Collection <name> is locked by process <n>, which no longer runs; if no md-collab command is writing, delete <lock file>`. A person or agent deletes the file by hand, see [Recovery](#recovery). A lock whose process number was reused by a live process looks held; remove it the same way.
- **New files** (threads and `collection.yaml`) are written to a private draft beside the destination, `.<name>.<random>.tmp`, then published with a hard link that fails when the destination exists, and the draft is removed. A reader sees a complete file or none.
- **Appends** reread the thread under the lock, refuse when the caller named an older version, write a draft and rename it over the thread.
- **Creation** under the lock reads the collection, refuses an id or a question number that exists or repeats in the batch, then publishes each thread.
- Drafts and the lock start with a dot. Readers and the page's change notices ignore them, and every handled failure removes the draft it wrote.

### Store invariants

Each invariant names the failure it prevents and the test that checks it at the store's boundary.

| Invariant | Prevents | Test |
| --- | --- | --- |
| An acknowledged entry stays in its thread, whatever other writers do. | Two concurrent appends both report success and one entry is lost. | [keeps every entry when many writers append to one thread at once](../../packages/md-collab/test/collab.test.ts) |
| A question number names one thread in its collection. | A repeated number in one import, or two concurrent imports, make the collection unreadable. | [refuses a repeated question number in a batch or in the collection and writes nothing](../../packages/md-collab/test/collab.test.ts) |
| A write refused by a check (an old version, an existing id or question number) changes nothing. A write that fails on a filesystem error removes its own draft and lock; an import that fails part-way keeps the complete threads it published before the failure, see [Recovery](#recovery). A crashed writer can leave a draft, which readers ignore, and its lock, which refuses later writes until it is deleted. | A conflict or a repeated id blocks or corrupts later writes; two writers enter after a crash. | [appends entries and refuses a write against an old version](../../packages/md-collab/test/collab.test.ts), [leaves no draft or lock behind when a write is refused, and refuses to write past a lock left by a crashed process](../../packages/md-collab/test/collab.test.ts) |
| A thread file reads back as the thread written, whatever its text. | A note that starts like a field or a heading changes an answer or makes the thread unreadable. | [writes and reads a thread file without loss, and derives status from its entries](../../packages/md-collab/test/collab.test.ts) |
| The store is outside the documents' working tree. | Annotations ride on the documents' branches. | [refuses a store inside the documents' working tree](../../packages/md-collab/test/collab.test.ts) |

### Local page and server

`serve` renders the documents with `renderSinglePage` and the md-collab extension, then listens on `127.0.0.1` and prints the address.

- Every request needs `Host` equal to `127.0.0.1:<port>`, the printed address, or `localhost:<port>`, both names of this computer. Writes also need `Origin` equal to `http://` and that Host. A page from another site cannot write. A site that points its own name at `127.0.0.1` is still refused, because the browser sends that site's name as the Host.
- There is no token. Any program on the same computer can write through the server; the operator accepted that on 2026-10-24 to keep the address simple.
- Annotation text is rendered through the same sanitizer as documents; raw HTML stays escaped.
- The page reads threads from `GET /api/state` and receives changes over server-sent events from `/api/events`: a store change, such as an agent's new question, reloads the threads, and a change to the documents re-renders the page and reloads it. The operator confirmed on 2026-10-24 that live updates are needed.
- The server watches the store's `threads` folder, without recursion, since nothing else in the store changes after start; Node's recursive watch on Linux misses a file renamed over a watched one, which every append does. It also watches the documents.
- One render runs at a time; a change during a render starts one more after it. A render publishes its page, view and commit together, and only when it succeeds. A failed render keeps the last good page and sends `failed` with the error, which the page shows.
- The page loads the threads at start and each time the event stream opens, so a reconnection catches up on writes it missed. One state request runs at a time, so an older response never replaces a newer one. A page that stops reading the stream is disconnected and catches up when it reconnects.
- A change that arrives while the reader types a note updates the counts at once and redraws the list when the note loses focus; notes being written survive the redraw.
- The sidebar has the approved Questions view and the History view of the 2026-10-24 prototype. Comments on a text selection anchor to the selected blocks.

## Recovery

What each refusal leaves behind, who acts and how.

| Situation | What is left | Who acts | Repair |
| --- | --- | --- | --- |
| `import` stopped part-way, by a crash or a disk error | The questions published before the stop; each is complete. | The agent that imported | `list` shows the imported numbers. Remove those questions from the question file, or keep a copy with only the rest, and import again. A repeated number refuses the whole import, so nothing is imported twice. |
| `Thread <id> changed since it was read` | The thread with the other writer's entry. | The page reloads; the reader repeats the change. | None in the store. |
| `Collection <name> is locked by process <n>` | A lock file held by process `<n>`. | The writer | Retry. If process `<n>` is not an md-collab command, its number was reused after a crash: delete `<store>/<collection>/.lock`. |
| `Collection <name> is locked by process <n>, which no longer runs; …` | The lock file `<store>/<collection>/.lock` of a crashed writer. Every write to the collection is refused. | The person or agent that sees the message | Check that no md-collab command is writing to the collection, then delete the named lock file and repeat the write. |
| A thread file that does not parse, or a repeated question number from a hand edit | The file; every read of the collection fails and names it. | Whoever edited the store | Fix or remove the named file in the store's git checkout, for example with `git checkout -- <file>`. |
| `check` reports an orphaned anchor | The thread, unchanged; the page lists the passage as no longer found. | The agent that owns the question | Find the passage, or resolve or withdraw the question. |
| `check` reports a missing settled chapter, or `serve` refuses one | `collection.yaml` names a chapter that is not rendered. | The collection's owner | Fix the path in `collection.yaml`, or render the folder that holds the chapter. |
| An Authority line names no decider | The decision chapter, unchanged; `serve` refuses to start. | The specification's owner | Add a `**Decided by:**` line to that decision. |
| A re-render fails | The last good page stays served; the page shows the error. | The document's author | Fix the document; the next save re-renders. |
| The store is inside the documents' working tree | Nothing written. | The operator | Move the store to a separate folder and pass it with `--store`. |

## Key decisions

### Decision: md-render stays the renderer

**Choice:** md-render keeps rendering and gains block identity, source lines, extensions and a browser interface. md-collab owns everything that writes.

**Authority:** Lead decision, 2026-10-24, delegated by the operator; part of the framework the operator approved on 2026-10-24.

**Reason:** md-render's spec lists "Editing Markdown, … remote hosting and live reload" as non-goals (`docs/specs/md-render/md-render.md:39`).

**Rejected alternatives:** md-render growing into the whole tool. Editing md-render's finished HTML afterwards, as the first prototype did, depends on markup md-render never promised.

### Decision: annotations live outside the documents' working tree

**Choice:** Threads are files in a separate store, one file per thread, written only through md-collab.

**Authority:** Lead proposal, 2026-10-24, after the operator asked how agents in worktrees and read-only reviewers would write annotations; part of the approved framework.

**Reason:** Agents work on branches in worktrees and reviewers run read-only. Files inside the documents' repository would ride on feature branches, conflict in merges and be unwritable for reviewers.

**Rejected alternatives:** An `annotations/` folder in the documents' repository; git notes, which attach to commits rather than text.

### Decision: block IDs follow the client portal's rule

**Choice:** Heading ID plus a hash of the block's text.

**Authority:** Lead decision, 2026-10-24, under the approved owner of anchors (md-render).

**Reason:** One rule for both systems; the ID survives line moves and changes when the text changes, which is when an anchor must fall back to its quote.

**Rejected alternatives:** Line numbers only, which break on every edit above the block. Sequential block numbers, which shift when a block is inserted.

## Size

`ESTIMATE`: md-render, 4 source files changed and about 300 lines, plus spec sections and tests. md-collab, about 10 source files and 1 500 lines, plus tests.

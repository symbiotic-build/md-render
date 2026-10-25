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
- `kind` is `comment` or `question` in this slice. A comment has no options, `decides` or `number`.
- `decides` is `operator`, `lead` or `measurement`. `number` is the operator question number in its collection, unique there.
- An anchor needs `path`, `commit` and `lines`; `block` and `quote` are written by the tool when it can.
- The status comes from the entries: the last of `raised`, `reopened`, `answered`, `settled` and `withdrawn` decides it, and `comment` entries never change it. `answer` makes it `answered`.
- Only a `person:` actor writes an `answer`. An agent that records an answer the operator gave in chat writes it as the person with the line `Source: chat` in the entry.

### Settled decisions

md-collab reads `### Decision:` sections from the decision chapters a collection names in its `collection.yaml`. Each becomes a read-only settled item: anchor = its decision heading, date and decider from **Authority**. They are never written to the store; the specification remains their home.

### Anchor resolution

At every load, each anchor is matched against the current `SiteView`:

1. the block with the same `block` ID in the same path;
2. otherwise the block in that path whose text contains `quote`, nearest to the old lines;
3. otherwise, when the store's `commit` equals the documents' current commit, the blocks overlapping `lines`;
4. otherwise the anchor is orphaned. The page lists orphaned anchors, and `md-collab check` reports them with exit code 1.

### Commands

```text
md-collab serve <documents> --store <dir> --collection <name>      # local page on 127.0.0.1
md-collab import <questions.md> --store <dir> --collection <name>  # House Rules question list -> question threads
md-collab list --store <dir> [--collection <name>] [--status open|answered|settled] [--json]
md-collab answer <id> --choice <n> [--note <text>] --by person:<login> [--source chat]
md-collab resolve <id> --settled-as <path#anchor> --by <actor>
md-collab check <documents> --store <dir> --collection <name>
```

Writes go through one function that rereads the file, appends, and refuses when the file changed since it was read.

### Store writes

One function in `store.ts` owns every write to a collection. It holds the collection's lock while it reads, checks and writes:

- **Lock.** The lock is the file `<store>/<collection>/.lock`, holding the owner's process number and a random token. A writer publishes it the same way as a new thread, below, so the lock appears only when complete and only if absent. A writer that finds a lock waits, polling every 10 ms, and gives up after 10 seconds with `Collection <name> is locked by process <n>`.
- **A lock left by a crashed process.** A lock whose process no longer exists is stale. The waiting writer moves it aside under a unique name and reads it back; when the moved file is the stale lock, it deletes it and takes the lock. When another writer replaced the stale lock meanwhile, it links that live lock back. If a third writer took the lock in that instant, two writers can hold it; that needs a crash and three concurrent writers. A lock whose process number was reused by a live process is not seen as stale; remove it by hand, see [Recovery](#recovery).
- **New files** (threads, `collection.yaml`, the lock) are written to a private draft beside the destination, `.<name>.<random>.tmp`, then published with a hard link that fails when the destination exists, and the draft is removed. A reader sees a complete file or none.
- **Appends** reread the thread under the lock, refuse when the caller named an older version, write a draft and rename it over the thread.
- **Creation** under the lock reads the collection, refuses an id or a question number that exists or repeats in the batch, then publishes each thread.
- Drafts and the lock start with a dot. Readers and the page's change notices ignore them, and every handled failure removes the draft it wrote.

### Local page and server

`serve` renders the documents with `renderSinglePage` and the md-collab extension, then listens on `127.0.0.1` and prints the address.

- Every request needs `Host` equal to the printed address, and writes also need `Origin` equal to it. A page from another site cannot write, and a site that rebinds its name to `127.0.0.1` is refused.
- There is no token. Any program on the same computer can write through the server; the operator accepted that on 2026-10-24 to keep the address simple.
- Annotation text is rendered through the same sanitizer as documents; raw HTML stays escaped.
- The page reads threads from `GET /api/state` and receives changes over server-sent events from `/api/events`: a store change, such as an agent's new question, reloads the threads, and a change to the documents re-renders the page and reloads it. The operator confirmed on 2026-10-24 that live updates are needed.
- The sidebar has the approved Questions view and the History view of the 2026-10-24 prototype. Comments on a text selection anchor to the selected blocks.

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

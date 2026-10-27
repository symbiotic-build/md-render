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

In a render with at least one extension, every rendered block element of a Markdown page carries two attributes. Folder and single-file exports, which take no extensions, write the same bytes as before this slice and do no block work. `renderSinglePage` and `renderView` return a view, so they always collect blocks, with or without extensions:

- `data-source-lines="72-73"`: the first and last source line of the block, from the parser's positions. One line is written `72-72`.
- `data-block="decimal~3f9a1c"`: the block ID.

A block is a `p`, `li`, `h1`–`h6`, `tr`, `pre`, `blockquote` or `figure` element. A Mermaid fence becomes a `figure` and its source `pre`, and both carry the fence's lines, with or without the diagram renderer. `FACT`: remark keeps each node's source position through `remark-rehype` and `rehype-sanitize`; a probe on this repository at `dd43046` printed `p:3-4 li:6-6 tr:11-11` for a small document.

A block ID is its section ID, `~`, and the first six hexadecimal digits of the SHA-256 of the block's whitespace-normalised text. The section ID is the ID of the nearest preceding heading, unless an explicit anchor stands before that heading: then the anchor names the section, as in the menu. A block before the first heading uses `top`. The maintained definition is md-render's [Blocks and extensions](../specs/md-render/reference.md#extension-reference). A second block with the same ID in the same document gets `-2`, a third `-3`. This is the client portal's block rule (portal design §3.3), adopted so both name blocks the same way. It keeps the ID when lines move and changes it when the block's text or its section heading changes.

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
  readonly documents: readonly {
    readonly path: string; readonly title: string;
    readonly markdown: string;         // the text md-render read and rendered
    readonly anchors: readonly string[]; readonly blocks: readonly Block[];
  }[];
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

`renderSinglePage` returns the single-file page without writing a file, for servers such as md-collab's. `renderView` returns only the view, for commands that find blocks but show no page; it reads no theme files, writes no page HTML and draws no diagrams. Both return the corpus root, so callers read the corpus once.

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
- **Entry:** one dated step in a thread: `raised`, `comment`, `answer`, `settled`, `reopened`, `withdrawn`, `kept-open` or `fix-requested`.
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
    block: decimal~3f9a1c
    snapshot: 9c1e4b7f0a2d5e8c3b6f1a4d7e0c3b6a9f2e5d8c1b4a7f0e3d6c9b2a5f8e1d4c
  - role: also
    path: docs/specs/memory-storage/decisions.md
    block: decision-bounded-decimal~8c01d2
    snapshot: 4f7a0d3c6b9e2f5a8d1c4b7e0a3f6d9c2b5e8a1f4d7c0b3e6a9d2f5c8b1e4a7d
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

- The front matter is YAML, and its field names are lower snake case, such as `settled_as`. A thread file is named `<id>.md`. A thread id, and so its file name, and a collection name are lower-case letters, digits and hyphens, starting with a letter or digit, such as `d1-decimal-schema-source`.
- The body has the context, then `## Options` and `## Entries`. Each entry starts with `### <time> <actor> <kind>`, then its fields (`Choice:`, `Source:`, `Settled as:`), one per line, then a blank line and the note. Fields start at the beginning of a line; the note keeps its leading whitespace, so a note line ` Choice: 2` stays note text. Every block (the context, an entry's heading, its fields and its note) is followed by one blank line, which belongs to the format; the context and notes keep their own leading and trailing whitespace, so indented code at the start of a context stays code.
- A line of context or note text that starts with `#`, `Choice: `, `Source: ` or `Settled as: `, after any number of backslashes, is written with one more backslash, inside fenced code too; reading removes exactly one. So no text can end a section or an entry or be read as a field, the parser never tracks fences, and an unclosed fence cannot swallow the entries. An option, a `Source:` value and a `Settled as:` value are one line, and no text holds a carriage return, which reading would turn into a line end; a write that breaks this is refused. An option is recommended exactly when its text says "(recommended)", since reading takes the recommendation from the text.
- `kind` is `comment` or `question` in this slice. A comment has no options, `decides` or `number`.
- `decides` is `operator`, `lead` or `measurement`. Every operator question has a `number`, unique in its collection; the page offers answers only for numbered questions. Lead and measurement questions have none.
- An anchor names one rendered block as it was when the anchor was written: its document in `path`, its block ID in `block`, and in `snapshot` the SHA-256 of the [snapshot](#store-layout) of that document's blocks, which holds the block's tag and text. A citation or a selection that covers several blocks gets one anchor per block, in document order; the first is the main passage when the citation or selection names the main passage, and the others are `also` (operator decision of 2026-10-27). A block counts when the citation's lines or the selection cover some of its text; a pure wrapper whose relevant text is fully covered by its descendants, such as a quote around its paragraphs, gives way to them. A containing block with selected text of its own beyond its covered descendants keeps its own anchor too; overlapping coverage is accepted (lead decision LD1, 2026-10-27). For example, a parent reading “Parent policy. Child policy.” and a child reading “Child policy.” keep both anchors. The renderer supplies blocks in document pre-order, with descendants following their parent inside its source lines. Line numbers and commits are not stored (operator decision of 2026-10-27, [Anchors name a block and its text](#decision-anchors-name-a-block-and-its-text)).
- The status comes from the entries: the last of `raised`, `reopened`, `answered`, `settled` and `withdrawn` decides it, and `comment`, `kept-open` and `fix-requested` entries never change it. `answer` makes it `answered`.
- `kept-open` records that the reader kept the thread open on its updated passages; the same write moves each updated anchor to its block as it reads now. `fix-requested` records that the reader sent the thread's changed passage to a fix run, which starts outside md-collab; agents read both with `md-collab list --json`.
- Only a `person:` actor writes an `answer`. An agent that records an answer the operator gave in chat writes it as the person with the line `Source: chat` in the entry.

### Settled decisions

md-collab reads `### Decision:` sections from the decision chapters a collection names in its `collection.yaml`, in the text and structure md-render rendered: a decision heading inside a code fence is none. Each becomes a read-only settled item: anchor = the anchor md-render gives its heading (an explicit anchor before it, in either quote form, or else the heading's own ID), date and decider from **Authority**. They are never written to the store; the specification remains their home.

- History shows each settled item's title, date and decider, and links to the decision's heading in the rendered page. Choice, Reason and Rejected alternatives are not copied into History; the reader reads them in place on the page.
- md-collab reads three fields: **Authority**, **Decided by** and **Date**. A field is a top-level paragraph of the section, in md-render's parse of that text, that starts with the bold field name and a colon. Code blocks, lists and quotes are never fields, so a fenced example that contains `**Authority:** Operator decision, 2030-01-01.` leaves the decision's own Authority as it is.
- A field's value is the rest of its paragraph as plain text: link text stays, link targets and other markup go, and a line break counts as a space. So `Lead`, a hard line break and `decision` read as "Lead decision".
- The date is the **Date** field when there is one, otherwise the latest ISO date in the Authority.

- The page names a settled item `<chapter path>#<anchor>`, because two chapters may use the same anchor.
- The decider is the explicit **Decided by** line when there is one. Otherwise the **Authority** text decides. An Authority that starts with "Lead decision", "Lead clarification" or "Lead proposal" names the lead alone, even when it also mentions a `Q<n>`, the operator or measurement: "Lead decision, 2026-10-14. The operator delegated Q152" names the lead. A decision that needs another attribution gets a **Decided by** line. In any other Authority, a `Q<n>` or `operator` names the operator, "lead decision", "lead clarification" or "lead proposal" names the lead, and `measurement` names measurement. Authority text that names none of them is refused with a request for a **Decided by** line, instead of being attributed to the operator.

### Anchor resolution

Anchoring follows the version diff, as git does when it carries review comments from one version of a file to the next (lead decision of 2026-10-27, after the operator asked for git-like behavior). Each render compares, once per snapshot that the threads' anchors name, the snapshot's block texts with the current document's block texts. The comparison is the array diff of the npm package `diff` (jsdiff), and each anchor takes the result for its block:

1. **Same.** The block's text is in both, matched by the diff. The anchor follows its block to its new place, also when blocks were inserted or removed around it or its section heading was renamed, and the page shows it as normal.
2. **Updated.** The block was removed in a hunk of the diff that also adds blocks. The hunk's removed blocks pair with its added blocks in order, and the anchor moves to its block's partner. The page flags it "updated" with jsdiff's word diff of the snapshot's text against the text now. The reader marks it done (a `settled` entry), keeps it open (a `kept-open` entry) or sends it to a fix run (a `fix-requested` entry). Keeping it open writes a new snapshot of the document as it reads now and moves each updated anchor to its block there, so the flag clears.
3. **Removed.** The block was removed and has no partner in its hunk. The page shows it as "removed" with the snapshot's text. The reader closes the thread (a `withdrawn` entry) or leaves a note for an agent (a `comment` entry). An added block without a partner pairs with no anchor.

A thread with both updated and removed passages shows both action groups. Above them, the page says “Settling or withdrawing applies to the whole thread.” Keeping it open moves only updated anchors; removed anchors stay flagged (lead decision LD2, 2026-10-27).

A snapshot that is missing or cannot be read, or that has no block with the anchor's ID, makes the anchor removed, and the page says which file it could not read instead of the old text; neither the page nor `check` stops. A settled or withdrawn thread no longer needs its passage, so the page shows no flag for it. `md-collab check` prints each updated and removed anchor of the other threads, with the reason when its snapshot cannot be read, and exits 1 when there is one.

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

1. **Prerequisites.** The documents are in a git checkout. The store is a folder outside that checkout's working tree; `import` and `serve` refuse a store inside it. The store is a git repository of its own (`git init <store>`), so a damaged thread file can be restored. md-collab never commits: the agent that imports commits the store after step 3, and again after each review session.
2. **Create the collection.** `init` writes `<store>/<collection>/collection.yaml` and prints `Created collection <name> in <store>`. It refuses a collection that exists. `--settled` names each decision chapter by its corpus path, for example `docs/specs/memory-storage/decisions.md`.
3. **Import the questions.** `import` reads a House Rules question list, anchors each citation to every rendered block with text that its lines cover, writes the snapshots those anchors name, and prints `Imported <n> questions into <collection>`, plus one line per citation kept as text because it names no rendered document. It refuses the whole list, before writing anything, when a question number repeats in the list or is already in the collection, or when a question holds a fenced code block, whose lines it would read as headings and options.
4. **Serve the page.** `serve` prints `md-collab: open http://127.0.0.1:<port>/` and runs until Ctrl+C. Ctrl+C during startup lets the first render finish and remove what it started, such as a diagram browser and its profile, and ends `serve` without printing the address. The operator answers there.
5. **Read the answers.** `list` prints one line per thread with its status and latest answer; `--json` prints the threads. `answer`, `comment` and `resolve` print `<id>: <kind> recorded; status <status>`.
6. **Check anchors.** `check` prints each updated or removed anchor of a thread that is not settled or withdrawn, and each missing settled chapter, and exits 1 when there is one; otherwise it prints `All anchors resolve`.

### Store layout

```text
<store>/<collection>/collection.yaml                     # title and settled chapters
<store>/<collection>/threads/<id>.md                     # one thread
<store>/<collection>/versions/<sha256>.json       # one document snapshot that anchors name
```

A snapshot is the JSON list of a rendered document's blocks, in document order, each with its `id`, `tag` and `text`, written with two-space indentation and a final line end. Its file name is the SHA-256 of the file's content in lower-case hexadecimal, followed by `.json`: `<sha256>.json`. The name stays bounded regardless of document nesting or Unicode paths. Each anchor retains the document's corpus path. Identical snapshots can share the same file. The store writes a document's snapshot whenever it writes an anchor on that document, at `import`, for a comment on a selection and for "Keep open", unless the same snapshot is already there. Each anchor names its snapshot by that SHA-256.

### Store writes

One function in `store.ts` owns every write to a collection. It holds the collection's lock while it reads, checks and writes:

- **Lock.** The lock is the file `<store>/<collection>/.lock`, holding the owner's process number and a random token. A writer creates it only if it is absent, and owns it from that moment: every way out from then on removes it, also when writing or closing the lock file fails. A writer that finds a lock waits, polling every 10 ms, and gives up after 10 seconds, measured on the monotonic clock, with `Collection <name> is locked by process <n>`. A lock that still names no process after the wait, left by a writer that crashed between creating it and writing its owner, is refused with `Collection <name> is locked by <lock file>, which names no process; if no md-collab command is writing, delete it`. A writer removes the lock when it finishes, and only when the lock still holds its own token. A lock that is already gone counts as removed; any other failure to remove it is reported to the caller as `Could not remove the lock <file>: <reason>`, after the failure of the write itself when there was one.
- **A lock left by a crashed process.** A lock whose process no longer exists is never taken over. A writer that finds one refuses at once with `Collection <name> is locked by process <n>, which no longer runs; if no md-collab command is writing, delete <lock file>`. A person or agent deletes the file by hand, see [Recovery](#recovery). A lock whose process number was reused by a live process looks held; remove it the same way.
- **New files** (threads, snapshots and `collection.yaml`) are written to a private draft beside the destination, `.<name>.<random>.tmp`, then published with a hard link that fails when the destination exists, and the draft is removed. A reader sees a complete file or none.
- **Snapshots** are written under the lock, after the write's other checks and before its thread. A write is refused, before anything is written, when an anchor names a snapshot that the write does not bring and the store does not have. A snapshot that is already there with the same content counts as written; one whose content differs from its name is refused with its path.
- **Appends** reread the thread under the lock, refuse when the caller named an older version, write a draft and rename it over the thread.
- **Creation** under the lock refuses an id that exists or repeats in the batch, then publishes each thread. Only a batch with question numbers reads the collection's threads, to refuse a number that exists or repeats; a comment checks only its own file name.
- Drafts and the lock start with a dot. Readers and the page's change notices ignore them, and every handled failure tries to remove the draft it wrote.

### Store invariants

Each invariant names the failure it prevents and the test that checks it at the store's boundary.

| Invariant | Prevents | Test |
| --- | --- | --- |
| An acknowledged entry stays in its thread, whatever other writers do. | Two concurrent appends both report success and one entry is lost. | [keeps every entry when many writers append to one thread at once](../../packages/md-collab/test/collab.test.ts) |
| A question number names one thread in its collection. | A repeated number in one import, or two concurrent imports, make the collection unreadable. | [refuses a repeated question number in a batch or in the collection and writes nothing](../../packages/md-collab/test/collab.test.ts) |
| A write refused by a check (an old version, an existing id or question number) changes nothing. A write that fails on a filesystem error tries to remove its own draft and lock; an import that fails part-way keeps the complete threads it published before the failure, see [Recovery](#recovery). That cleanup can fail as well: a draft left behind is ignored by readers, and a lock left behind is reported with its path and refuses later writes until it is deleted. The write may have been published before the cleanup failed. A crashed writer can leave a draft and its lock in the same way. | A conflict or a repeated id blocks or corrupts later writes; two writers enter after a crash. | [appends entries and refuses a write against an old version](../../packages/md-collab/test/collab.test.ts), [leaves no draft or lock behind when a write is refused, and refuses to write past a lock left by a crashed process](../../packages/md-collab/test/collab.test.ts), [reports a lock it could not remove after a write, and leaves it for the documented repair](../../packages/md-collab/test/collab.test.ts) |
| A thread file reads back as the thread written, whatever its text. | A note that starts like a field or a heading changes an answer or makes the thread unreadable. | [writes and reads a thread file without loss, and derives status from its entries](../../packages/md-collab/test/collab.test.ts) |
| The store is outside the documents' working tree. | Annotations ride on the documents' branches. | [refuses a store inside the documents' working tree](../../packages/md-collab/test/collab.test.ts) |
| A snapshot is written once and never changed: a second write of the same content leaves the file as it is. | An anchor's old text, and so its diff, changes after the anchor was written. | [writes each snapshot once, and refuses a thread whose anchor names a snapshot the store does not have](../../packages/md-collab/test/collab.test.ts) |
| An anchor names a snapshot that is in the store. | A thread whose passage can never be found again. | [writes each snapshot once, and refuses a thread whose anchor names a snapshot the store does not have](../../packages/md-collab/test/collab.test.ts) |
| md-collab never deletes a snapshot, also when "Keep open" moves every anchor off it. | A thread restored from the store's git history names a snapshot that is gone. | [records "%s" on a commented passage whose words changed](../../packages/md-collab/test/collab.test.ts) |

### Local page and server

`serve` renders the documents with `renderSinglePage` and the md-collab extension, then listens on `127.0.0.1` and prints the address.

- Every request needs `Host` equal to `127.0.0.1:<port>`, the printed address, or `localhost:<port>`, both names of this computer. Writes also need `Origin` equal to `http://` and that Host. A page from another site cannot write. A site that points its own name at `127.0.0.1` is still refused, because the browser sends that site's name as the Host.
- There is no token. Any program on the same computer can write through the server; the operator accepted that on 2026-10-24 to keep the address simple.
- Annotation text is rendered through the same sanitizer as documents; raw HTML stays escaped.
- The page reads threads from `GET /api/state` and receives changes over server-sent events from `/api/events`: a store change, such as an agent's new question, reloads the threads, and a change to the documents re-renders the page and reloads it. The operator confirmed on 2026-10-24 that live updates are needed.
- The server uses no file watches. Every second it reads with one `stat` the modification time, change time, inode and size of each Markdown file under the documents' git working tree, or under the selected folder when it is not in git, outside `.git` and `node_modules`, and of each thread file in the store's `threads` folder; drafts and the lock start with a dot and are not thread files. A file whose four values changed is a change, so an editor that saves by writing a new file and renaming it over the old one is seen even when the new file keeps the modification time and the size (lead decision, 2026-10-27). A Markdown file that changed, appeared or disappeared starts the normal re-render, which sends `reload`. A thread file that changed, appeared or disappeared sends `changed`. That folder is found without reading a document, so startup reads each document once, in the first render; the store check uses the root that render returns. The server records the documents' values before the first render and again whenever a check finds a change, before the render it starts reads its files, so an edit made during a render starts the next one. A folder that cannot be read, or that disappears during the check, is skipped and never stops the server. The page loads every thread when it connects. One second is the checking interval, not a promise of when a page shows a change.
- One render runs at a time; a change during a render starts one more after it. A render publishes its page, view and settled decisions together, and only when it succeeds; it takes the settled decisions from the text it rendered, which the view carries, so History always describes the page's text. A failed render keeps the last good page and sends `failed` with the error. Every state carries the last failure until a render succeeds, and the page shows it, so the warning stays when threads change and after a reload or a reconnection. Stopping the server stops the checks, starts no further render and waits for the check and the render running. The checks start only after the server listens, so a start that fails leaves none running.
- The page loads the threads at start and each time the event stream opens, so a reconnection catches up on writes it missed. Every page and every state carry the identity of the render they come from, random for each render, so renders of a restarted server never match an older page; a page whose render differs from the state's reloads before it shows the state, so a reconnection also catches up on a render it missed, also from a server restarted on the same port. One state request runs at a time, so an older response never replaces a newer one. Every write names the render its page shows. The server checks a comment and a `kept-open` choice, which name passages, against one current render and refuses one from an older render with 409, so a page that missed a re-render cannot attach a comment to text it never showed. A page that stops reading the stream is disconnected and catches up when it reconnects.
- A change that arrives while the reader types a note in the list updates the counts at once and redraws the list when the focus leaves the sidebar, also when it moves from the note to a button in the sidebar first; notes being written survive the redraw. The comment box for selected text is not in the list, so typing there never holds a redraw back. A save clears a note's draft only when the draft still holds the text that was saved; a comment save closes and empties the comment box only when it still holds the saved text and passage.
- The sidebar has the approved Questions view and the History view of the 2026-10-24 prototype. A comment on a text selection anchors to each block the selection covers in the chapter where it starts, the first as the main passage.
- A thread's main passage keeps the yellow highlight. Its other cited passages get a light dotted underline in the theme's pen colour and no fill, also while the thread is open (operator decision of 2026-10-27).
- A question or comment card with more than one cited passage has a previous and a next button, shown as `<` and `>` and named "Previous passage" and "Next passage", and the position beside them, such as "2 of 4". They move through the thread's passages in order, main first, with `mdRender.show({ path, block })`, and stop at the first and the last. A card with one passage shows neither the buttons nor the count (operator decision of 2026-10-27).

## Recovery

What each refusal leaves behind, who acts and how.

| Situation | What is left | Who acts | Repair |
| --- | --- | --- | --- |
| `import` stopped part-way, by a crash or a disk error | The questions published before the stop; each is complete. | The agent that imported | `list` shows the imported numbers. Remove those questions from the question file, or keep a copy with only the rest, and import again. A repeated number refuses the whole import, so nothing is imported twice. |
| `Thread <id> changed since it was read` | The thread with the other writer's entry. | The page reloads; the reader repeats the change. | None in the store. |
| `Collection <name> is locked by process <n>` | A lock file held by process `<n>`. | The writer | Retry. If process `<n>` is not an md-collab command, its number was reused after a crash: delete `<store>/<collection>/.lock`. |
| `Could not remove the lock <file>: <reason>; the change may be saved. …` | The lock file; the change itself may be published. Every write to the collection is refused until the lock is gone. | The person or agent that sees the message | Read the thread or `list` to see whether the change is there. Check that no md-collab command is writing, delete the named lock file, and repeat the change only if it is missing. A failure to remove a draft leaves a `.<name>.<random>.tmp` file, which readers ignore; delete it when no write runs. |
| `Collection <name> is locked by <lock file>, which names no process; …` | The lock file of a writer that crashed before it wrote its process number. Every write to the collection is refused. | The person or agent that sees the message | Check that no md-collab command is writing to the collection, then delete the named lock file and repeat the write. |
| `Collection <name> is locked by process <n>, which no longer runs; …` | The lock file `<store>/<collection>/.lock` of a crashed writer. Every write to the collection is refused. | The person or agent that sees the message | Check that no md-collab command is writing to the collection, then delete the named lock file and repeat the write. |
| A thread file that does not parse, or a repeated question number from a hand edit | The file; every read of the collection fails and names it. | Whoever edited the store | Fix or remove the named file in the store's git checkout, for example with `git checkout -- <file>`. A restore brings back the last committed version, so entries written since that commit are lost; repeat them from `list` output or the page if they matter. |
| A passage shows as removed because its snapshot `versions/<file>` cannot be read | The thread, unchanged. | Whoever edited the store | Restore the named file from the store's git checkout, for example with `git checkout -- <file>`. The passage shows again at the next state load. |
| `check` reports an updated or removed anchor | The thread, unchanged; the page flags the passage. | The reader on the page; for a `fix-requested` entry or a note, an agent | The reader marks it done, keeps it open, sends it to a fix run, closes it or leaves a note. An agent that reads a `fix-requested` entry or a note fixes the document or answers with a `comment`. |
| `Thread <id>: only a person writes an answer` | Nothing written. | The agent that tried to answer | Leave the answer to the person. When the person answered in chat, record it as that person: `answer <id> --by person:<login> --source chat`. |
| `Extension <name> failed: <message>` | Nothing written. `serve` does not start; during a re-render the last good page stays. | The extension's maintainer; for `md-collab`, whoever installed it | Fix the extension the message names. For `md-collab`, rebuild or reinstall the package so its sidebar files are the shipped ones. |
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

**Reason:** One rule for both systems; the ID survives line moves and changes when the text changes, which is when the page shows an anchor's passage as updated.

**Rejected alternatives:** Line numbers only, which break on every edit above the block. Sequential block numbers, which shift when a block is inserted.

### Decision: anchors name a block and its text

**Choice:** A comment or question stores its block's ID and the block's exact text when it was written, the text in a write-once snapshot of its document. A block whose text is unchanged shows as normal. The same block with changed text stays attached and is flagged "updated" with a word-level diff of the old text against the new; the reader marks it done, keeps it open or sends it to a fix run. A block that is gone shows as "removed" with its old text; the reader closes the question or leaves a note for an agent. Line numbers are no longer used. Which block is the same block, and which is the same block with changed text, follows a block diff of the snapshot against the document now, see [Anchor resolution](#anchor-resolution).

**Authority:** Operator decision, 2026-10-27. The version diff over snapshots is a lead decision of 2026-10-27, after the operator asked for git-like behavior; it replaces the lead proposal of the same day that matched a block by its tag and position in its section.

**Reason:** A commit names a revision, not the text a working tree held, so line numbers could attach a comment to unrelated text. The reader judges a changed passage better than a quote search does.

**Rejected alternatives:** A quote search, then the lines at the same commit, which attached comments to unrelated text after an uncommitted edit. The block of the same tag at the same position in the same section, which lost a block whose section heading was renamed and paired a block with an unrelated one after an insertion above it.

## Size

`ESTIMATE`: md-render, 4 source files changed and about 300 lines, plus spec sections and tests. md-collab, about 10 source files and 1 500 lines, plus tests.

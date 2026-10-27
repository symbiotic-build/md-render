# md-collab

Read Markdown documents with their open questions, earlier decisions and comments in a sidebar, and answer in place. Agents raise questions and read the answers with the same tool, from the command line.

md-collab renders documents with [md-render](../../README.md) and never changes them. Annotations live in a separate store: one Markdown file per thread, in a git repository of their own, so agents in worktrees and read-only reviewers never write into the documents' branches.

The design and its decisions are in [docs/design/collab-first-slice.md](../../docs/design/collab-first-slice.md).

## Start

```sh
git init ~/annotations
md-collab init --store ~/annotations --collection memory-storage --title "Memory storage spec" \
  --settled docs/specs/memory-storage/decisions.md
md-collab import questions.md path/to/repository/docs --store ~/annotations --collection memory-storage --by agent:claude-code/session-1
git -C ~/annotations add -A && git -C ~/annotations commit -m "Import memory-storage questions"
md-collab serve path/to/repository/docs --store ~/annotations --collection memory-storage --person person:your-login
```

The store is a git repository of its own, so a damaged thread file can be restored from it. md-collab writes files and never commits: the agent that imports commits the store after the import, and commits again after each review session. Git restores only what was committed, so answers and comments written since the last commit are lost by a restore.

The store must be a folder outside the documents' git working tree; `import` and `serve` refuse one inside it. `serve` prints a `127.0.0.1` address. Open it in a browser on the same computer. `serve` checks the store and the documents once a second. What agents add then appears in the open page, and an edit to the documents, also one saved by renaming a new file over the old one, refreshes it.

- **Questions for you** lists the operator questions. Choosing an option saves an answer; "Save note" saves the note with it.
- **History** lists every question, lead and measurement item, comment and settled decision, newest first, with filters for who decides, status, topic and chapter.
- Selecting text and choosing **Comment** adds a comment thread on each block the selection covers; the first is its main passage. A thread with several passages has `<` and `>` buttons that move between them.
- A thread whose passage changed shows it as **updated**, with the changed words, or **removed**, with its old text. The reader marks it done, keeps it open or sends it to a fix run, or closes it or leaves a note for an agent.

Answers and comments are written to the store at once. An agent sees them with `md-collab list`.

## Commands for agents

Every command also needs `--store <dir>` and `--collection <name>`; the forms below leave them out.

- `import <questions.md> <documents>`: turns a House Rules question list (`### 1\. Title`, context, numbered options with one "(recommended)") into question threads. Each `[file.md:72-73](link)` citation, in the context or an option, becomes one anchor on each rendered block with text that its lines cover. A line `Main passage: [file.md:72](link)` names the main passage; otherwise it is the first citation outside the settled chapters. A question number that repeats in the list or is already in the collection refuses the whole list. So does a fenced code block in a question; cite an example in the documents instead.
- `list [--status answered] [--json]`: threads with their status and latest answer.
- `answer <id> --by person:<login> --choice <n> [--note <text>] --source chat`: records an answer the person gave in chat. Only a person answers.
- `comment <id> --by <actor> --note <text>`: adds a comment to a thread.
- `resolve <id> --by <actor> --settled-as <path#anchor>`: marks a question settled by a decision in the specification.
- `check <documents>`: exits 1 and lists every updated or removed anchor of a thread that is not settled or withdrawn.

An actor is `person:<login>` or `agent:<product>/<session>`.

## Store layout

```text
<store>/<collection>/collection.yaml        # title, and the decision chapters to read
<store>/<collection>/threads/<id>.md        # one thread: YAML front matter, context, options, entries
<store>/<collection>/versions/<path>~<sha256>.json  # a write-once snapshot of a document's blocks, which anchors name
<store>/<collection>/.lock                  # present while a command writes; names its process
```

Every write holds the collection's lock, so concurrent agents never lose each other's entries. What to do after an interrupted import or a refused write is in the design's [Recovery](../../docs/design/collab-first-slice.md#recovery) section.

Settled decisions are read from the `### Decision:` sections of the chapters `collection.yaml` names. They stay in the specification and are never copied into the store.

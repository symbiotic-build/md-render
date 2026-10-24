# md-collab

Read Markdown documents with their open questions, earlier decisions and comments in a sidebar, and answer in place. Agents raise questions and read the answers with the same tool, from the command line.

md-collab renders documents with [md-render](../../README.md) and never changes them. Annotations live in a separate store: one Markdown file per thread, in a git repository of their own, so agents in worktrees and read-only reviewers never write into the documents' branches.

The design and its decisions are in [docs/design/collab-first-slice.md](../../docs/design/collab-first-slice.md).

## Start

```sh
md-collab init --store ~/annotations --collection memory-storage --title "Memory storage spec" \
  --settled docs/specs/memory-storage/decisions.md
md-collab import questions.md path/to/repository/docs --store ~/annotations --collection memory-storage --by agent:claude-code/session-1
md-collab serve path/to/repository/docs --store ~/annotations --collection memory-storage --person person:your-login
```

`serve` prints a `127.0.0.1` address with a session token. Open it in a browser on the same computer.

- **Questions for you** lists the operator questions. Choosing an option saves an answer; "Save note" saves the note with it.
- **History** lists every question, lead and measurement item, comment and settled decision, newest first, with filters for who decides, status, topic and chapter.
- Selecting text and choosing **Comment** adds a comment thread on that passage.

Answers and comments are written to the store at once. An agent sees them with `md-collab list`.

## Commands for agents

- `import <questions.md> <documents>`: turns a House Rules question list (`### 1\. Title`, context, numbered options with one "(recommended)") into question threads. Each `[file.md:72-73](link)` citation becomes an anchor. A line `Main passage: [file.md:72](link)` names the main passage; otherwise it is the first citation outside the settled chapters.
- `list [--status answered] [--json]`: threads with their status and latest answer.
- `answer <id> --by person:<login> --choice <n> [--note <text>] --source chat`: records an answer the person gave in chat. Only a person answers.
- `comment <id> --by <actor> --note <text>`: adds a comment to a thread.
- `resolve <id> --by <actor> --settled-as <path#anchor>`: marks a question settled by a decision in the specification.
- `check <documents>`: exits 1 and lists every anchor whose text is no longer found.

An actor is `person:<login>` or `agent:<product>/<session>`.

## Store layout

```text
<store>/<collection>/collection.yaml        # title, and the decision chapters to read
<store>/<collection>/threads/<id>.md        # one thread: YAML front matter, context, options, entries
```

Settled decisions are read from the `### Decision:` sections of the chapters `collection.yaml` names. They stay in the specification and are never copied into the store.

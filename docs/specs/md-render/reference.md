<a id="reference"></a>
# Reference

Use these lookups after the tour to connect public arguments, metadata and diagnostics to their implementation owners.
md-render reads the metadata fields needed for rendering.
A separate authoring checker validates the complete specification format; rendering alone does not establish that validation.

<a id="command-reference"></a>
## Command and API

These entry points share source parsing and rendering; local-reference behavior depends on the API or command options.
Use Node.js 22 or later with the package dependencies already installed.
SVG diagram builds also need the pinned Mermaid package and an installed Chromium browser; source-only display needs neither.

```sh
node dist/cli.js <Markdown-file-or-folder-or-repository> [--out <empty-directory>] [--single-file <path.html>] [--theme <name-or-css-path>] [--max-linked-file-bytes <bytes>]
```

The command accepts exactly one positional input.
`--help` or `-h` prints usage.
`--out` selects retained folder export plus a [single-file export](serving-and-export.md#single-file-export).
`--single-file` selects an explicit HTML destination, alone or alongside `--out`.
With neither option, the command starts the [temporary viewer](serving-and-export.md#temporary-viewer).
`--theme` accepts `symbiotic`, `default` or a local CSS path.

The optional environment variable `MD_RENDER_BROWSER` selects an installed Chromium executable for diagram builds.

The package exports `loadCorpus`, `parseDocument`, `documentHtml`, `renderSite`, `exportSite`, `renderSinglePage`, `renderView` and `startViewer` from [src/index.ts](../../../src/index.ts).
`renderSite(input, output, options)` returns directory, pages, checked local-link count, Mermaid availability and warnings.
It retains [local-reading behavior](serving-and-export.md#single-file-export), including links to original local files.
Its options include `theme?: string` and `mermaid?: boolean`.
Retained exports additionally accept the versioned [bundle policy](#bundle-reference).

`exportSite(input, { out?, singleFile? }, options)` writes the requested exports and returns the rendering summary plus `singleFile` and `bytes`.
It produces portable retained output with [bundled local references](serving-and-export.md#bundled-local-references).

`startViewer(input, options)` adds a local URL and asynchronous `close()`.
Both report failures by rejecting their promises.
The CLI prints each warning and reports unavailable Mermaid explicitly.

<a id="extension-reference"></a>
## Blocks and extensions

In a render with at least one extension, every Markdown block, a `p`, `li`, `h1`–`h6`, `tr`, `pre`, `blockquote` or `figure` element, carries two attributes. Without extensions the output bytes are unchanged and no block work is done.

`data-source-lines="3-4"` names its first and last source line. `data-block` names its block ID: the nearest heading's ID, `~` and six hexadecimal digits of the SHA-256 of its whitespace-normalised text. An explicit anchor before a heading names that section instead of the heading's own ID. A repeated ID in one document gets `-2`, `-3`. Plain-text source pages keep their `L<n>` line IDs and have no blocks. In a single page with extensions, each chapter's section carries `data-source-path` with the document's corpus path.

`renderSinglePage(input, options, extensions)` accepts `extensions`, a list of `{ name, prepare(view) }`; the folder and file exports take none. A name matches `[a-z][a-z0-9-]*` and is unique. `prepare` runs once, after every page is rendered and before the page is written. It receives the documents in reading order with their path, title, anchors and blocks, frozen, so no extension changes what a later one sees. It returns optional `styles`, `script`, `data` and `connect`.

md-render embeds the style, the JSON data and the inline script in the page, and adds the script's SHA-256 hash to the page policy. `connect: true` allows requests to the page's own origin. A failing `prepare` stops the render with `Extension <name> failed: <message>`, and a script that contains `</script` is refused.

`renderSinglePage` returns `{ html, view, root, warnings }` without writing a file; `root` is the corpus root. `renderView(input, options)` returns `{ view, root, warnings }` without building a page.

Page scripts of a single page with extensions use the frozen global `mdRender`, version 1. `documents()` lists path and title, and `currentDocument()` names the shown document. `blocks(path, first, last)` and `block(path, id)` return shown elements. `show({ path, block?, anchor? })` opens a document of the page and scrolls to the target, resolving to the element or null. `onNavigate(listener)` reports the shown document after it changes, and `extensionData(name)` returns an extension's data.

<a id="selector-reference"></a>
## Selector execution

Acceptance selectors connect each executable case to results from the normal Vitest run.
[docs/DOCUMENTS.json](../../DOCUMENTS.json) declares `pattern: "test/*.test.ts"`, `kind: "junit"` and `reports: ["reports/vitest.xml"]`.
Its `testcase` mapping is `{"classname": "{file}", "name": "{selector}"}`.
Vitest writes the repository-relative file path in `classname` and the full `describe > test name` in `name`.

Each Implementation label contains the exact full name, preserving spaces, punctuation and parameter values.
For example, `follows manifest section order and deduplicates files` identifies that exact test in `test/renderer.test.ts`.
Parameterized cases cite each expanded name separately.
A match passes only without failure, error or skipped children; no match is missing.

**Procedure: verify acceptance evidence**

1. **Generate results:** run `pnpm test:report` with standard input closed.
   This runs the normal suite with default and JUnit reporters, writing `reports/vitest.xml`.
2. **Audit results:** run the pinned House Rules `audit_selectors.py --root . --report reports/vitest.xml` after `spec_docs.py check --root .`.
   Acceptance requires zero missing and zero failing citations.

`pnpm test` remains `vitest run` without report output.
[vitest.config.ts](../../../vitest.config.ts) sets test and hook limits to 60 seconds as runaway guards; tests should finish in seconds.
Assertion-level timing checks retain their behavioral bounds.
Reports are ignored, rebuildable run artifacts; they must come from the candidate being checked.

Without explicit or declared reports, the audit calls the manifest's `batch` command once with `{report}` and all `{selectors}`.
[scripts/vitest-batch.mjs](../../../scripts/vitest-batch.mjs) runs the complete cited files in one Vitest invocation and writes JUnit to that report path.
The shared audit matches exact cited names afterward, so missing or skipped cases cannot pass.
The adapter supplies EOF on standard input and propagates startup errors, signals and nonzero exits.
It installs no dependencies and starts no process per selector.

<a id="metadata-reference"></a>
## Metadata lookup

This table names the renderer's consumed JSON fields; full authoring metadata for this specification lives in [docs/DOCUMENTS.json](../../DOCUMENTS.json) and [docs/ENTITIES.json](../../ENTITIES.json).
A [document manifest](selecting-sources.md#document-manifest) controls selection, not merely an inventory listing.
An [entity index](selecting-sources.md#entity-index) resolves home sections before rendering reads their definitions.

| Object | Field | Meaning |
|---|---|---|
| Both envelopes | `version` | Supported integer version |
| Manifest | `inventory[]` | Classified paths |
| Inventory entry | `path`, `kind` | Path and classification |
| Manifest | `documents[]` | Ordered document groups |
| Document | `id`, `title?` | Identity and group label |
| Document | `sections[]` | Ordered section entries |
| Document | `navigation.path?` | Additional navigation file |
| Section | `id`, `path`, `anchor` | Section lookup and destination |
| Section | `summary?`, `title?` | Map metadata |
| Entity envelope | `entities` | Identity-keyed definitions |
| Entity home | `section`, `anchor` | Section selector and target |

The renderer requires nonempty strings for consumed path and identity fields.
It accepts envelope version `1` and the four inventory classifications described at the manifest's home.
It does not validate every House Rules metadata field or reject all unknown fields and duplicate JSON keys.
Checked authoring metadata therefore needs the shared specification checker as a separate gate.

In the tour, `demo#home` means document identity `demo`, section identity `home`.
It resolves to `chapters/nested/home.md`; `writer` identifies the definition within that file.
The [test/fixtures/corpus/docs/DOCUMENTS.json](../../../test/fixtures/corpus/docs/DOCUMENTS.json) and
[test/fixtures/corpus/docs/ENTITIES.json](../../../test/fixtures/corpus/docs/ENTITIES.json) preserve the exact input example.

For a new runtime input, place the following manifest under `docs/DOCUMENTS.json`.
It selects one chapter, whose title anchor is `guide`.
This example supplies the renderer's consumed fields; a checked specification additionally needs the full authoring metadata shown by this document's linked metadata files.

```json
{
  "version": 1,
  "inventory": [{"path": "guide.md", "kind": "specification"}],
  "documents": [{
    "id": "guide",
    "title": "Guide",
    "sections": [{"id": "body", "path": "guide.md", "anchor": "guide"}]
  }]
}
```

**Entities in this example:** [Document manifest](selecting-sources.md#document-manifest).

The accompanying `docs/ENTITIES.json` binds the Writer definition to that section.
`guide#body` combines the document and section identities; `writer` names the anchor within the selected chapter.

```json
{
  "version": 1,
  "entities": {
    "guide.writer": {"home": {"section": "guide#body", "anchor": "writer"}}
  }
}
```

**Entities in this example:** [Entity index](selecting-sources.md#entity-index).

The chapter `guide.md` supplies both targets and their definition text.
Rendering `[Writer](#writer)` keeps its fragment and adds the paragraph as hover text.

```markdown
<a id="guide"></a>
# Guide

Read the [Writer](#writer) definition.

<a id="writer"></a>
## Writer

The writer checks prepared requests before accepting them.
```

<a id="anchor-reference"></a>
## Anchor and navigation markers

These encodings distinguish supported empty anchors from escaped HTML.
Use this comparison to choose the example below; paragraph and block boundaries affect how the Markdown parser groups tags.

| Form | Other markup | Targets retained | Outline target |
|---|---|---|---|
| Anchor-only block | None | All anchors | Last anchor |
| All-HTML paragraph | `<br>` | All anchors | First anchor |
| Mixed HTML block | `<div>` | None | Generated heading |

Heading-generated identifiers use parsed heading text converted to lower case.
The base retains Unicode letters, numbers, combining marks, underscores, hyphens and whitespace; it removes other characters.
Each whitespace character becomes a hyphen; consecutive whitespace is not collapsed.
For example, Café becomes `café`, while A.b becomes `ab`.
The [collision rule](resolving-content.md#links-and-anchors) adds suffixes when a target already exists.

```markdown
<a id="first-home"></a>
<a id="last-home"></a>

## Definition

The definition paragraph supplies hover text for both anchors.
```

Fragments are percent-decoded, then matched against identifiers with exact case-sensitive equality.
The URL query does not participate in that lookup.

In an anchor-only block, all identifiers survive and the menu uses `last-home`.
Single- and double-quoted IDs are accepted; whitespace before a closing tag is accepted.
The three HTML forms below differ by whether anything other than empty anchor tags shares their block or paragraph.
In a paragraph containing only HTML tags, a non-anchor tag leaves the first anchor as the menu destination.
A mixed HTML block is escaped as a whole instead of extracting its anchor targets.

For an all-HTML paragraph, both anchors below remain link targets and `<br>` appears as escaped text.
The menu uses `first`, and only `first` receives the definition paragraph as its hover meaning.

```markdown
<a id="first"></a><br><a id="second"></a>

## Definition

Meaning.
```

The following mixed block instead appears entirely as escaped text.
Neither `first` nor `second` becomes a link target; only the generated `definition` heading target exists.

```markdown
<a id="first">
</a>
<a id="second"></a>
<div>Other HTML</div>

## Definition

Meaning.
```
Duplicate explicit IDs fail; generated heading IDs avoid both explicit and previous generated IDs.

This generated section lists terms derived from the JSON input; the JSON file itself does not appear in the article.

**Entities in this example:** [Entity index](selecting-sources.md#entity-index).

```markdown
<!-- spec-docs:navigation document="book" -->

## Overview

Retained prose.

## Document map

Omitted chapter list.

## Entity index

Retained terms.

<!-- /spec-docs:navigation -->
```

Only an exact complete marker pair activates omission of the level-two Document map subtree.
Different quoting, extra marker attributes, incomplete pairs, code-fenced markers and other heading depths do not activate that rule.
Original heading IDs, explicit anchors and shared reference definitions survive omission.
The retained Entity index heading introduces a term list generated from the [entity index](selecting-sources.md#entity-index) JSON input.

<a id="state-reference"></a>
## State and output lookup

These locations separate rebuildable files from browser preferences.

| Location | Content | Lifetime |
|---|---|---|
| Source root | Markdown, metadata, images | Author-owned |
| Output root | HTML and copied images | Mode-dependent |
| `_md-render/` | CSS, navigation script, logo | Rebuildable output |
| Browser storage | `md-render-menu-expanded` | Desktop menu preference |
| Browser storage | `md-render-theme` | Explicit colour preference |
| Temporary browser profile | Diagram build session | Build-scoped |

The menu preference stores the strings `true` or `false`.
The colour preference stores `light` or `dark`; absence means System.
No separate entity-meaning registry is persisted.
An output page preserves its path relative to the resolved source root, with `.md` changed to `.html`.
For example, a nested selected file at `nested/one.md` becomes `nested/one.html` when the repository is its source root.

<a id="diagnostic-reference"></a>
## Diagnostics and recovery lookup

This lookup points each failure family to its complete retained-state and recovery explanation.

| Diagnostic fragment | Recovery home |
|---|---|
| `unsupported version` | [Source refusal](serving-and-export.md#failure-source-input) |
| `symlink` / `Symbolic link` | [Source refusal](serving-and-export.md#failure-source-input) |
| `Missing anchor` | [Unresolved definition](serving-and-export.md#failure-definition) |
| `unknown home section` | [Unresolved definition](serving-and-export.md#failure-definition) |
| `first paragraph` | [Unresolved definition](serving-and-export.md#failure-definition) |
| `Duplicate anchor` | [Unresolved definition](serving-and-export.md#failure-definition) |
| `Unsupported link` | [Content refusal](serving-and-export.md#failure-content-build) |
| `Build-time Mermaid needs` | [Content refusal](serving-and-export.md#failure-content-build) |
| `must be empty` | [Output refusal](serving-and-export.md#failure-output-startup) |

In temporary local-reading mode, an external local reference warns and links to the original file.
Retained exports instead follow [Bundled local references](serving-and-export.md#bundled-local-references).
A browser-storage failure is a console warning with a current-page preference, not a build refusal.

<a id="bundle-reference"></a>
## Bundle policy and source-line fragments

The retained-export policy bounds each additional linked file before reading its bytes.
It does not cap initially selected documents or the total export size.

| Surface | Field | Default | Valid values |
|---|---|---|---|
| API `options.bundle` | `version` | `1` | `1` |
| API `options.bundle` | `maxFileBytes` | `5000000` | Nonnegative safe integer |
| CLI | `--max-linked-file-bytes` | API default | Decimal byte count |

The default is 5 MB in decimal bytes. A file exactly at the limit is bundled; a larger file is visibly omitted with its exact size.
Invalid configuration rejects before output is written.
The [retained export](serving-and-export.md#bundled-local-references) uses this same policy for both destinations.

Code-page fragments accept `#L42` and `#L10-L20`, with positive decimal line numbers and no leading zeros.
The ending line must be at least the starting line, and both must exist.
A range URL resolves to the first line's anchor, such as `#L10`.
CRLF and CR normalize to LF; a terminal newline does not create an additional numbered line.
An empty text file has one empty line.

Unsupported or out-of-range fragments authored in input pages reject visibly.
In bundled references, invalid fragments instead warn and link to the destination top, following [reference fragment validation](decisions-and-questions.md#bundle-fragment-choice).

Other byte sequences become binary downloads; the single file uses `application/octet-stream` for unknown types.
Generated reference destinations live beneath the reserved `_md-render/references/` output directory and never contain absolute source paths.

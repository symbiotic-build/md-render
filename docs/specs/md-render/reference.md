<a id="reference"></a>
# Reference

Use these lookups after the tour to connect public arguments, metadata and diagnostics to their implementation owners.
md-render reads the metadata fields needed for rendering.
A separate authoring checker validates the complete specification format; rendering alone does not establish that validation.

<a id="command-reference"></a>
## Command and API

These entry points produce the same rendered site in either output mode.
Use Node.js 22 or later with the package dependencies already installed.
SVG diagram builds also need the pinned Mermaid package and an installed Chromium browser; source-only display needs neither.

```sh
node dist/cli.js <Markdown-file-or-folder-or-repository> [--out <empty-directory>] [--theme <name-or-css-path>]
```

The command accepts exactly one positional input.
`--help` or `-h` prints usage.
`--out` selects retained export; its absence selects the [temporary viewer](serving-and-export.md#temporary-viewer).
`--theme` accepts `symbiotic`, `default` or a local CSS path.
The optional environment variable `MD_RENDER_BROWSER` selects an installed Chromium executable for diagram builds.

The package exports `loadCorpus`, `parseDocument`, `documentHtml`, `renderSite` and `startViewer` from [src/index.ts](../../../src/index.ts).
`renderSite(input, output, options)` returns directory, pages, checked local-link count, Mermaid availability and warnings.
Its options are `theme?: string` and `mermaid?: boolean`.
`startViewer(input, options)` adds a local URL and asynchronous `close()`.
Both report failures by rejecting their promises.
The CLI prints each warning and reports unavailable Mermaid explicitly.

<a id="selector-reference"></a>
## Selector execution

Acceptance selectors let the shared audit execute the same Vitest cases as the package test command.
[docs/DOCUMENTS.json](../../DOCUMENTS.json) declares `test/*.test.ts` with command arguments `node`, `scripts/vitest-selector.mjs`, `{file}` and `{selector}`.
The audit substitutes the test file and selector as separate arguments without shell interpretation.

The selector is a URI-encoded regular expression matched against the full Vitest test name.
Encoding keeps spaces and punctuation intact within the whitespace-free Implementation label.
For example, `follows%20manifest%20section%20order%20and%20deduplicates%20files%24` decodes to `follows manifest section order and deduplicates files$`.
The final `$` requires the end of the name; a surrounding suite name may precede it.
Parameterized patterns select all named rows, such as both anchor counts in each supported block form.
The readable names remain beside each acceptance case.

[scripts/vitest-selector.mjs](../../../scripts/vitest-selector.mjs) decodes the pattern and runs installed Vitest with a temporary JSON report.
It returns `0` only when Vitest succeeds and at least one test passes, `2` for an entirely unmatched or skipped selection, and `1` for failure.
Invocation or report errors also fail visibly; the temporary report is removed after the run.
[test/selector-runner.test.ts](../../../test/selector-runner.test.ts) checks a missing name, a passing name and an invalid pattern.
No dependencies are installed by the runner.

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

An external local reference is a warning with an original-file URL, not a copied attachment or a validated destination.
A browser-storage failure is a console warning with a current-page preference, not a build refusal.

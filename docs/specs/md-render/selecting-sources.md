<a id="selecting-sources"></a>
# Selecting sources

Selection determines the initial reading order before any links add referenced pages.
A repository uses its declared documents; a plain folder can be read without metadata.

<a id="source-corpus"></a>
## Source corpus

A source corpus is the selected Markdown and metadata read from one local source root.
It supplies the original content from which the HTML site is derived.
The loader accepts a repository root, a folder or one Markdown file.
The selected input must be a directory or a regular file with a case-insensitive `.md` extension.

The source root is the directory that supplies the base for repository-relative paths and confines local file reads.
Selecting a folder does not always make that folder the source root: metadata or an enclosing Git repository can supply a wider root.
Initial selection still follows the chosen input, unless a manifest supplies the page list.

**Procedure: resolve the source root**

1. **Choose the base directory:** use the selected folder, or the containing directory for a selected Markdown file.
   This identifies where metadata lookup begins.

2. **Look for local metadata:** use the base directory, except that a folder named `docs` uses its parent.
   If either metadata file exists there, that directory becomes the source root.

   > **Detail — fixture selection**
   >
   > Selecting `test/fixtures/corpus` finds its `docs/DOCUMENTS.json` and `docs/ENTITIES.json`.
   > Selecting `test/fixtures/corpus/docs` checks the same metadata and selects the same declared pages.

3. **Find an enclosing repository when local metadata is absent:** search upward from the base for the first `.git` entry.
   Use that repository as the source root and read any metadata there.
   Without such a repository, retain the base directory as the source root.

   > **Detail — nested selection**
   >
   > In a metadata-free repository, selecting `nested/one.md` initially renders only that file.
   > Its source-root-relative path remains `nested/one.md`.
   > Rendering writes `nested/one.html` beneath the output directory.
   > Sibling links can reach other files within the repository.

Without a [document manifest](#document-manifest), recursive discovery excludes `.git` and `node_modules`.
The selected folder’s `index.md` must open first; remaining paths sort lexically.
For example, selecting `nested` must order `nested/index.md` before `nested/a.md`.
The [settled folder decision](decisions-and-questions.md#question-nested-index) also applies after repository-root discovery.
The current loader promotes only root-relative `index.md`, so nested selection remains an [implementation gap](decisions-and-questions.md#open-questions).

The loader reads each initial Markdown file as UTF-8 and keeps its text in memory.
The parser creates one reusable tree for each page.
There is no stored parse registry, search index or database.
Local images are copied only when referenced; other local files stay at their original paths.

<a id="document-manifest"></a>
## Document manifest

A document manifest is the JSON file that declares document groups and their ordered sections.
It makes the author's reading order independent of file names.
Its location is `docs/DOCUMENTS.json` beneath the resolved root.

The fixture declares `demo#home` before `demo#tour`.
Each section maps its identity to a repository-relative path and an explicit anchor.
Multiple sections in one file contribute one page at their first occurrence.
Each document's navigation file follows its sections unless that path is already selected.
Navigation inclusion does not apply the section inventory filter.
For example, a declared `docs/generated/map.md` navigation file is included even when its inventory classification is generated.

Inventory entries classify inputs as specification, design, other or generated.
Section selection excludes paths ending in `/` and inventory entries classified as other or generated.
Unlisted Markdown does not join the initial reading order.
A link can still add such Markdown as a referenced page.

Document titles label groups, so the tour appears beneath Synthetic guide.
Within that group, the menu shows the parsed Home and Tour headings rather than section identities or filename slugs.
A document with one chapter uses its document title as its single menu entry.
[Reading menu](reading-pages.md#reading-menu) explains suppression of redundant group and chapter labels.

<a id="entity-index"></a>
## Entity index

An entity index is the JSON file that locates named definitions through manifest section identities.
It enables definition hover text without storing another copy of the definition.
The file is optional and lives at `docs/ENTITIES.json`.

The fixture maps its Writer entity to section `demo#home`, anchor `writer`.
The section lookup chooses Home; the anchor locates its heading.
The first paragraph immediately after that heading supplies plain-text hover text.
All consecutive empty anchors immediately before the heading share that paragraph.

An unknown home section fails loading.
A home in an initially selected file must have its anchor, heading and first paragraph.
Homes whose section files are outside the initial selection are not registered for hovers.
This qualification matters when selecting a single file from a larger repository.

<a id="selection-refusals"></a>
## Input refusal and repair

Validation prevents the renderer from publishing a site with unresolved selected inputs.
An unsupported metadata version, invalid shape, unreadable source or empty selection stops the command.
The loader accepts only the version it implements; it does not convert metadata.

Every rendered input path component inside the source root must be free of symlinks.
Selecting a symlink directly is also refused.
Regular file reads also reject symlinked files and symlinked parent directories beneath the resolved root.
Recursive folder discovery refuses symlink entries, including entries it would otherwise not render.
Ancestors above the source root are out of scope under the [settled symlink decision](decisions-and-questions.md#question-symlink-root).
For example, a symlinked `chapters` directory inside the root fails; an ancestor of the root is not subject to that check.

These stops use [Source refusal](serving-and-export.md#failure-source-input) and [Unresolved definition](serving-and-export.md#failure-definition).
The author repairs the original input and reruns the command.

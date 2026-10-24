<a id="requirements"></a>
# Requirements

These obligations define the renderer’s required behavior, with evidence boundaries kept beside each acceptance case.
They remain proposed contracts until the lead accepts this draft.
The display bounds come from [desktop-width](reading-pages.md#desktop-width) and [diagram-contrast](resolving-content.md#diagram-contrast).
The [implementation evidence](decisions-and-questions.md#open-questions) links the regressions for the settled folder-order and duplicate-title requirements.

<a id="req-source-order"></a>
## Requirement: select sources in declared order

Selection makes the authored order observable in the rendered site.

**Actor:** md-render.

**Condition:** A repository, plain folder or Markdown file is selected.

**Result:** Use the manifest section order, deduplicate files at first occurrence and include declared navigation. Without a manifest, put the selected folder’s index first, then discover remaining Markdown lexically. Group chapters by document and use heading-derived labels.

**Verification:** Compare the selected paths and menu groups with the fixture manifest.

**Tests:** [Source selection](acceptance.md#test-source-order), [Selected nested-folder index](acceptance.md#test-selected-folder-index).

**Status:** lead-settled scope; implemented behavior, with linked executable regression evidence.

**Basis:** [Document manifest](selecting-sources.md#document-manifest).

<a id="req-entity-meanings"></a>
## Requirement: resolve selected entity meanings

Definition validation prevents empty or invented hover meanings.

**Actor:** md-render.

**Condition:** An [entity index](selecting-sources.md#entity-index) accompanies selected manifest sections.

**Result:** Resolve each home section. For homes in initially selected files, require the anchor, heading and first paragraph; use that paragraph as plain-text hover text. Reject unknown selected homes rather than silently omitting their meaning.

**Verification:** Compare the Writer hover with its source paragraph and inspect the selected-home refusal.

**Tests:** [Entity meanings](acceptance.md#test-entity-meanings).

**Status:** implemented behavior; proposed specification.

**Basis:** [Entity index](selecting-sources.md#entity-index).

<a id="req-local-links"></a>
## Requirement: preserve local links and stacked anchors

Anchor preservation keeps existing inbound references usable after rendering.

**Actor:** md-render.

**Condition:** A page links to local Markdown or a fragment.

**Result:** Rewrite rendered Markdown destinations to HTML, preserving query and valid fragments. Preserve every stacked empty anchor, use the last as its outline destination and retain generated heading targets. Reject duplicates and broken targets, except for the retained-reference fragment fallback in [Bundled local references](serving-and-export.md#bundled-local-references).

**Verification:** Follow every stacked anchor and inspect the last-anchor menu destination.

**Tests:** [Links and anchors](acceptance.md#test-local-links).

**Status:** implemented behavior; proposed specification.

**Basis:** [Links and anchors](resolving-content.md#links-and-anchors).

<a id="req-reference-pages"></a>
## Requirement: render references without changing authored labels

Reference discovery lets readers follow supporting files without changing the main reading order.

**Actor:** md-render.

**Condition:** A selected page links to repository Markdown or a non-Markdown local file.

**Result:** In temporary local-reading mode, render only repository Markdown linked directly from initially selected document pages. Deduplicate these references and list each once by title, without sections. Further-out Markdown links from referenced pages use the original-file treatment: keep labels, add a file icon and original-path hover, warn and link to originals without reading or copying them. Apply the same original-file treatment to non-Markdown links.

**Verification:** Inspect one-hop selection, title-only reference entries, warning list and original-file hovers.

**Tests:** [Referenced files](acceptance.md#test-reference-pages).

**Status:** implemented behavior; proposed specification.

**Basis:** [Links and anchors](resolving-content.md#links-and-anchors).

<a id="req-safe-content"></a>
## Requirement: keep markdown rendering offline and sanitized

Content restrictions prevent source markup from executing in the reader’s page.

**Actor:** md-render.

**Condition:** Sources include raw HTML, images or link schemes.

**Result:** Preserve allowed empty anchors and literal code; omit comments and metadata from body text; escape other HTML. Copy local in-root images. Refuse executable links, remote images, escaping images and output collisions.

**Verification:** Inspect escaped markup and each rejected image or link scheme.

**Tests:** [Safe content](acceptance.md#test-safe-content).

**Status:** implemented behavior; proposed specification.

**Basis:** [Content pipeline](resolving-content.md#content-pipeline).

<a id="req-diagram-build"></a>
## Requirement: build diagrams before viewing

Build-time conversion makes the diagram visible without a viewing-time engine.

**Actor:** md-render.

**Condition:** Mermaid code blocks occur in a selected or referenced page.

**Result:** With the pinned installed package and working browser, build SVG using theme colours and retain source. When the package is absent or disabled, show source explicitly. Fail an installed renderer error instead of hiding it.

**Verification:** Inspect generated SVG, retained source and the explicit disabled-renderer display.

**Tests:** [Diagram build](acceptance.md#test-diagram-build).

**Status:** implemented behavior; proposed specification.

**Basis:** [Diagram rendering](resolving-content.md#diagram-rendering).

<a id="req-menu-navigation"></a>
## Requirement: provide one chapter and section menu

A unified outline lets readers find the chapter and section being read.

**Actor:** md-render.

**Condition:** A reader opens any rendered page.

**Result:** Use one grouped menu; flatten single-chapter documents and never list a title twice consecutively. Allow unrelated equal titles elsewhere. Expand the current chapter and show its level-two and level-three sections. Highlight the section being read with background tint and bold text, without an inset bar in either built-in theme or colour mode; reveal it without moving the article.

**Verification:** Compare the current menu entry with the visible section after scroll and hash changes.

**Tests:** [Menu navigation](acceptance.md#test-menu-navigation), [Adjacent equal authored titles](acceptance.md#test-adjacent-equal-titles).

**Status:** lead-settled scope; implemented behavior, with linked executable regression evidence.

**Basis:** [Reading menu](reading-pages.md#reading-menu).

<a id="req-responsive-layout"></a>
## Requirement: keep the document readable across widths

Responsive layout keeps reading and navigation usable at both sides of the width boundary.

**Actor:** md-render.

**Condition:** The viewport crosses the desktop-width boundary or content overflows.

**Result:** At desktop-width and wider, keep a fixed hideable sidebar and persist its state. Below the boundary, open a full-screen modal menu. Keep article scrolling on the document and horizontal overflow inside code, tables or diagrams. A tall menu may scroll independently.

**Verification:** Compare the sidebar and overlay geometry on both sides of desktop-width.

**Tests:** [Responsive layout](acceptance.md#test-responsive-layout).

**Status:** implemented behavior; proposed specification.

**Basis:** [Reading menu](reading-pages.md#reading-menu).

<a id="req-theme-mode"></a>
## Requirement: restore colour mode before first paint

Early colour restoration avoids an initial paint in the wrong palette.

**Actor:** md-render.

**Condition:** The reader chooses System, Light or Dark.

**Result:** Place the switch at the menu bottom, persist explicit modes and apply the saved override before styles load. System follows the OS. Storage failure warns without blocking reading. Meet the built-in diagram contrast bound for the documented tested pairs in each mode.

**Verification:** Inspect head ordering, restored pressed-button selection and the tested diagram colour pairs.

**Tests:** [Colour mode and contrast](acceptance.md#test-theme-mode).

**Status:** implemented behavior; proposed specification.

**Basis:** [Colour mode](reading-pages.md#colour-mode).

<a id="req-article-navigation"></a>
## Requirement: avoid a duplicate body map and generated heading numbers

Article navigation avoids repeating a generated list while preserving its link targets.

**Actor:** md-render.

**Condition:** An article includes headings, generated navigation or adjacent initial pages.

**Result:** Add no automatic heading numbers. Omit only the generated level-two Document map subtree inside an exact navigation region, keeping anchors and sibling sections. Provide Previous and Next in initial reading order.

**Verification:** Compare retained siblings, empty map targets and adjacent-page destinations.

**Tests:** [Article navigation](acceptance.md#test-article-navigation).

**Status:** implemented behavior; proposed specification.

**Basis:** [Article display](reading-pages.md#article-display).

<a id="req-temporary-lifecycle"></a>
## Requirement: constrain and clean temporary serving

Lifecycle cleanup makes the default session disposable and confines its server to the local machine.

**Actor:** md-render.

**Condition:** The command runs without either export option or the API starts a viewer.

**Result:** Serve only on loopback after rendering succeeds. Remove temporary output on close, normal exit, SIGINT, SIGTERM and startup failure. Release the listening port on close. Do not claim cleanup after SIGKILL or machine failure.

**Verification:** Inspect the bound address, closed port and removed output after each handled stop.

**Tests:** [Viewer lifecycle](acceptance.md#test-temporary-lifecycle).

**Status:** implemented behavior; proposed specification.

**Basis:** [Temporary viewer](serving-and-export.md#temporary-viewer).

<a id="req-input-refusals"></a>
## Requirement: refuse invalid selected input visibly

Visible refusal gives the author enough information to repair invalid input.

**Actor:** md-render.

**Condition:** Metadata, paths, links or homes cannot satisfy the supported input contract.

**Result:** Refuse unknown versions, broken local anchors authored in input pages, missing selected homes and symlinked selected inputs. Report the cause with CLI exit 1 or an API rejection; leave original inputs intact and explain repair through the failure declarations.

**Verification:** Inspect each diagnostic and the absence of an announced viewer on refusal.

**Tests:** [Input refusals](acceptance.md#test-input-refusals).

**Status:** implemented behavior; proposed specification.

**Basis:** [Failure source input](serving-and-export.md#failure-source-input).

<a id="req-static-export"></a>
## Requirement: retain static output without overwriting existing content

The export check protects existing destination contents before writing begins.

**Actor:** md-render.

**Condition:** The caller supplies an explicit output directory.

**Result:** Write static output only into an absent or empty destination and exit without serving. Keep successful output after exit. Do not overwrite a nonempty destination; expose partial output after a later failure for caller inspection.

**Verification:** Inspect retained static pages and existing contents after nonempty-directory refusal.

**Tests:** [Static export](acceptance.md#test-static-export).

**Status:** implemented behavior; proposed specification.

**Basis:** [Static export](serving-and-export.md#static-export).

<a id="req-instant-navigation"></a>
## Requirement: change rendered pages without a full load

Page swaps avoid the browser overhead of loading a new document for each chapter.

**Actor:** The reader in a JavaScript-enabled localhost or HTTP-served static site.

**Condition:** The reader hovers, focuses or follows a link to another rendered page, or uses browser history.

**Result:** Prefetch hovered or focused rendered links and the current page's previous/next destinations. Reuse a bounded in-memory HTML cache. Intercept only same-origin rendered-page links with a plain left click, no modifiers, target or download. Replace main content, title and menu state; push history, focus the new heading and scroll to the fragment or top. Back/forward swaps restore the entry's scroll position. Retain the wrapper and existing menu nodes across structurally matching pages, preserving menu scroll and reader-selected chapter disclosures while opening the new current chapter. Update relative link targets and current page and section markers; replace menu children only for a structurally different menu. Preserve section tracking, theme, diagrams, adjacent links and compact-menu closing. Fetch or document-validation failure warns and performs a normal full load. Original-file and external links remain normal, and all links work without JavaScript. Serve HTML with no-cache and static viewer assets with a session-length max-age.

**Verification:** Exercise successful swaps, prefetch reuse, history, excluded clicks and full-load fallbacks through the real local viewer.

**Tests:** [Instant navigation](acceptance.md#test-instant-navigation), [Viewer caching](acceptance.md#test-viewer-caching).

**Status:** task-settled behavior; implementation details proposed for lead acceptance.

**Basis:** [Page changes](reading-pages.md#page-changes).

<a id="req-single-file-export"></a>
## Requirement: export one self-contained document

The standalone document makes the complete reading session portable without sibling files.

**Actor:** md-render and the reader.

**Condition:** The CLI receives `--out`, `--single-file`, or both.

**Result:** Follow [Single-file export](serving-and-export.md#single-file-export): retain the requested outputs, refuse existing targets, report byte size, embed all resources, and resolve namespaced page and fragment links inside the file. Preserve reading controls and document-wide browser find without network requests.

**Verification:** Export synthetic pages, open through file URLs, inspect resources and navigate rendered destinations.

**Tests:** [Single-file output](acceptance.md#test-single-file-output), [Single-file reading](acceptance.md#test-single-file-reading).

**Status:** task-settled behavior; naming and routing details proposed for lead acceptance.

**Basis:** [Single-file export](serving-and-export.md#single-file-export).

<a id="req-bundled-references"></a>
## Requirement: bundle portable local references

Bundling makes the input pages’ direct local references usable on another machine.

**Actor:** md-render.

**Condition:** The caller requests a retained folder or single-file export.

**Result:** Follow [Bundled local references](serving-and-export.md#bundled-local-references): render directly linked Markdown regardless of inventory kind or root, render UTF-8 text as numbered code pages, and embed binary downloads. Mark further local targets as not bundled with portable paths and one warning per target. Preserve labels and valid fragments. Refuse broken fragments in input pages; warn and link to the destination top for broken fragments in bundled references. Display portable paths, including local Git commit labels, without absolute input/home paths or original-machine URLs. Warn for missing files and leave their labels as non-link text. Visibly omit linked files above the configured byte limit with their exact size.

**Verification:** Open both exports through file URLs, navigate chapter and source-line links, compare binary bytes, inspect labels and omission messages.

**Tests:** [Portable references](acceptance.md#test-bundled-references), [Bundle omissions](acceptance.md#test-bundle-omissions).

**Status:** operator-settled bundling; line-fragment and policy details proposed for lead acceptance.

**Basis:** [Bundle local files for sharing](decisions-and-questions.md#bundle-local-files-choice).

<a id="req-extensions"></a>
## Requirement: let extensions find rendered blocks

Extensions point at rendered text by its source lines, so no program has to change md-render's output afterwards.

**Actor:** md-render and the calling program.

**Condition:** The caller passes `extensions` in the render options, or a page script runs in any rendered page.

**Result:** Follow [Blocks and extensions](reference.md#extension-reference). In a render with extensions, mark every Markdown block with its source lines and block ID; leave other renders unchanged. Run each extension once on the rendered corpus and stop the render when one fails. Embed its style, script and data in every page, with the script's hash in the page policy. Give page scripts the version-1 browser interface.

**Verification:** Render synthetic pages with a probe extension, inspect markup and policy, and call the browser interface in the real browser fixture.

**Tests:** [Block identity and extensions](acceptance.md#test-extension-render), [Extension browser interface](acceptance.md#test-extension-browser).

**Status:** operator-approved framework of 2026-10-24; interface details proposed for lead acceptance.

**Basis:** [Expose blocks to extensions](decisions-and-questions.md#extension-choice).


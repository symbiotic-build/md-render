<a id="acceptance"></a>
# Acceptance

The executable cases name existing Vitest tests through the declared repository runner.
Their Implementation links use exact full test names, explained in [Selector execution](reference.md#selector-reference).
The audit matches these names against JUnit results from the normal test run.
Every citation must match a passing testcase; missing, failing, errored or skipped matches fail the audit.
Source-inspection observations below record behavior outside the automated assertions, with the inspected code and result.

Runtime evidence is scoped to the assertions in each linked test.
The [implementation evidence](decisions-and-questions.md#open-questions) connects settled folder-order and duplicate-title requirements to their regressions.

Choose [input and rendering evidence](#input-evidence), [reading controls evidence](#display-evidence) or [output lifecycle evidence](#lifecycle-evidence).

<a id="input-evidence"></a>
## Input and rendering evidence

These cases follow selected sources through definition lookup, URL resolution and body rendering.

<a id="test-source-order"></a>
### Acceptance test: source selection

This case checks that source selection follows author-declared order rather than filename order.
Selected nested-folder priority has a separate [automated case](#test-selected-folder-index).

Selected Vitest names:

- `follows manifest section order and deduplicates files`.
- `uses the manifest for a selected docs folder without adding unrelated inventory`.
- `puts index.md first without a manifest and includes nested chapters`.

**Method:** test.

**Requirements:** [Select sources in declared order](requirements.md#req-source-order).

**Inputs:** The fixture, a selected docs folder and an independent plain folder.

**Expected:** Declared Home, Tour and index order; no unlisted initial pages; index first for the standalone plain folder.

**Implementation:** [test/renderer.test.ts::follows manifest section order and deduplicates files](../../../test/renderer.test.ts), [test/renderer.test.ts::uses the manifest for a selected docs folder without adding unrelated inventory](../../../test/renderer.test.ts), [test/renderer.test.ts::puts index.md first without a manifest and includes nested chapters](../../../test/renderer.test.ts)




<a id="test-entity-meanings"></a>
### Acceptance test: entity meanings

This case ties hover text to the selected definition and checks incomplete-home refusal.

Selected Vitest names:

- `rewrites cross-file, fragment, query and reference links and adds entity hovers`.
- `refuses entity homes with no canonical meaning`.

**Method:** test.

**Requirements:** [Resolve selected entity meanings](requirements.md#req-entity-meanings).

**Inputs:** The fixture Writer home and a selected home without a paragraph.

**Expected:** The Writer hover matches its paragraph; a selected home without a definition paragraph fails.

**Implementation:** [test/renderer.test.ts::rewrites cross-file, fragment, query and reference links and adds entity hovers](../../../test/renderer.test.ts), [test/renderer.test.ts::visible input failures \> refuses entity homes with no canonical meaning](../../../test/renderer.test.ts)




<a id="test-local-links"></a>
### Acceptance test: links and anchors

This case follows rewritten links and checks all targets in a stacked anchor block.

Selected Vitest names:

- `resolves %i stacked entity anchors in a %s block`.
- `rejects duplicate ids in stacked anchors with %j before the closing tag`.
- `rewrites cross-file, fragment, query and reference links and adds entity hovers`.
- `refuses missing Markdown targets and fragments`.

**Method:** test.

**Requirements:** [Preserve local links and stacked anchors](requirements.md#req-local-links).

**Inputs:** The fixture links and anchor-only blocks containing two or three anchors.

**Expected:** All stacked targets and meanings resolve once; the outline uses the last anchor; missing targets or fragments refuse the build.

**Implementation:** [test/renderer.test.ts::resolves 2 stacked entity anchors in a paragraph block](../../../test/renderer.test.ts), [test/renderer.test.ts::resolves 3 stacked entity anchors in a paragraph block](../../../test/renderer.test.ts), [test/renderer.test.ts::resolves 2 stacked entity anchors in a html block](../../../test/renderer.test.ts), [test/renderer.test.ts::resolves 3 stacked entity anchors in a html block](../../../test/renderer.test.ts), [test/renderer.test.ts::resolves 2 stacked entity anchors in a adjacent block](../../../test/renderer.test.ts), [test/renderer.test.ts::resolves 3 stacked entity anchors in a adjacent block](../../../test/renderer.test.ts), [test/renderer.test.ts::rejects duplicate ids in stacked anchors with "" before the closing tag](../../../test/renderer.test.ts), [test/renderer.test.ts::rejects duplicate ids in stacked anchors with "\\n" before the closing tag](../../../test/renderer.test.ts), [test/renderer.test.ts::rewrites cross-file, fragment, query and reference links and adds entity hovers](../../../test/renderer.test.ts), [test/renderer.test.ts::visible input failures \> refuses missing Markdown targets and fragments](../../../test/renderer.test.ts)




<a id="test-reference-pages"></a>
### Acceptance test: referenced files

This case checks temporary local-reading discovery and the original-file treatment of native sources.

Selected Vitest names:

- `renders only direct Markdown references with title-only menu entries`.
- `keeps reference-style non-Markdown labels with a file icon and repository path`.

**Method:** test.

**Requirements:** [Render references without changing authored labels](requirements.md#req-reference-pages).

**Inputs:** A manifest page linking directly to a reference with sections, repeated direct links, further-out Markdown, a cycle and a source file.

**Expected:** Only direct references render, once each, with titles and no section lists. Further-out Markdown and native files keep labels, icons, path hovers and original-file URLs; their contents are not read.

**Implementation:** [test/renderer.test.ts::renders only direct Markdown references with title-only menu entries](../../../test/renderer.test.ts), [test/renderer.test.ts::keeps reference-style non-Markdown labels with a file icon and repository path](../../../test/renderer.test.ts)




<a id="test-safe-content"></a>
### Acceptance test: safe content

This case checks that untrusted markup remains text and disallowed resource URLs fail.

Selected Vitest names:

- `renders unsupported raw HTML as text and blocks executable markup`.
- `rejects image escapes and executable links`.
- `applies offline image rules to reference-style images`.

- `preserves encoded filenames and copies reference-style local images`.

- `refuses output collisions between attachments and rendered pages`.

**Method:** test.

**Requirements:** [Keep Markdown rendering offline and sanitized](requirements.md#req-safe-content).

**Inputs:** Script markup, local and remote images, an escaping image and an executable link.

**Expected:** Raw scripts remain text; local images copy; disallowed images and executable links reject visibly.

**Implementation:** [test/renderer.test.ts::renders unsupported raw HTML as text and blocks executable markup](../../../test/renderer.test.ts), [test/renderer.test.ts::visible input failures \> rejects image escapes and executable links](../../../test/renderer.test.ts), [test/renderer.test.ts::applies offline image rules to reference-style images](../../../test/renderer.test.ts), [test/renderer.test.ts::preserves encoded filenames and copies reference-style local images](../../../test/renderer.test.ts), [test/renderer.test.ts::refuses output collisions between attachments and rendered pages](../../../test/renderer.test.ts)




<a id="test-diagram-build"></a>
### Acceptance test: diagram build

This case distinguishes static SVG from the explicit source-only display.

Selected Vitest names:

- `builds pinned offline Mermaid SVG without viewer scripts`.


**Method:** test.

**Requirements:** [Build diagrams before viewing](requirements.md#req-diagram-build).

**Inputs:** The fixture flowchart with the installed renderer and with Mermaid disabled.

**Expected:** The build produces SVG without viewer Mermaid scripts; disabled rendering visibly shows source.

**Implementation:** [test/renderer.test.ts::builds pinned offline Mermaid SVG without viewer scripts](../../../test/renderer.test.ts), [test/renderer.test.ts::rewrites cross-file, fragment, query and reference links and adds entity hovers](../../../test/renderer.test.ts), [test/browser.test.ts::reuses one Chromium without a startup page and isolates storage and overrides after a failed callback](../../../test/browser.test.ts)

The [Entity meanings](#test-entity-meanings) evidence also exercises the explicit source-only diagram display.

<a id="display-evidence"></a>
## Reading controls evidence

These cases exercise navigation, responsive layout and colour behavior in the rendered page.




<a id="test-menu-navigation"></a>
### Acceptance test: menu navigation

This case checks current-section tracking alongside chapter and document labels.

Selected Vitest names:

- `flattens single-chapter documents to their document title with current sections`.
- `labels the first chapter by its heading, first level-two heading or Introduction without adjacent duplicate labels`.
- `tracks the last section above the reading line, handles hash navigation and reveals the current entry without scrolling the page`.

**Method:** test.

**Requirements:** [Provide one chapter and section menu](requirements.md#req-menu-navigation).

**Inputs:** Multi-document navigation with single chapters, a repeated group title and a long current chapter.

**Expected:** The menu has one current page, no redundant structural title and the last section above the reading line marked current; at the end of a scrolled page, the last section on screen is current.

**Implementation:** [test/navigation.test.ts::flattens single-chapter documents to their document title with current sections](../../../test/navigation.test.ts), [test/navigation.test.ts::labels the first chapter by its heading, first level-two heading or Introduction without adjacent duplicate labels](../../../test/navigation.test.ts), [test/navigation.test.ts::tracks the last section above the reading line, handles hash navigation and reveals the current entry without scrolling the page](../../../test/navigation.test.ts)




<a id="test-responsive-layout"></a>
### Acceptance test: responsive layout

This case compares desktop and compact menu geometry with contained content overflow.

Selected Vitest names:

- `checks rendered menu, theme controls, storage failure and diagram contrast in both themes`.

- `keeps wide diagrams readable, contains code and table overflow, and prints on white from either theme`.

- `keeps a tall sidebar fixed with independent scrolling at desktop widths and only one document navigation at every width`.

**Method:** test.

**Requirements:** [Keep the document readable across widths](requirements.md#req-responsive-layout).

**Inputs:** Both built-in themes at wide, boundary and phone widths with wide code, tables and diagrams.

**Expected:** The sidebar stays fixed at desktop widths; the compact menu locks the background; content does not widen the viewport or create an article scrolling pane.

**Implementation:** [test/browser.test.ts::checks rendered menu, theme controls, storage failure and diagram contrast in both themes](../../../test/browser.test.ts), [test/layout.test.ts::keeps wide diagrams readable, contains code and table overflow, and prints on white from either theme](../../../test/layout.test.ts), [test/navigation.test.ts::keeps a tall sidebar fixed with independent scrolling at desktop widths and only one document navigation at every width](../../../test/navigation.test.ts)




<a id="test-theme-mode"></a>
### Acceptance test: colour mode and contrast

This case checks palette restoration and the documented built-in diagram contrast pairs.

Selected Vitest names:

- `checks rendered menu, theme controls, storage failure and diagram contrast in both themes`.
- `uses a single chapter menu with independent disclosures and an appearance button group`.
- `swaps rendered pages with prefetch history and reading controls`.

**Method:** test.

**Requirements:** [Restore colour mode before first paint](requirements.md#req-theme-mode).

**Inputs:** Both built-in themes, both explicit modes, System and unavailable browser storage.

**Expected:** A title-free Appearance group sits at the menu bottom with Light, System and Dark icon buttons in that order. Each has its name as `aria-label` and `title`, and only the selected button is pressed. Restored storage, pressed state and palette agree; System follows the system preference and clears the override; instant page changes retain the choice. Without JavaScript the control is hidden and System applies. Tested diagram colour pairs meet the bound; unavailable storage leaves the page readable and its current selection usable.

**Implementation:** [test/browser.test.ts::checks rendered menu, theme controls, storage failure and diagram contrast in both themes](../../../test/browser.test.ts), [test/renderer.test.ts::uses a single chapter menu with independent disclosures and an appearance button group](../../../test/renderer.test.ts), [test/page-changes.test.ts::swaps rendered pages with prefetch history and reading controls](../../../test/page-changes.test.ts)

Source inspection completed on 2026-10-16 at `4305d3e`:
[src/site.ts::page](../../../src/site.ts) emits the inline theme script before both stylesheet links.
[themes/theme-init.js](../../../themes/theme-init.js) reads the saved override and applies only `light` or `dark` to the document element.
Its exception handler logs “Theme preference could not be read; using System.”
These observations establish source ordering and warning text.
They do not measure first-paint timing.
The browser case does not assert those source details; the markup case checks script-before-stylesheet ordering.

<a id="test-article-navigation"></a>
### Acceptance test: article navigation

This case checks map omission without losing sibling content or inbound targets.

Selected Vitest names:

- `omits only the marked level-two document map and keeps its siblings unchanged`.
- `resolves inbound links to omitted anchors and keeps menu siblings (%s)`.
- `groups chapters by document title, uses first headings over manifest labels and follows manifest order`.

**Method:** test.

**Requirements:** [Avoid a duplicate body map and generated heading numbers](requirements.md#req-article-navigation).

**Inputs:** A generated navigation region, inbound map fragment and middle page in a declared order.

**Expected:** Overview and the generated term-list section remain, the duplicate list disappears, inbound fragments resolve and adjacent links use declared neighbors.

**Implementation:** [test/renderer.test.ts::generated navigation regions \> omits only the marked level-two document map and keeps its siblings unchanged](../../../test/renderer.test.ts), [test/renderer.test.ts::generated navigation regions \> resolves inbound links to omitted anchors and keeps menu siblings ()](../../../test/renderer.test.ts), [test/renderer.test.ts::generated navigation regions \> resolves inbound links to omitted anchors and keeps menu siblings (\<a id="map-home"\>\</a\>  )](../../../test/renderer.test.ts), [test/renderer.test.ts::groups chapters by document title, uses first headings over manifest labels and follows manifest order](../../../test/renderer.test.ts)

<a id="lifecycle-evidence"></a>
## Output lifecycle evidence

These cases exercise loopback serving, refusal and retained static exports.




<a id="test-temporary-lifecycle"></a>
### Acceptance test: viewer lifecycle

This case checks local serving and disposable output across each handled lifecycle exit.

Selected Vitest names:

- `serves pages on a free loopback port and removes output on close`.
- `removes temporary CLI output on SIGINT`.
- `removes temporary CLI output on SIGTERM`.
- `removes output on normal process exit`.
- `returns a visible error for invalid input and cleans startup resources`.

**Method:** test.

**Requirements:** [Constrain and clean temporary serving](requirements.md#req-temporary-lifecycle).

**Inputs:** A running viewer, explicit close, child-process exit and each handled signal.

**Expected:** The host is 127.0.0.1; pages are readable; close and handled exits remove output; startup failure retains no viewer handlers.

**Implementation:** [test/server.test.ts::serves pages on a free loopback port and removes output on close](../../../test/server.test.ts), [test/server.test.ts::removes temporary CLI output on SIGINT](../../../test/server.test.ts), [test/server.test.ts::removes temporary CLI output on SIGTERM](../../../test/server.test.ts), [test/server.test.ts::removes output on normal process exit](../../../test/server.test.ts), [test/server.test.ts::returns a visible error for invalid input and cleans startup resources](../../../test/server.test.ts)




<a id="test-input-refusals"></a>
### Acceptance test: input refusals

This case checks that invalid selected inputs refuse with actionable diagnostics.

Selected Vitest names:

- `rejects an unknown real-format manifest version before selecting files`.
- `still refuses symlinked manifest sections and symlinked parent directories`.
- `refuses missing Markdown targets and fragments`.
- `refuses entity homes with no canonical meaning`.

**Method:** test.

**Requirements:** [Refuse invalid selected input visibly](requirements.md#req-input-refusals).

**Inputs:** Unknown manifest version, symlinked file or parent, missing fragment and incomplete selected entity home.

**Expected:** Each invalid selected input refuses rather than producing an announced site; repairing the source permits a new clean build.

**Implementation:** [test/renderer.test.ts::rejects an unknown real-format manifest version before selecting files](../../../test/renderer.test.ts), [test/renderer.test.ts::still refuses symlinked manifest sections and symlinked parent directories](../../../test/renderer.test.ts), [test/renderer.test.ts::visible input failures \> refuses missing Markdown targets and fragments](../../../test/renderer.test.ts), [test/renderer.test.ts::visible input failures \> refuses entity homes with no canonical meaning](../../../test/renderer.test.ts)




<a id="test-static-export"></a>
### Acceptance test: static export

This case distinguishes retained static output from nonempty-directory refusal.

Selected Vitest names:

- `does not overwrite existing static output`.

- `keeps static output after the CLI exits`.

**Method:** test.

**Requirements:** [Retain static output without overwriting existing content](requirements.md#req-static-export).

**Inputs:** An empty destination, a nonempty destination and a successful static CLI invocation.

**Expected:** Success retains a static site; the nonempty check preserves existing files; failures return visibly rather than claiming atomic export.

**Implementation:** [test/renderer.test.ts::visible input failures \> does not overwrite existing static output](../../../test/renderer.test.ts), [test/server.test.ts::keeps static output after the CLI exits](../../../test/server.test.ts)

Source inspection completed on 2026-10-16 at `4305d3e`:
[src/site.ts::renderSite](../../../src/site.ts) checks destination emptiness before copying assets and writing pages directly into that destination.
It has no rollback around those writes.
A later failure can therefore leave partial static output; this is an analysis of the write path, not an injected write-failure test.
[Static export](serving-and-export.md#static-export) describes the caller's recovery.

<a id="test-selected-folder-index"></a>
## Acceptance test: selected nested-folder index

This regression checks the settled folder order when repository discovery gives the selected folder a repository-relative path.

**Method:** test.

**Requirements:** [Select sources in declared order](requirements.md#req-source-order).

**Inputs:** A repository without metadata, containing `nested/a.md` and `nested/index.md`; select `nested`.

**Expected:** The selected folder's index opens before `a.md`, even though repository discovery retains repository-relative paths.

**Implementation:** [test/renderer.test.ts::opens the selected nested folder index before its remaining lexical paths](../../../test/renderer.test.ts)

The executable case also checks the map, document group, rendered page order and root redirect.
It covers the [settled folder decision](decisions-and-questions.md#question-nested-index) after its implementation repair.

<a id="test-adjacent-equal-titles"></a>
## Acceptance test: adjacent equal authored titles

This regression checks consecutive equal chapter labels after group and outline suppression.

**Method:** test.

**Requirements:** [Provide one chapter and section menu](requirements.md#req-menu-navigation).

**Inputs:** Two consecutive chapters titled Guide in one manifest document, with no section links separating their menu entries.

**Expected:** Guide is not listed twice in a row; equal titles separated by other entries remain allowed.

**Implementation:** [test/renderer.test.ts::qualifies adjacent equal chapter labels with source relative paths while retaining both links](../../../test/renderer.test.ts)

The executable case covers two and three equal titles, separated equal titles, intervening sections, exact case and retained child links.
It checks each rendered page's menu and preserves authored page titles.
These assertions cover the repaired [settled title decision](decisions-and-questions.md#question-equal-titles).

<a id="test-instant-navigation"></a>
## Acceptance test: instant navigation

This case checks the page-change contract through executable behavior.

**Method:** test.

**Requirements:** [Change rendered pages without a full load](requirements.md#req-instant-navigation).

**Inputs:** Rendered chapters on the real loopback viewer, history entries, intent events, excluded links and failed responses.

**Expected:** Page, wrapper and matching-menu node identities survive swaps. Menu scroll and reader-opened or closed chapters survive; the new current chapter opens and its page and section are marked. Cross-directory links update, and structurally different menus replace their children. Content, focus, fragments, themes and diagrams update; history restores scroll; cache requests are reused and bounded; failures load normally. Current sections retain tint and bold text without an inset bar in both built-in themes and light/dark modes.

**Implementation:** [test/page-changes.test.ts::retains menu nodes scroll and reader disclosures across page changes](../../../test/page-changes.test.ts), [test/page-changes.test.ts::replaces a structurally different menu on page change](../../../test/page-changes.test.ts), [test/page-changes.test.ts::highlights current sections without an inset bar in both themes and colour modes](../../../test/page-changes.test.ts), [test/page-changes.test.ts::swaps rendered pages with prefetch history and reading controls](../../../test/page-changes.test.ts), [test/page-changes.test.ts::keeps excluded clicks native and falls back on navigation failures](../../../test/page-changes.test.ts), [test/page-changes.test.ts::bounds prefetch requests and ignores superseded navigation](../../../test/page-changes.test.ts)

<a id="test-viewer-caching"></a>
## Acceptance test: viewer caching

This case checks the page-change contract through executable behavior.

**Method:** test.

**Requirements:** [Change rendered pages without a full load](requirements.md#req-instant-navigation).

**Inputs:** GET and HEAD requests for HTML and renderer assets.

**Expected:** HTML uses no-cache; assets use the configured max-age, defaulting to 3600 seconds.

**Implementation:** [test/server.test.ts::revalidates HTML and caches session assets](../../../test/server.test.ts)

<a id="test-single-file-output"></a>
## Acceptance test: single-file output

This case checks export destinations, embedded resources and existing-target preservation.

**Method:** test.

**Requirements:** [Export one self-contained document](requirements.md#req-single-file-export).

**Inputs:** Two pages, images, themes, explicit and automatic destinations, and existing output.

**Expected:** Standalone mode writes only one HTML file; combined modes retain folder output. All resources are embedded, authored external links retain their behavior and local text links resolve internally, and existing targets are unchanged.

**Implementation:** [test/single-file.test.ts::writes only the standalone file and reports its byte size](../../../test/single-file.test.ts), [test/single-file.test.ts::adds the named file to folder output and supports an explicit combined target](../../../test/single-file.test.ts), [test/single-file.test.ts::refuses existing single-file targets without changing them](../../../test/single-file.test.ts), [test/single-file.test.ts::embeds resources and preserves authored link behavior](../../../test/single-file.test.ts), [test/single-file.test.ts::preserves rendered diagrams and readable offline source in single files](../../../test/single-file.test.ts), [test/single-file.test.ts::refuses a single-file destination that collides with a folder page](../../../test/single-file.test.ts)

<a id="test-single-file-reading"></a>
## Acceptance test: single-file reading

This case checks the portable document through the real browser fixture.

**Method:** test.

**Requirements:** [Export one self-contained document](requirements.md#req-single-file-export).

**Inputs:** A file URL containing two pages with the same heading and a cross-page fragment link.

**Expected:** Menu and previous/next change the visible page, cross-page fragments land on their heading, identifiers remain unique, themes work and browser find can reveal inactive content. No viewing resource references leave the file.

**Implementation:** [test/single-file.test.ts::reads and navigates the standalone document through file URLs](../../../test/single-file.test.ts)

<a id="test-bundled-references"></a>
## Acceptance test: portable references

This case follows portable chapter, source and binary destinations through the real browser fixture.

**Method:** test.

**Requirements:** [Bundle portable local references](requirements.md#req-bundled-references).

**Inputs:** External Markdown with another linked chapter and a cycle, inventory-classified other Markdown, a Git source file with line fragments, UTF-8 text and binary bytes.

**Expected:** Both retained formats opened through file URLs resolve chapter and line destinations internally, expose matching binary bytes, and show portable Git labels. No absolute input/home paths or original-machine URLs appear in generated HTML, text or Markdown-derived content. Theme stylesheet text, embedded resources and opaque binary attachments are exempt from path removal and retain their content. Directly referenced pages appear once under Referenced files. Further targets remain plain text with “not bundled”, portable paths and one warning per target. Broken fragments in bundled references warn and land at the destination top; input-page broken fragments still refuse export. Regression cases also cover published text fields, overlapping path replacements, classification before Markdown parsing, shared and duplicate definitions, shared image bytes after source replacement, portable anchor identities and fragments, and reference links to included images.

**Implementation:** [test/bundled-files.test.ts::bundles Chapter links for both file URL exports](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::bundles Source links for both file URL exports](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::bundles Range links for both file URL exports](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::bundles Binary links for both file URL exports](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::keeps direct and inventory references portable without machine paths](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::marks further local targets as not bundled once per target in both exports](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::warns once and lands at the page top for broken fragments in bundled references](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::refuses broken fragments authored in input pages](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::keeps diagram text portable after SVG rendering in both exports](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::removes input and home paths from Mermaid source before rendering (mermaid=false)](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::removes input and home paths from Mermaid source before rendering (mermaid=true)](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::resolves images in external Markdown from the original source directory](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::reuses the prepared diagram SVG unchanged in the standalone export](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::preserves opaque attachment bytes containing input and home paths in both exports](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::removes machine paths from published image descriptions after loading resources](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::removes machine paths from published manifest titles after loading resources](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::refuses an originally missing fragment that matches a converted anchor](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::maps path-bearing anchor identities and all local references consistently in both exports](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::preserves author stylesheet bytes including path comments and embedded resources in both exports](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::replaces original path occurrences without rewriting inserted portable labels](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::classifies an unselected .md directory before Markdown parsing](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::classifies an unselected .md invalid UTF-8 before Markdown parsing](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::keeps a shared image definition usable as both preview and named download](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::keeps the first duplicate definition as the rendered link destination](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::preserves captured preview and attachment bytes when the source changes after capture](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::keeps reference-page links to images already included through previews](../../../test/bundled-files.test.ts)

<a id="test-bundle-omissions"></a>
## Acceptance test: bundle omissions

This case checks explicit exceptions to bundling without broken local links.

**Method:** test.

**Requirements:** [Bundle portable local references](requirements.md#req-bundled-references).

**Inputs:** A missing file, linked files at and above a configured byte limit, invalid policy or source-line fragments, and an in-root symlink.

**Expected:** Missing labels remain non-link text with warnings. Oversized files visibly show omission and size; files at the limit are bundled. Invalid policy, line destinations and in-root symlinks reject visibly.

**Implementation:** [test/bundled-files.test.ts::lists oversized files and missing labels visibly without local URLs](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::rejects invalid bundle policies](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::rejects unsupported source line fragments](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::refuses linked symlinks inside the input root](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::omits oversized additional Markdown before parsing while exempting selected pages](../../../test/bundled-files.test.ts), [test/bundled-files.test.ts::visibly omits a linked file that grows beyond the read budget after stat](../../../test/bundled-files.test.ts)

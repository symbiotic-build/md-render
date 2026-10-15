<a id="acceptance"></a>
# Acceptance

The executable cases name existing Vitest tests through the declared repository runner.
Their Implementation links use URI-encoded test-name patterns, explained in [Selector execution](reference.md#selector-reference).
An audit passes only when every named pattern runs at least one passing test and no test fails.
Inspection cases identify behavior without automated coverage and name the source evidence to examine.

Runtime evidence is scoped to the assertions in each linked test.
The [implementation gaps](decisions-and-questions.md#open-questions) distinguish settled requirements from behavior the current implementation does not satisfy.

Choose [input and rendering evidence](#input-evidence), [reading controls evidence](#display-evidence) or [output lifecycle evidence](#lifecycle-evidence).

<a id="input-evidence"></a>
## Input and rendering evidence

These cases follow selected sources through definition lookup, URL resolution and body rendering.

<a id="test-source-order"></a>
### Acceptance test: source selection

This case checks that source selection follows author-declared order rather than filename order.
Selected nested-folder priority has a separate [inspection case](#test-selected-folder-index).

Selected Vitest names:

- `follows manifest section order and deduplicates files`.
- `uses the manifest for a selected docs folder without adding unrelated inventory`.
- `puts index.md first without a manifest and includes nested chapters`.

**Method:** test.

**Requirements:** [Select sources in declared order](requirements.md#req-source-order).

**Inputs:** The fixture, a selected docs folder and an independent plain folder.

**Expected:** Declared Home, Tour and index order; no unlisted initial pages; index first for the standalone plain folder.

**Implementation:** [test/renderer.test.ts::follows%5C%20manifest%5C%20section%5C%20order%5C%20and%5C%20deduplicates%5C%20files%24](../../../test/renderer.test.ts), [test/renderer.test.ts::uses%5C%20the%5C%20manifest%5C%20for%5C%20a%5C%20selected%5C%20docs%5C%20folder%5C%20without%5C%20adding%5C%20unrelated%5C%20inventory%24](../../../test/renderer.test.ts), [test/renderer.test.ts::puts%5C%20index%5C.md%5C%20first%5C%20without%5C%20a%5C%20manifest%5C%20and%5C%20includes%5C%20nested%5C%20chapters%24](../../../test/renderer.test.ts)




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

**Implementation:** [test/renderer.test.ts::rewrites%5C%20cross%5C-file%2C%5C%20fragment%2C%5C%20query%5C%20and%5C%20reference%5C%20links%5C%20and%5C%20adds%5C%20entity%5C%20hovers%24](../../../test/renderer.test.ts), [test/renderer.test.ts::refuses%5C%20entity%5C%20homes%5C%20with%5C%20no%5C%20canonical%5C%20meaning%24](../../../test/renderer.test.ts)




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

**Implementation:** [test/renderer.test.ts::resolves%20%5B23%5D%20stacked%20entity%20anchors%20in%20a%20%28paragraph%7Chtml%7Cadjacent%29%20block%24](../../../test/renderer.test.ts), [test/renderer.test.ts::rejects%20duplicate%20ids%20in%20stacked%20anchors%20with%20.%2A%20before%20the%20closing%20tag%24](../../../test/renderer.test.ts), [test/renderer.test.ts::rewrites%5C%20cross%5C-file%2C%5C%20fragment%2C%5C%20query%5C%20and%5C%20reference%5C%20links%5C%20and%5C%20adds%5C%20entity%5C%20hovers%24](../../../test/renderer.test.ts), [test/renderer.test.ts::refuses%5C%20missing%5C%20Markdown%5C%20targets%5C%20and%5C%20fragments%24](../../../test/renderer.test.ts)




<a id="test-reference-pages"></a>
### Acceptance test: referenced files

This case checks referenced-page discovery and the original-file treatment of native sources.

Selected Vitest names:

- `renders linked repository Markdown recursively in a collapsed referenced group`.
- `keeps reference-style non-Markdown labels with a file icon and repository path`.

**Method:** test.

**Requirements:** [Render references without changing authored labels](requirements.md#req-reference-pages).

**Inputs:** A manifest page linking to two further Markdown pages, a cycle and a source file.

**Expected:** Referenced HTML pages appear once; the group is collapsed off-reference; the native file keeps its label and original-file URL.

**Implementation:** [test/renderer.test.ts::renders%5C%20linked%5C%20repository%5C%20Markdown%5C%20recursively%5C%20in%5C%20a%5C%20collapsed%5C%20referenced%5C%20group%24](../../../test/renderer.test.ts), [test/renderer.test.ts::keeps%5C%20reference%5C-style%5C%20non%5C-Markdown%5C%20labels%5C%20with%5C%20a%5C%20file%5C%20icon%5C%20and%5C%20repository%5C%20path%24](../../../test/renderer.test.ts)




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

**Implementation:** [test/renderer.test.ts::renders%5C%20unsupported%5C%20raw%5C%20HTML%5C%20as%5C%20text%5C%20and%5C%20blocks%5C%20executable%5C%20markup%24](../../../test/renderer.test.ts), [test/renderer.test.ts::rejects%5C%20image%5C%20escapes%5C%20and%5C%20executable%5C%20links%24](../../../test/renderer.test.ts), [test/renderer.test.ts::applies%5C%20offline%5C%20image%5C%20rules%5C%20to%5C%20reference%5C-style%5C%20images%24](../../../test/renderer.test.ts), [test/renderer.test.ts::preserves%5C%20encoded%5C%20filenames%5C%20and%5C%20copies%5C%20reference%5C-style%5C%20local%5C%20images%24](../../../test/renderer.test.ts), [test/renderer.test.ts::refuses%5C%20output%5C%20collisions%5C%20between%5C%20attachments%5C%20and%5C%20rendered%5C%20pages%24](../../../test/renderer.test.ts)




<a id="test-diagram-build"></a>
### Acceptance test: diagram build

This case distinguishes static SVG from the explicit source-only display.

Selected Vitest names:

- `builds pinned offline Mermaid SVG without viewer scripts`.


**Method:** test.

**Requirements:** [Build diagrams before viewing](requirements.md#req-diagram-build).

**Inputs:** The fixture flowchart with the installed renderer and with Mermaid disabled.

**Expected:** The build produces SVG without viewer Mermaid scripts; disabled rendering visibly shows source.

**Implementation:** [test/renderer.test.ts::builds%5C%20pinned%5C%20offline%5C%20Mermaid%5C%20SVG%5C%20without%5C%20viewer%5C%20scripts%24](../../../test/renderer.test.ts), [test/renderer.test.ts::rewrites%5C%20cross%5C-file%2C%5C%20fragment%2C%5C%20query%5C%20and%5C%20reference%5C%20links%5C%20and%5C%20adds%5C%20entity%5C%20hovers%24](../../../test/renderer.test.ts)

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

**Expected:** The menu has one current page, no redundant structural title and the last section above the reading line marked current.

**Implementation:** [test/navigation.test.ts::flattens%5C%20single%5C-chapter%5C%20documents%5C%20to%5C%20their%5C%20document%5C%20title%5C%20with%5C%20current%5C%20sections%24](../../../test/navigation.test.ts), [test/navigation.test.ts::labels%5C%20the%5C%20first%5C%20chapter%5C%20by%5C%20its%5C%20heading%2C%5C%20first%5C%20level%5C-two%5C%20heading%5C%20or%5C%20Introduction%5C%20without%5C%20adjacent%5C%20duplicate%5C%20labels%24](../../../test/navigation.test.ts), [test/navigation.test.ts::tracks%5C%20the%5C%20last%5C%20section%5C%20above%5C%20the%5C%20reading%5C%20line%2C%5C%20handles%5C%20hash%5C%20navigation%5C%20and%5C%20reveals%5C%20the%5C%20current%5C%20entry%5C%20without%5C%20scrolling%5C%20the%5C%20page%24](../../../test/navigation.test.ts)




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

**Implementation:** [test/browser.test.ts::checks%5C%20rendered%5C%20menu%2C%5C%20theme%5C%20controls%2C%5C%20storage%5C%20failure%5C%20and%5C%20diagram%5C%20contrast%5C%20in%5C%20both%5C%20themes%24](../../../test/browser.test.ts), [test/layout.test.ts::keeps%5C%20wide%5C%20diagrams%5C%20readable%2C%5C%20contains%5C%20code%5C%20and%5C%20table%5C%20overflow%2C%5C%20and%5C%20prints%5C%20on%5C%20white%5C%20from%5C%20either%5C%20theme%24](../../../test/layout.test.ts), [test/navigation.test.ts::keeps%5C%20a%5C%20tall%5C%20sidebar%5C%20fixed%5C%20with%5C%20independent%5C%20scrolling%5C%20at%5C%20desktop%5C%20widths%5C%20and%5C%20only%5C%20one%5C%20document%5C%20navigation%5C%20at%5C%20every%5C%20width%24](../../../test/navigation.test.ts)




<a id="test-theme-mode"></a>
### Acceptance test: colour mode and contrast

This case checks palette restoration and the documented built-in diagram contrast pairs.

Selected Vitest names:

- `checks rendered menu, theme controls, storage failure and diagram contrast in both themes`.

**Method:** test.

**Requirements:** [Restore colour mode before first paint](requirements.md#req-theme-mode).

**Inputs:** Both built-in themes, both explicit modes, System and unavailable browser storage.

**Expected:** Restored selection and radio controls agree; tested diagram colour pairs meet the bound; unavailable storage leaves the page readable and its current selection usable.

**Implementation:** [test/browser.test.ts::checks%5C%20rendered%5C%20menu%2C%5C%20theme%5C%20controls%2C%5C%20storage%5C%20failure%5C%20and%5C%20diagram%5C%20contrast%5C%20in%5C%20both%5C%20themes%24](../../../test/browser.test.ts)


Head-script ordering and console-warning text need source inspection of [src/site.ts](../../../src/site.ts) and [themes/theme-init.js](../../../themes/theme-init.js); the automated case does not assert them.



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

**Implementation:** [test/renderer.test.ts::omits%5C%20only%5C%20the%5C%20marked%5C%20level%5C-two%5C%20document%5C%20map%5C%20and%5C%20keeps%5C%20its%5C%20siblings%5C%20unchanged%24](../../../test/renderer.test.ts), [test/renderer.test.ts::resolves%20inbound%20links%20to%20omitted%20anchors%20and%20keeps%20menu%20siblings%20%5C%28%5B%5Cs%5CS%5D%2A%5C%29%24](../../../test/renderer.test.ts), [test/renderer.test.ts::groups%5C%20chapters%5C%20by%5C%20document%5C%20title%2C%5C%20uses%5C%20first%5C%20headings%5C%20over%5C%20manifest%5C%20labels%5C%20and%5C%20follows%5C%20manifest%5C%20order%24](../../../test/renderer.test.ts)

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

**Implementation:** [test/server.test.ts::serves%5C%20pages%5C%20on%5C%20a%5C%20free%5C%20loopback%5C%20port%5C%20and%5C%20removes%5C%20output%5C%20on%5C%20close%24](../../../test/server.test.ts), [test/server.test.ts::removes%5C%20temporary%5C%20CLI%5C%20output%5C%20on%5C%20SIGINT%24](../../../test/server.test.ts), [test/server.test.ts::removes%5C%20temporary%5C%20CLI%5C%20output%5C%20on%5C%20SIGTERM%24](../../../test/server.test.ts), [test/server.test.ts::removes%5C%20output%5C%20on%5C%20normal%5C%20process%5C%20exit%24](../../../test/server.test.ts), [test/server.test.ts::returns%5C%20a%5C%20visible%5C%20error%5C%20for%5C%20invalid%5C%20input%5C%20and%5C%20cleans%5C%20startup%5C%20resources%24](../../../test/server.test.ts)




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

**Implementation:** [test/renderer.test.ts::rejects%5C%20an%5C%20unknown%5C%20real%5C-format%5C%20manifest%5C%20version%5C%20before%5C%20selecting%5C%20files%24](../../../test/renderer.test.ts), [test/renderer.test.ts::still%5C%20refuses%5C%20symlinked%5C%20manifest%5C%20sections%5C%20and%5C%20symlinked%5C%20parent%5C%20directories%24](../../../test/renderer.test.ts), [test/renderer.test.ts::refuses%5C%20missing%5C%20Markdown%5C%20targets%5C%20and%5C%20fragments%24](../../../test/renderer.test.ts), [test/renderer.test.ts::refuses%5C%20entity%5C%20homes%5C%20with%5C%20no%5C%20canonical%5C%20meaning%24](../../../test/renderer.test.ts)




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

**Implementation:** [test/renderer.test.ts::does%5C%20not%5C%20overwrite%5C%20existing%5C%20static%5C%20output%24](../../../test/renderer.test.ts), [test/server.test.ts::keeps%5C%20static%5C%20output%5C%20after%5C%20the%5C%20CLI%5C%20exits%24](../../../test/server.test.ts)

Partial-write recovery remains a source-inspected limitation described at [Static export](serving-and-export.md#static-export).




<a id="test-selected-folder-index"></a>
## Acceptance test: selected nested-folder index

This inspection exposes the gap between the settled folder order and the current root-relative comparison.
No automated test covers a selected plain folder nested inside a repository.

**Method:** test.

**Requirements:** [Select sources in declared order](requirements.md#req-source-order).

**Inputs:** A repository without metadata, containing `nested/a.md` and `nested/index.md`; select `nested`.

**Expected:** The selected folder's index opens before `a.md`, even though repository discovery retains repository-relative paths.

**Implementation:** [test/renderer.test.ts::opens%5C%20the%5C%20selected%5C%20nested%5C%20folder%5C%20index%5C%20before%5C%20its%5C%20remaining%5C%20lexical%5C%20paths%24](../../../test/renderer.test.ts)

Evidence: inspect `loadCorpus` in [src/corpus.ts](../../../src/corpus.ts).
Its comparison with the exact root-relative `index.md` leaves `nested/a.md` first, so this inspection currently fails.
The [settled folder decision](decisions-and-questions.md#question-nested-index) requires a later runtime fix.

<a id="test-adjacent-equal-titles"></a>
## Acceptance test: adjacent equal authored titles

This inspection checks consecutive equal titles outside the tested group/chapter suppression.
No automated test covers equal titles in consecutive unrelated chapters.

**Method:** test.

**Requirements:** [Provide one chapter and section menu](requirements.md#req-menu-navigation).

**Inputs:** Two consecutive chapters titled Guide in one manifest document, with no section links separating their menu entries.

**Expected:** Guide is not listed twice in a row; equal titles separated by other entries remain allowed.

**Implementation:** [test/renderer.test.ts::qualifies%5C%20adjacent%5C%20equal%5C%20chapter%5C%20labels%5C%20with%5C%20source%5C%20relative%5C%20paths%5C%20while%5C%20retaining%5C%20both%5C%20links%24](../../../test/renderer.test.ts)

Evidence: inspect the `chapters` helper in [src/site.ts](../../../src/site.ts).
It compares a chapter only with its group and first outline heading, so unrelated consecutive Guide entries remain duplicated.
This inspection currently fails the [settled title decision](decisions-and-questions.md#question-equal-titles).

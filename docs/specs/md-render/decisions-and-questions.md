<a id="decisions-and-questions"></a>
# Decisions and questions

This chapter identifies the authority for implementation choices and preserves the lead’s settled scope decisions.
The specification remains a draft pending lead acceptance.

<a id="derived-output-choice"></a>
## Rebuild from local sources

**Choice:** Use local Markdown, metadata and theme files as inputs; rebuild the complete static site for each invocation.

**Authority:** Current implementation in [src/site.ts](../../../src/site.ts) and [src/corpus.ts](../../../src/corpus.ts); this authored contract remains a proposal for lead acceptance.

**Reason:** The CLI and package API both need a self-contained site. One parsed tree per page supplies rendering and validation without persistent indexes.

**Rejected alternatives:** A persistent rendering database duplicates source authority. Browser-side diagram generation adds a viewing dependency that the current static SVG output avoids. These are author assessments, not evidence of earlier operator decisions.

<a id="navigation-choice"></a>
## Keep one reading menu

**Choice:** Use one [reading menu](reading-pages.md#reading-menu), plus previous/next controls; omit the generated body Document map only inside its exact navigation region.

**Authority:** Shipped layout in [src/site.ts](../../../src/site.ts), omission in [src/markdown.ts](../../../src/markdown.ts), and the navigation-focused Git commits ending at `7570192`; lead acceptance of this specification is pending.

**Reason:** Readers can move between chapters and sections without a second contents list in the article.

**Rejected alternatives:** An additional On this page block repeats section links. Removing every authored Document map would erase content outside the generated region. Neither alternative describes the current system.

<a id="evidence-choice"></a>
## Execute TypeScript acceptance evidence

**Choice:** Mark automated acceptance cases with Method `test` and exact full-name Implementation selectors.
Declare JUnit report matching and one batched fallback in the manifest's `test_runners` entry.

**Authority:** The task pins House Rules commit `e8a17db0a3af83b597f1d313e0d9a2b4f688edd3` and requires report-based auditing.

**Reason:** The shared selector audit reads normal-run results without rerunning each citation.
[Selector execution](reference.md#selector-reference) defines the report mapping, commands and single-invocation fallback.
A skipped or missing testcase cannot count as passing evidence.

**Rejected alternatives:** Per-selector processes repeat test startup and browser work.
Inspection alone hides executable coverage; name filtering alone can succeed without running a matching case.

<a id="title-label-proposal"></a>
## Qualify later duplicate chapter labels

**Choice:** After structural group/chapter suppression, append ` — ` and the source-root-relative file path to a later chapter label when it equals the preceding menu title. Compare plain displayed text with exact case. Keep both chapter links.

**Authority:** Current implementation in [src/site.ts::page](../../../src/site.ts), fulfilling the lead’s [settled adjacent-title requirement](#question-equal-titles). Lead acceptance of the path-qualifier design remains pending.

**Reason:** Two consecutive chapters called Guide remain reachable as Guide and Guide — b.md. This adds no stored title or global uniqueness rule.

**Rejected alternatives:** Hiding the later chapter removes its destination. Renaming all equal titles changes unrelated entries. Leaving consecutive equal labels contradicts the lead’s answer.

<a id="scope-decisions"></a>
## Settled scope decisions

The lead supplied these answers on 2026-10-16 in “Lead answers to the md-render open questions”.
Each answer defines scope; an implementation gap does not reopen the decision.

<a id="question-document-map"></a>
### Name the menu in the user guide

**Choice:** The README's “document map” means the [reading menu](reading-pages.md#reading-menu). Call it a menu in [README.md](../../../README.md).

**Authority:** Lead answer: “README ‘document map’ means the menu; update README.”

**Reason:** Readers need one name for the chapter-and-section control. The generated Markdown Document map remains a separate source structure whose duplicate body list is omitted.

**Rejected alternatives:** A second body contents list contradicts the single-menu display.

<a id="question-nested-index"></a>
### Open the selected folder's index first

**Choice:** Without a manifest, open the selected plain folder's `index.md` first, including when that folder is nested inside a repository.

**Authority:** Lead answer: “when a plain folder is selected, its `index.md` opens first.”

**Reason:** Selecting a folder should begin at that folder's introduction. Repository-root discovery still supplies the boundary for sibling links.

**Rejected alternatives:** Promoting only the repository-root index leaves a nested folder's introduction in lexical order.

<a id="question-scrollbars"></a>
### Permit a tall menu to scroll

**Choice:** Keep the desktop sidebar fixed. Allow a tall open menu to scroll independently. Normal reading with a closed or fitting menu has no second vertical scrolling pane.

**Authority:** Lead answer permits independent tall-sidebar scrolling and applies “no second scrollbar” to a closed or fitting menu.

**Reason:** A reader must reach every entry without moving the article. [test/navigation.test.ts](../../../test/navigation.test.ts) checks the fixed sidebar and independent list scrolling.

**Rejected alternatives:** Forbidding menu scrolling makes tall navigation inaccessible; scrolling the article in a separate pane adds an unnecessary scroller.

<a id="question-equal-titles"></a>
### Suppress consecutive duplicate titles

**Choice:** Never list the same title twice in a row in the menu. Allow unrelated equal titles elsewhere.

**Authority:** Lead answer: “no title listed twice in a row in the menu; unrelated equal titles elsewhere are allowed.”

**Reason:** Adjacent duplication repeats the reader's immediate choice. Equal titles separated by other entries need no global renaming rule.

**Rejected alternatives:** Global title uniqueness changes unrelated labels. Limiting suppression to group/chapter pairs leaves other adjacent duplicates.

<a id="question-contrast-scope"></a>
### Bound built-in theme contrast

**Choice:** Apply contrast requirements to the built-in themes and their diagram colours. Custom themes are their authors' responsibility.

**Authority:** Lead answer: “built-in themes and their diagram colours; custom themes are the theme author's responsibility.”

**Reason:** The renderer owns the built-in palettes. The [diagram contrast evidence](resolving-content.md#diagram-rendering) establishes the bound for the tested pairs, not every diagram family or arbitrary custom CSS.

**Rejected alternatives:** Claiming universal custom-theme contrast exceeds the renderer's control and its tests.

<a id="question-symlink-root"></a>
### Refuse symlinks inside the source root

**Choice:** Refuse symlinks in every rendered input path component inside the source root. Ancestors above that root are out of scope.

**Authority:** Lead answer defines that exact boundary.

**Reason:** [src/corpus.ts](../../../src/corpus.ts) normalizes the selected root and refuses symlinked reads beneath it. This includes linked Markdown and copied images, not only initial pages.

**Rejected alternatives:** Checking ancestors above the source root broadens the settled boundary. Checking only the final filename misses symlinked parent directories inside it.

<a id="bundle-local-files-choice"></a>
## Bundle local files for sharing

**Choice:** Bundle local files linked by the input’s own rendered pages in both retained export formats, including Markdown outside the input root.

**Authority:** Operator decision, 2026-10-18: “no they should get bundled in”. This supersedes original-file links in retained exports.

**Reason:** An export must work on another machine. Machine-local destinations do not satisfy that purpose.
The [bundling procedure](serving-and-export.md#bundled-local-references) defines portable destinations and visible exceptions.

**Rejected alternatives:** Retaining original-file URLs requires the author's filesystem. Dropping local links loses requested material.

**Implementation proposal:** Render text with line numbers and use a versioned per-file byte limit.
Keep the viewer's existing local-reading behavior and expose portable retained output through `exportSite`.
The [reference](reference.md#bundle-reference) defines the configurable bound and accepted line-fragment forms for lead acceptance.

<a id="bundle-depth-choice"></a>
## Bundle one level of local references

**Choice:** Bundle local files linked directly from the input’s own rendered pages, including registered documents and directly rendered in-root Markdown pages.
Do not discover further files through bundled references.
Further local links retain their authored label as plain text, followed by “not bundled” and the portable path label.
Warn once per unbundled target; never show an absolute path or original-machine URL.

**Authority:** Lead decision, 2026-10-18, refining the operator’s “bundle them in” decision.

**Reason:** Recursive discovery expanded 45 direct references into 365 Markdown and 120 text pages, mostly unrelated notes, according to the lead’s export evidence.

**Rejected alternatives:** Recursive inclusion adds unrelated material. Silent omission hides the boundary from readers.

<a id="bundle-fragment-choice"></a>
## Warn for broken fragments in bundled references

**Choice:** Keep fragment validation strict for links authored in the input’s own pages; a broken fragment refuses export.
In a bundled reference page, a missing destination fragment links to that page’s top and produces a visible warning.
The export continues.

**Authority:** Lead decision, 2026-10-18, refining the operator’s “bundle them in” decision.

**Reason:** Supporting files can contain stale fragments without preventing readers from sharing the selected document.

**Rejected alternatives:** Relaxing selected-page validation hides input defects. Refusing stale reference fragments prevents the requested export.

<a id="open-questions"></a>
## Open questions and implementation evidence

No operator decision remains open from the six questions.
Both previously identified runtime gaps are repaired in commit `4305d3e`:

- [Selected-folder index priority](#question-nested-index): `loadCorpus` compares paths with the selected folder's repository-relative index path in [src/corpus.ts::loadCorpus](../../../src/corpus.ts). The [nested-folder acceptance case](acceptance.md#test-selected-folder-index) checks selection and rendered entry order.
- [Consecutive title suppression](#question-equal-titles): `page` compares menu titles in output order in [src/site.ts::page](../../../src/site.ts). The [equal-title acceptance case](acceptance.md#test-adjacent-equal-titles) checks qualification, intervening sections and retained chapter links.

These cases provide executable evidence; they are not pending inspections.
Passing them does not establish behavior beyond their assertions.

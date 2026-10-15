<a id="decisions-and-questions"></a>
# Decisions and questions

This chapter separates proposed implementation choices from the lead’s settled scope decisions.
The specification remains a draft; known implementation gaps remain visible rather than being described as satisfied requirements.

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

**Choice:** Mark automated acceptance cases with Method `test`. Each Implementation field links a test file and runnable name pattern. The manifest’s `test_runners` entry supplies the execution command.

**Authority:** The task requires the language-neutral runner contract and executable evidence.

**Reason:** The shared authoring tool’s selector audit executes each Implementation link through the repository-declared command.
It is a specification gate, not part of the renderer’s runtime. [scripts/vitest-selector.mjs](../../../scripts/vitest-selector.mjs) adapts Vitest's name filtering to the audit's missing-selector exit status. A skipped file cannot count as passing evidence.

**Rejected alternatives:** Inspection alone hides executable coverage. Calling Vitest directly treats an unmatched name filter as success. Python wrappers add an unrelated test framework.

<a id="title-label-proposal"></a>
## Qualify later duplicate chapter labels

**Choice:** After structural group/chapter suppression, append ` — ` and the source-root-relative file path to a later chapter label when it equals the preceding menu title. Compare plain displayed text with exact case. Keep both chapter links.

**Authority:** Author proposal to complete the lead’s settled adjacent-title requirement; lead acceptance is pending.

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

<a id="open-questions"></a>
## Open questions and implementation gaps

No operator decision remains open from the six questions.
Two settled requirements need runtime work outside this specification revision:

- [Selected-folder index priority](#question-nested-index): `loadCorpus` in [src/corpus.ts](../../../src/corpus.ts) promotes only the exact root-relative index. The [nested-folder inspection](acceptance.md#test-selected-folder-index) records the uncovered case.
- [Consecutive title suppression](#question-equal-titles): the `chapters` helper in [src/site.ts](../../../src/site.ts) removes structural repetition, but does not compare consecutive unrelated chapter labels. The [equal-title inspection](acceptance.md#test-adjacent-equal-titles) records that gap.

Existing automated cases continue to establish the narrower behavior they assert.
The lead can assign the runtime repairs without choosing these scopes again.

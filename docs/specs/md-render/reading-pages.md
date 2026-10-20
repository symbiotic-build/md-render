<a id="reading-pages"></a>
# Reading pages

This chapter explains chapter labels, current-section tracking and the controls that keep pages readable across widths and colour modes.
Readers use Previous and Next to follow the declared reading order.

<a id="reading-menu"></a>
## Reading menu

The reading menu is the single chapter-and-section navigation in the page sidebar or compact-screen overlay.
It combines document groups, chapters and section links so the article needs no second contents block.

| Key | Value | Status | Basis |
|---|---|---|---|
| <a id="desktop-width"></a>desktop-width | 1024 px | specified | [themes/base.css](../../../themes/base.css) |

At [desktop-width](#desktop-width) and wider, the sidebar stays fixed beneath the sticky menu bar while the document scrolls.
The Menu button hides or shows it.
The initial desktop state is expanded; browser storage remembers subsequent changes.

Below that boundary, the menu starts closed and opens as a full-screen overlay.
The overlay locks background scrolling, makes background controls inert and keeps keyboard focus inside it.
Escape, Close menu or following a same-page link closes the overlay and restores focus to Menu. A page swap instead focuses the new heading.
The compact open state is not persisted.

The [document manifest](selecting-sources.md#document-manifest) supplies group titles and chapter order.
The tour's Home and Tour appear together under Synthetic guide.
Without a manifest, all initially selected pages belong to one group.
A multi-page group is labelled Documentation; a single page has only its chapter entry.
For example, a plain folder containing `index.md` headed Start and `a.md` headed Detail lists Documentation, Start, then Detail.

Title comparisons are case-sensitive and use plain heading text, with Markdown formatting removed.
They apply no further case or whitespace normalization.
For example, a book and first chapter both called Guide use the chapter’s Overview section as its menu label.

The menu must never list equal titles consecutively, even for unrelated chapters.
Equal titles elsewhere keep their names.
The [label rule](decisions-and-questions.md#title-label-proposal) qualifies the later entry with its source-root-relative path so both chapters stay reachable.
The [equal-title acceptance case](acceptance.md#test-adjacent-equal-titles) checks consecutive labels and intervening sections.

The renderer does not use filename slugs as chapter titles.
The duplicate-label path qualifier adds menu text without changing the authored title.
Referenced pages additionally show their paths so heading-free pages remain distinguishable.

Apply label rules in this order so overlapping conditions have one result:

**Procedure: choose chapter menu text**

1. **Choose the parsed title:** use the first heading, otherwise nonempty YAML title, otherwise Untitled chapter.
2. **Choose the chapter label:** use the document title for a single-chapter document when that title exists.
   Otherwise, keep the parsed title unless the first chapter of a multi-chapter group repeats its group title.
   That chapter uses its first level-two heading, or Introduction when none exists.
3. **Remove a repeated outline entry:** if the first entry equals the chosen label, replace it with its children.
   Otherwise, retain the outline; the heading always remains in the article.
4. **Compare menu titles in output order:** if the chapter entry equals the preceding title, append its source-root-relative path.
   A referenced chapter's comparison text already includes its displayed path.

Group headings and all section links, including links inside collapsed disclosures, participate in that output order.
With no preceding title, keep the chapter label.
A first chapter cannot simultaneously belong to a single-chapter and a multi-chapter group.
Later chapters cannot take the first-chapter substitution branch.
For Guide, Guide, Guide with no sections, the labels become Guide, Guide — b.md, Guide when the middle file is `b.md`.
If Section intervenes between two Guide chapter entries, both Guide labels remain.

Each chapter with sections has an independent disclosure.
The current chapter starts expanded; other chapters start collapsed.
Level-two sections appear in source order; level-three subsections nest under the preceding level-two section.
Deeper headings remain in the article but do not enter this outline.

Before the first section reaches the reading line, only the page entry is current.
While scrolling, the last section at or above one-third of the viewport height is highlighted.
In both built-in themes and both colour modes, the current section uses a background tint and bold text without an inset bar.
Hash navigation immediately selects its matching entry and expands the chapter as needed.
Revealing a current entry scrolls only the menu list, not the article.

<a id="colour-mode"></a>
## Colour mode

The colour controls keep the selected page palette consistent across navigation and diagrams.
The bottom of both the sidebar and phone overlay contains one compact group with `role="group"` and `aria-label="Appearance"`.
It has no visible title or text labels.

Three icon buttons appear in this order: Light (sun), System (computer screen), Dark (moon).
Each button has its mode name as both `aria-label` and `title`; exactly the selected button has `aria-pressed="true"`.
The buttons use native Tab focus and Enter or Space activation.

The portal-style pill uses a 1 px `--line` border, 8 px radius, 3 px padding and 2 px gap.
Its buttons are 30 × 28 px with 5 px radius and 15 px icons drawn in a 24 × 24 view box.

Icons use no fill, current-colour strokes of width 1.8, and round caps and joins.
Idle icons use `--muted`, hover uses `--tint`, and the pressed button uses `--accent` with a `--paper` icon.
Keyboard focus has a visible accent ring in both built-in themes and colour modes.
System follows the operating-system preference; Light and Dark set explicit overrides.
The default is System. Without JavaScript the group is hidden and System applies.

An inline script in the head restores the saved override before the stylesheets load.
This establishes the selected colour mode before first paint.
A content security policy authorizes that exact script by its hash.
Choosing System removes the override from browser storage.

The existing per-viewer choice survives instant page changes and also controls diagram colours.
For example, choosing Dark presses only the moon button and stores `dark` under `md-render-theme`; choosing System clears that key and presses only the screen button.
Storage failures produce console warnings and keep the selected mode usable for the current page.
They do not prevent reading.

The theme option chooses the site's CSS, independently of the colour mode.
The neutral `default` theme is the default; `symbiotic` selects the Symbiotic brand palette and logo.
Custom CSS is copied as supplied, with one optional neighbouring SVG, PNG or WebP logo.
Custom theme authors must keep extra resources inline to preserve offline use.
They also own contrast in their custom CSS; the renderer’s contrast obligation covers its built-in themes and their diagram colours.
The built-in theme contrast evidence belongs to [Diagram rendering](resolving-content.md#diagram-rendering).

<a id="article-display"></a>
## Article display

The article preserves authored content without introducing another navigation layer.
Headings receive no automatic numbering; authored numbers remain visible.
Within an exact generated navigation region, the level-two Document map subtree is omitted.
The [marker lookup](reference.md#anchor-reference) shows the complete opening and closing comment syntax.
The generated Overview and term-list sections remain in the article.
The latter is a term list generated from the [entity index](selecting-sources.md#entity-index) JSON input.

Anchors from the omitted subtree stay as empty targets so inbound links still resolve.
An authored Document map outside the exact region remains visible.

Previous and Next follow the initial deduplicated file order.
The first page has no Previous destination; the last has no Next destination.
Referenced pages have neither destination because they have no position in that order.
An authored index page keeps its own output; otherwise a root index redirects to the first page.

Normal reading scrolls the document rather than a separate article pane.
Wide code, tables and diagrams scroll inside their own containers rather than widening the page.
A tall menu list can have an independent thin scrollbar.
With the menu closed or fitting, normal reading has no second vertical scrollbar.
The [settled scrolling decision](decisions-and-questions.md#question-scrollbars) permits the tall-menu exception while keeping the sidebar fixed.

Without JavaScript, the menu remains visible and chapter links remain accessible; interactive controls are hidden.
Print styles hide navigation and use black text on white paper.

<a id="page-changes"></a>
## Page changes

Rendered pages on the same HTTP origin share one reading session. A hovered or focused link starts fetching its HTML; previous/next pages are prefetched after initial load and each swap. The native fetch and History APIs supply transport and navigation; no router, database or disk cache is added.

The version-1 `RenderOptions.navigation` configuration sets `cachePages` (default 6, a positive integer) and `assetMaxAgeSeconds` (default 3600, a nonnegative integer). Six entries retain the two adjacent destinations and four recent or intended destinations; eviction discards the oldest entry and aborts any unfinished fetch. The generated navigation meta tag carries the version and page bound. The cache is rebuilt from rendered HTML and disappears with the document. HTTP asset caching lasts one hour by default because viewer output is immutable for the process lifetime; HTML is revalidated with `no-cache`.

**Procedure: change a page**

1. **Recognize a rendered link:** require same origin and a path in the chapter menu, HTTP or HTTPS, and a different page URL. Only unmodified left clicks without a `target` or `download` attribute are intercepted. Fragment-only links remain native.
2. **Fetch and validate:** reuse an existing cache request or fetch HTML. Require a successful nonredirected HTML response with the renderer configuration, main, article, title and document-map navigation. A failure logs its cause and loads the requested URL normally. File-URL exports continue to use normal links.
3. **Remember the current position:** save scroll coordinates in memory under the current history entry key, then push the new URL with a fresh key. A later navigation supersedes an unfinished earlier one.
4. **Swap and initialize:** replace main content and title while retaining the wrapper and menu DOM when its structure matches. Compare menu structure and resolved link destinations, ignoring current markers and disclosure state. Update only changed link targets and current markers, open the new current chapter (and its containing disclosure), and retain all other reader-selected disclosure states and menu scroll coordinates. Replace menu children only when the target menu differs structurally, such as another document set. Rebind section tracking, close a compact overlay and preserve the existing colour choice. Static SVG diagrams arrive in the new article without script execution.
5. **Place the reader:** focus the new article's first heading (or main for a heading-free page) without scrolling, then scroll to the decoded fragment or top. Back/forward uses the same swap, restores stored coordinates, and falls back to the URL on failure. Same-page history also restores position.

Browser history entries carry a navigation key; a document-scoped map holds each entry's scroll coordinates. Saving only when leaving an entry avoids repeated History API writes during scrolling. No new local-storage keys or persistent source structures are introduced.

For example, a reader opens Chapter 4, closes Chapter 1 and scrolls the menu before following Chapter 2’s End section. The existing menu nodes and scroll coordinates remain. Chapter 4 stays open and Chapter 1 stays closed. Chapter 2 opens, and its page and End section become current. Relative links update when Chapter 2 lives in a different directory. Subsequent reading scrolls and same-page hash changes still reveal the current entry.

<a id="reading-pages"></a>
# Reading pages

Readers choose chapters and sections in one menu, then use Previous and Next to follow the declared reading order.
Readers can hide the menu, follow the section being read and select a colour mode.

<a id="reading-menu"></a>
## Reading menu

The reading menu is the single chapter-and-section navigation in the page sidebar or compact-screen overlay.
It combines document groups, chapters and section links so the article needs no second contents block.

| Key | Value | Status | Basis |
|---|---|---|---|
| <a id="desktop-width"></a>desktop-width | 1024 px | implemented | [themes/base.css](../../../themes/base.css) |

At [desktop-width](#desktop-width) and wider, the sidebar stays fixed beneath the sticky menu bar while the document scrolls.
The Menu button hides or shows it.
The initial desktop state is expanded; browser storage remembers subsequent changes.

Below that boundary, the menu starts closed and opens as a full-screen overlay.
The overlay locks background scrolling, makes background controls inert and keeps keyboard focus inside it.
Escape, Close menu or following a link closes the overlay and restores focus to Menu.
The compact open state is not persisted.

The [document manifest](selecting-sources.md#document-manifest) supplies group titles and chapter order.
The tour's Home and Tour appear together under Synthetic guide.
Without a manifest, all initially selected pages belong to one group.
A multi-page group is labelled Documentation; a single page has only its chapter entry.
For example, a plain folder containing `index.md` headed Start and `a.md` headed Detail lists Documentation, Start, then Detail.

A single-chapter document displays one entry labelled with the document title rather than a repeated group heading.
For a multi-chapter document, chapter labels use the first authored heading.
If the first chapter title exactly equals its group title, its first level-two heading labels the chapter instead.

The comparison is case-sensitive and compares plain heading text, with Markdown formatting removed.
It applies no further case or whitespace normalization.
With no such heading, the label is Introduction.
When the first outline heading also labels the chapter, the menu lists it once and retains its child links.
The heading remains in the article.

For example, a book and first chapter both called Guide use the chapter’s Overview section as its menu label.
The menu must never list equal titles consecutively, even for unrelated chapters.
Equal titles elsewhere keep their names.
The [proposed label rule](decisions-and-questions.md#title-label-proposal) qualifies the later entry with its source-root-relative path so both chapters stay reachable.
Current structural suppression does not compare consecutive unrelated chapters; that remains an [implementation gap](decisions-and-questions.md#open-questions).

A heading overrides a conflicting YAML title.
Without any heading, a nonempty YAML title supplies the label; otherwise the label is Untitled chapter.
The renderer does not use filename slugs as chapter titles.
The proposed duplicate-label path qualifier adds menu text without changing the authored title.
Referenced pages additionally show their paths so heading-free pages remain distinguishable.

Each chapter with sections has an independent disclosure.
The current chapter starts expanded; other chapters start collapsed.
Level-two sections appear in source order; level-three subsections nest under the preceding level-two section.
Deeper headings remain in the article but do not enter this outline.

Before the first section reaches the reading line, only the page entry is current.
While scrolling, the last section at or above one-third of the viewport height is highlighted.
Hash navigation immediately selects its matching entry and expands the chapter as needed.
Revealing a current entry scrolls only the menu list, not the article.

<a id="colour-mode"></a>
## Colour mode

The colour controls keep the selected page palette consistent across navigation and diagrams.
System, Light and Dark form a native radio group at the bottom of the menu.
System follows the operating-system preference; Light and Dark set explicit overrides.
The default is System.

An inline script in the head restores the saved override before the stylesheets load.
This establishes the selected colour mode before first paint.
A content security policy authorizes that exact script by its hash.
Choosing System removes the override from browser storage.
Storage failures produce console warnings and keep the selected mode usable for the current page.
They do not prevent reading.

The theme option chooses the site's CSS, independently of the colour mode.
Symbiotic is the default; default selects the neutral palette.
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

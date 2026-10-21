<a id="resolving-content"></a>
# Resolving content

This chapter explains how parsing, link validation and diagram builds preserve authored relationships in the HTML output.
Parsing precedes link validation, so forward links and referenced-page cycles can resolve against the complete set.

<a id="content-pipeline"></a>
## Parse and resolve

The renderer parses initially selected pages and discovered Markdown references before checking rendered destinations.
Retained exports use [one-level bundling](serving-and-export.md#bundled-local-references); the [temporary viewer](serving-and-export.md#temporary-viewer) uses the one-hop procedure below.
A link from Tour back to Writer can therefore resolve before any HTML is written.
The [source corpus](selecting-sources.md#source-corpus) provides initial files; each additional referenced page is parsed once.

**Procedure: build page bodies**

1. **Parse initial files:** reserve explicit anchors before generating heading identifiers.
   This keeps an inbound link to an omitted Document map heading valid.
2. **Discover repository Markdown links:** inspect only initially selected pages, including reference-style links, and add their direct Markdown targets once.
   If selected A links to B and B links to C, render A and B; C remains an original-file link unless another initially selected page links to C directly.
3. **Resolve definitions and validate targets:** read selected entity meanings and check manifest anchors and fragments for rendered destinations.
   A broken anchor authored in an input page refuses the build. Retained reference pages use the documented fragment fallback.
   In retained exports, missing files warn and become non-link text. In the temporary viewer, a missing Markdown target refuses startup.
4. **Serialize sanitized bodies:** rewrite URLs, copy referenced images and wrap wide tables.
   HTML comments and YAML metadata disappear from body text.
5. **Render diagrams:** replace supported source figures with static SVG before page files are written.
   The final layout adds the menu, assets and adjacent-page links.

The [entity index](selecting-sources.md#entity-index) supplies home locations, not hover meanings.
The same parsed tree supplies headings, anchors, meanings, URL transformation and serialization.
Changing Markdown, metadata or a theme requires a new build; there is no incremental cache or watcher.

<a id="links-and-anchors"></a>
## Links and anchors

Links preserve the author's destinations while making rendered Markdown browsable.
The tour's `nested/home.md#writer` becomes `nested/home.html#writer`.
For example, `nested/home.md?mode=read#default` becomes `nested/home.html?mode=read#default`.
Encoded filenames retain their URL meaning.
Root-relative local paths resolve beneath the source root.

Empty HTML anchors remain real HTML targets.
Several stacked empty anchors before one heading all remain valid, share its meaning and map to that heading.
The menu uses the last anchor in an anchor-only block.
Both the explicit anchors and the generated heading identifier remain valid destinations.
Duplicate explicit identifiers fail.

Generated identifiers use the heading-derived base, then try `-1`, `-2` and successive suffixes until an unused target is found.
For example, an explicit `writer` anchor makes the Writer heading’s generated identifier `writer-1`.
The [identifier reference](reference.md#anchor-reference) defines the heading-derived base, including Unicode and punctuation handling.

The anchor-only rule does not authorize arbitrary HTML.
A block containing other HTML is escaped rather than interpreted as an anchor block.
An anchor paragraph containing `<br>` retains both targets but uses only the first for the menu and hover meaning.
A block containing `<div>` instead has no extracted anchor targets.
The [anchor examples](reference.md#anchor-reference) show these exact inputs and results.

In temporary local-reading mode, linked Markdown inside the repository joins a separate Referenced files group.
The group starts collapsed unless the current page belongs to it.
Discovery stops after one hop from initially selected pages. Referenced entries show one title and path each, with no section list. Links from a reference to any already rendered page still use HTML; further-out links use the original-file treatment below.
These pages do not alter previous/next links for the initial reading order.

In temporary local-reading mode, non-Markdown local links retain their labels and become `file:` URLs to the original location.
A file icon and path hover distinguish them; each produces a warning.
Files outside the source root receive the same treatment, including outside Markdown references.
Those originals are neither copied nor validated; browsers may block opening them from localhost.
An authored `file:` scheme is refused even though the renderer can generate one.

Relative images beneath the root are copied to matching output paths.
Remote images and image paths escaping the root fail.
Supported raster data URLs remain inline.
HTTP, HTTPS, mail and telephone links are allowed; executable schemes fail.
Raw HTML other than allowed empty anchors appears as text before sanitization.

<a id="diagram-rendering"></a>
## Diagram rendering

Diagram rendering is the build-time conversion of Mermaid code blocks into themed SVG figures.
It lets readers view diagrams without a browser-side diagram engine or a remote service.
The fixture's preparation-to-check diagram is rendered during the same build as its Markdown page.

| Key | Value | Status | Basis |
|---|---|---|---|
| <a id="mermaid-version"></a>mermaid-version | 12.2.0 | specified | [src/diagrams.ts::renderDiagrams](../../../src/diagrams.ts) |
| <a id="diagram-contrast"></a>diagram-contrast | 4.5:1 | specified | [Built-in contrast acceptance](acceptance.md#test-theme-mode) |

The build evaluates these rules in order; a terminal outcome ends the procedure.

**Procedure: choose diagram output**

1. **Check the API option:** if it disables Mermaid, retain readable source without checking the package or browser.
2. **Locate the package:** if absent, retain readable source without checking the browser.
3. **Check the installed version:** if it differs from [mermaid-version](#mermaid-version), fail, even when no page contains a diagram.
4. **Check for diagram blocks:** if none exist, finish without starting a browser.
5. **Build SVG:** with diagram blocks present, start the browser and render them.
   Any browser or rendering error fails the build.

Package read errors other than absence also fail.
Disabled rendering makes package, diagram and browser combinations irrelevant.
An absent browser cannot cause a build failure on a branch that never starts one.
Rendering success is observed during the build, before serving; it is not a browser qualification assumed before invocation.

The build opens an isolated temporary browser profile and loads the installed Mermaid bundle locally.
It uses strict Mermaid security and disables browser background networking and host resolution.
It removes authored inline colour declarations from the SVG and appends a scoped theme stylesheet.
Text, fills, strokes, clusters and edge labels then inherit page colour tokens.
Changing colour mode recolours the existing SVG without rerendering the diagram.
The figure retains Mermaid source in a disclosure.

Chromium starts without an unused startup window.
Browser transport can share one Chromium process across independent page sessions.
Each session uses a fresh browser context and target.
Disposing its context removes that session’s storage, cookies and page overrides.
The default diagram build still owns and closes its browser process and temporary profile.

The built-in themes meet [diagram-contrast](#diagram-contrast) for the text/background and line/background pairs exercised by the browser fixture.
The fixture includes custom authored colours that the renderer replaces.
This evidence is not a guarantee for arbitrary custom CSS or every Mermaid diagram family.
Wide diagrams retain natural label size and scroll within their figure.

<a id="render-and-read"></a>
# Render and read

Use the existing synthetic fixture to follow one complete reading session.
The [source corpus](selecting-sources.md#source-corpus) is the selected Markdown and metadata; rendering leaves those inputs unchanged.
Use an installed checkout; the [runtime prerequisites](reference.md#command-reference) list the dependencies needed for this tour.

<a id="fixture-tour"></a>
## Follow the fixture

This tour connects input selection, links, reading controls and cleanup.
The fixture's [document manifest](selecting-sources.md#document-manifest) declares Home before Tour, even though their paths sort differently.
Its [entity index](selecting-sources.md#entity-index) identifies the Writer definition.
Hovering a link to Writer reveals that definition paragraph.

**Procedure: render, read and stop**

1. **Build the installed checkout:** run `pnpm build` from the repository root.
   The TypeScript compiler creates the `dist/cli.js` command used below.
   Dependencies must already be installed; this tour does not install packages.

2. **Start the command:** run `node dist/cli.js test/fixtures/corpus` from the repository root.
   The command prints the local URL and temporary output directory after rendering succeeds.

   > **Detail — selected pages**
   >
   > Home comes first, followed by Tour and Synthetic guide.
   > These come from [test/fixtures/corpus/chapters/nested/home.md](../../../test/fixtures/corpus/chapters/nested/home.md),
   > [test/fixtures/corpus/chapters/start.md](../../../test/fixtures/corpus/chapters/start.md), and
   > [test/fixtures/corpus/index.md](../../../test/fixtures/corpus/index.md).
   > Linked Markdown adds Referenced files after the declared pages.

3. **Open the printed URL:** the browser shows Home with the current chapter expanded in the [reading menu](reading-pages.md#reading-menu).
   The URL points to the first declared page rather than an unrelated index page.

4. **Choose Tour:** the menu opens the authored Tour heading rather than the title in its opening YAML metadata, also called frontmatter.
   The diagram shows the preparation step leading to the checking step.

   > **Detail — diagram availability**
   >
   > [Diagram rendering](resolving-content.md#diagram-rendering) produces SVG during the build when its dependencies are present.
   > Without Mermaid, the page explicitly shows diagram source instead.
   > A present renderer that fails stops the build.

5. **Follow Writer:** the link returns to the definition in Home.
   Hovering the link shows the definition paragraph; a query-bearing link keeps its query and fragment.

   > **Detail — exact link**
   >
   > Tour contains `[writer](nested/home.md#writer)`.
   > Rendering changes the destination to `nested/home.html#writer` and retains the label.
   > The definition paragraph is “The writer checks prepared requests before accepting them.”

6. **Select Dark:** the menu applies the dark colour mode to text and diagrams.
   The next page restores the choice when browser storage is available.

7. **Press Ctrl+C in the terminal:** the [temporary viewer](serving-and-export.md#temporary-viewer) stops and removes its output directory.
   Closing only the browser tab leaves the command running.

Source admission is explained in [Selecting sources](selecting-sources.md#selecting-sources).
Failures and repair actions belong to [Serving and export](serving-and-export.md#serving-and-export).

<a id="scenario-fixture-session"></a>
### Scenario: follow a definition and close the viewer

This scenario checks that the same reading path survives the whole pipeline.

**Purpose:** Open the first declared page, follow the Writer definition and remove disposable output.

**Inputs:** The unchanged fixture corpus, installed dependencies and a Chromium executable.

**Expected:** Home opens first; Tour links to Writer with hover text; stopping the command removes output and releases the port.

**Requirements:** [Source order](requirements.md#req-source-order), [Entity meanings](requirements.md#req-entity-meanings), [Local links](requirements.md#req-local-links), [Temporary lifecycle](requirements.md#req-temporary-lifecycle).

**Tests:** [Source selection](acceptance.md#test-source-order), [Entity meanings](acceptance.md#test-entity-meanings), [Links and anchors](acceptance.md#test-local-links), [Viewer lifecycle](acceptance.md#test-temporary-lifecycle).

# md-render

Render Markdown documentation as a readable, offline website. Each Markdown file gets a
page, a chapter-and-section menu, and previous/next links. The default theme is
Symbiotic. Tables scroll within the page; code, explicit HTML anchors, and file fragments
survive rendering.

Requires Node.js 22 or later and pnpm 10.20.0. Install from the local pnpm store only:

```sh
pnpm install --offline
pnpm build
node dist/cli.js /path/to/spec
```

The package installs a `md-render` command:

```sh
md-render /path/to/spec
md-render /path/to/chapter.md
md-render /path/to/repository --out ./rendered-docs
md-render /path/to/spec --theme default
```

Temporary mode prints a free `127.0.0.1` URL. Keep the process running while reading.
Press Ctrl+C to close the viewer. Its temporary directory is removed on SIGINT,
SIGTERM, normal process exit, or startup failure. Closing a browser tab alone does not
stop the process. SIGKILL and machine failure cannot run cleanup handlers.

`--out` writes a static folder plus one self-contained HTML file and exits.
`--single-file ./guide.html` writes just that file; combine it with `--out` to choose its name.
Both retained formats open directly from disk on another machine. The destination must be absent or empty, so an
existing export cannot be overwritten accidentally. Open the printed entry page or serve the directory
with any static server. An authored `index.md` keeps its own `index.html` page. No remote scripts, fonts, or diagram services are requested.

When `docs/DOCUMENTS.json` exists, its `documents[].sections[]` order controls navigation.
Files appear once, at their first section. Declared navigation files are included too.
Inventory entries classified as `other` or `generated`, directories, and unlisted Markdown
are not added as document pages. A generated file is included when declared as navigation.
In retained exports, linked Markdown renders under the collapsed “Referenced files” menu group,
including files outside the input and inventory entries classified as `other`.
Other UTF-8 text files become numbered source pages; `#L42` and `#L10-L20` links land on the first referenced line.
Other files become downloads. Files larger than 5 MB are visibly omitted with their size;
set `--max-linked-file-bytes <bytes>` to change that per-file limit. Missing files warn and keep their labels as non-link text. Unknown manifest versions fail with a diagnostic.
Without a manifest, `index.md` comes first, followed by all
Markdown files recursively in lexical path order. Git internals and `node_modules` are
excluded. A selected `docs` folder uses repository-relative metadata paths.

`docs/ENTITIES.json` homes resolve through the manifest's section identities. Hover text
comes from the first paragraph after each home heading. No separate meanings registry
is stored. Missing targets, duplicate anchors, invalid metadata, and unreadable inputs
fail with a diagnostic. Explicit empty `<a id="…"></a>` anchors render as HTML; other
raw HTML appears as escaped text. HTML comments and YAML metadata do not appear as body
text. Unsupported executable link schemes fail.

Links between rendered Markdown files become `.html` links with their fragments intact.
Relative images inside the source root are copied. Retained exports bundle local files linked directly from the input pages and display portable paths.
Further local links in bundled references become plain text marked “not bundled”.
Broken fragments in bundled references warn and link to the destination top; input-page fragments remain strict.
The temporary viewer keeps its local-reading behavior: non-Markdown and outside-root links
open original files with a warning. Browsers may block those original-file links from localhost.

Mermaid 12.2.0 is an optional, pinned dependency. When present, an installed Chromium browser renders SVG diagrams at build time and
retains source in a disclosure. Set `MD_RENDER_BROWSER` to a Chromium executable if it
is outside the standard locations. No browser is needed to view the generated diagrams. If absent, the page explicitly
shows readable diagram source. A rendering failure stops the build with a diagnostic. The renderer never downloads Mermaid.

## Themes

`--theme default` selects the neutral theme. `--theme symbiotic` (the default) uses the portal's
palette, document typography, and optional brand mark, with a system font.
`--theme ./custom.css` accepts a small CSS file. Copy [default.css](themes/default.css)
to start with the color and font tokens. A neighboring `custom.logo.svg`,
`custom.logo.png`, or `custom.logo.webp` supplies an optional logo; choose one.
Theme CSS is copied as supplied; keep additional resources inline so static output stays
offline. Base layout and print styles remain available to every theme.

## Package API and checks

```ts
import { exportSite, startViewer } from 'md-render';

await exportSite('./spec', { out: './output' }, { theme: 'default' });
const viewer = await startViewer('./spec');
console.log(viewer.url);
await viewer.close();
```

The pipeline is adapted from `@symbiotic/docs`: unified, remark parsing, GitHub tables,
frontmatter, remark-to-HTML, sanitization, and serialization, at the portal's exact pins.
Each source is parsed once. Navigation, hover meanings, and link validation use that same
in-memory tree. Rendered output is derived from the Markdown, metadata, and theme.

```sh
pnpm typecheck
pnpm build
pnpm test test/renderer.test.ts test/server.test.ts
```

Tests use a synthetic fixture corpus. Server tests need permission to bind localhost;
all tests run without external network access. Build first because lifecycle tests launch
the compiled command.

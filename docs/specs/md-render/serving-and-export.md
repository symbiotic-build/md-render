<a id="serving-and-export"></a>
# Serving and export

The command provides disposable local viewing by default and a retained export when an output directory is supplied.
All modes render before announcing success; errors reach the API caller or the command's diagnostic output.

<a id="temporary-viewer"></a>
## Temporary viewer

A temporary viewer is a loopback HTTP server whose rendered directory is removed when the viewing process ends normally.
It provides a local reading session without retaining a generated site in the source repository.

Startup creates a unique directory beneath the operating system's temporary directory.
Exit and signal cleanup handlers are installed before rendering starts.
After rendering succeeds, the server binds a free port on `127.0.0.1` only.
The printed URL names the first selected page, including when an authored index appears later.
Closing a browser tab does not stop the server.

The server accepts GET and HEAD, maps the root URL to the output index and confines reads to its output directory.
It returns content types with `nosniff`; unsupported methods and malformed or missing paths return visible HTTP errors.
No server endpoint edits the sources or rebuilds pages.
The API's idempotent `close()` releases connections, removes output and unregisters cleanup handlers.

Normal process exit removes the directory.
SIGINT removes it and exits with code 130; SIGTERM removes it and exits with code 143.
Startup failure also removes temporary output and handlers.
SIGKILL and machine failure cannot run cleanup; a remaining temporary directory must be removed manually after confirming the process stopped.

<a id="static-export"></a>
## Static export

Static export writes a site to a caller-selected absent or empty directory and exits without starting a server.
The command reports the output directory and first page.
Unlike temporary viewing, these files remain after process exit.

The [source corpus](selecting-sources.md#source-corpus) is not modified.
HTML pages, copied images, bundled linked files, theme assets and any root redirect are derived output.
Both retained formats follow [Bundled local references](#bundled-local-references).
The renderer has no transactional export staging layer.
A failure can leave a partially populated static destination; rerunning into that nonempty destination is refused.
Recover by choosing a new empty directory or removing only the failed output after inspecting it.

<a id="single-file-export"></a>
## Single-file export

A single-file export is one retained HTML document containing every rendered page and its reading controls.
It opens directly through `file://` without a server or network access.
The CLI adds it to every `--out` export; `--single-file <path.html>` alone writes only that file.
Combining both options writes the folder and the explicitly named file, without an additional automatically named file.
The [temporary viewer](#temporary-viewer) and its folder-rendering primitive `renderSite` retain local-reading behavior.
Use `exportSite` for portable retained folder and single-file output.

The automatic basename comes from the entry page title, normalized to NFC.
Replace each run outside Unicode letters, marks, numbers, underscores and hyphens with a hyphen, then trim hyphens.
Use `documentation` when the result is empty and prefix Windows device names with `documentation-`.

Append `.html`; refuse a collision with a folder page or asset rather than overwrite it.
Explicit paths must end in `.html`, ignoring case.
Create missing parent directories, but create the target exclusively: existing files, directories and symlinks are refused.
Failures reach the caller; an existing target remains unchanged.
A write failure can leave a partial new target, which the caller must inspect before removing or choosing another path.

Reuse source selection, link validation, sanitized Markdown, diagrams and the page shell from folder rendering.
Serialize sanitized bodies and render diagrams once; derive standalone URLs and page identifiers from that prepared output, preserving diagram identifiers.
Render and validate before writing the single file.
Inline styles and scripts; encode the logo, images and stylesheet resources as data URIs.
Reject unavailable resources and remote stylesheet dependencies visibly without attempting network access.

Retain rendered SVG diagrams or the existing readable offline source fallback.
A restrictive content policy permits only inline hashed scripts and embedded resources; viewing performs no network requests.
Authored external links remain clickable; local destinations follow [Bundled local references](#bundled-local-references).

Each source page occupies a section, in selected reading order followed by bundled referenced pages.
Namespace each page's Markdown identifiers with its zero-based rendered page index, including footnote identifiers and references.
Rendered diagram identifiers use the existing document-wide diagram sequence, disjoint from page namespaces.
Menu, article and previous/next links use those in-file targets; query strings do not affect document destinations.

Use hash routing to show one page at a time while retaining every section in the DOM.
Inactive sections use `hidden="until-found"`, so browser find can reveal them; `beforematch` selects the revealed page.
This preserves separate-page reading while allowing document-wide find in supporting browsers.
Without JavaScript all sections remain readable in order.
The CLI reports the output path and exact UTF-8 byte size without imposing a size cap.

**Procedure: share the fixture as one file**

1. **Export the fixture:** run `md-render test/fixtures/corpus --out export` into an absent directory.
   The folder pages remain available, and its entry title Home produces `export/Home.html`.
2. **Open the file:** double-click `export/Home.html`, then use the menu to open Tour and its section links.
   Previous returns to Home without leaving the document.
3. **Choose a standalone destination:** run `md-render test/fixtures/corpus --single-file sharing/guide.html`.
   Only `sharing/guide.html` is written; repeating the command refuses that existing target.

**Verification:** [Single-file output](acceptance.md#test-single-file-output), [Single-file reading](acceptance.md#test-single-file-reading).

<a id="bundled-local-references"></a>
## Bundled local references

A retained export includes local files linked directly by the input’s own rendered pages, so sharing it needs no access to the author's filesystem.
This follows the [operator's bundling decision](decisions-and-questions.md#bundle-local-files-choice).
Initial selection still follows the manifest; inventory classifications do not exclude linked references.
Prepare the input’s existing rendered pages first, including directly linked in-root Markdown, before bundling their outgoing local files.
Classify each additional target before parsing, including targets whose names end in `.md`.

**Procedure: prepare portable references**

1. **Discover local links:** resolve paths relative to each source file, retaining source-root-relative interpretation of leading slashes.
   Inspect the input’s rendered pages, deduplicate direct targets, and parse all bundled pages before validating fragments.
2. **Classify each regular file:** use the [bundle policy](reference.md#bundle-reference) before reading its contents.
   Render UTF-8 Markdown through the existing page renderer. Render other valid UTF-8 files without NUL bytes as read-only code pages.
3. **Prepare destinations:** place rendered references under the existing collapsed Referenced files group, opened on its current page.
   Keep initial previous/next order. Copy other files into folder assets; embed their bytes as data URIs behind download links in the single file.
4. **Rewrite links:** preserve authored labels and Markdown fragments, and resolve [source-line fragments](reference.md#bundle-reference) to line anchors.
   Use relative folder URLs or namespaced single-file targets; never generate original-machine URLs.

Local links from bundled references to further files remain plain text with their authored label, “not bundled” and the portable path label.
Warn once per unbundled target, without reading that file’s contents.
Links to pages or files already included remain usable.
Register included image destinations before classifying links from bundled references.
This follows [one-level bundling](decisions-and-questions.md#bundle-depth-choice).

A broken fragment authored in an input page refuses export.
A broken fragment authored in a bundled reference instead links to the destination page’s top, with one warning per destination fragment.
This follows [reference fragment validation](decisions-and-questions.md#bundle-fragment-choice).

Code pages show their portable file label and monospaced, escaped source with numbered lines.
They require no syntax highlighting. A line range lands on its first line; no range selection is required.
Binary download links use the original basename as their download filename and preserve the file bytes.
Opaque binary attachments are exempt from path removal; do not scan, reject or rewrite their bytes for containing paths.

Displayed local paths use source-root-relative paths for files inside the input root.
For files in another Git repository, read local Git metadata and display `<repository folder name> @ <short commit>: <path inside that repository>`.
Other files show only their basename.

Repository labels identify the checked-out commit; exported bytes are the current local file bytes.
Apply these labels to reference metadata, path hovers, manifest titles, image descriptions, and absolute input/home paths appearing in visible prose or code.
Apply the same conversion to published stylesheet text after loading its resources.
Replace occurrences by their original text offsets, so inserted labels cannot consume a later original occurrence.
A retained export's generated HTML, text and Markdown-derived content contain no original-machine URLs or absolute input/home paths.
Opaque binary attachment bytes are exempt from this guarantee and remain unchanged.
Literal colon characters in ordinary text may use HTML character references without changing the reader's text.

A missing linked file produces an external-local-reference warning and leaves its authored label as non-link text.
An oversized linked file similarly remains non-link text, with a visible omission and exact byte size beside the label.
The command reports the omission as a warning; no oversized bytes enter either retained format.
The caller can raise the configured limit and rebuild.

A directory link warns and becomes non-link text marked “directory not bundled”; bundling does not walk directories.
Unreadable files and other non-regular files fail visibly.
Keep the settled symlink refusal inside the input root; external aliases resolve to regular files using the local filesystem.
Existing image confinement and executable-scheme refusal remain in force.

The [temporary viewer](#temporary-viewer) may retain one-hop in-root Markdown discovery and original-file links with warnings for other local destinations.
Portable exports read each additional file once per build, plus local Git metadata for external labels.
An image and attachment using the same source reuse its captured bytes.
They add no database, persistent index or migration; pages and attachments are rebuildable output required by the bundling decision.

**Verification:** [Portable references](acceptance.md#test-bundled-references), [Bundle omissions](acceptance.md#test-bundle-omissions).

<a id="failure-source-input"></a>
## Failure state: source input refused

This refusal identifies unsupported or unsafe input before a valid site can be announced.

**Trigger:** An unknown metadata version, invalid required metadata, unreadable or malformed UTF-8 input, disallowed symlink, escaping input path or empty Markdown selection.

**Outcome:** The API rejects; the CLI prints `md-render:` followed by the diagnostic and exits with code 1. No viewer URL is announced.

**Retained state:** Original input files remain unchanged. Temporary output is removed; static output may be partial.

**Recovery:** Correct the metadata or path, restore readable regular files, or copy symlinked content into regular inputs. Rerun with a clean destination.

**Authority:** The documentation author needs permission to repair the source and choose or clean the destination.

**Verification:** [Input refusals](acceptance.md#test-input-refusals).

<a id="failure-definition"></a>
## Failure state: unresolved definition

This stop prevents broken selected entity hovers and unresolved local destinations from appearing as successful output.

**Trigger:** In local-reading mode, a missing Markdown target; in either mode, a broken local anchor authored in an input page, missing manifest anchor, duplicate explicit anchor, unknown home section or selected entity home without an anchor, heading and first paragraph. Local-reading mode also refuses broken anchors in referenced pages.

**Outcome:** Rendering rejects with the offending link, anchor or home in its diagnostic; the command exits with code 1.

**Retained state:** Sources retain their authored links and metadata. No server starts; temporary output is removed and static output may be partial.

**Recovery:** Repair the link or identifier, restore the target, or complete the home paragraph. Rerun the build into an empty destination.

**Authority:** The author who owns the affected source or metadata can make the repair.

**Verification:** [Entity meanings](acceptance.md#test-entity-meanings), [Links and anchors](acceptance.md#test-local-links), [Input refusals](acceptance.md#test-input-refusals).

<a id="failure-content-build"></a>
## Failure state: content build refused

This failure tells the author which content or installed renderer needs repair.
An absent Mermaid package instead produces the explicit source-only figure described in [Diagram rendering](resolving-content.md#diagram-rendering).

**Trigger:** An executable link scheme, remote or escaping image, asset/page collision, reserved asset path, unreadable theme, multiple theme logos, wrong Mermaid version or browser/rendering failure.

**Outcome:** The API rejects and the command reports the cause with exit code 1 rather than publishing a successful viewer URL.

**Retained state:** Sources remain intact. Temporary output and the build browser profile are cleaned on the handled paths; static output may be partial.

**Recovery:** Correct the content or theme. For diagrams, provide the pinned installed Mermaid and a working Chromium executable through `MD_RENDER_BROWSER` when needed. Rerun into an empty destination.

**Authority:** The content author can fix sources; the local installation owner can repair installed dependencies and browser configuration.

**Verification:** [Safe content](acceptance.md#test-safe-content), [Diagram build](acceptance.md#test-diagram-build), [Static export](acceptance.md#test-static-export).

<a id="failure-output-startup"></a>
## Failure state: output or server startup refused

This refusal protects an existing export and reports a viewer that could not start.

**Trigger:** A nonempty output directory, existing single-file target, filesystem write failure or loopback listen failure.

**Outcome:** The API rejects; the command prints the cause and exits with code 1 without announcing a working viewer.

**Retained state:** Existing destination contents are retained when the empty-directory check refuses. Later static-write failures can leave partial output; temporary startup output is removed.

**Recovery:** Choose an absent or empty writable destination, or repair the local filesystem or loopback environment, then rerun.

**Authority:** The caller needs filesystem access to the destination and permission to bind loopback for viewing.

**Verification:** [Static export](acceptance.md#test-static-export), [Viewer lifecycle](acceptance.md#test-temporary-lifecycle).

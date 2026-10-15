import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, rm, access, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from '../src/corpus.js';
import { documentHtml, documentOutline, parseDocument, transformUrls } from '../src/markdown.js';
import { renderSite } from '../src/site.js';

const fixture = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));
const scratch: string[] = [];
async function temp(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'md-render-test-'));
  scratch.push(directory);
  return directory;
}
afterEach(async () => { await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

it('follows manifest section order and deduplicates files', async () => {
  const corpus = await loadCorpus(fixture);
  expect(corpus.files.map((file) => file.path)).toEqual(['chapters/nested/home.md', 'chapters/start.md', 'index.md']);
  expect(corpus.map.map((entry) => entry.anchor)).toEqual(['home-section', 'tour', undefined]);
});
it('uses the manifest for a selected docs folder without adding unrelated inventory', async () => {
  const corpus = await loadCorpus(path.join(fixture, 'docs'));
  expect(corpus.files.map((file) => file.path)).toEqual(['chapters/nested/home.md', 'chapters/start.md', 'index.md']);
  expect(corpus.entities).toEqual([{ path: 'chapters/nested/home.md', anchor: 'writer' }]);
});
it('renders linked inventory Markdown and preserves original directory links', async () => {
  const output = await temp();
  const result = await renderSite(fixture, output, { mermaid: false });
  expect(result.pages).toEqual(['chapters/nested/home.html', 'chapters/start.html', 'index.html', 'ignored.html', 'docs/generated/unused.html']);
  expect(result.warnings).toHaveLength(1);
  const index = await readFile(path.join(output, 'index.html'), 'utf8');
  expect(index).toContain('ignored.html');
  expect(index).toContain('templates/');
  expect(index).not.toContain('(external local file)');
  expect(index).toContain('class="local-file"');
  expect(index).toContain('>Referenced files</summary>');
  await expect(access(path.join(output, 'ignored.md'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('rejects an unknown real-format manifest version before selecting files', async () => {
  const source = fileURLToPath(new URL('./fixtures/unknown-version', import.meta.url));
  await expect(loadCorpus(source)).rejects.toThrow('DOCUMENTS.json: unsupported version 99');
});
it('still refuses symlinked manifest sections and symlinked parent directories', async () => {
  const source = await temp();
  await cp(fixture, source, { recursive: true });
  const home = path.join(source, 'chapters/nested/home.md');
  await rm(home);
  await symlink(path.join(fixture, 'chapters/nested/home.md'), home);
  await expect(loadCorpus(source)).rejects.toThrow(/symlink|Symbolic link/);
  await rm(path.dirname(home), { recursive: true });
  await symlink(path.join(fixture, 'chapters/nested'), path.dirname(home));
  await expect(loadCorpus(source)).rejects.toThrow(/symlink|Symbolic link/);
});
it('puts index.md first without a manifest and includes nested chapters', async () => {
  const source = await temp();
  await mkdir(path.join(source, 'nested'));
  await writeFile(path.join(source, 'index.md'), '# Index');
  await writeFile(path.join(source, 'a.md'), '# A');
  await writeFile(path.join(source, 'nested/b.md'), '# B');
  expect((await loadCorpus(source)).files.map((file) => file.path)).toEqual(['index.md', 'a.md', 'nested/b.md']);
});
it('loads a selected Markdown file as one page', async () => {
  const source = await temp();
  await writeFile(path.join(source, 'one.md'), '# One\n\nA single document.');
  const result = await renderSite(path.join(source, 'one.md'), await temp(), { mermaid: false });
  expect(result.pages).toEqual(['one.html']);
});
it('preserves inline fact anchors, table rows and literal code', async () => {
  const doc = parseDocument('<a id="home"></a>\n# Home\n\nMeaning.\n\n| Key | Value |\n|---|---|\n| <a id="value"></a>one | 1 |\n| two | 2 |\n\n```ts\n  const x = "<tag>";\n```', 'fallback');
  const html = await documentHtml(doc);
  expect(html).toContain('id="home"');
  expect(html).toContain('id="value"');
  expect(html.match(/<tr>/g)).toHaveLength(3);
  expect(html).toContain('  const x = "&#x3C;tag>";');
  expect(doc.meanings.get('home')).toBe('Meaning.');
});
it('preserves Unicode heading fragments and disambiguates repeated headings', () => {
  const doc = parseDocument('# Café\n\n## A.b\n\n## A.b', 'fallback');
  expect([...doc.anchors]).toEqual(['café', 'ab', 'ab-1']);
});
it('uses preceding explicit anchors in the outline and keeps generated heading targets', async () => {
  const doc = parseDocument('# Page\n\n<a id="first-section"></a>\n## First\n\n<a id="child"></a>\n\n### Child\n\n## Second', 'fallback');
  expect(documentOutline(doc)).toEqual([
    { id: 'first-section', title: 'First', children: [{ id: 'child', title: 'Child', children: [] }] },
    { id: 'second', title: 'Second', children: [] },
  ]);
  const html = await documentHtml(doc);
  for (const id of ['first-section', 'first', 'child', 'child-1', 'second']) expect(html).toContain(`id="${id}"`);
});
it.each([
  [2, 'paragraph'], [3, 'paragraph'], [2, 'html'], [3, 'html'], [2, 'adjacent'], [3, 'adjacent'],
] as const)('resolves %i stacked entity anchors in a %s block', async (count, form) => {
  const ids = ['document-manifest', 'entity-home', 'last-home'].slice(0, count);
  const tags = ids.map(id => `<a id="${id}">${form === 'html' ? '\n' : ''}</a>`).join(form === 'adjacent' ? '' : '\n');
  const markdown = `# Page\n\n${tags}\n\n## Document manifest\n\nShared **meaning**.`;
  const doc = parseDocument(markdown, 'fallback');
  expect([...doc.anchors]).toEqual([...ids, 'page', 'document-manifest-1']);
  expect([...doc.meanings]).toEqual(ids.map(id => [id, 'Shared meaning.']));
  expect(documentOutline(doc)).toEqual([{ id: ids.at(-1), title: 'Document manifest', children: [] }]);
  const source = await temp();
  await mkdir(path.join(source, 'docs'));
  await writeFile(path.join(source, 'index.md'), `${markdown}\n\n${ids.map(id => `[${id}](#${id})`).join(' ')}`);
  await writeFile(path.join(source, 'docs/DOCUMENTS.json'), JSON.stringify({ version: 1, inventory: [], documents: [
    { id: 'book', title: 'Book', sections: [{ id: 'body', path: 'index.md', anchor: ids[0] }] },
  ] }));
  await writeFile(path.join(source, 'docs/ENTITIES.json'), JSON.stringify({ version: 1, entities: Object.fromEntries(
    ids.map(id => [id, { home: { section: 'book#body', anchor: id } }]),
  ) }));
  const output = await temp();
  const result = await renderSite(source, output, { mermaid: false });
  expect(result.links).toBe(count);
  const html = await readFile(path.join(output, 'index.html'), 'utf8');
  expect([...html.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1])).toEqual(ids);
  for (const id of ids) {
    expect(html.match(new RegExp(`<a id="${id}"></a>`, 'g'))).toHaveLength(1);
    expect(html).toContain(`href="#${id}" title="Shared meaning."`);
  }
  expect(html).toContain(`href="#${ids.at(-1)}">Document manifest</a>`);
  expect(html).toContain('<h2 id="document-manifest-1">');
});
it.each(['', '\n'])('rejects duplicate ids in stacked anchors with %j before the closing tag', (gap) => {
  expect(() => parseDocument(`<a id="same">${gap}</a>\n<a id="same">${gap}</a>\n\n## Heading`, 'fallback')).toThrow('Duplicate anchor: same');
});
it('keeps a mixed HTML block escaped without extracting its anchors', async () => {
  const doc = parseDocument('<a id="first">\n</a>\n<a id="second"></a>\n<div>Other HTML</div>\n\n## Heading\n\nMeaning.', 'fallback');
  expect([...doc.anchors]).toEqual(['heading']);
  expect([...doc.meanings]).toEqual([]);
  expect(documentOutline(doc)).toEqual([{ id: 'heading', title: 'Heading', children: [] }]);
  const html = await documentHtml(doc);
  expect(html).toContain('&#x3C;a id="first">\n&#x3C;/a>');
  expect(html).toContain('&#x3C;a id="second">&#x3C;/a>');
  expect(html).toContain('&#x3C;div>Other HTML&#x3C;/div>');
  expect(html).not.toContain('<a id=');
});
it('keeps the first-anchor behaviour of a mixed all-HTML paragraph', async () => {
  const doc = parseDocument('<a id="first"></a><br><a id="second"></a>\n\n## Heading\n\nMeaning.', 'fallback');
  expect([...doc.anchors]).toEqual(['first', 'second', 'heading']);
  expect([...doc.meanings]).toEqual([['first', 'Meaning.']]);
  expect(documentOutline(doc)).toEqual([{ id: 'first', title: 'Heading', children: [] }]);
  expect(await documentHtml(doc)).toContain('<p><a id="first"></a>&#x3C;br><a id="second"></a></p>');
});
it('extracts plain text from linked and formatted headings', () => {
  const doc = parseDocument('# Page\n\n## [Linked **bold**](#page) and `code`\n\n### *Child* & ~~old~~\n\n## [Reference][ref]\n\n[ref]: #page', 'fallback');
  expect(documentOutline(doc)).toEqual([
    { id: 'linked-bold-and-code', title: 'Linked bold and code', children: [{ id: 'child--old', title: 'Child & old', children: [] }] },
    { id: 'reference', title: 'Reference', children: [] },
  ]);
});
it('nests level-three headings under the preceding level-two heading in source order', () => {
  const doc = parseDocument('# Page\n\n### Intro\n\n## First\n\n### One\n\n#### Omitted\n\n### Two\n\n## Second\n\n### Three', 'fallback');
  expect(documentOutline(doc)).toEqual([
    { id: 'intro', title: 'Intro', children: [] },
    { id: 'first', title: 'First', children: [
      { id: 'one', title: 'One', children: [] }, { id: 'two', title: 'Two', children: [] },
    ] },
    { id: 'second', title: 'Second', children: [{ id: 'three', title: 'Three', children: [] }] },
  ]);
});
it('includes a single level-two section and its children', () => {
  expect(documentOutline(parseDocument('# Page', 'fallback'))).toEqual([]);
  expect(documentOutline(parseDocument('# Page\n\n## Only\n\n### Child', 'fallback'))).toEqual([
    { id: 'only', title: 'Only', children: [{ id: 'child', title: 'Child', children: [] }] },
  ]);
});
describe('generated navigation regions', () => {
  const start = '<!-- spec-docs:navigation document="book" -->';
  const end = '<!-- /spec-docs:navigation -->';
  const overview = '## Overview\n\nPurpose with **formatting**.\n\n### Audience\n\nReaders.';
  const entities = '<a id="entities"></a>\n\n## Entity index\n\n- [Term](#term)\n\n<a id="term"></a>\n\n### Term\n\nMeaning.';
  const map = '## Document map\n\n- Duplicate chapter list\n  - <a id="map-item"></a>Nested entry\n\n### Map detail\n\nDuplicate detail.';

  it.each(['', '\n'])('preserves stacked anchors in omitted maps and retained siblings (%j)', async (gap) => {
    const hiddenMap = map.replace('### Map detail', `<a id="hidden-section">${gap}</a>\n<a id="hidden-home">${gap}</a>\n\n### Map detail`);
    const doc = parseDocument(`${start}\n\n<a id="map-section">${gap}</a>\n<a id="map-home">${gap}</a>\n\n${hiddenMap}\n\n<a id="entity-section">${gap}</a>\n<a id="entity-home">${gap}</a>\n\n## Entity index\n\nShared meaning.\n\n${end}`, 'fallback');
    const html = await documentHtml(doc);
    expect(html).not.toContain('Duplicate chapter list');
    expect(html).not.toContain('<h2 id="document-map">');
    for (const id of doc.anchors) expect(html.match(new RegExp(`id="${id}"`, 'g'))).toHaveLength(1);
    expect(doc.anchors.has('hidden-section')).toBe(true);
    expect(doc.anchors.has('hidden-home')).toBe(true);
    expect([...doc.meanings]).toEqual([
      ['hidden-section', 'Duplicate detail.'], ['hidden-home', 'Duplicate detail.'],
      ['entity-section', 'Shared meaning.'], ['entity-home', 'Shared meaning.'],
    ]);
    expect(documentOutline(doc)).toEqual([{ id: 'entity-home', title: 'Entity index', children: [] }]);
    expect(html).toContain('<h2 id="entity-index">Entity index</h2>');
  });

  it('omits only the marked level-two document map and keeps its siblings unchanged', async () => {
    const doc = parseDocument(`# Book\n\n${start}\n\n${overview}\n\n${map}\n\n${entities}\n\n${end}\n\n## Document map\n\nAuthored map.`, 'fallback');
    const html = await documentHtml(doc);
    expect(html).not.toContain('Duplicate chapter list');
    expect(html).not.toContain('Nested entry');
    expect(html).not.toContain('Duplicate detail');
    expect(html).not.toContain('<h3 id="map-detail">');
    expect(html.match(/>Document map<\/h2>/g)).toHaveLength(1);
    for (const section of [overview, entities]) {
      expect(html).toContain(await documentHtml(parseDocument(section, 'fallback')));
    }
    expect(html).toContain('<h2 id="document-map-1">Document map</h2>\n<p>Authored map.</p>');
    expect(documentOutline(doc)).toEqual([
      { id: 'overview', title: 'Overview', children: [{ id: 'audience', title: 'Audience', children: [] }] },
      { id: 'entities', title: 'Entity index', children: [{ id: 'term', title: 'Term', children: [] }] },
      { id: 'document-map-1', title: 'Document map', children: [] },
    ]);
    for (const id of doc.anchors) expect(html).toContain(`id="${id}"`);
  });

  it.each([
    ['', ''],
    ['<!-- navigation document="book" -->', end],
    ["<!-- spec-docs:navigation document='book' -->", end],
    ['<!-- spec-docs:navigation document="book" extra="yes" -->', end],
    [start, '<!-- /navigation -->'],
    [start, ''],
    ['', end],
    [end, start],
    [`\`\`\`md\n${start}\n\`\`\``, end],
  ])('keeps document maps without an exact complete marker pair (%s, %s)', async (open, close) => {
    const html = await documentHtml(parseDocument(`# Book\n\n${open}\n\n${map}\n\n${close}`, 'fallback'));
    expect(html).toContain('<h2 id="document-map">Document map</h2>');
    expect(html).toContain('Duplicate chapter list');
  });

  it('keeps other heading levels and text outside the marked region', async () => {
    const html = await documentHtml(parseDocument(`${start}\n\n### Document map\n\nNested map.\n\n${end}\n\n## Document map\n\nOutside map.`, 'fallback'));
    expect(html).toContain('<h3 id="document-map">Document map</h3>');
    expect(html).toContain('Nested map.');
    expect(html).toContain('Outside map.');
  });

  it('stops omission at the closing marker and retains shared reference definitions', async () => {
    const doc = parseDocument(`${start}\n\n## Overview\n\n[Purpose][purpose]\n\n${map}\n\n[purpose]: #overview\n\n${end}\n\nAfter the region.`, 'fallback');
    const html = await documentHtml(doc);
    expect(html).toContain('<a href="#overview">Purpose</a>');
    expect(html).toContain('<p>After the region.</p>');
    expect(html).not.toContain('Duplicate chapter list');
  });

  it.each(['', '<a id="map-home"></a>\n\n'])('resolves inbound links to omitted anchors and keeps menu siblings (%s)', async (explicit) => {
    const source = await temp();
    const target = explicit ? 'map-home' : 'document-map';
    await writeFile(path.join(source, 'index.md'), `# Book\n\n${start}\n\n${overview}\n\n${explicit}${map}\n\n${entities}\n\n${end}`);
    await writeFile(path.join(source, 'other.md'), `# Other\n\n[Map](index.md#${target}) [Heading](index.md#document-map) [Item](index.md#map-item) [Detail](index.md#map-detail)`);
    const output = await temp();
    await renderSite(source, output, { mermaid: false });
    const html = await readFile(path.join(output, 'index.html'), 'utf8');
    expect(html).toContain(`<a id="${target}"></a>`);
    expect(html).not.toContain('Duplicate chapter list');
    const menu = html.split('<nav aria-label="Document map">')[1]!.split('</nav>')[0]!;
    expect(menu).not.toContain('>Document map</a>');
    expect(menu).toContain('href="#overview">Overview</a>');
    expect(menu).toContain('href="#entities">Entity index</a>');
    const other = await readFile(path.join(output, 'other.html'), 'utf8');
    expect(other).toContain(`href="index.html#${target}">Map</a>`);
  });
});
it('shows sections only in the menu, expanding only the current chapter', async () => {
  const source = await temp();
  await writeFile(path.join(source, 'index.md'), '# Page\n\n<a id="custom"></a>\n## [First](#custom) & **bold**\n\n### Child\n\n## Second');
  await writeFile(path.join(source, 'other.md'), '# Other\n\n## Only');
  const output = await temp();
  await renderSite(source, output, { mermaid: false });
  const html = await readFile(path.join(output, 'index.html'), 'utf8');
  const contents = '<ol><li><a href="#custom">First &amp; bold</a><ol><li><a href="#child">Child</a></li></ol></li><li><a href="#second">Second</a></li></ol>';
  expect(html).toContain(`aria-current="page">Page</a></div><div id="chapter-sections-0">${contents}</div></li>`);
  expect(html).not.toContain('On this page');
  expect(html).not.toContain('class="contents"');
  const other = await readFile(path.join(output, 'other.html'), 'utf8');
  expect(other).toContain('aria-current="page">Other</a></div><div id="chapter-sections-1">');
  expect(other).not.toContain('class="contents"');
  expect(other).toContain('href="index.html#custom"');
});
it('shows one chapter and one nested outline for repeated manifest entries of the current file', async () => {
  const source = await temp();
  await mkdir(path.join(source, 'docs'));
  await writeFile(path.join(source, 'chapter.md'), '# Chapter\n\n## First\n\n### Child\n\n## Second');
  await writeFile(path.join(source, 'docs/DOCUMENTS.json'), JSON.stringify({
    version: 1, inventory: [], documents: [{ id: 'book', sections: [
      { id: 'first', path: 'chapter.md', anchor: 'first', title: 'Chapter start' },
      { id: 'second', path: 'chapter.md', anchor: 'second', title: 'Chapter end' },
    ] }],
  }));
  const output = await temp();
  await renderSite(source, output, { mermaid: false });
  const html = await readFile(path.join(output, 'chapter.html'), 'utf8');
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toContain('href="chapter.html" aria-current="page">Chapter</a></div><div id="chapter-sections-0"><ol>');
  expect(html.match(/href="#child"/g)).toHaveLength(1);
  expect(html).not.toContain('href="chapter.html#second"');
});
it('renders unsupported raw HTML as text and blocks executable markup', async () => {
  const html = await documentHtml(parseDocument('# Safe\n\n<script>alert(1)</script>\n\n<a id="safe" onclick="bad()"></a>', 'fallback'));
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<a id="safe"');
  expect(html).toContain('&#x3C;script>');
});
it('rewrites cross-file, fragment, query and reference links and adds entity hovers', async () => {
  const output = await temp();
  const result = await renderSite(fixture, output, { mermaid: false });
  const start = await readFile(path.join(output, 'chapters/start.html'), 'utf8');
  const home = await readFile(path.join(output, 'chapters/nested/home.html'), 'utf8');
  expect(start).toContain('href="nested/home.html#writer" title="The writer checks prepared requests before accepting them."');
  expect(start).toContain('href="nested/home.html?mode=read#default"');
  expect(start.split('<article')[1]!.match(/href="nested\/home.html#writer"/g)).toHaveLength(2);
  expect(home).toContain('href="../start.html#tour"');
  expect(home).toContain('href="#writer-1"');
  expect(result.pages).toHaveLength(5);
  expect(result.links).toBe(10);
  expect(start).toContain('offline renderer unavailable');
  expect(start).not.toContain('mermaid.min.js');
});
it('builds pinned offline Mermaid SVG without viewer scripts', async () => {
  const output = await temp();
  const result = await renderSite(fixture, output);
  expect(result.mermaid).toBe(true);
  await expect(access(path.join(output, '_md-render/mermaid.min.js'))).rejects.toMatchObject({ code: 'ENOENT' });
  const html = await readFile(path.join(output, 'chapters/start.html'), 'utf8');
  expect(html).toContain('<svg');
  expect(html).toContain('class="node');
  expect(html).not.toContain('diagrams.js');
  for (const token of ['fill', 'ink', 'line', 'cluster', 'label']) expect(html).toContain(`var(--diagram-${token})`);
  expect(html).not.toMatch(/src="https?:/);
});
it('defaults to Symbiotic and keeps the neutral theme explicit', async () => {
  const neutral = await temp();
  const branded = await temp();
  await renderSite(fixture, neutral, { mermaid: false, theme: 'default' });
  await renderSite(fixture, branded, { mermaid: false });
  expect(await readFile(path.join(neutral, 'index.html'), 'utf8')).not.toContain('logo.svg');
  expect(await readFile(path.join(branded, 'index.html'), 'utf8')).toContain('_md-render/logo.svg');
});
it('accepts a custom CSS file and its optional neighboring logo', async () => {
  const theme = await temp();
  await writeFile(path.join(theme, 'custom.css'), ':root{--accent:purple}');
  await writeFile(path.join(theme, 'custom.logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const output = await temp();
  await renderSite(fixture, output, { mermaid: false, theme: path.join(theme, 'custom.css') });
  expect(await readFile(path.join(output, '_md-render/theme.css'), 'utf8')).toContain('purple');
});

describe('visible input failures', () => {
  it('refuses missing Markdown targets and fragments', async () => {
    const source = await temp();
    const file = path.join(source, 'one.md');
    await writeFile(file, '# One\n\n[missing](absent.md)');
    await expect(renderSite(file, await temp(), { mermaid: false })).rejects.toThrow('outside rendered corpus');
    await writeFile(file, '# One\n\n[missing](#absent)');
    await expect(renderSite(file, await temp(), { mermaid: false })).rejects.toThrow('Missing anchor');
  });
  it('does not overwrite existing static output', async () => {
    const output = await temp();
    await writeFile(path.join(output, 'keep.txt'), 'keep');
    await expect(renderSite(fixture, output, { mermaid: false })).rejects.toThrow('must be empty');
    expect(await readFile(path.join(output, 'keep.txt'), 'utf8')).toBe('keep');
  });
  it('marks references outside the input as external without reading them', async () => {
    const source = await temp();
    await writeFile(path.join(source, 'one.md'), '# One\n\n[Native source](../not-present/source.cc)');
    const output = await temp();
    const result = await renderSite(source, output, { mermaid: false });
    expect(result.warnings).toHaveLength(1);
    const html = await readFile(path.join(output, 'one.html'), 'utf8');
    expect(html).not.toContain('(external local file)');
    expect(html).toContain('class="local-file"');
    expect(html).toContain('title="../not-present/source.cc"');
  });
  it('rejects image escapes and executable links', async () => {
    const source = await temp();
    const file = path.join(source, 'one.md');
    await writeFile(file, '# One\n\n![Image](../outside.png)');
    await expect(renderSite(file, await temp(), { mermaid: false })).rejects.toThrow('escapes source root');
    await writeFile(file, '# One\n\n[Bad](javascript:alert)');
    await expect(renderSite(file, await temp(), { mermaid: false })).rejects.toThrow('Unsupported link');
  });
  it('refuses unsupported metadata versions and symlink inputs', async () => {
    const source = await temp();
    await mkdir(path.join(source, 'docs'));
    await writeFile(path.join(source, 'docs/DOCUMENTS.json'), '{"version":2}');
    await expect(loadCorpus(source)).rejects.toThrow('unsupported version');
    const linked = path.join(await temp(), 'link.md');
    await symlink(path.join(fixture, 'index.md'), linked);
    await expect(loadCorpus(linked)).rejects.toThrow('symbolic link');
  });
  it('refuses entity homes with no canonical meaning', async () => {
    const source = await temp();
    await cp(fixture, source, { recursive: true });
    await writeFile(path.join(source, 'chapters/nested/home.md'), '<a id="home-section"></a>\n# Home\n\n<a id="writer"></a>\n## Writer');
    await expect(renderSite(source, await temp(), { mermaid: false })).rejects.toThrow('first paragraph');
  });
});

it('applies offline image rules to reference-style images', async () => {
  const source = await temp();
  const file = path.join(source, 'one.md');
  await writeFile(file, '# One\n\n![Remote image][picture]\n\n[picture]: https://example.invalid/picture.png');
  await expect(renderSite(file, await temp(), { mermaid: false })).rejects.toThrow('Remote or unsupported image');
});
it('preserves encoded filenames and copies reference-style local images', async () => {
  const source = await temp();
  await writeFile(path.join(source, 'index.md'), '# Index\n\n[Chapter](a%20chapter.md#point)\n\n![Local][picture]\n\n[picture]: picture.svg');
  await writeFile(path.join(source, 'a chapter.md'), '<a id="point"></a>\n# A chapter\n\nMeaning.');
  await writeFile(path.join(source, 'picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const output = await temp();
  await renderSite(source, output, { mermaid: false });
  expect(await readFile(path.join(output, 'index.html'), 'utf8')).toContain('href="a%20chapter.html#point"');
  expect(await readFile(path.join(output, 'picture.svg'), 'utf8')).toContain('<svg');
});
it('refuses output collisions between attachments and rendered pages', async () => {
  const source = await temp();
  await writeFile(path.join(source, 'one.md'), '# One\n\n[Attachment](one.html)');
  await writeFile(path.join(source, 'one.html'), 'Original attachment');
  await expect(renderSite(source, await temp(), { mermaid: false })).rejects.toThrow('collides with rendered page');
});

it('groups chapters by document title, uses first headings over manifest labels and follows manifest order', async () => {
  const source = await temp();
  await mkdir(path.join(source, 'docs'));
  await writeFile(path.join(source, 'z.md'), '## First **chapter**\n\n<a id="z"></a>');
  await writeFile(path.join(source, 'a.md'), '# Second chapter\n\n<a id="a"></a>');
  await writeFile(path.join(source, 'b.md'), '# Third chapter\n\n<a id="b"></a>');
  await writeFile(path.join(source, 'docs/DOCUMENTS.json'), JSON.stringify({
    version: 1, inventory: [], documents: [
      { id: 'book-id', title: 'First book', sections: [
        { id: 'slug-z', title: 'Wrong label', path: 'z.md', anchor: 'z' },
        { id: 'slug-a', path: 'a.md', anchor: 'a' },
      ] },
      { id: 'other-id', title: 'Second book', sections: [{ id: 'slug-b', path: 'b.md', anchor: 'b' }] },
    ],
  }));
  const output = await temp();
  await renderSite(source, output, { mermaid: false });
  const html = await readFile(path.join(output, 'a.html'), 'utf8');
  expect(html).toContain('<h2>First book</h2><ol>');
  expect(html).toContain('href="z.html">First chapter</a>');
  expect(html).toContain('<section class="document-group"><ol><li><div class="chapter-row"><a href="b.html">Second book</a>');
  expect(html).not.toMatch(/>Wrong label<|>slug-a<|>book-id</);
  expect(html).toContain('href="z.html"><small>Previous</small>First chapter</a>');
  expect(html).toContain('href="b.html"><small>Next</small>Third chapter</a>');
});
it('renders a controlled menu without a separate contents block in both themes', async () => {
  for (const theme of ['default', 'symbiotic']) {
    const source = await temp();
    await writeFile(path.join(source, 'index.md'), '# Page\n\n## One\n\n## Two');
    const output = await temp();
    await renderSite(source, output, { theme, mermaid: false });
    const html = await readFile(path.join(output, 'index.html'), 'utf8');
    expect(html).toContain('id="menu-button"');
    expect(html).toContain('aria-expanded="true" aria-controls="document-menu"');
    expect(html).toContain('id="document-menu"');
    expect(html).toContain('id="menu-close"');
    expect(html).not.toContain('On this page');
    expect(html).toContain('src="_md-render/navigation.js"');
    await expect(access(path.join(output, '_md-render/navigation.js'))).resolves.toBeUndefined();
  }
});

it('never uses a filename slug as a chapter title when no heading is authored', async () => {
  const source = await temp();
  await writeFile(path.join(source, 'opaque-slug.md'), 'A chapter without a heading.');
  const output = await temp();
  await renderSite(source, output, { mermaid: false });
  const html = await readFile(path.join(output, 'opaque-slug.html'), 'utf8');
  expect(html).toContain('aria-current="page">Untitled chapter</a>');
  expect(html).not.toContain('>opaque-slug</a>');
});


it('uses a single chapter menu with independent disclosures and a theme radio group', async () => {
  const source = await temp();
  await writeFile(path.join(source, 'index.md'), '# Current title\n\n## Only section\n\n### Nested section');
  await writeFile(path.join(source, 'other.md'), '# Other title\n\n## Other section');
  await writeFile(path.join(source, 'empty.md'), '# No sections');
  const output = await temp();
  await renderSite(source, output, { mermaid: false });
  const html = await readFile(path.join(output, 'index.html'), 'utf8');
  expect(html).not.toContain('On this page');
  expect(html).not.toContain('class="contents"');
  expect(html).toContain('aria-label="Toggle Current title" aria-expanded="true"');
  expect(html).toContain('aria-label="Toggle Other title" aria-expanded="false"');
  expect(html).not.toContain('Toggle No sections');
  expect(html).toContain('>Only section</a>');
  expect(html).toContain('>Nested section</a>');
  expect(html).toContain('role="radiogroup" aria-labelledby="theme-label"');
  expect(html).toContain('<span id="theme-label">Colour theme</span>');
  for (const value of ['system', 'light', 'dark']) expect(html).toContain(`value="${value}"`);
  const css = await readFile(path.join(output, '_md-render/theme.css'), 'utf8');
  expect(css).not.toContain('counter(sd-section');
  expect(css).toContain(':root:not([data-theme="light"])');
  expect(css).toContain(':root[data-theme="dark"]');
});
it('renders linked repository Markdown recursively in a collapsed referenced group', async () => {
  const source = await temp();
  await mkdir(path.join(source, 'docs'));
  await writeFile(path.join(source, 'docs/DOCUMENTS.json'), JSON.stringify({ version: 1, inventory: [], documents: [
    { id: 'book', title: 'Book', sections: [{ id: 'one', path: 'one.md', anchor: 'one' }] },
  ] }));
  await writeFile(path.join(source, 'one.md'), '# One\n\n[Two](two.md#two) [Native](source.ts)');
  await writeFile(path.join(source, 'two.md'), '# Two\n\n[Three][ref]\n\n[ref]: three.md');
  await writeFile(path.join(source, 'three.md'), '# Three\n\n[Cycle](two.md)');
  await writeFile(path.join(source, 'source.ts'), 'export {};');
  const output = await temp();
  const result = await renderSite(source, output, { mermaid: false });
  expect(result.pages).toEqual(['one.html', 'two.html', 'three.html']);
  const html = await readFile(path.join(output, 'one.html'), 'utf8');
  expect(html).toContain('<details class="document-group referenced"><summary>Referenced files</summary>');
  expect(html).toContain('href="two.html#two"');
  expect(html).toContain('class="local-file"');
  expect(html).toContain('title="source.ts"');
  expect(html).not.toContain('(external local file)');
});


it('renders sibling repository Markdown from a selected nested file without escaping the repository', async () => {
  const source = await temp();
  await mkdir(path.join(source, '.git'));
  await mkdir(path.join(source, 'nested'));
  await writeFile(path.join(source, 'nested/one.md'), '# One\n\n[Two](../two.md) [Outside](../../outside.md)');
  await writeFile(path.join(source, 'two.md'), '# Real sibling title');
  const output = await temp();
  const result = await renderSite(path.join(source, 'nested/one.md'), output, { mermaid: false });
  expect(result.pages).toEqual(['nested/one.html', 'two.html']);
  expect(result.warnings).toHaveLength(1);
  const html = await readFile(path.join(output, 'nested/one.html'), 'utf8');
  expect(html).toContain('href="../two.html"');
  expect(html).toContain('>Real sibling title<small class="reference-path">two.md</small></a>');
});
it('uses the first authored heading instead of conflicting frontmatter for menu labels', () => {
  expect(parseDocument('---\ntitle: Slug\n---\n\n# Real heading', 'fallback').title).toBe('Real heading');
});
it('keeps reference-style non-Markdown labels with a file icon and repository path', async () => {
  const source = await temp();
  await writeFile(path.join(source, 'index.md'), '# Page\n\n[Native][source]\n\n[source]: source.ts');
  const output = await temp();
  await renderSite(source, output, { mermaid: false });
  const html = await readFile(path.join(output, 'index.html'), 'utf8');
  expect(html).toMatch(/title="source.ts" class="local-file">Native<\/a>/);
  expect(html).not.toContain('(external local file)');
});

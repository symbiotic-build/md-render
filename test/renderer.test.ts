import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, rm, access, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from '../src/corpus.js';
import { documentHtml, parseDocument, transformUrls } from '../src/markdown.js';
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
  expect(start.match(/href="nested\/home.html#writer"/g)).toHaveLength(2);
  expect(home).toContain('href="../start.html#tour"');
  expect(home).toContain('href="#writer-1"');
  expect(result.pages).toHaveLength(3);
  expect(result.links).toBe(8);
  expect(start).toContain('offline renderer unavailable');
  expect(start).not.toContain('mermaid.min.js');
});
it('loads pinned offline Mermaid without remote script URLs', async () => {
  const output = await temp();
  const result = await renderSite(fixture, output);
  expect(result.mermaid).toBe(true);
  await expect(access(path.join(output, '_md-render/mermaid.min.js'))).resolves.toBeUndefined();
  const html = await readFile(path.join(output, 'chapters/start.html'), 'utf8');
  expect(html).toContain('src="../_md-render/mermaid.min.js"');
  expect(html).not.toMatch(/src="https?:/);
});
it('keeps brand assets in the optional Symbiotic theme', async () => {
  const neutral = await temp();
  const branded = await temp();
  await renderSite(fixture, neutral, { mermaid: false });
  await renderSite(fixture, branded, { mermaid: false, theme: 'symbiotic' });
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
    expect(await readFile(path.join(output, 'one.html'), 'utf8')).toContain('(external local file)');
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

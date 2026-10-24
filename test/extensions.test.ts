import { useBrowser } from './browser-fixture.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDocument, renderDocument, textDocument } from '../src/markdown.js';
import { renderSite, type RenderExtension, type SiteView } from '../src/site.js';
import { renderSinglePage } from '../src/single-file.js';

const withBrowser = useBrowser();
let root: string;
let source: string;
const hex = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 6);
beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'md-render-extensions-')));
  source = path.join(root, 'input');
  await mkdir(path.join(source, 'nested'), { recursive: true });
  await writeFile(path.join(source, 'index.md'), '# Guide\n\nFirst paragraph\nspans two lines.\n\n## Rules\n\n- One rule\n- Two rule\n\n| Key | Value |\n| --- | --- |\n| a | b |\n');
  await writeFile(path.join(source, 'nested/b.md'), '# Second\n\n<a id="limits"></a>\n\n## Limits and caps\n\nThe limit is 4 MiB.\n\nRepeat.\n\nRepeat.\n');
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it('marks every Markdown block with its source lines and a stable block ID', async () => {
  const { html, blocks } = await renderDocument(parseDocument('# Guide\n\nFirst paragraph\nspans two lines.\n\n## Rules\n\n- One rule\n- Two rule\n\n| Key | Value |\n| --- | --- |\n| a | b |\n', 'x'), { mark: true });
  expect(blocks.map(block => [block.tag, block.lines, block.heading])).toEqual([
    ['h1', [1, 1], 'guide'], ['p', [3, 4], 'guide'], ['h2', [6, 6], 'rules'], ['li', [8, 8], 'rules'], ['li', [9, 9], 'rules'],
    ['tr', [11, 11], 'rules'], ['tr', [13, 13], 'rules'],
  ]);
  expect(blocks[1]).toMatchObject({ id: `guide~${hex('First paragraph spans two lines.')}`, text: 'First paragraph spans two lines.' });
  expect(html).toContain(`<p data-source-lines="3-4" data-block="guide~${hex('First paragraph spans two lines.')}">`);
  expect(html).toContain(`<tr data-source-lines="13-13" data-block="rules~${hex('a b')}">`);
});

it('names blocks after an explicit anchor before a heading and numbers repeated text', async () => {
  const { blocks } = await renderDocument(parseDocument('<a id="limits"></a>\n\n## Limits and caps\n\nRepeat.\n\nRepeat.\n', 'x'));
  expect(blocks.map(block => block.id)).toEqual([`limits~${hex('Limits and caps')}`, `limits~${hex('Repeat.')}`, `limits~${hex('Repeat.')}-2`]);
});

it('gives source pages of plain text files no blocks, and marks nothing without extensions', async () => {
  const { html, blocks } = await renderDocument(textDocument('one\ntwo', 'notes.txt'), { mark: true });
  expect(blocks).toEqual([]);
  expect(html).not.toContain('data-block');
  const plain = await renderDocument(parseDocument('# Guide\n\nText.', 'x'));
  expect(plain.blocks).toHaveLength(2);
  expect(plain.html).toBe('<h1 id="guide">Guide</h1>\n<p>Text.</p>');
});

it('passes the rendered corpus to an extension and embeds its output in the single page', async () => {
  let seen: SiteView | undefined;
  const extension: RenderExtension = { name: 'probe', prepare(view) {
    seen = view;
    return { styles: '.probe{color:red}', script: 'window.probeRan = mdRender.extensionData("probe").count;', data: { count: 2, tag: '</script>' }, connect: true };
  } };
  const { html, view } = await renderSinglePage(source, { mermaid: false }, [extension]);
  expect(seen).toBe(view);
  expect(view.documents.map(document => document.path)).toEqual(['index.md', 'nested/b.md']);
  expect(view.documents[1]!.blocks.find(block => block.text === 'The limit is 4 MiB.')).toMatchObject({ path: 'nested/b.md', lines: [7, 7], heading: 'limits' });
  expect(html).toContain('<style data-md-render-extension="probe">.probe{color:red}</style>');
  expect(html).toContain('<script type="application/json" id="md-render-extension-data-probe">{"count":2,"tag":"\\u003c/script>"}</script>');
  const policy = /Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
  expect(policy).toContain(`'sha256-${createHash('sha256').update('window.probeRan = mdRender.extensionData("probe").count;').digest('base64')}'`);
  expect(policy).toContain("connect-src 'self'");
  expect(html).toContain('data-source-path="nested/b.md"');
  const plain = await renderSinglePage(source, { mermaid: false });
  expect(plain.html).toContain("connect-src 'none'");
  expect(plain.html).not.toMatch(/<(?:p|h1|li|tr)\b[^>]*data-block=/);
  const folder = path.join(root, 'folder');
  await renderSite(source, folder, { mermaid: false });
  expect(await readFile(path.join(folder, 'nested/b.html'), 'utf8')).not.toMatch(/<(?:p|h1|li|tr)\b[^>]*data-block=/);
});

it('stops the render when an extension fails or is malformed', async () => {
  await expect(renderSinglePage(source, { mermaid: false }, [{ name: 'broken', prepare() { throw new Error('no data'); } }]))
    .rejects.toThrow('Extension broken failed: no data');
  await expect(renderSinglePage(source, { mermaid: false }, [{ name: 'Bad Name', prepare: () => ({}) }]))
    .rejects.toThrow('Invalid extension name: Bad Name');
  await expect(renderSinglePage(source, { mermaid: false }, [{ name: 'a', prepare: () => ({}) }, { name: 'a', prepare: () => ({}) }]))
    .rejects.toThrow('Duplicate extension name: a');
  await expect(renderSinglePage(source, { mermaid: false }, [{ name: 'tag', prepare: () => ({ script: 'x = "</script>"' }) }]))
    .rejects.toThrow('Extension tag failed: its script contains </script');
});

it('lets an extension find blocks by source line and show them in the single page', async () => {
  const script = `mdRender.onNavigate(path => { (window.navigations ||= []).push(path); });`;
  const { html } = await renderSinglePage(source, { mermaid: false }, [{ name: 'probe', prepare: () => ({ script }) }]);
  const file = path.join(root, 'single.html');
  await writeFile(file, html);
  await withBrowser(async browser => {
    await browser.navigate(pathToFileURL(file).href);
    expect(await browser.evaluate(`({ version: mdRender.version, current: mdRender.currentDocument(), documents: mdRender.documents().map(d => d.path), frozen: Object.isFrozen(mdRender) })`))
      .toEqual({ version: 1, current: 'index.md', documents: ['index.md', 'nested/b.md'], frozen: true });
    expect(await browser.evaluate(`mdRender.blocks('index.md', 4, 8).map(e => e.tagName + ' ' + e.dataset.sourceLines)`)).toEqual(['P 3-4', 'H2 6-6', 'LI 8-8']);
    const shown = await browser.evaluate(`mdRender.show({ path: 'nested/b.md', block: mdRender.blocks('nested/b.md', 7, 7)[0].dataset.block }).then(e => ({ text: e.textContent, visible: e.checkVisibility(), current: mdRender.currentDocument(), navigations: window.navigations }))`);
    expect(shown).toEqual({ text: 'The limit is 4 MiB.', visible: true, current: 'nested/b.md', navigations: ['nested/b.md'] });
    expect(await browser.evaluate(`mdRender.show({ path: 'nested/b.md', anchor: 'limits' }).then(e => e.textContent)`)).toBe('Limits and caps');
    expect(await browser.evaluate(`mdRender.show({ path: 'missing.md' })`)).toBeNull();
  });
});

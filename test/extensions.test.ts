import { useBrowser } from './browser-fixture.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { documentHtml, exportSite, parseDocument, renderSinglePage, renderSite, renderView, type ExtensionOutput, type ParsedDocument, type RenderExtension, type SiteView } from '../src/index.js';

const withBrowser = useBrowser();
let root: string;
let source: string;
let anchors: string;
const hex = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 6);
beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'md-render-extensions-')));
  source = path.join(root, 'input');
  await mkdir(path.join(source, 'nested'), { recursive: true });
  await writeFile(path.join(source, 'index.md'), '# Guide\n\nFirst paragraph\nspans two lines.\n\n## Rules\n\n- One rule\n- Two rule\n\n| Key | Value |\n| --- | --- |\n| a | b |\n\n```mermaid\ngraph TD; A-->B\n```\n\n[Notes](notes.txt)\n');
  await writeFile(path.join(source, 'notes.txt'), 'one\ntwo\n');
  await writeFile(path.join(source, 'nested/b.md'), '# Second\n\n<a id="limits"></a>\n\n## Limits and caps\n\nThe limit is 4 MiB.\n\nRepeat.\n\nRepeat.\n');  // Text before the first heading, an inline anchor, and the three supported anchor forms before a heading.
  anchors = path.join(root, 'anchors');
  await mkdir(anchors);
  await writeFile(path.join(anchors, 'index.md'), ['Intro before any heading.', '# Anchors', 'Before <a id="spot"></a> after.', 'Different passage.',
    '<a id="marker"></a>', '## Marked', 'Under marked.', '<a id="stacked">\n</a>', '## Stacked', 'Under stacked.',
    '<a id="first"></a><br><a id="second"></a>', '## Mixed', 'Under mixed.'].join('\n\n') + '\n');
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

/** The view an extension receives, with the single page rendered beside it. */
async function probe(options: { mermaid?: boolean } = {}): Promise<{ view: SiteView; html: string }> {
  let seen: SiteView | undefined;
  const { html } = await renderSinglePage(source, { mermaid: options.mermaid ?? false }, [{ name: 'probe', prepare(view) { seen = view; return {}; } }]);
  return { view: seen!, html };
}
const blocksOf = (view: SiteView, file: string) => view.documents.find(document => document.path === file)!.blocks;

it('marks every Markdown block with its source lines and a stable block ID', async () => {
  const { view, html } = await probe();
  expect(blocksOf(view, 'index.md').map(block => [block.tag, block.lines, block.heading])).toEqual([
    ['h1', [1, 1], 'guide'], ['p', [3, 4], 'guide'], ['h2', [6, 6], 'rules'], ['li', [8, 8], 'rules'], ['li', [9, 9], 'rules'],
    ['tr', [11, 11], 'rules'], ['tr', [13, 13], 'rules'], ['figure', [15, 17], 'rules'], ['pre', [15, 17], 'rules'], ['p', [19, 19], 'rules'],
  ]);
  expect(blocksOf(view, 'index.md')[1]).toMatchObject({ path: 'index.md', id: `guide~${hex('First paragraph spans two lines.')}`, text: 'First paragraph spans two lines.' });
  expect(html).toContain(`<p data-source-lines="3-4" data-block="guide~${hex('First paragraph spans two lines.')}">`);
  expect(html).toContain(`<tr data-source-lines="13-13" data-block="rules~${hex('a b')}">`);
});

it('names blocks after an explicit anchor before a heading and numbers repeated text', async () => {
  const { view } = await probe();
  expect(blocksOf(view, 'nested/b.md').map(block => block.id)).toEqual([
    `second~${hex('Second')}`, `second~${hex('')}`, `limits~${hex('Limits and caps')}`, `limits~${hex('The limit is 4 MiB.')}`, `limits~${hex('Repeat.')}`, `limits~${hex('Repeat.')}-2`,
  ]);
});

// Lines: 1 intro, 3 h1, 5 inline anchor, 7, 9 anchor-only paragraph, 11 h2, 13, 15-16 HTML-block anchor, 18 h2, 20, 22 all-HTML paragraph, 24 h2, 26.
it('names a section after the explicit anchor before its heading, in every supported anchor form', async () => {
  let seen: SiteView | undefined;
  await renderSinglePage(anchors, { mermaid: false }, [{ name: 'probe', prepare(view) { seen = view; return {}; } }]);
  expect(blocksOf(seen!, 'index.md').map(block => [block.tag, block.lines, block.heading, block.id.split('~')[0]])).toEqual([
    ['p', [1, 1], null, 'top'], ['h1', [3, 3], 'anchors', 'anchors'], ['p', [5, 5], 'anchors', 'anchors'], ['p', [7, 7], 'anchors', 'anchors'],
    ['p', [9, 9], 'anchors', 'anchors'], ['h2', [11, 11], 'marker', 'marker'], ['p', [13, 13], 'marker', 'marker'],
    ['h2', [18, 18], 'stacked', 'stacked'], ['p', [20, 20], 'stacked', 'stacked'],
    ['p', [22, 22], 'stacked', 'stacked'], ['h2', [24, 24], 'first', 'first'], ['p', [26, 26], 'first', 'first'],
  ]);
});

it('gives source pages of plain text files no blocks', async () => {
  const { view, html } = await probe();
  const notes = view.documents.find(document => document.path.endsWith('/notes.txt.md'))!;
  expect(notes).toMatchObject({ title: 'notes.txt', blocks: [] });
  const section = new RegExp(`<section class="single-page"[^>]*data-source-path="${notes.path}">([\\s\\S]*?)</section>`).exec(html)![1]!;
  expect(section).toContain('id="page-2--L2"');
  expect(section).not.toContain('data-block');
});

it('gives a Mermaid figure and its source the fence lines, with and without the diagram renderer', async () => {
  for (const mermaid of [false, true]) {
    const { view, html } = await probe({ mermaid });
    const id = (tag: string) => blocksOf(view, 'index.md').find(block => block.tag === tag && block.lines[0] === 15)?.id;
    // The figure and its source have the same text, the fence's, so the source is the repeat.
    expect([id('figure'), id('pre')]).toEqual([expect.stringMatching(/^rules~[0-9a-f]{6}$/), expect.stringMatching(/^rules~[0-9a-f]{6}-2$/)]);
    expect(html).toMatch(new RegExp(`<figure class="mermaid-diagram" data-source-lines="15-17" data-block="${id('figure')}">`));
    expect(html).toContain(`<pre data-source-lines="15-17" data-block="${id('pre')}">`);
    if (mermaid) expect(html).toMatch(/<figure class="mermaid-diagram"[^>]*><div><svg/);
  }
});

// The figure's text and ID must not depend on whether the renderer drew it: renderView never draws.
it('gives a Mermaid figure the text of its fence, whatever the diagram renderer drew', async () => {
  const figure = (view: SiteView) => blocksOf(view, 'index.md').find(block => block.tag === 'figure');
  const expected = { lines: [15, 17], text: 'graph TD; A-->B', id: `rules~${hex('graph TD; A-->B')}` };
  expect(figure((await probe({ mermaid: true })).view)).toMatchObject(expected);
  expect(figure((await renderView(source, { mermaid: false })).view)).toMatchObject(expected);
});

// A view needs no theme file and no diagram browser: with either missing, renderView still returns it.
it.each([
  { name: 'a theme file that does not exist', theme: 'no-theme.css' },
  { name: 'diagrams on and no browser to draw them', mermaid: true, browser: 'no-browser' },
] as { name: string; theme?: string; mermaid?: boolean; browser?: string }[])('returns the view without building a page, given $name', async ({ theme, mermaid, browser }) => {
  const { view: expected } = await probe();
  const saved = process.env.MD_RENDER_BROWSER;
  if (browser) process.env.MD_RENDER_BROWSER = path.join(root, browser);
  try {
    const { view } = await renderView(source, { mermaid: mermaid ?? false, ...(theme ? { theme: path.join(root, theme) } : {}) });
    expect(view).toEqual(expected);
  } finally { if (saved === undefined) delete process.env.MD_RENDER_BROWSER; else process.env.MD_RENDER_BROWSER = saved; }
});

it("keeps main's output bytes for renders without extensions (recorded from main at dd43046)", async () => {
  // SHA-256 of every file main wrote for this corpus, folder and single file, with Mermaid off.
  const expected = {
    'folder/_md-render/base.css': 'a336f938dc8a2f8c18c81206cecd1d4fdc31d4a4a822ad47be65a172fad1b883',
    'folder/_md-render/navigation.js': '5fc272409a12ba60c3c0ebb6fe87e40bff8a13c5d66f40eb2e7ed5d31b426202',
    'folder/_md-render/theme.css': '884281e49c9386d5c0da4b6548baa33234248541927142e71d64a028dfcb08a1',
    'folder/index.html': '0ee59e31a5c37db6d1f6ee54f99977094579c512aa1303414537eac2cfbf05c7',
    'folder/nested/b.html': 'ae1ea8ff62797d2877d5ab9b7b4b245c60951efffac1c00c3362f391a327c060',
    'single.html': '9bf16a726da63b9d58b60d15ab73cda09a986102ee7d67577994b0d07612e047',
  };
  const base = path.join(root, 'bytes');
  const input = path.join(base, 'input');
  await mkdir(path.join(input, 'nested'), { recursive: true });
  await writeFile(path.join(input, 'index.md'), '# Guide\n\n<a id="limits"></a>\n\n## Limits\n\nFirst paragraph\nspans two lines.\n\n- One\n- Two\n\n| Key | Value |\n| --- | --- |\n| a | b |\n\n```mermaid\ngraph TD; A-->B\n```\n\n[Second](nested/b.md#rules)\n');
  await writeFile(path.join(input, 'nested/b.md'), '# Second\n\n## Rules\n\nRepeat.\n');
  await renderSite(input, path.join(base, 'folder'), { mermaid: false });
  await exportSite(input, { singleFile: path.join(base, 'single.html') }, { mermaid: false });
  const files = [...(await readdir(path.join(base, 'folder'), { recursive: true, withFileTypes: true }))].filter(entry => entry.isFile())
    .map(entry => path.relative(base, path.join(entry.parentPath, entry.name))).concat('single.html').sort();
  const actual = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(path.join(base, file))).digest('hex')])));
  expect(actual).toEqual(expected);
});

it('passes the rendered corpus to an extension and embeds its output in the single page', async () => {
  let seen: SiteView | undefined;
  const extension: RenderExtension = { name: 'probe', prepare(view) {
    seen = view;
    return { styles: '.probe{color:red}', script: 'window.probeRan = mdRender.extensionData("probe").count;', data: { count: 2, tag: '</script>' }, connect: true };
  } };
  const { html, view } = await renderSinglePage(source, { mermaid: false }, [extension]);
  expect(seen).toBe(view);
  expect(view.documents.map(document => document.path)).toEqual(['index.md', 'nested/b.md', '_md-render/references/0/notes.txt.md']);
  expect(view.documents[1]!.blocks.find(block => block.text === 'The limit is 4 MiB.')).toMatchObject({ path: 'nested/b.md', lines: [7, 7], heading: 'limits' });
  expect(html).toContain('<style data-md-render-extension="probe">.probe{color:red}</style>');
  expect(html).toContain('<script type="application/json" id="md-render-extension-data-probe">{"count":2,"tag":"\\u003c/script>"}</script>');
  const policy = /Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
  expect(policy).toContain(`'sha256-${createHash('sha256').update('window.probeRan = mdRender.extensionData("probe").count;').digest('base64')}'`);
  expect(policy).toContain("connect-src 'self'");
  expect(html).toContain('data-source-path="nested/b.md"');
});

it('gives an extension the text of each document as md-render read it', async () => {
  const { view } = await probe();
  const read = (file: string) => readFile(path.join(source, file), 'utf8');
  expect(view.documents.map(document => [document.path, document.markdown])).toEqual([
    ['index.md', await read('index.md')], ['nested/b.md', await read('nested/b.md')], ['_md-render/references/0/notes.txt.md', 'one\ntwo\n'],
  ]);
});

// A caller that built a ParsedDocument before the view existed still typechecks and renders.
it('renders a document object that a caller built without its source text', async () => {
  const { title, tree, anchors, headings, meanings } = parseDocument('# Title\n\nText.\n', 'Untitled');
  const built: ParsedDocument = { title, tree, anchors, headings, meanings };
  expect(await documentHtml(built)).toBe('<h1 id="title">Title</h1>\n<p>Text.</p>');
});

it('gives every extension the same read-only view, whatever an earlier one tries to change', async () => {
  const attempts: string[] = [];
  const tryTo = (name: string, change: () => void) => { try { change(); attempts.push(`${name} changed`); } catch { attempts.push(`${name} refused`); } };
  let later: SiteView | undefined;
  const { view } = await renderSinglePage(source, { mermaid: false }, [
    { name: 'writer', prepare(view) {
      const documents = view.documents as unknown as { title: string; blocks: { text: string; lines: number[] }[] }[];
      tryTo('documents', () => { (documents as unknown[]).pop(); });
      tryTo('title', () => { documents[0]!.title = 'Changed'; });
      tryTo('blocks', () => { documents[0]!.blocks.splice(0, 1); });
      tryTo('text', () => { documents[0]!.blocks[0]!.text = 'Changed'; });
      tryTo('lines', () => { documents[0]!.blocks[0]!.lines[0] = 99; });
      return {};
    } },
    { name: 'reader', prepare(view) { later = view; return {}; } },
  ]);
  expect(attempts).toEqual(['documents refused', 'title refused', 'blocks refused', 'text refused', 'lines refused']);
  expect(later).toBe(view);
  expect(view.documents.map(document => document.title)).toEqual(['Guide', 'Second', 'notes.txt']);
  expect(view.documents[0]!.blocks[0]).toMatchObject({ text: 'Guide', lines: [1, 1] });
});

it('stops the render when an extension fails or is malformed', async () => {
  const returns = (name: string, output: unknown): RenderExtension[] => [{ name, prepare: () => output as ExtensionOutput }];
  const cases: [RenderExtension[], string][] = [
    [[{ name: 'broken', prepare() { throw new Error('no data'); } }], 'Extension broken failed: no data'],
    [returns('Bad Name', {}), 'Invalid extension name: Bad Name'],
    [[...returns('a', {}), ...returns('a', {})], 'Duplicate extension name: a'],
    [returns('tag', { script: 'x = "</script>"' }), 'Extension tag failed: its script contains </script'],
    [returns('tag', { script: 'x = "<!--<script>"' }), 'Extension tag failed: its script contains <!--'],
    [returns('tag', { script: 'x = "<SCRIPT>"' }), 'Extension tag failed: its script contains <SCRIPT'],
  ];
  const outcomes = await Promise.all(cases.map(([extensions]) => renderSinglePage(source, { mermaid: false }, extensions).then(() => 'rendered', (error: Error) => error.message)));
  expect(outcomes).toEqual(cases.map(([, message]) => message));
});

/** Writes a single page with one extension; by default its script records navigation. */
async function singleFile(name: string, { input = source, mermaid = false, script = `mdRender.onNavigate(path => { (window.navigations ||= []).push(path); });` } = {}): Promise<string> {
  const { html } = await renderSinglePage(input, { mermaid }, [{ name: 'probe', prepare: () => ({ script }) }]);
  const file = path.join(root, name);
  await writeFile(file, html);
  return pathToFileURL(file).href;
}

it('lets an extension find blocks by source line and show them in the single page', async () => {
  const url = await singleFile('single.html');
  await withBrowser(async browser => {
    await browser.navigate(url);
    expect(await browser.evaluate(`({ version: mdRender.version, current: mdRender.currentDocument(), documents: mdRender.documents().map(d => d.path), frozen: Object.isFrozen(mdRender) })`))
      .toEqual({ version: 1, current: 'index.md', documents: ['index.md', 'nested/b.md', '_md-render/references/0/notes.txt.md'], frozen: true });
    expect(await browser.evaluate(`mdRender.blocks('index.md', 4, 8).map(e => e.tagName + ' ' + e.dataset.sourceLines)`)).toEqual(['P 3-4', 'H2 6-6', 'LI 8-8']);
    const shown = await browser.evaluate(`mdRender.show({ path: 'nested/b.md', block: mdRender.blocks('nested/b.md', 7, 7)[0].dataset.block }).then(e => ({ text: e.textContent, visible: e.checkVisibility(), current: mdRender.currentDocument(), navigations: window.navigations }))`);
    expect(shown).toEqual({ text: 'The limit is 4 MiB.', visible: true, current: 'nested/b.md', navigations: ['nested/b.md'] });
    expect(await browser.evaluate(`mdRender.show({ path: 'nested/b.md', anchor: 'limits' }).then(e => e.textContent)`)).toBe('Limits and caps');
    expect(await browser.evaluate(`mdRender.show({ path: 'missing.md' })`)).toBeNull();
  });
});

it('shows the passage that holds an anchor, or the heading after an anchor that stands alone', async () => {
  const url = await singleFile('single-anchors.html', { input: anchors });
  await withBrowser(async browser => {
    await browser.navigate(url);
    expect(await browser.evaluate(`Promise.all(['spot', 'marker', 'stacked'].map(anchor => mdRender.show({ path: 'index.md', anchor }).then(e => e.textContent.replace(/\\s+/g, ' '))))`))
      .toEqual(['Before after.', 'Marked', 'Stacked']);
  });
});

it('opens the collapsed Mermaid source that show() selects', async () => {
  const url = await singleFile('single-mermaid.html', { mermaid: true });
  await withBrowser(async browser => {
    await browser.navigate(url);
    expect(await browser.evaluate(`mdRender.show({ path: 'index.md', block: mdRender.blocks('index.md', 15, 15).find(e => e.localName === 'pre').dataset.block }).then(e => ({ tag: e.localName, visible: e.checkVisibility() }))`))
      .toEqual({ tag: 'pre', visible: true });
  });
});

it('runs an extension script written with Windows line endings', async () => {
  const url = await singleFile('single-crlf.html', { script: 'window.first = 1;\r\nwindow.second = 2;\r\n' });
  await withBrowser(async browser => {
    await browser.navigate(url);
    expect(await browser.evaluate('[window.first, window.second]')).toEqual([1, 2]);
  });
});

it('follows a link back to the previous chapter after show() opened another one', async () => {
  const url = await singleFile('single-return.html');
  await withBrowser(async browser => {
    await browser.navigate(url + '#page-0');
    expect(await browser.evaluate(`mdRender.show({ path: 'nested/b.md', anchor: 'limits' }).then(() => mdRender.currentDocument())`)).toBe('nested/b.md');
    // A chapter link sets the hash; the page must route it even though that chapter was shown before.
    expect(await browser.evaluate(`new Promise(resolve => {
      addEventListener('hashchange', () => resolve(mdRender.currentDocument()), { once: true });
      setTimeout(() => resolve('no hash change; still ' + mdRender.currentDocument()), 2000);
      document.querySelector('.sidebar a[href="#page-0"]').click();
    })`)).toBe('index.md');
  });
});

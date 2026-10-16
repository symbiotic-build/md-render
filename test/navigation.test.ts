import { useBrowser } from './browser-fixture.js';
import { afterAll, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderSite } from '../src/site.js';
import type { BrowserSession } from '../src/browser.js';
const withBrowser = useBrowser();

const scratch: string[] = [];
afterAll(async () => { await Promise.all(scratch.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
let menuFixture: Promise<{ output: string; url: string }> | undefined;
function fixture() { return menuFixture ??= buildFixture(); }
async function buildFixture() {
  const source = await mkdtemp(path.join(tmpdir(), 'md-render-navigation-'));
  scratch.push(source);
  await mkdir(path.join(source, 'docs'));
  const documents = [];
  for (let i = 0; i < 24; i++) {
    await writeFile(path.join(source, `single-${i}.md`), `# Authored title ${i}\n\n## Section ${i}`);
    documents.push({ id: `single-${i}`, title: `Document ${i}`, sections: [{ id: 'body', path: `single-${i}.md`, anchor: `section-${i}` }] });
  }
  for (const [name, first] of [['own', '# Authored chapter'], ['same', '# Book same\n\n## Overview'], ['empty', '# Book empty']] as const) {
    await writeFile(path.join(source, `${name}.md`), `${first}\n\n<a id="body"></a>\n\n${Array.from({ length: 14 }, (_, i) => `<a id="section-${i}"></a>\n\n## Part ${i}\n\n${'Paragraph for a bounded scroll test. '.repeat(90)}`).join('\n\n')}`);
    await writeFile(path.join(source, `${name}-next.md`), '# Next chapter\n\n## Next section');
    documents.push({ id: name, title: `Book ${name}`, sections: [{ id: 'body', path: `${name}.md`, anchor: 'body' }, { id: 'next', path: `${name}-next.md`, anchor: 'next-section' }] });
  }
  // No level-two heading: this chapter must use the Introduction fallback.
  await writeFile(path.join(source, 'empty.md'), '# Book empty\n\n<a id="body"></a>');
  await writeFile(path.join(source, 'docs/DOCUMENTS.json'), JSON.stringify({ version: 1, inventory: [], documents }));
  const output = path.join(source, 'rendered');
  await renderSite(source, output, { mermaid: false });
  return { output, url: pathToFileURL(path.join(output, 'own.html')).href };
}
const settle = (browser: BrowserSession) => browser.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);

it('follows an inbound map fragment to an empty target while retaining the sibling menu links', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'md-render-map-'));
  scratch.push(source);
  await writeFile(path.join(source, 'index.md'), '# Book\n\n<!-- spec-docs:navigation document="book" -->\n\n## Overview\n\nPurpose.\n\n<a id="book-map"></a>\n\n## Document map\n\n- Duplicate chapter list\n\n## Entity index\n\nTerms.\n\n<!-- /spec-docs:navigation -->');
  await writeFile(path.join(source, 'other.md'), '# Other\n\n[Map](index.md#book-map)');
  const output = path.join(source, 'rendered');
  await renderSite(source, output, { mermaid: false });
  await withBrowser(async browser => {
    await browser.navigate(pathToFileURL(path.join(output, 'other.html')).href);
    const href = await browser.evaluate<string>(`document.querySelector('article a').href`);
    await browser.navigate(href);
    expect(await browser.evaluate(`location.hash`)).toBe('#book-map');
    expect(await browser.evaluate(`document.querySelector(':target').outerHTML`)).toBe('<a id="book-map"></a>');
    expect(await browser.evaluate(`document.querySelectorAll('[id="book-map"]').length`)).toBe(1);
    expect(await browser.evaluate(`document.querySelector('article').textContent.includes('Duplicate chapter list')`)).toBe(false);
    expect(await browser.evaluate(`Array.from(document.querySelectorAll('#chapter-sections-0 > ol > li > a'), a => [a.textContent, !!document.getElementById(a.hash.slice(1))])`)).toEqual([
      ['Overview', true], ['Entity index', true],
    ]);
  });
});

it('flattens single-chapter documents to their document title with current sections', async () => {
  const { output } = await fixture();
  const html = await readFile(path.join(output, 'single-0.html'), 'utf8');
  const menu = html.split('<nav aria-label="Document map">')[1]!.split('</nav>')[0]!;
  expect(menu).not.toContain('<h2>Document 0</h2>');
  expect(menu).toContain('aria-current="page">Document 0</a>');
  expect(menu).toContain('href="#section-0">Section 0</a>');
});

it('labels the first chapter by its heading, first level-two heading or Introduction without adjacent duplicate labels', async () => {
  const { url } = await fixture();
  await withBrowser(async browser => {
    await browser.navigate(url);
    expect(await browser.evaluate(`Array.from(document.querySelectorAll('.document-group h2'), heading => [heading.textContent, heading.nextElementSibling.querySelector('.chapter-row a').textContent])`)).toEqual([
      ['Book own', 'Authored chapter'], ['Book same', 'Overview'], ['Book empty', 'Introduction'],
    ]);
    expect(await browser.evaluate(`(() => { const labels = [...document.querySelectorAll('#document-menu nav h2, #document-menu nav a')].map(el => el.textContent.trim()); return labels.filter((label,i) => i && label === labels[i-1]); })()`)).toEqual([]);
  });
});

it('keeps a tall sidebar fixed with independent scrolling at desktop widths and only one document navigation at every width', async () => {
  const { url } = await fixture();
  await withBrowser(async browser => {
    await browser.navigate(url);
    for (const width of [1440, 1024, 1023, 390]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
      await settle(browser);
      expect(await browser.evaluate(`document.querySelectorAll('aside').length`)).toBe(1);
      expect(await browser.evaluate(`document.querySelectorAll('nav[aria-label="Document map"]').length`)).toBe(1);
      expect(await browser.evaluate(`document.querySelectorAll('.contents').length`)).toBe(0);
      expect(await browser.evaluate(`document.body.textContent.includes('On this page')`)).toBe(false);
      if (width < 1024) continue;
      expect(await browser.evaluate(`getComputedStyle(document.querySelector('#document-menu')).position`)).toBe('fixed');
      expect(await browser.evaluate(`document.querySelector('#document-menu').getBoundingClientRect().toJSON()`)).toMatchObject({ y: 56, height: 744 });
      expect(await browser.evaluate(`getComputedStyle(document.querySelector('#document-menu nav')).overflowY`)).toBe('auto');
      expect(await browser.evaluate(`getComputedStyle(document.querySelector('#document-menu nav')).scrollbarWidth`)).toBe('thin');
      await browser.evaluate(`window.scrollTo(0, 1500)`);
      await settle(browser);
      expect(await browser.evaluate(`document.querySelector('#document-menu').getBoundingClientRect().toJSON()`)).toMatchObject({ y: 56, height: 744 });
      expect(await browser.evaluate(`document.querySelector('.menu-bar').getBoundingClientRect().top`)).toBe(0);
      expect(await browser.evaluate(`(() => { const nav=document.querySelector('#document-menu nav'); nav.scrollTop=nav.scrollHeight; return window.scrollY; })()`)).toBe(1500);
      await browser.evaluate(`window.scrollTo(0,0)`);
    }
  });
});

it('tracks the last section above the reading line, handles hash navigation and reveals the current entry without scrolling the page', async () => {
  const { url } = await fixture();
  await withBrowser(async browser => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await browser.navigate(url);
    await settle(browser);
    expect(await browser.evaluate(`getComputedStyle(document.querySelector('.chapter-toggle span')).transitionDuration`)).toBe('0s');
    await browser.evaluate(`window.scrollTo(0,document.getElementById('part-6').getBoundingClientRect().top + scrollY - innerHeight/3 + 2)`);
    await settle(browser);
    expect(await browser.evaluate(`document.querySelector('#document-menu a[aria-current="location"]')?.hash`)).toBe('#section-6');
    expect(await browser.evaluate(`(() => { const link=document.querySelector('#document-menu a[aria-current="location"]'), nav=link.closest('nav'); const a=link.getBoundingClientRect(), b=nav.getBoundingClientRect(); return a.top >= b.top && a.bottom <= b.bottom; })()`)).toBe(true);
    // A collapsed current chapter opens on hash navigation; explicit hash wins immediately.
    await browser.evaluate(`document.querySelector('.chapter-toggle[aria-expanded="true"]').click(); location.hash='section-2'`);
    await settle(browser);
    expect(await browser.evaluate(`document.querySelector('#document-menu a[aria-current="location"]')?.hash`)).toBe('#section-2');
    expect(await browser.evaluate(`document.querySelector('#document-menu a[aria-current="location"]').getClientRects().length`)).toBeGreaterThan(0);
    await browser.evaluate(`document.querySelector('.chapter-toggle[aria-expanded="true"]').click(); window.scrollTo(0,document.getElementById('part-4').getBoundingClientRect().top + scrollY - innerHeight/3 + 2)`);
    await settle(browser);
    expect(await browser.evaluate(`document.querySelector('#document-menu a[aria-current="location"]')?.hash`)).toBe('#section-4');
    expect(await browser.evaluate(`document.querySelector('#document-menu a[aria-current="location"]').getClientRects().length`)).toBeGreaterThan(0);
    // Observe a jump backwards across several headings, not just adjacent intersections.
    await browser.evaluate(`window.scrollTo(0,0)`);
    await settle(browser);
    expect(await browser.evaluate(`document.querySelector('#document-menu a[aria-current="location"]')`)).toBe(null);
    expect(await browser.evaluate(`window.scrollY`)).toBe(0);
  });
});

it('keeps all navigation links usable without JavaScript on a phone', async () => {
  const { url } = await fixture();
  await withBrowser(async browser => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.send('Emulation.setScriptExecutionDisabled', { value: true });
    await browser.navigate(url);
    expect(await browser.evaluate(`getComputedStyle(document.querySelector('#document-menu')).display`)).not.toBe('none');
    expect(await browser.evaluate(`document.querySelector('#document-menu a[href="single-0.html#section-0"]').getClientRects().length`)).toBeGreaterThan(0);
  });
});

it('distinguishes heading-free references and opens the referenced group on its current page', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'md-render-references-'));
  scratch.push(source);
  await writeFile(path.join(source, 'index.md'), '# Index\n\n[First](a.md) and [Second](b.md)');
  await writeFile(path.join(source, 'a.md'), 'First reference without a heading.');
  await writeFile(path.join(source, 'b.md'), 'Second reference without a heading.');
  const output = path.join(source, 'rendered');
  await renderSite(path.join(source, 'index.md'), output, { mermaid: false });
  await withBrowser(async browser => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.navigate(pathToFileURL(path.join(output, 'a.html')).href);
    expect(await browser.evaluate(`document.querySelector('.referenced').open`)).toBe(true);
    expect(await browser.evaluate(`Array.from(document.querySelectorAll('.referenced .chapter-row a'), link => link.textContent)`)).toEqual(['Untitled chaptera.md', 'Untitled chapterb.md']);
    expect(await browser.evaluate(`document.querySelector('.referenced a[aria-current="page"]').getClientRects().length`)).toBeGreaterThan(0);
  });
});

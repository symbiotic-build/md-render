import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startViewer, type Viewer } from '../src/server.js';
import { renderSite } from '../src/site.js';
import { withBrowser, type BrowserSession } from '../src/browser.js';

const scratch: string[] = [];
const viewers: Viewer[] = [];
afterEach(async () => { await Promise.all(viewers.splice(0).map(viewer => viewer.close())); });
afterEach(async () => { await Promise.all(scratch.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
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


async function swapFixture(diagrams = false, cachePages = 6, theme = 'symbiotic') {
  const source = await mkdtemp(path.join(tmpdir(), 'md-render-swaps-'));
  scratch.push(source);
  await mkdir(path.join(source, 'docs'));
  await mkdir(path.join(source, 'nested'));
  const paths = ['a.md', 'nested/b.md', ...Array.from({ length: 8 }, (_, i) => `c${i}.md`)];
  for (const [i, file] of paths.entries()) {
    await writeFile(path.join(source, file), `# Chapter ${i}\n\n## Section\n\n${'Reading paragraph. '.repeat(500)}\n\n## End\n\n${'End paragraph. '.repeat(200)}${diagrams && i === 1 ? '\n\n```mermaid\nflowchart TD\nA --> B\n```' : ''}`);
  }
  await writeFile(path.join(source, 'docs/DOCUMENTS.json'), JSON.stringify({ version: 1, inventory: [], documents: [
    { id: 'book', title: 'Book', sections: paths.map((file, i) => ({ id: `part${i}`, path: file, anchor: 'section' })) },
  ] }));
  const viewer = await startViewer(source, { theme, mermaid: diagrams, navigation: { version: 1, cachePages } });
  viewers.push(viewer);
  return viewer;
}
async function until(browser: BrowserSession, condition: string) {
  await browser.evaluate(`new Promise((resolve, reject) => {
    const start = performance.now();
    function check() {
      if (${condition}) resolve(true);
      else if (performance.now() - start > 2500) reject(new Error('Condition timed out: ' + ${JSON.stringify(condition)}));
      else requestAnimationFrame(check);
    } check();
  })`);
}

it('swaps rendered pages with prefetch history and reading controls', async () => {
  const viewer = await swapFixture(true);
  await withBrowser(async browser => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.navigate(viewer.url);
    await browser.evaluate(`window.originalDocument = document; window.calls=[]; window.nativeFetch=fetch;
      window.fetch=(...args)=>{ calls.push(String(args[0])); return nativeFetch(...args); };
      document.querySelector('input[value="dark"]').click();
      document.querySelector('.chapter-row a[href="c0.html"]').dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
      document.querySelector('.chapter-row a[href="c0.html"]').focus();`);
    await until(browser, `performance.getEntriesByType('resource').some(e => e.name.endsWith('/c0.html'))`);
    expect(await browser.evaluate(`calls.filter(url=>url.endsWith('/c0.html')).length`)).toBe(1);
    await browser.evaluate(`window.historyWrites=0; window.nativeReplace=history.replaceState.bind(history);
      history.replaceState=(...args)=>{historyWrites++; return nativeReplace(...args);};
      for(let i=0;i<150;i++) dispatchEvent(new Event('scroll'));
      scrollTo(0, 350)`);
    expect(await browser.evaluate(`historyWrites`)).toBe(0);
    await settle(browser);
    await browser.evaluate(`document.querySelector('.chapter-row a[href="c0.html"]').click()`);
    await until(browser, `document.title === 'Chapter 2'`);
    expect(await browser.evaluate(`document === originalDocument`)).toBe(true);
    expect(await browser.evaluate(`calls.filter(url=>url.endsWith('/c0.html')).length`)).toBe(1);
    expect(await browser.evaluate(`scrollY`)).toBe(0);
    expect(await browser.evaluate(`document.activeElement.textContent`)).toBe('Chapter 2');
    expect(await browser.evaluate(`document.documentElement.dataset.theme`)).toBe('dark');
    expect(await browser.evaluate(`document.querySelector('input[value="dark"]').checked`)).toBe(true);
    expect(await browser.evaluate(`document.querySelector('a[aria-current="page"]').previousElementSibling.getAttribute('aria-expanded')`)).toBe('true');
    await browser.evaluate(`scrollTo(0, 480)`);
    await settle(browser);
    await browser.evaluate(`history.back()`);
    await until(browser, `document.title === 'Chapter 0' && scrollY === 350`);
    await browser.evaluate(`history.forward()`);
    await until(browser, `document.title === 'Chapter 2' && scrollY === 480`);
    // Cross-directory URLs and fragments must resolve against the new page.
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate(`document.querySelector('#menu-button').click(); document.querySelector('a[href="nested/b.html#end"]').click()`);
    await until(browser, `document.title === 'Chapter 1' && location.hash === '#end'`);
    expect(await browser.evaluate(`document === originalDocument`)).toBe(true);
    expect(await browser.evaluate(`document.body.classList.contains('menu-modal')`)).toBe(false);
    expect(await browser.evaluate(`document.querySelector('main').inert`)).toBe(false);
    expect(await browser.evaluate(`document.activeElement.textContent`)).toBe('Chapter 1');
    expect(await browser.evaluate(`document.getElementById('end').getBoundingClientRect().top`)).toBeCloseTo(144, 0);
    expect(await browser.evaluate(`!!document.querySelector('article svg')`)).toBe(true);
    expect(await browser.evaluate(`document.querySelector('.adjacent a').pathname`)).toBe('/a.html');
    expect(await browser.evaluate(`document.querySelector('.site-title').pathname`)).toBe('/a.html');
    expect(await browser.evaluate(`document.querySelector('.site-title img').pathname || new URL(document.querySelector('.site-title img').src).pathname`)).toBe('/_md-render/logo.svg');
    expect(await browser.evaluate(`document.querySelector('.site-title img').naturalWidth > 0`)).toBe(true);
    await browser.evaluate(`scrollTo(0, document.getElementById('section').offsetTop)`);
    await settle(browser);
    expect(await browser.evaluate(`document.querySelector('#document-menu a[aria-current="location"]').hash`)).toBe('#section');
    await browser.evaluate(`document.querySelector('#menu-button').click(); document.querySelector('.chapter-row a[href="../c0.html"]').click()`);
    await until(browser, `document.title === 'Chapter 2'`);
    expect(await browser.evaluate(`document === originalDocument`)).toBe(true);
    // Same-document fragments retain native history and restore positions.
    await browser.evaluate(`location.hash='end'`);
    await settle(browser);
    await browser.evaluate(`history.back()`);
    await until(browser, `!location.hash && scrollY === 0`);
  });
}, 15_000);

it('keeps excluded clicks native and falls back on navigation failures', async () => {
  const viewer = await swapFixture();
  await withBrowser(async browser => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.navigate(viewer.url);
    expect(await browser.evaluate(`(() => {
      const a=document.querySelector('.chapter-row a[href="c0.html"]'); const result=[];
      const record=e=>{result.push(e.defaultPrevented); e.preventDefault();}; window.addEventListener('click',record);
      for (const options of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]) {
        const e=new MouseEvent('click',{bubbles:true,cancelable:true,...options}); a.dispatchEvent(e);
      }
      for (const [attribute,value] of [['target','_blank'],['target',''],['download','']]) {
        a.setAttribute(attribute,value); const e=new MouseEvent('click',{bubbles:true,cancelable:true}); a.dispatchEvent(e); a.removeAttribute(attribute);
      }
      for (const href of ['file:///synthetic.ts','https://example.invalid/','/missing.html','#section']) {
        const link=document.createElement('a'); link.href=href; document.body.append(link);
        const e=new MouseEvent('click',{bubbles:true,cancelable:true}); link.dispatchEvent(e); link.remove();
      }
      window.removeEventListener('click',record); return result;
    })()`)).toEqual(Array(12).fill(false));
    // Prevent actual default navigations during synthetic eligibility checks.
  });
  for (const failure of ['fetch', 'document', 'status', 'type']) await withBrowser(async browser => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.navigate(viewer.url);
    await browser.waitForNavigation(() => browser.evaluate(`window.beforeFailure=true;
      window.fetch=async()=>{ ${failure === 'fetch' ? "throw new Error('synthetic fetch failure')" : `return new Response(${JSON.stringify(failure === 'document' ? '<html><title>Wrong</title></html>' : '')}, {status:${failure === 'status' ? 500 : 200},headers:{'Content-Type':${JSON.stringify(failure === 'type' ? 'text/plain' : 'text/html')}}})`} };
      setTimeout(() => document.querySelector('.chapter-row a[href="c5.html"]').click(), 0);`));
    expect(await browser.evaluate(`document.title`)).toBe('Chapter 7');
    expect(await browser.evaluate(`typeof window.beforeFailure`)).toBe('undefined');
  });
}, 15_000);

it('bounds prefetch requests and ignores superseded navigation', async () => {
  const viewer = await swapFixture(false, 2);
  await withBrowser(async browser => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.navigate(viewer.url);
    await browser.evaluate(`window.originalDocument=document; window.calls=[]; window.aborted=[]; window.nativeFetch=fetch;
      window.fetch=(url, options)=>{ calls.push(String(url));
        options.signal.addEventListener('abort',()=>aborted.push(String(url)));
        if (String(url).includes('c5.html')) return nativeFetch(url, options).then(async response => {
          const html=await response.text(); return new Promise(resolve=>window.release=()=>resolve(new Response(html,{headers:{'Content-Type':'text/html'}})));
        });
        return nativeFetch(url,options);
      };`);
    for (const file of ['c0', 'c1', 'c2']) {
      await browser.evaluate(`document.querySelector('.chapter-row a[href="${file}.html"]').focus()`);
      await until(browser, `performance.getEntriesByType('resource').some(e=>e.name.endsWith('/${file}.html'))`);
    }
    await browser.evaluate(`document.querySelector('.chapter-row a[href="c0.html"]').focus()`);
    await until(browser, `calls.filter(url=>url.endsWith('/c0.html')).length === 2`);
    expect(await browser.evaluate(`aborted.some(url=>url.endsWith('/c0.html'))`)).toBe(true);
    await browser.evaluate(`document.querySelector('.chapter-row a[href="c5.html"]').click()`);
    await until(browser, `typeof window.release === 'function'`);
    await browser.evaluate(`document.querySelector('.chapter-row a[href="c1.html"]').click()`);
    await until(browser, `document.title === 'Chapter 3'`);
    expect(await browser.evaluate(`document === originalDocument`)).toBe(true);
    expect(await browser.evaluate(`location.pathname`)).toBe('/c1.html');
    await until(browser, `typeof window.release === 'function'`);
    await browser.evaluate(`release()`);
    await settle(browser);
    expect(await browser.evaluate(`document.title`)).toBe('Chapter 3');
  });
});


it('retains menu nodes scroll and reader disclosures across page changes', async () => {
  const viewer = await swapFixture();
  await withBrowser(async browser => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 500, deviceScaleFactor: 1, mobile: false });
    await browser.navigate(viewer.url);
    await settle(browser);
    await browser.evaluate(`window.shell = [...document.querySelectorAll('main, .menu-bar, #document-menu, .theme-switch')];
      window.menuNodes = [...document.querySelector('#document-menu nav').querySelectorAll('*')];
      window.readerOpen = document.querySelector('.chapter-row a[href="c1.html"]').previousElementSibling;
      readerOpen.click();
      document.querySelector('a[aria-current="page"]').previousElementSibling.click();
      window.readerClosed = document.querySelector('a[aria-current="page"]').previousElementSibling;
      document.querySelector('#document-menu nav').scrollTop = 120;
      window.menuScroll = document.querySelector('#document-menu nav').scrollTop;
      document.querySelector('a[href="c0.html#end"]').click();`);
    await until(browser, `document.title === 'Chapter 2' && location.hash === '#end'`);
    await settle(browser);
    expect(await browser.evaluate(`menuScroll`)).toBeGreaterThan(0);
    expect(await browser.evaluate(`document.querySelector('#document-menu nav').scrollTop`)).toBe(await browser.evaluate(`menuScroll`));
    expect(await browser.evaluate(`menuNodes.every((node, i) => node === document.querySelector('#document-menu nav').querySelectorAll('*')[i])`)).toBe(true);
    expect(await browser.evaluate(`shell.every(node => node.isConnected)`)).toBe(true);
    expect(await browser.evaluate(`readerOpen.getAttribute('aria-expanded')`)).toBe('true');
    expect(await browser.evaluate(`readerClosed.getAttribute('aria-expanded')`)).toBe('false');
    expect(await browser.evaluate(`document.querySelector('a[aria-current="page"]').textContent`)).toBe('Chapter 2');
    expect(await browser.evaluate(`document.querySelector('a[aria-current="page"]').previousElementSibling.getAttribute('aria-expanded')`)).toBe('true');
    expect(await browser.evaluate(`document.querySelector('a[aria-current="location"]').hash`)).toBe('#end');
    expect(await browser.evaluate(`document.querySelector('a[aria-current="location"]').getClientRects().length`)).toBeGreaterThan(0);
    // The same nodes must survive relative-link changes in both directions and history.
    await browser.evaluate(`document.querySelector('a[href="nested/b.html#section"]').click()`);
    await until(browser, `document.title === 'Chapter 1'`);
    await settle(browser);
    expect(await browser.evaluate(`menuNodes.every(node => node.isConnected)`)).toBe(true);
    expect(await browser.evaluate(`document.querySelector('.chapter-row a[href="../c0.html"]').pathname`)).toBe('/c0.html');
    expect(await browser.evaluate(`document.querySelector('a[aria-current="location"]').getAttribute('href')`)).toBe('#section');
    expect(await browser.evaluate(`document.querySelectorAll('a[aria-current="page"]').length`)).toBe(1);
    expect(await browser.evaluate(`document.querySelector('#document-menu nav').scrollTop`)).toBe(await browser.evaluate(`menuScroll`));
    await browser.evaluate(`history.back()`);
    await until(browser, `document.title === 'Chapter 2' && location.hash === '#end'`);
    await settle(browser);
    expect(await browser.evaluate(`menuNodes.every(node => node.isConnected) && shell.every(node => node.isConnected)`)).toBe(true);
    expect(await browser.evaluate(`readerOpen.getAttribute('aria-expanded')`)).toBe('true');
    expect(await browser.evaluate(`readerClosed.getAttribute('aria-expanded')`)).toBe('false');
    expect(await browser.evaluate(`document.querySelector('#document-menu nav').scrollTop`)).toBe(await browser.evaluate(`menuScroll`));
    // Same-page section changes still reveal the current entry normally.
    await browser.evaluate(`location.hash='section'`);
    await settle(browser);
    expect(await browser.evaluate(`document.querySelector('a[aria-current="location"]').hash`)).toBe('#section');
  });
});

it('replaces a structurally different menu on page change', async () => {
  const viewer = await swapFixture();
  await withBrowser(async browser => {
    await browser.navigate(viewer.url);
    await browser.evaluate(`window.originalNav = document.querySelector('#document-menu nav');
      window.originalGroup = originalNav.firstElementChild;
      window.originalMain = document.querySelector('main');
      window.nativeFetch = fetch;
      window.fetch = async (...args) => {
        const response = await nativeFetch(...args);
        if (!String(args[0]).endsWith('/c5.html')) return response;
        const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
        parsed.querySelector('.document-group h2').textContent = 'Another document set';
        parsed.querySelector('.chapter-row a[href="c7.html"]').closest('li').remove();
        return new Response(parsed.documentElement.outerHTML, { headers: { 'Content-Type': 'text/html' } });
      };
      document.querySelector('.chapter-row a[href="c5.html"]').click();`);
    await until(browser, `document.title === 'Chapter 7'`);
    expect(await browser.evaluate(`document.querySelector('#document-menu nav') === originalNav && document.querySelector('main') === originalMain`)).toBe(true);
    expect(await browser.evaluate(`originalGroup.isConnected`)).toBe(false);
    expect(await browser.evaluate(`document.querySelector('.document-group h2').textContent`)).toBe('Another document set');
    expect(await browser.evaluate(`document.querySelector('.chapter-row a[href="c7.html"]')`)).toBe(null);
    expect(await browser.evaluate(`document.querySelector('a[aria-current="page"]').textContent`)).toBe('Chapter 7');
    expect(await browser.evaluate(`document.querySelector('a[aria-current="page"]').previousElementSibling.getAttribute('aria-expanded')`)).toBe('true');
  });
});

it('highlights current sections without an inset bar in both themes and colour modes', async () => {
  for (const theme of ['default', 'symbiotic']) {
    const viewer = await swapFixture(false, 6, theme);
    await withBrowser(async browser => {
      await browser.navigate(viewer.url + '#section');
      for (const mode of ['light', 'dark']) {
        await browser.evaluate(`document.querySelector('input[value="${mode}"]').click()`);
        await settle(browser);
        const style = await browser.evaluate<{ shadow: string; weight: string; background: string; tint: string }>(`(() => {
          const link = document.querySelector('a[aria-current="location"]');
          const style = getComputedStyle(link);
          const probe = document.createElement('span'); probe.style.background = 'var(--tint)'; document.body.append(probe);
          const tint = getComputedStyle(probe).backgroundColor; probe.remove();
          return { shadow: style.boxShadow, weight: style.fontWeight, background: style.backgroundColor, tint };
        })()`);
        expect(style.shadow, theme + ' ' + mode).toBe('none');
        expect(style.weight, theme + ' ' + mode).toBe('700');
        expect(style.background, theme + ' ' + mode).toBe(style.tint);
        expect(style.background, theme + ' ' + mode).not.toBe('rgba(0, 0, 0, 0)');
      }
    });
  }
});

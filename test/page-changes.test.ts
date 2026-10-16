import { useBrowser } from './browser-fixture.js';
import { afterAll, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startViewer, type Viewer } from '../src/server.js';
import type { BrowserSession } from '../src/browser.js';

const withBrowser = useBrowser();
const scratch: string[] = [];
const viewers: Viewer[] = [];
afterAll(async () => { await Promise.all(viewers.map(viewer => viewer.close())); });
afterAll(async () => { await Promise.all(scratch.map(dir => rm(dir, { recursive: true, force: true }))); });
const settle = (browser: BrowserSession) => browser.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);

const swapFixtures = new Map<string, Promise<Viewer>>();
function swapFixture(diagrams = false, cachePages = 6, theme = 'symbiotic') {
  const key = JSON.stringify([diagrams, cachePages, theme]);
  let fixture = swapFixtures.get(key);
  if (!fixture) { fixture = buildSwapFixture(diagrams, cachePages, theme); swapFixtures.set(key, fixture); }
  return fixture;
}
async function buildSwapFixture(diagrams: boolean, cachePages: number, theme: string) {
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
      document.querySelector('.theme-switch button[value="dark"]').click();
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
    expect(await browser.evaluate(`document.querySelector('.theme-switch button[value="dark"]').getAttribute('aria-pressed')`)).toBe('true');
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
});

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
});

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
        await browser.evaluate(`document.querySelector('.theme-switch button[value="${mode}"]').click()`);
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

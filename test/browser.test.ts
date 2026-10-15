import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderSite } from '../src/site.js';
import { withBrowser } from '../src/browser.js';

it('checks rendered menu, theme controls, storage failure and diagram contrast in both themes', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'md-render-ui-'));
  try {
    await writeFile(path.join(source, 'index.md'), '# Real title\n\n## 1. Result\n\n### Child\n\n```mermaid\nflowchart TD\nsubgraph Group\nA[Start] -->|Label| B[End]\nend\nstyle A fill:#fff,color:#000,stroke:#000\nclassDef custom fill:#fff,color:#000,stroke:#000;\nclass B custom;\n```');
    await writeFile(path.join(source, 'other.md'), '# Other title\n\n## Other section');
    for (const theme of ['default', 'symbiotic']) {
      const output = path.join(source, theme);
      await renderSite(path.join(source, 'index.md'), output, { theme });
      await withBrowser(async (browser) => {
        await browser.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 800, deviceScaleFactor: 1, mobile: false });
        const url = pathToFileURL(path.join(output, 'index.html')).href;
        await browser.navigate(url);
        expect(await browser.evaluate(`document.querySelector('#document-menu').hidden`)).toBe(false);
        expect(await browser.evaluate(`getComputedStyle(document.querySelector('#document-menu')).position`)).toBe('fixed');
        expect(await browser.evaluate(`(() => { const list=document.querySelector('#document-menu nav'); return list.scrollHeight === list.clientHeight; })()`)).toBe(true);
        expect(await browser.evaluate(`getComputedStyle(document.querySelector('.sd-doc h2'), '::before').content`)).toBe('none');
        expect(await browser.evaluate(`Math.max(...[...document.querySelectorAll('.theme-switch label')].map(label => label.getBoundingClientRect().height))`)).toBeLessThanOrEqual(24);
        // Native radio keyboard navigation also fires change and persists the choice.
        await browser.evaluate(`document.querySelector('input[value="system"]').focus()`);
        await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
        await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
        expect(await browser.evaluate(`document.documentElement.dataset.theme`)).toBe('light');
        expect(await browser.evaluate(`localStorage.getItem('md-render-theme')`)).toBe('light');
        for (const mode of ['light', 'dark']) {
          await browser.evaluate(`document.querySelector('input[value="${mode}"]').click()`);
          expect(await browser.evaluate(`document.documentElement.dataset.theme`)).toBe(mode);
          const contrast = await browser.evaluate<number[]>(`(() => {
            const style = getComputedStyle(document.querySelector('.mermaid-diagram svg'));
            const resolve = (token) => {
              const el = document.createElement('i'); el.style.color = style.getPropertyValue(token); document.body.append(el);
              const rgb = getComputedStyle(el).color.match(/[\\d.]+/g).slice(0,3).map(Number); el.remove();
              return rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((n,v,i) => n + v * [.2126,.7152,.0722][i], 0);
            };
            const ratio = (a,b) => { a=resolve(a); b=resolve(b); return (Math.max(a,b)+.05)/(Math.min(a,b)+.05); };
            const svg = document.querySelector('.mermaid-diagram svg');
            const expected = ['.node rect', '.cluster rect', '.flowchart-link', 'marker path', '.nodeLabel p', '.edgeLabel p'];
            if (expected.some(s => !svg.querySelector(s))) throw new Error('Missing diagram test element');
            for (const [selector, property, token] of [
              ['.node rect','fill','--diagram-fill'], ['.node rect','stroke','--diagram-line'],
              ['.cluster rect','fill','--diagram-cluster'], ['.cluster rect','stroke','--diagram-line'],
              ['.flowchart-link','stroke','--diagram-line'], ['marker path','fill','--diagram-line'],
              ['.nodeLabel p','color','--diagram-ink'], ['.edgeLabel p','color','--diagram-ink'],
              ['.edgeLabel p','backgroundColor','--diagram-label'],
            ]) {
              const el = document.createElement('i'); el.style.color=style.getPropertyValue(token); document.body.append(el);
              const colour=getComputedStyle(el).color; el.remove();
              if (getComputedStyle(svg.querySelector(selector))[property] !== colour) throw new Error(selector + ' ' + property + ' = ' + getComputedStyle(svg.querySelector(selector))[property] + ', expected ' + colour + ' from ' + token);
            }
            return ['--diagram-fill','--diagram-cluster','--diagram-label'].flatMap(bg => ['--diagram-ink','--diagram-line'].map(fg => ratio(fg,bg)));
          })()`);
          expect(Math.min(...contrast)).toBeGreaterThanOrEqual(4.5);
          console.log(`${theme} ${mode}: minimum diagram contrast ${Math.min(...contrast).toFixed(2)}:1 (${contrast.length} pairs)`);
        }
        await browser.navigate(url);
        expect(await browser.evaluate(`document.documentElement.dataset.theme`)).toBe('dark');
        await browser.evaluate(`document.querySelector('input[value="system"]').click()`);
        expect(await browser.evaluate(`document.documentElement.hasAttribute('data-theme')`)).toBe(false);
        expect(await browser.evaluate(`localStorage.getItem('md-render-theme')`)).toBe(null);
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
        expect(await browser.evaluate(`getComputedStyle(document.documentElement).colorScheme`)).toBe('dark');
        await browser.evaluate(`document.querySelector('input[value="light"]').click()`);
        expect(await browser.evaluate(`getComputedStyle(document.documentElement).colorScheme`)).toBe('light');
        await browser.send('Emulation.setDeviceMetricsOverride', { width: 1023, height: 800, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
        expect(await browser.evaluate(`document.querySelector('#document-menu').hidden`)).toBe(true);
        await browser.evaluate(`document.querySelector('#menu-button').click()`);
        expect(await browser.evaluate(`document.querySelector('#document-menu').getBoundingClientRect().toJSON()`)).toMatchObject({ x: 0, y: 0, width: 1023, height: 800 });
        expect(await browser.evaluate(`getComputedStyle(document.body).overflow`)).toBe('hidden');
        expect(await browser.evaluate(`document.activeElement.id`)).toBe('menu-close');
        expect(await browser.evaluate(`document.querySelector('main').inert`)).toBe(true);
        await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
        expect(await browser.evaluate(`document.querySelector('#document-menu').hidden`)).toBe(true);
        expect(await browser.evaluate(`document.activeElement.id`)).toBe('menu-button');
        await browser.evaluate(`document.querySelector('#menu-button').click(); document.querySelector('.chapter-toggle').click()`);
        expect(await browser.evaluate(`document.querySelector('.chapter-toggle').getAttribute('aria-expanded')`)).toBe('false');
        await browser.evaluate(`document.querySelector('.chapter-toggle').click(); document.querySelector('#document-menu a[href="#1-result"]').click()`);
        expect(await browser.evaluate(`document.querySelector('#document-menu').hidden`)).toBe(true);
        await browser.evaluate(`document.querySelector('#menu-button').click(); document.querySelector('#menu-close').click()`);
        expect(await browser.evaluate(`document.activeElement.id`)).toBe('menu-button');
        await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
        await browser.evaluate(`document.querySelector('#menu-button').click()`);
        expect(await browser.evaluate(`document.querySelector('#document-menu').getBoundingClientRect().width`)).toBe(390);
        expect(await browser.evaluate(`Math.max(...[...document.querySelectorAll('.theme-switch label')].map(label => label.getBoundingClientRect().height))`)).toBeLessThanOrEqual(24);
        await browser.evaluate(`document.querySelector('#menu-close').click()`);
        await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });` });
        await browser.navigate(url);
        expect(await browser.evaluate(`document.documentElement.hasAttribute('data-theme')`)).toBe(false);
        expect(await browser.evaluate(`document.querySelector('input[value="system"]').checked`)).toBe(true);
        expect(await browser.evaluate(`getComputedStyle(document.documentElement).colorScheme`)).toBe('dark');
        await browser.evaluate(`document.querySelector('#menu-button').click(); document.querySelector('input[value="light"]').click(); document.querySelector('input[value="system"]').click()`);
        expect(await browser.evaluate(`document.documentElement.hasAttribute('data-theme')`)).toBe(false);
        expect(await browser.evaluate(`document.querySelector('main').textContent.includes('Real title')`)).toBe(true);
      });
    }
  } finally { await rm(source, { recursive: true, force: true }); }
}, 15_000);

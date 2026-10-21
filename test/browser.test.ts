import { useBrowser } from './browser-fixture.js';
import { it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderSite } from '../src/site.js';
const withBrowser = useBrowser();

vi.mock('../src/diagrams.js', () => import('./diagram-fixture.js'));

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
        expect(await browser.evaluate(`Math.max(...[...document.querySelectorAll('.theme-switch button')].map(control => control.getBoundingClientRect().height))`)).toBe(28);
        expect(await browser.evaluate(`(() => {
          const group = document.querySelector('.theme-switch');
          return {role:group.getAttribute('role'), label:group.getAttribute('aria-label'), text:group.textContent,
            names:[...group.children].map(b => [b.getAttribute('aria-label'), b.title, b.getAttribute('aria-pressed')]),
            last:group === document.querySelector('#document-menu').lastElementChild};
        })()`)).toEqual({role:'group', label:'Appearance', text:'', names:[['Light','Light','false'],['System','System','true'],['Dark','Dark','false']], last:true});
        // Native button keyboard activation persists the choice.
        await browser.evaluate(`document.querySelector('.theme-switch button[value="light"]').focus()`);
        await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        expect(await browser.evaluate(`document.documentElement.dataset.theme`)).toBe('light');
        expect(await browser.evaluate(`localStorage.getItem('md-render-theme')`)).toBe('light');
        expect(await browser.evaluate(`(() => {const s=getComputedStyle(document.activeElement); return [s.outlineStyle,s.outlineWidth];})()`)).toEqual(['solid','2px']);
        for (const mode of ['light', 'dark']) {
          await browser.evaluate(`document.querySelector('.theme-switch button[value="${mode}"]').click()`);
          expect(await browser.evaluate(`document.documentElement.dataset.theme`)).toBe(mode);
          expect(await browser.evaluate(`[...document.querySelectorAll('.theme-switch button[aria-pressed="true"]')].map(b=>b.value)`)).toEqual([mode]);
          expect(await browser.evaluate(`(() => {
            const button=document.querySelector('.theme-switch button[aria-pressed="true"]');
            const probe=document.createElement('i'); document.body.append(probe);
            probe.style.color='var(--accent)'; const accent=getComputedStyle(probe).color;
            probe.style.color='var(--paper)'; const paper=getComputedStyle(probe).color; probe.remove();
            const s=getComputedStyle(button); return s.backgroundColor === accent && s.color === paper;
          })()`)).toBe(true);
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
        // Chromium applies localStorage writes asynchronously, so a document loaded right
        // after the click may still read the old value. Reload until the saved theme is
        // restored; a restore defect never gets there and fails at the deadline.
        await expect.poll(async () => {
          await browser.navigate(url);
          return browser.evaluate(`({
            theme: document.documentElement.dataset.theme,
            selected: [...document.querySelectorAll('.theme-switch button[aria-pressed="true"]')].map(button => button.value),
          })`);
        }, {
          timeout: 5_000,
          interval: 100,
          message: 'After reloading, the saved dark theme must be restored',
        }).toEqual({ theme: 'dark', selected: ['dark'] });
        await browser.evaluate(`document.querySelector('.theme-switch button[value="system"]').click()`);
        expect(await browser.evaluate(`[...document.querySelectorAll('.theme-switch button[aria-pressed="true"]')].map(b=>b.value)`)).toEqual(['system']);
        expect(await browser.evaluate(`document.documentElement.hasAttribute('data-theme')`)).toBe(false);
        expect(await browser.evaluate(`localStorage.getItem('md-render-theme')`)).toBe(null);
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
        expect(await browser.evaluate(`getComputedStyle(document.documentElement).colorScheme`)).toBe('dark');
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
        expect(await browser.evaluate(`getComputedStyle(document.documentElement).colorScheme`)).toBe('light');
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
        await browser.evaluate(`document.querySelector('.theme-switch button[value="light"]').click()`);
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
        expect(await browser.evaluate(`Math.max(...[...document.querySelectorAll('.theme-switch button')].map(control => control.getBoundingClientRect().height))`)).toBe(28);
        await browser.evaluate(`document.querySelector('#menu-close').click()`);
        // A stored override cannot affect a page when JavaScript is disabled.
        await browser.send('Emulation.setScriptExecutionDisabled', { value: true });
        await browser.navigate(url);
        expect(await browser.evaluate(`getComputedStyle(document.querySelector('.theme-switch')).display`)).toBe('none');
        expect(await browser.evaluate(`getComputedStyle(document.documentElement).colorScheme`)).toBe('dark');
        expect(await browser.evaluate(`document.documentElement.hasAttribute('data-theme')`)).toBe(false);
        await browser.send('Emulation.setScriptExecutionDisabled', { value: false });
        await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });` });
        await browser.navigate(url);
        expect(await browser.evaluate(`document.documentElement.hasAttribute('data-theme')`)).toBe(false);
        expect(await browser.evaluate(`document.querySelector('.theme-switch button[value="system"]').getAttribute('aria-pressed')`)).toBe('true');
        expect(await browser.evaluate(`getComputedStyle(document.documentElement).colorScheme`)).toBe('dark');
        await browser.evaluate(`document.querySelector('#menu-button').click(); document.querySelector('.theme-switch button[value="light"]').click(); document.querySelector('.theme-switch button[value="system"]').click()`);
        expect(await browser.evaluate(`document.documentElement.hasAttribute('data-theme')`)).toBe(false);
        expect(await browser.evaluate(`document.querySelector('main').textContent.includes('Real title')`)).toBe(true);
      });
    }
  } finally { await rm(source, { recursive: true, force: true }); }
});

it('reuses one Chromium without a startup page and isolates storage and overrides after a failed callback', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'md-render-isolation-'));
  const url = pathToFileURL(path.join(source, 'index.html')).href;
  try {
    await writeFile(path.join(source, 'index.html'), '<!doctype html><script>window.pageScript = true;</script>');
    let defaults: { width: number; dark: boolean };
    let sentinel: string;
    await expect(withBrowser(async browser => {
      const { targetInfos } = await browser.send('Target.getTargets');
      expect(targetInfos.filter((target: { type: string }) => target.type === 'page')).toHaveLength(1);
      // A browser-owned target survives page-context disposal, proving process reuse.
      sentinel = (await browser.send('Target.createTarget', { url: 'about:blank' })).targetId;
      defaults = await browser.evaluate(`({width:innerWidth, dark:matchMedia('(prefers-color-scheme: dark)').matches})`);
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 321, height: 456, deviceScaleFactor: 1, mobile: false });
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
      await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.injected = true;' });
      await browser.navigate(url);
      await browser.evaluate(`localStorage.setItem('isolation', 'old'); sessionStorage.setItem('isolation', 'old')`);
      await browser.send('Network.setCookie', { name: 'isolation', value: 'old', url: 'http://127.0.0.1/' });
      await browser.send('Emulation.setScriptExecutionDisabled', { value: true });
      throw new Error('synthetic callback failure');
    })).rejects.toThrow('synthetic callback failure');
    await withBrowser(async browser => {
      expect((await browser.send('Target.getTargets')).targetInfos.map((target: { targetId: string }) => target.targetId)).toContain(sentinel!);
      await browser.send('Target.closeTarget', { targetId: sentinel! });
      expect((await browser.send('Network.getCookies', { urls: ['http://127.0.0.1/'] })).cookies).toEqual([]);
      await browser.navigate(url);
      expect(await browser.evaluate(`({local:localStorage.getItem('isolation'), session:sessionStorage.getItem('isolation'),
        injected:typeof injected, script:window.pageScript, width:innerWidth, dark:matchMedia('(prefers-color-scheme: dark)').matches})`))
        .toEqual({ local: null, session: null, injected: 'undefined', script: true, ...defaults! });
    });
  } finally { await rm(source, { recursive: true, force: true }); }
});

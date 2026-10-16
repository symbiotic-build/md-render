import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { withBrowser } from '../src/browser.js';
import { renderSite } from '../src/site.js';

it('keeps wide diagrams readable, contains code and table overflow, and prints on white from either theme', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'md-render-layout-'));
  try {
    await writeFile(path.join(source, 'index.md'), `# Long documentation title wrapping across multiple lines on a phone\n\n## Content\n\n| ${'Long column heading | '.repeat(8)}\n| ${'--- | '.repeat(8)}\n| ${'Wide value | '.repeat(8)}\n\n\`\`\`ts\n${'const wide = true; '.repeat(60)}\n\`\`\`\n\n\`\`\`mermaid\nflowchart LR\nA[First readable node] --> B[Second readable node] --> C[Third readable node] --> D[Fourth readable node]\n\`\`\``);
    for (const theme of ['default', 'symbiotic']) {
      const output = path.join(source, theme);
      await renderSite(path.join(source, 'index.md'), output, { theme });
      await withBrowser(async browser => {
        await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
        await browser.navigate(pathToFileURL(path.join(output, 'index.html')).href);
        expect(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
        expect(await browser.evaluate(`document.querySelector('.table-scroll').scrollWidth > document.querySelector('.table-scroll').clientWidth`)).toBe(true);
        expect(await browser.evaluate(`document.querySelector('.sd-doc pre').scrollWidth > document.querySelector('.sd-doc pre').clientWidth`)).toBe(true);
        // Screen diagrams retain natural text size and scroll instead of shrinking labels.
        expect.soft(await browser.evaluate(`(() => { const svg=document.querySelector('.mermaid-diagram svg'); return svg.getBoundingClientRect().width / svg.viewBox.baseVal.width; })()`)).toBeGreaterThanOrEqual(1);
        await browser.evaluate(`document.querySelector('#menu-button').click(); document.querySelector('.theme-switch button[value="dark"]').click()`);
        await browser.send('Emulation.setEmulatedMedia', { media: 'print' });
        expect(await browser.evaluate(`getComputedStyle(document.querySelector('#document-menu')).display`)).toBe('none');
        expect.soft(await browser.evaluate(`getComputedStyle(document.querySelector('.sd-doc')).color`)).toBe('rgb(0, 0, 0)');
        expect.soft(await browser.evaluate(`getComputedStyle(document.querySelector('.sd-doc')).backgroundColor`)).toBe('rgb(255, 255, 255)');
        expect.soft(await browser.evaluate(`parseFloat(getComputedStyle(document.querySelector('.sd-doc h1')).fontSize)`)).toBeCloseTo(25 * 96 / 72, 1);
        expect(await browser.evaluate(`getComputedStyle(document.querySelector('.sd-doc pre')).whiteSpace`)).toBe('pre-wrap');
        expect(await browser.evaluate(`getComputedStyle(document.querySelector('.sd-doc th')).whiteSpace`)).toBe('normal');
        expect(await browser.evaluate(`getComputedStyle(document.body).overflow`)).toBe('visible');
      });
    }
  } finally { await rm(source, { recursive: true, force: true }); }
});

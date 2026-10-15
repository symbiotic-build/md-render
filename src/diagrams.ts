import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowser } from './browser.js';

/** Renders Mermaid once at build time; SVG colours inherit the viewer's live theme. */
export async function renderDiagrams(pages: string[], enabled: boolean): Promise<{ pages: string[]; available: boolean }> {
  if (!enabled) return { pages, available: false };
  let packageFile: string;
  try { packageFile = createRequire(import.meta.url).resolve('mermaid/package.json'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') return { pages, available: false };
    throw error;
  }
  const pkg = JSON.parse(await readFile(packageFile, 'utf8')) as { version: string };
  if (pkg.version !== '12.2.0') throw new Error(`Expected offline Mermaid 12.2.0, found ${pkg.version}`);
  if (!pages.some((html) => html.includes('class="mermaid-diagram"'))) return { pages, available: true };
  const bundle = await readFile(path.join(path.dirname(packageFile), 'dist/mermaid.min.js'), 'utf8');
  const colours = await readFile(fileURLToPath(new URL('../themes/diagrams.css', import.meta.url)), 'utf8');
  return withBrowser(async (browser) => {
    await browser.evaluate(bundle);
    const rendered = await browser.evaluate<string[]>(`(async () => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'base' });
      const pages = ${JSON.stringify(pages)};
      let index = 0;
      const results = [];
      for (const html of pages) {
        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.append(container);
        for (const figure of container.querySelectorAll('.mermaid-diagram')) {
          const { svg } = await mermaid.render('md-render-diagram-' + index++, figure.querySelector('code').textContent);
          const drawing = document.createElement('div');
          drawing.innerHTML = svg;
          const image = drawing.querySelector('svg');
          // Keep labels readable on small screens; the figure owns horizontal scrolling.
          image.style.width = image.viewBox.baseVal.width + 'px';
          image.style.maxWidth = 'none';
          // Authored colours are often inline !important. Remove only colour
          // declarations, then let one scoped stylesheet own all theme colours.
          for (const element of image.querySelectorAll('[style]')) {
            for (const property of ['fill', 'stroke', 'color', 'background', 'background-color']) element.style.removeProperty(property);
          }
          const colours = document.createElementNS('http://www.w3.org/2000/svg', 'style');
          colours.textContent = ${JSON.stringify(colours)}.replaceAll(':root', '#' + image.id);
          image.append(colours);
          figure.prepend(drawing);
          figure.querySelector('figcaption').textContent = 'Diagram source';
          const details = document.createElement('details');
          const summary = document.createElement('summary');
          summary.textContent = 'View Mermaid source';
          details.append(summary, figure.querySelector('pre'));
          figure.append(details);
        }
        results.push(container.innerHTML);
        container.remove();
      }
      return results;
    })()`);
    return { pages: rendered, available: true };
  });
}

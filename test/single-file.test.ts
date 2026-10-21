import { useBrowser } from './browser-fixture.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const withBrowser = useBrowser();
const run = promisify(execFile);
const cli = new URL('../dist/cli.js', import.meta.url).pathname;
let root: string;
let source: string;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/pkAAAAASUVORK5CYII=';
beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'md-render-single-')));
  source = path.join(root, 'input');
  await mkdir(path.join(source, 'nested'), { recursive: true });
  await writeFile(path.join(source, 'index.md'), '# My / Guide: café\n\n## Shared\n\n[Destination](nested/b.md?view=1#shared)\n\n[Escaped destination](nested/b.md#shared%26caf%C3%A9)\n\n[External](https://example.com/guide)\n\n[Attachment](notes.txt)\n\n![Pixel](pixel.png)\n\nNote[^a].\n\n[^a]: First footnote.\n\n| Key | Value |\n| --- | --- |\n| a | b |\n\n```js\nconst example = 1;\n```');
  await writeFile(path.join(source, 'nested/b.md'), '# Second\n\n<a id="shared&café"></a>\n\n## Shared\n\nUnique searchable sentence.\n\n[Home](../index.md#shared)\n\nNote[^a].\n\n[^a]: Second footnote.' + '\n\n' + Array.from({ length: 16 }, () => 'Additional reading paragraph.').join('\n\n'));
  await writeFile(path.join(source, 'pixel.png'), Buffer.from(png, 'base64'));
  await writeFile(path.join(source, 'notes.txt'), 'Original attachment.');
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });
async function exportFile(name: string, extra: string[] = []) {
  const file = path.join(root, name + '.html');
  const result = await run(process.execPath, [cli, source, '--single-file', file, ...extra]);
  return { file, ...result };
}

it('writes only the standalone file and reports its byte size', async () => {
  const destination = path.join(root, 'only');
  const { file, stdout } = await exportFile('only/guide');
  expect(await readdir(destination)).toEqual(['guide.html']);
  expect(stdout).toContain(`Single file: ${file} (${(await stat(file)).size} bytes)`);
});

it('adds the named file to folder output and supports an explicit combined target', async () => {
  const output = path.join(root, 'folder');
  await run(process.execPath, [cli, source, '--out', output]);
  expect(await readFile(path.join(output, 'index.html'), 'utf8')).toContain('<h1 id="my--guide-café">');
  expect(await readFile(path.join(output, 'My-Guide-café.html'), 'utf8')).toContain('Unique searchable sentence.');
  const combined = path.join(root, 'combined');
  const { file } = await exportFile('combined-explicit', ['--out', combined]);
  expect(await readFile(file, 'utf8')).toContain('Unique searchable sentence.');
  expect((await readdir(combined)).sort()).toEqual(['_md-render', 'index.html', 'nested', 'pixel.png']);
});

it('refuses existing single-file targets without changing them', async () => {
  const file = path.join(root, 'existing.html');
  await writeFile(file, 'Keep this file.');
  for (const target of [file, path.join(root, 'linked.html')]) {
    if (target !== file) await symlink(file, target);
    await expect(run(process.execPath, [cli, source, '--single-file', target])).rejects.toMatchObject({ code: 1, stderr: expect.stringMatching(/exists|EEXIST/) });
    expect(await readFile(file, 'utf8')).toBe('Keep this file.');
  }
});

it('embeds resources and preserves authored link behavior', async () => {
  const custom = path.join(source, 'custom.css');
  await writeFile(path.join(source, 'import.css'), ':root{--custom-import:loaded}');
  await writeFile(custom, `@import "${new URL('../themes/symbiotic.css', import.meta.url).pathname}"; @import "import.css"; .sd-doc{background-image:url("pixel.png")}`);
  await writeFile(path.join(source, 'custom.logo.png'), Buffer.from(png, 'base64'));
  for (const theme of ['symbiotic', custom]) {
    const { file, stderr } = await exportFile(theme === custom ? 'resources-custom' : 'resources', ['--theme', theme]);
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      expect(await browser.evaluate(`Array.from(document.querySelectorAll('[src],link[href],a[href]')).map(e=>e.getAttribute('src')||e.getAttribute('href')).filter(u=>!u.startsWith('#')&&!u.startsWith('data:'))`)).toEqual(['https://example.com/guide']);
      expect(await browser.evaluate(`Array.from(document.images).map(i=>({loaded:i.complete&&i.naturalWidth>0,embedded:i.src.startsWith('data:')}))`)).toEqual(Array.from({ length: theme === custom ? 2 : 1 }, () => ({ loaded: true, embedded: true })));
      expect(await browser.evaluate(`(()=>{const a=Array.from(document.querySelectorAll('article a')).find(a=>a.textContent==='Attachment');return document.getElementById(a.hash.slice(1)).querySelector('code').textContent})()`)).toContain('Original attachment.');
      expect(await browser.evaluate(`({tables:document.querySelectorAll('article table').length,code:document.querySelector('article pre code').textContent.trim()})`)).toEqual({ tables: 1, code: 'const example = 1;' });
      if (theme === custom) expect(await browser.evaluate(`({imported:getComputedStyle(document.documentElement).getPropertyValue('--custom-import').trim(),background:getComputedStyle(document.querySelector('article')).backgroundImage})`)).toEqual({ imported: 'loaded', background: `url("data:image/png;base64,${png}")` });
    });
    expect(stderr).toBe('');
  }
});

it('reads and navigates the standalone document through file URLs', async () => {
  const { file } = await exportFile('reading');
  await withBrowser(async browser => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.navigate(pathToFileURL(file).href);
    const wait = (title: string) => browser.evaluate(`new Promise((resolve,reject)=>{const start=performance.now();function check(){if(document.title===${JSON.stringify(title)})requestAnimationFrame(()=>resolve(true));else if(performance.now()-start>2500)reject(new Error('Page did not change'));else requestAnimationFrame(check)}check()})`);
    const visible = () => browser.evaluate(`Array.from(document.querySelectorAll('main article')).filter(e=>e.checkVisibility()).map(e=>e.querySelector('h1').textContent)`);
    expect(await visible()).toEqual(['My / Guide: café']);
    await browser.evaluate(`Array.from(document.querySelectorAll('.chapter-row a')).find(a=>a.textContent==='Second').click()`);
    await wait('Second');
    expect(await visible()).toEqual(['Second']);
    expect(await browser.evaluate(`document.querySelector('main .single-page:not([hidden]) .page-meta').textContent`)).toBe('nested/b.md2 / 2');
    await browser.evaluate(`Array.from(document.querySelectorAll('.single-page:not([hidden]) .adjacent a')).find(a=>a.textContent.includes('Previous')).click()`);
    await wait('My / Guide: café');
    await browser.evaluate(`Array.from(document.querySelectorAll('.single-page:not([hidden]) .adjacent a')).find(a=>a.textContent.includes('Next')).click()`);
    await wait('Second');
    await browser.evaluate(`history.back()`);
    await wait('My / Guide: café');
    await browser.evaluate(`Array.from(document.querySelectorAll('article a')).find(a=>a.textContent==='Destination').click()`);
    await wait('Second');
    expect(await browser.evaluate(`({text:document.getElementById(decodeURIComponent(location.hash.slice(1))).textContent,top:Math.round(document.getElementById(decodeURIComponent(location.hash.slice(1))).getBoundingClientRect().top)})`)).toEqual({ text: 'Shared', top: 144 });
    expect(await browser.evaluate(`(()=>{const ids=Array.from(document.querySelectorAll('[id]')).map(e=>e.id);return ids.filter((id,i)=>ids.indexOf(id)!==i)})()`)).toEqual([]);
    expect(await browser.evaluate(`Array.from(document.querySelectorAll('a[href^="#"]')).filter(a=>!document.getElementById(decodeURIComponent(a.hash.slice(1)))).map(a=>a.textContent)`)).toEqual([]);
    await browser.evaluate(`document.querySelector('.theme-switch button[value="dark"]').click()`);
    expect(await browser.evaluate(`document.documentElement.dataset.theme`)).toBe('dark');
    // Search reaches inactive content; the browser UI signals its reveal with beforematch.
    await browser.evaluate(`history.back()`);
    await wait('My / Guide: café');
    expect(await browser.evaluate(`window.find('Unique searchable sentence.')`)).toBe(true);
    // window.find searches text but does not emit the browser UI's beforematch event.
    await browser.evaluate(`Array.from(document.querySelectorAll('.single-page')).find(section=>section.textContent.includes('Unique searchable sentence.')).dispatchEvent(new Event('beforematch', {bubbles:true}))`);
    await wait('Second');
    expect(await visible()).toEqual(['Second']);
    expect(await browser.evaluate(`performance.getEntriesByType('resource').filter(e=>!e.name.startsWith('data:')&&!e.name.startsWith('file:')).map(e=>e.name)`)).toEqual([]);
  });
});


it('preserves rendered diagrams and readable offline source in single files', async () => {
  const { exportSite } = await import('../src/single-file.js');
  const input = path.join(root, 'diagram.md');
  await writeFile(input, '# Diagram\n\n```mermaid\nflowchart TD\nA[Start] --> B[Finish]\n```');
  for (const mermaid of [false, true]) {
    const result = await exportSite(input, { singleFile: path.join(root, `diagram-${mermaid}.html`) }, { mermaid });
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(result.singleFile).href);
      expect(await browser.evaluate(`Array.from(document.querySelectorAll('figure code')).map(e=>e.textContent)`)).toEqual(['flowchart TD\nA[Start] --> B[Finish]']);
      expect(await browser.evaluate(`Array.from(document.querySelectorAll('figure svg')).map(e=>e.getBoundingClientRect().width>0&&e.textContent.includes('Start')&&e.textContent.includes('Finish'))`)).toEqual(mermaid ? [true] : []);
      expect(await browser.evaluate(`Array.from(document.querySelectorAll('script[src],link[href],img[src]:not([src^="data:"])')).map(e=>e.outerHTML)`)).toEqual([]);
    });
  }
});

it('refuses a single-file destination that collides with a folder page', async () => {
  const input = path.join(root, 'collision');
  await mkdir(input);
  await writeFile(path.join(input, 'index.md'), '# index');
  const out = path.join(root, 'collision-output');
  await expect(run(process.execPath, [cli, input, '--out', out])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('collides with folder output') });
  await expect(stat(out)).rejects.toMatchObject({ code: 'ENOENT' });
});

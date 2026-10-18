import { useBrowser } from './browser-fixture.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportSite } from '../src/single-file.js';

const withBrowser = useBrowser();
const run = promisify(execFile);
let root: string;
let input: string;
let commit: string;
const binary = Buffer.from([0, 1, 42]);
beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'md-render-bundle-')));
  input = path.join(root, 'input');
  await mkdir(path.join(input, 'docs'), { recursive: true });
  await mkdir(path.join(root, 'native'));
  await writeFile(path.join(input, 'docs/DOCUMENTS.json'), JSON.stringify({ version: 1,
    inventory: [{ path: 'old.md', kind: 'other' }],
    documents: [{ id: 'book', sections: [{ id: 'start', path: 'index.md', anchor: 'start' }] }],
  }));
  await writeFile(path.join(input, 'index.md'), `# Start\n\n[Chapter](../chapter.md#detail) [Source][src] [Range](../native/code.h#L10-L20) [Binary](../blob.bin) [Old](old.md#old)\n\n[src]: ../native/code.h#L42\n\nSource note: \`${input}/old.md\`. Home note: \`${homedir()}/notes/private.md\`.\n`);
  await symlink('chapter-content.md', path.join(root, 'chapter.md'));
  await writeFile(path.join(root, 'chapter-content.md'), '# Referenced chapter\n\n## Detail\n\nChapter body. [Next](more.md#more) [Cycle](input/index.md#start)');
  await writeFile(path.join(root, 'more.md'), '# More\n\n[Cycle](chapter.md#detail)');
  await writeFile(path.join(input, 'old.md'), '# Old\n\nOld chapter.');
  await writeFile(path.join(root, 'native/code.h'), Array.from({ length: 60 }, (_, i) => `const int line_${i + 1} = ${i + 1};`).join('\r\n') + '\r\n');
  await writeFile(path.join(root, 'blob.bin'), binary);
  await run('git', ['init', '-q', path.join(root, 'native')]);
  await run('git', ['-C', path.join(root, 'native'), 'add', 'code.h']);
  await run('git', ['-C', path.join(root, 'native'), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Synthetic source']);
  commit = (await run('git', ['-C', path.join(root, 'native'), 'rev-parse', '--short', 'HEAD'])).stdout.trim();
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it.each(['Chapter', 'Source', 'Range', 'Binary'] as const)('bundles %s links for both file URL exports', async kind => {
  const out = path.join(root, `export-${kind}`);
  const result = await exportSite(input, { out }, { mermaid: false });
  for (const file of [path.join(out, 'index.html'), result.singleFile]) {
    await withBrowser(async browser => {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 800, deviceScaleFactor: 1, mobile: false });
      await browser.navigate(pathToFileURL(file).href);
      const link = await browser.evaluate<{ href: string; download: string }>(`(()=>{const a=Array.from(document.querySelectorAll('article a')).find(a=>a.textContent===${JSON.stringify(kind)});return {href:a.getAttribute('href'),download:a.getAttribute('download')}})()`);
      expect(link.href.startsWith('#') || (!link.href.includes(':') && !link.href.startsWith('/')) || link.href.startsWith('data:')).toBe(true);
      if (kind === 'Binary') {
        expect(link.download).toBe('blob.bin');
        const bytes = link.href.startsWith('data:') ? Buffer.from(link.href.split(',')[1]!, 'base64') : await readFile(new URL(link.href, pathToFileURL(file)));
        expect(bytes).toEqual(binary);
        return;
      }
      const click = () => browser.evaluate(`Array.from(document.querySelectorAll('article a')).find(a=>a.textContent===${JSON.stringify(kind)}).click()`);
      if (file === result.singleFile) await click();
      else await browser.waitForNavigation(click);
      // Follow a completion signal for both native folder navigation and hash routing.
      await browser.evaluate(`new Promise((resolve,reject)=>{const start=performance.now();function check(){const e=document.getElementById(decodeURIComponent(location.hash.slice(1)));if(e&&e.checkVisibility())requestAnimationFrame(()=>resolve(true));else if(performance.now()-start>2500)reject(new Error('Destination not visible'));else requestAnimationFrame(check)}check()})`);
      expect(await browser.evaluate(`(()=>{const e=document.getElementById(decodeURIComponent(location.hash.slice(1)));return {text:e.textContent.trim(),visible:e.checkVisibility(),inViewport:e.getBoundingClientRect().top>=0&&e.getBoundingClientRect().top<innerHeight}})()`)).toEqual({ text: kind === 'Chapter' ? 'Detail' : kind === 'Range' ? '10const int line_10 = 10;' : '42const int line_42 = 42;', visible: true, inViewport: true });
      expect(await browser.evaluate(`Array.from(document.querySelectorAll('main .page-meta')).filter(e=>e.checkVisibility()).map(e=>e.textContent)`)).toEqual([kind === 'Chapter' ? 'chapter.mdReferenced file' : `native @ ${commit}: code.hReferenced file`]);
      if (kind === 'Source') {
        expect(await browser.evaluate(`(()=>{const code=Array.from(document.querySelectorAll('article code')).find(e=>e.checkVisibility());return {text:code.textContent,font:getComputedStyle(code).fontFamily}})()`)).toMatchObject({ text: expect.stringContaining('const int line_42 = 42;'), font: expect.stringMatching(/mono/i) });
      }
    });
  }
  expect(result.warnings).toEqual([]);
});

it('keeps recursive and inventory references portable without machine paths', async () => {
  const out = path.join(root, 'portable');
  const result = await exportSite(input, { out }, { mermaid: false });
  async function files(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(directory, e.name)) : [path.join(directory, e.name)]))).flat();
  }
  for (const file of await files(out)) {
    const bytes = await readFile(file, 'utf8');
    expect(bytes.match(/.{0,35}(?:file:|\/Users\/).{0,70}/g) ?? []).toEqual([]);
    expect(bytes).not.toContain(input);
    expect(bytes).not.toContain(root);
  }
  await withBrowser(async browser => {
    await browser.navigate(pathToFileURL(result.singleFile).href);
    expect(await browser.evaluate(`Array.from(document.querySelectorAll('nav details a')).map(a=>a.textContent)`)).toEqual(expect.arrayContaining(['Referenced chapterchapter.md', 'Moremore.md', 'Oldold.md', `code.hnative @ ${commit}: code.h`]));
    expect(await browser.evaluate(`Array.from(document.querySelectorAll('article p')).filter(e=>e.checkVisibility()).map(e=>e.textContent).find(t=>t.startsWith('Source note:'))`)).toBe('Source note: old.md. Home note: private.md.');
    expect(await browser.evaluate(`Array.from(document.querySelectorAll('a[href^="#"]')).filter(a=>!document.getElementById(decodeURIComponent(a.hash.slice(1)))).map(a=>a.textContent)`)).toEqual([]);
  });
});

it('lists oversized files and missing labels visibly without local URLs', async () => {
  const source = path.join(root, 'omissions');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Omissions\n\n[Large](large.bin) [Absent][a] [Exact](exact.txt)\n\n[a]: missing.md');
  await writeFile(path.join(source, 'large.bin'), Buffer.alloc(11));
  await writeFile(path.join(source, 'exact.txt'), 'profile: x');
  const out = path.join(root, 'omitted');
  const result = await exportSite(source, { out }, { mermaid: false, bundle: { version: 1, maxFileBytes: 10 } });
  expect(result.warnings.slice().sort()).toEqual([expect.stringMatching(/external local reference.*missing.md.*missing/), expect.stringMatching(/large.bin.*omitted.*11 bytes/)]);
  for (const file of [path.join(out, 'index.html'), result.singleFile]) {
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      expect(await browser.evaluate(`(()=>{const a=Array.from(document.querySelectorAll('article')).find(e=>e.checkVisibility());return {text:a.textContent.trim(),links:Array.from(a.querySelectorAll('a')).map(e=>e.textContent)}})()`)).toEqual({ text: 'Omissions\nLarge (omitted: 11 bytes) Absent Exact', links: ['Exact'] });
    });
  }
  expect(await readFile(result.singleFile, 'utf8')).not.toContain('file:');
});

it('rejects invalid bundle policies', async () => {
  for (const maxFileBytes of [-1, NaN, 1.2, Infinity]) {
    await expect(exportSite(input, { singleFile: path.join(root, 'invalid-policy.html') }, { mermaid: false, bundle: { version: 1, maxFileBytes } })).rejects.toThrow('bundle');
  }
});

it('rejects unsupported source line fragments', async () => {
  const source = path.join(root, 'bad-lines');
  await mkdir(source);
  await writeFile(path.join(source, 'code'), 'first\nsecond\n');
  for (const fragment of ['L0', 'L01', 'L3', 'L2-L1', 'L1-L3', 'other']) {
    await writeFile(path.join(source, 'index.md'), `# Page\n\n[Source](code#${fragment})`);
    await expect(exportSite(source, { singleFile: path.join(root, 'invalid-line.html') }, { mermaid: false })).rejects.toThrow('line fragment');
  }
});


it('refuses linked symlinks inside the input root', async () => {
  const source = path.join(root, 'symlinks');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Page\n\n[Alias](alias.txt)');
  await writeFile(path.join(source, 'real.txt'), 'Source text.');
  await symlink('real.txt', path.join(source, 'alias.txt'));
  await expect(exportSite(path.join(source, 'index.md'), { singleFile: path.join(root, 'unsafe.html') }, { mermaid: false })).rejects.toThrow('without symlinks');
});

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
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/pkAAAAASUVORK5CYII=', 'base64');
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
  expect(result.warnings).toEqual(['chapter.md: more.md not bundled']);
});

it('keeps direct and inventory references portable without machine paths', async () => {
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
    expect(await browser.evaluate(`Array.from(document.querySelectorAll('nav details a')).map(a=>a.textContent)`)).toEqual(expect.arrayContaining(['Referenced chapterchapter.md', 'Oldold.md', `code.hnative @ ${commit}: code.h`]));
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

it('marks further local targets as not bundled once per target in both exports', async () => {
  const source = path.join(root, 'one-level');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Input\n\n[Reference](../reference-depth.md) [Input page](local.md)');
  await writeFile(path.join(source, 'local.md'), '# Local input page\n\n[Other](../other-depth.md)');
  await writeFile(path.join(root, 'reference-depth.md'), '# Reference\n\n[Further](native/further.md#next) [Again][f]\n\n[f]: native/further.md#next');
  await writeFile(path.join(root, 'other-depth.md'), '# Other\n\n[Further](native/further.md#next)');
  await writeFile(path.join(root, 'native/further.md'), '# Further\n\n## Next');
  const result = await exportSite(path.join(source, 'index.md'), { out: path.join(root, 'one-level-out') }, { mermaid: false });
  const label = `native @ ${commit}: further.md`;
  expect(result.warnings).toEqual([`reference-depth.md: ${label} not bundled`]);
  expect(result.pages).toEqual(['index.html', 'local.html', '_md-render/references/0/reference-depth.html', '_md-render/references/1/other-depth.html']);
  for (const file of [path.join(result.directory!, result.pages[2]!), result.singleFile]) {
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      if (file === result.singleFile) await browser.evaluate(`Array.from(document.querySelectorAll('article a')).find(a=>a.textContent==='Reference').click()`);
      expect(await browser.evaluate(`(()=>{const article=Array.from(document.querySelectorAll('article')).find(e=>e.checkVisibility());return {text:article.textContent.trim(),links:Array.from(article.querySelectorAll('a')).map(a=>a.textContent)}})()`)).toEqual({
        text: `Reference\nFurther (not bundled: ${label}) Again (not bundled: ${label})`, links: [],
      });
    });
  }
});

it('warns once and lands at the page top for broken fragments in bundled references', async () => {
  const source = path.join(root, 'reference-fragments');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Input\n\n[Reference](../reference-fragment.md) [Source](code.txt)');
  await writeFile(path.join(root, 'reference-fragment.md'), '# Reference\n\n[Self](#gone) [Again][s] [Input](reference-fragments/index.md#gone) [Source](reference-fragments/code.txt#L9)\n\n[s]: #gone');
  await writeFile(path.join(source, 'code.txt'), 'first\nsecond\n');
  const result = await exportSite(path.join(source, 'index.md'), { out: path.join(root, 'reference-fragments-out') }, { mermaid: false });
  expect(result.warnings.slice().sort()).toEqual([
    'reference-fragment.md: missing fragment code.txt#L9; linked to page top',
    'reference-fragment.md: missing fragment index.md#gone; linked to page top',
    'reference-fragment.md: missing fragment reference-fragment.md#gone; linked to page top',
  ]);
  for (const single of [false, true]) {
    for (const [label, heading] of [['Self', 'Reference'], ['Input', 'Input'], ['Source', 'code.txt']]) {
      await withBrowser(async browser => {
        await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 800, deviceScaleFactor: 1, mobile: false });
        await browser.navigate(pathToFileURL(single ? result.singleFile : path.join(result.directory!, result.pages[1]!)).href);
        if (single) await browser.evaluate(`Array.from(document.querySelectorAll('article a')).find(a=>a.textContent==='Reference').click()`);
        const click = () => browser.evaluate(`Array.from(document.querySelectorAll('article')).find(e=>e.checkVisibility()).querySelectorAll('a')` + `.values().find(a=>a.textContent===${JSON.stringify(label)}).click()`);
        if (single) await click(); else await browser.waitForNavigation(click);
        expect(await browser.evaluate(`(()=>{const h=Array.from(document.querySelectorAll('article h1')).find(e=>e.checkVisibility());return {heading:h.textContent,top:scrollY,missing:location.hash.includes('gone')||location.hash.includes('L9')}})()`)).toEqual({ heading, top: 0, missing: false });
      });
    }
  }
});

it('refuses broken fragments authored in input pages', async () => {
  const source = path.join(root, 'input-fragments');
  await mkdir(source);
  for (const [target, reference] of [['#gone', '# Reference'], ['reference.md#gone', '# Reference'], ['reference.md', '# Reference\n\n[Broken](#gone)']]) {
    await writeFile(path.join(source, 'reference.md'), reference!);
    await writeFile(path.join(source, 'index.md'), `# Input\n\n[Broken](${target})`);
    await expect(exportSite(path.join(source, 'index.md'), { singleFile: path.join(root, 'input-fragments.html') }, { mermaid: false })).rejects.toThrow('Missing anchor');
  }
});

it('keeps diagram text portable after SVG rendering in both exports', async () => {
  const source = path.join(root, 'diagram-paths.md');
  const diagram = 'flowchart TD\nA["profile: value"] --> B[Finish]';
  await writeFile(source, `# Diagram\n\n\`\`\`mermaid\n${diagram}\n\`\`\``);
  const result = await exportSite(source, { out: path.join(root, 'diagram-paths-out') });
  for (const file of [path.join(result.directory!, 'diagram-paths.html'), result.singleFile]) {
    expect((await readFile(file, 'utf8')).match(/file:/g) ?? []).toEqual([]);
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      expect(await browser.evaluate(`Array.from(document.querySelectorAll('figure code')).map(e=>e.textContent)`)).toEqual([diagram]);
      expect(await browser.evaluate(`Array.from(document.querySelectorAll('figure svg')).map(e=>e.textContent.includes('profile: value')&&e.getBoundingClientRect().width>0)`)).toEqual([true]);
    });
  }
});

it('omits oversized additional Markdown before parsing while exempting selected pages', async () => {
  const source = path.join(root, 'markdown-limit');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Selected\n\n[Large](large.md) [Exact](exact.md)');
  // Duplicate anchors must never be parsed when this additional file is omitted.
  const large = '<a id="same"></a>\n\n<a id="same"></a>\n';
  await writeFile(path.join(source, 'large.md'), large);
  await writeFile(path.join(source, 'exact.md'), '# Exact');
  const result = await exportSite(path.join(source, 'index.md'), { out: path.join(root, 'markdown-limit-out') }, { mermaid: false, bundle: { version: 1, maxFileBytes: 7 } });
  expect({ pages: result.pages, warnings: result.warnings }).toEqual({ pages: ['index.html', 'exact.html'], warnings: [`index.md: large.md omitted: ${Buffer.byteLength(large)} bytes`] });
  for (const file of [path.join(result.directory!, 'index.html'), result.singleFile]) {
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      expect(await browser.evaluate(`(()=>{const a=document.querySelector('article');return {text:a.textContent.trim(),links:Array.from(a.querySelectorAll('a')).map(e=>e.textContent)}})()`)).toEqual({ text: `Selected\nLarge (omitted: ${Buffer.byteLength(large)} bytes) Exact`, links: ['Exact'] });
    });
  }
});

it.each([false, true])('removes input and home paths from Mermaid source before rendering (mermaid=%s)', async mermaid => {
  const source = path.join(root, `mermaid-private-${mermaid}.md`);
  await writeFile(source, `# Paths\n\n\`\`\`mermaid\nflowchart TD\nA["${root}/private.md"] --> B["${homedir()}/secret.txt"]\n\`\`\``);
  const result = await exportSite(source, { out: path.join(root, `mermaid-private-${mermaid}-out`) }, { mermaid });
  for (const file of [path.join(result.directory!, `mermaid-private-${mermaid}.html`), result.singleFile]) {
    const html = await readFile(file, 'utf8');
    expect({ inputPath: html.includes(root), homePath: html.includes(homedir()) }).toEqual({ inputPath: false, homePath: false });
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      expect(await browser.evaluate(`Array.from(document.querySelectorAll('figure code')).map(e=>e.textContent)`)).toEqual(['flowchart TD\nA["private.md"] --> B["secret.txt"]']);
    });
  }
});

it('resolves images in external Markdown from the original source directory', async () => {
  const source = path.join(root, 'external-image');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Input\n\n[Chapter](../image-chapter.md)');
  await writeFile(path.join(root, 'image-chapter.md'), '# Chapter\n\n![Pixel](external-image/pixel.png)');
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/pkAAAAASUVORK5CYII=', 'base64');
  await writeFile(path.join(source, 'pixel.png'), pixel);
  const result = await exportSite(path.join(source, 'index.md'), { out: path.join(root, 'external-image-out') }, { mermaid: false });
  for (const file of [path.join(result.directory!, result.pages[1]!), result.singleFile]) {
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      if (file === result.singleFile) await browser.evaluate(`Array.from(document.querySelectorAll('article a')).find(a=>a.textContent==='Chapter').click()`);
      expect(await browser.evaluate(`Array.from(document.querySelectorAll('article img')).map(i=>({alt:i.alt,loaded:i.complete&&i.naturalWidth>0,visible:i.checkVisibility()}))`)).toEqual([{ alt: 'Pixel', loaded: true, visible: true }]);
    });
  }
  expect(await readFile(path.join(result.directory!, 'pixel.png'))).toEqual(pixel);
});

it('reuses the prepared diagram SVG unchanged in the standalone export', async () => {
  const source = path.join(root, 'prepared-diagrams');
  await mkdir(source);
  // Git graphs generate commit labels; a fresh render changes the prepared drawing.
  await writeFile(path.join(source, 'index.md'), '# History\n\n```mermaid\ngitGraph\ncommit\ncommit\n```');
  const result = await exportSite(source, { out: path.join(root, 'prepared-diagrams-out') });
  const drawings: string[][] = [];
  for (const file of [path.join(result.directory!, 'index.html'), result.singleFile]) {
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      drawings.push(await browser.evaluate(`Array.from(document.querySelectorAll('figure svg')).map(svg=>svg.outerHTML)`));
    });
  }
  expect(drawings[0]).toEqual([expect.stringContaining('main')]);
  expect(drawings[1]).toEqual(drawings[0]);
});

it('visibly omits a linked file that grows beyond the read budget after stat', async () => {
  const source = path.join(root, 'growing-file');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Growth\n\n[Growing](growing.bin)');
  const linked = path.join(source, 'growing.bin');
  await writeFile(linked, Buffer.from([0]));
  const grownSize = 2 ** 32 + 1;
  const preload = path.join(root, 'grow-after-stat.mjs');
  // Inject only the nondeterministic filesystem race, in a separate CLI process.
  // The input and sparse growth are real files; no owned module is replaced.
  await writeFile(preload, `import fs from 'node:fs';\nimport { syncBuiltinESMExports } from 'node:module';\nconst lstat = fs.promises.lstat;\nfs.promises.lstat = async (...args) => {\n  const info = await lstat(...args);\n  if (String(args[0]) === ${JSON.stringify(linked)} && info.size === 1) await fs.promises.truncate(args[0], ${grownSize});\n  return info;\n};\nsyncBuiltinESMExports();\n`);
  const singleFile = path.join(root, 'growing-file.html');
  const result = await run(process.execPath, ['--import', preload, new URL('../dist/cli.js', import.meta.url).pathname, path.join(source, 'index.md'), '--single-file', singleFile, '--max-linked-file-bytes', '10']);
  expect(result.stderr).toBe(`md-render: index.md: growing.bin omitted: ${grownSize} bytes\n`);
  await withBrowser(async browser => {
    await browser.navigate(pathToFileURL(singleFile).href);
    expect(await browser.evaluate(`(()=>{const a=document.querySelector('article');return {text:a.textContent.trim(),links:Array.from(a.querySelectorAll('a')).map(e=>e.textContent)}})()`)).toEqual({ text: `Growth\nGrowing (omitted: ${grownSize} bytes)`, links: [] });
  });
});

it('preserves opaque attachment bytes containing input and home paths in both exports', async () => {
  const source = path.join(root, 'opaque-paths');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Opaque\n\n[Attachment](attachment.bin)');
  const original = Buffer.from(`\0${source}/private.bin\n${homedir()}/private.bin\n`, 'utf8');
  await writeFile(path.join(source, 'attachment.bin'), original);
  const result = await exportSite(path.join(source, 'index.md'), { out: path.join(root, 'opaque-paths-out') }, { mermaid: false });
  for (const file of [path.join(result.directory!, 'index.html'), result.singleFile]) {
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      const href = await browser.evaluate<string>(`Array.from(document.querySelectorAll('article a')).find(a=>a.textContent==='Attachment').getAttribute('href')`);
      const bytes = href.startsWith('data:') ? Buffer.from(href.split(',')[1]!, 'base64') : await readFile(new URL(href, pathToFileURL(file)));
      expect(bytes).toEqual(original);
    });
  }
});

it.each(['image descriptions', 'manifest titles'])('removes machine paths from published %s after loading resources', async field => {
  const source = path.join(root, `published-${field.replaceAll(' ', '-')}`);
  await mkdir(path.join(source, 'docs'), { recursive: true });
  await writeFile(path.join(source, 'index.md'), `# Published\n\n![${source}/private.txt](pixel.png)`);
  await writeFile(path.join(source, 'pixel.png'), pixel);
  await writeFile(path.join(source, 'docs/DOCUMENTS.json'), JSON.stringify({ version: 1, inventory: [], documents: [
    { id: 'book', title: `${homedir()}/secret.txt`, sections: [{ id: 'published', path: 'index.md', anchor: 'published' }] },
  ] }));
  const result = await exportSite(source, { out: path.join(source, 'out') }, { mermaid: false });
  for (const file of [path.join(result.directory!, 'index.html'), result.singleFile]) {
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      const actual = field === 'image descriptions'
        ? await browser.evaluate(`Array.from(document.querySelectorAll('article img')).map(i=>i.alt)`)
        : await browser.evaluate(`Array.from(document.querySelectorAll('.chapter-row a')).map(a=>a.textContent)`);
      expect(actual).toEqual(field === 'image descriptions' ? ['private.txt'] : ['secret.txt']);
    });
  }
});

it('replaces original path occurrences without rewriting inserted portable labels', async () => {
  const source = path.join(root, 'overlapping-paths');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), `# Paths\n\n\`\`\`text\n${source}/nested${homedir()}/second.txt ${homedir()}/second.txt\n\`\`\``);
  const result = await exportSite(source, { out: path.join(source, 'out') }, { mermaid: false });
  for (const file of [path.join(result.directory!, 'index.html'), result.singleFile]) {
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      expect(await browser.evaluate(`Array.from(document.querySelectorAll('article pre code')).map(e=>e.textContent.trim())`)).toEqual([`nested${homedir()}/second.txt second.txt`]);
    });
  }
});

it.each(['directory', 'invalid UTF-8'])('classifies an unselected .md %s before Markdown parsing', async kind => {
  const source = path.join(root, `classify-${kind.replaceAll(' ', '-')}`);
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Input\n\n[Target](target.md)');
  if (kind === 'directory') await mkdir(path.join(source, 'target.md'));
  else await writeFile(path.join(source, 'target.md'), Buffer.from([0xff, 0xfe, 0xfd]));
  const result = await exportSite(path.join(source, 'index.md'), { out: path.join(source, 'out') }, { mermaid: false });
  expect(result.warnings).toEqual(kind === 'directory' ? ['index.md: external local reference target.md; directory not bundled'] : []);
  for (const file of [path.join(result.directory!, 'index.html'), result.singleFile]) {
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      const actual = await browser.evaluate<{ text: string; downloads: { name: string; href: string }[] }>(`(()=>{const a=document.querySelector('article');return {text:a.textContent.trim(),downloads:Array.from(a.querySelectorAll('a')).map(e=>({name:e.download,href:e.getAttribute('href')}))}})()`);
      const downloads = await Promise.all(actual.downloads.map(async ({ name, href }) => ({ name,
        bytes: href.startsWith('data:') ? Buffer.from(href.split(',')[1]!, 'base64') : await readFile(new URL(href, pathToFileURL(file))),
      })));
      expect({ text: actual.text, downloads }).toEqual({
        text: kind === 'directory' ? 'Input\nTarget (directory not bundled)' : 'Input\nTarget', downloads: kind === 'directory' ? [] : [{ name: 'target.md', bytes: Buffer.from([0xff, 0xfe, 0xfd]) }],
      });
    });
  }
});

it('keeps a shared image definition usable as both preview and named download', async () => {
  const source = path.join(root, 'shared-definition');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Shared\n\n![Preview][asset] [Download][asset]\n\n[asset]: pixel.png');
  await writeFile(path.join(source, 'pixel.png'), pixel);
  const result = await exportSite(source, { out: path.join(source, 'out') }, { mermaid: false });
  for (const file of [path.join(result.directory!, 'index.html'), result.singleFile]) {
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      expect(await browser.evaluate(`({images:Array.from(document.querySelectorAll('article img')).map(i=>({alt:i.alt,loaded:i.complete&&i.naturalWidth>0})),downloads:Array.from(document.querySelectorAll('article a')).map(a=>({text:a.textContent,name:a.download}))})`)).toEqual({ images: [{ alt: 'Preview', loaded: true }], downloads: [{ text: 'Download', name: 'pixel.png' }] });
    });
  }
});

it('keeps the first duplicate definition as the rendered link destination', async () => {
  const source = path.join(root, 'duplicate-definition');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Input\n\n[Chapter][chapter]\n\n[chapter]: chapter.md\n[chapter]: missing.md');
  await writeFile(path.join(source, 'chapter.md'), '# Chapter');
  const result = await exportSite(path.join(source, 'index.md'), { out: path.join(source, 'out') }, { mermaid: false });
  for (const file of [path.join(result.directory!, 'index.html'), result.singleFile]) {
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      expect(await browser.evaluate(`Array.from(document.querySelectorAll('article a')).map(a=>({text:a.textContent,destination:a.getAttribute('href')}))`)).toEqual([{ text: 'Chapter', destination: file === result.singleFile ? '#page-1' : 'chapter.html' }]);
    });
  }
  expect(result.warnings).toEqual([]);
});

it('preserves source bytes in both the preview and attachment in both exports', async () => {
  const source = path.join(root, 'shared-bytes');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Shared\n\n![Preview](pixel.png) [Download](pixel.png)');
  await writeFile(path.join(source, 'pixel.png'), pixel);
  const result = await exportSite(source, { out: path.join(source, 'out') }, { mermaid: false });
  for (const file of [path.join(result.directory!, 'index.html'), result.singleFile]) {
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      const urls = await browser.evaluate<string[]>(`[document.querySelector('article img').src,document.querySelector('article a').href]`);
      const bytes = await Promise.all(urls.map(url => url.startsWith('data:') ? Buffer.from(url.split(',')[1]!, 'base64') : readFile(new URL(url))));
      expect(bytes).toEqual([pixel, pixel]);
    });
  }
});

it('keeps reference-page links to images already included through previews', async () => {
  const source = path.join(root, 'included-image');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Input\n\n![Preview](pixel.png) [Reference](../image-reference.md)');
  await writeFile(path.join(source, 'pixel.png'), pixel);
  await writeFile(path.join(root, 'image-reference.md'), '# Reference\n\n[Download](included-image/pixel.png)');
  const result = await exportSite(path.join(source, 'index.md'), { out: path.join(source, 'out') }, { mermaid: false });
  for (const file of [path.join(result.directory!, result.pages[1]!), result.singleFile]) {
    await withBrowser(async browser => {
      await browser.navigate(pathToFileURL(file).href);
      const href = await browser.evaluate<string | null>(`Array.from(document.querySelectorAll('article a')).find(a=>a.textContent==='Download')?.getAttribute('href') ?? null`);
      const bytes = href === null ? null : href.startsWith('data:') ? Buffer.from(href.split(',')[1]!, 'base64') : await readFile(new URL(href, pathToFileURL(file)));
      expect(bytes).toEqual(pixel);
    });
  }
  expect(result.warnings).toEqual([]);
});

it('preserves author stylesheet bytes including path comments and embedded resources in both exports', async () => {
  const source = path.join(root, 'author-stylesheet');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Theme');
  const theme = path.join(source, 'theme.css');
  // The data URI deliberately contains a home-path sequence as encoded resource content.
  const encoded = homedir().padEnd(Math.ceil(homedir().length / 4) * 4, 'A');
  const css = `/* ${source}/note.txt*/\n.sd-doc{color:purple;background:url("data:application/octet-stream;base64,${encoded}")}\n`;
  await writeFile(theme, css);
  const result = await exportSite(source, { out: path.join(source, 'out') }, { mermaid: false, theme });
  const folder = await readFile(path.join(result.directory!, '_md-render/theme.css'), 'utf8');
  const single = await readFile(result.singleFile, 'utf8');
  expect({ folder, inline: single.slice(single.indexOf(css), single.indexOf(css) + css.length) }).toEqual({ folder: css, inline: css });
});

it('refuses authored anchors containing input or home paths and names the page and identifier', async () => {
  const source = path.join(root, 'anchor-paths');
  await mkdir(source);
  for (const id of [source, `prefix-${source}/detail`, homedir(), `prefix-${homedir()}/private`]) {
    await writeFile(path.join(source, 'index.md'), `# Input\n\n<a id="${id}"></a>`);
    for (const targets of [{ out: path.join(source, 'out') }, { singleFile: path.join(source, 'out.html') }]) {
      await expect(exportSite(source, targets, { mermaid: false })).rejects.toThrow(`Authored anchor contains an absolute input or home path: index.md#${id}`);
    }
  }
});

it('refuses an originally missing fragment without changing authored identifiers', async () => {
  const source = path.join(root, 'missing-original-fragment');
  await mkdir(source);
  await writeFile(path.join(source, 'index.md'), '# Input\n\n<a id="private-detail"></a>\n\n[Broken](#private)');
  await expect(exportSite(source, { singleFile: path.join(source, 'out.html') }, { mermaid: false })).rejects.toThrow('Missing anchor: index.md -> index.md#private');
});

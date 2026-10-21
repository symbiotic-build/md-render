import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { exportSite } from '../src/single-file.js';
import { renderSite } from '../src/site.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'md-render-review-')));
  roots.push(root);
  const input = path.join(root, 'input');
  await mkdir(input);
  await writeFile(path.join(input, 'index.md'), '# Guide');
  return { root, input, singleFile: path.join(root, 'guide.html'), theme: path.join(root, 'theme.css') };
}
async function stylesheet(css: string, resources: Record<string, string> = {}) {
  const setup = await fixture();
  await writeFile(setup.theme, css);
  for (const [name, text] of Object.entries(resources)) await writeFile(path.join(setup.root, name), text);
  await exportSite(setup.input, { singleFile: setup.singleFile }, { theme: setup.theme, mermaid: false });
  return (await readFile(setup.singleFile, 'utf8')).match(/<style>([\s\S]*?)<\/style>/)![1]!;
}

it('leaves an existing private file named only in a CSS comment unembedded', async () => {
  const css = '/* Example: url(private.txt) */';
  const output = await stylesheet(css, { 'private.txt': 'Synthetic private bytes' });
  expect({ comment: output.includes(css), embedded: output.includes(Buffer.from('Synthetic private bytes').toString('base64')) }).toEqual({ comment: true, embedded: false });
});

it.each([
  '/* url(missing.txt) @import "missing.css"; */',
  '.sd-doc::before{content:"url(missing.txt) @import \'missing.css\';"}',
  '.sd-doc::before{content:\'escaped \\\' url(missing.txt) @import "missing.css";\'}',
  '.sd-doc::before{content:"escaped \\" url(missing.txt) @import \'missing.css\';"}',
])('ignores missing CSS resources in inert text: %s', async css => {
  const output = await stylesheet(css);
  expect(output).toContain(css);
});

it.each([
  ['"import.css"', 'pixel.svg'], ["'import.css'", '"pixel.svg"'],
  ['url(import.css)', "'pixel.svg'"], ['url("import.css")', 'pixel.svg'],
])('embeds real CSS imports and URLs: %s', async (imported, image) => {
  const css = `@import ${imported}; .sd-doc{background:url(${image})}`;
  const output = await stylesheet(css, { 'import.css': ':root{--imported:yes}', 'pixel.svg': '<svg/>' });
  expect(output).toContain(':root{--imported:yes} .sd-doc{background:url("data:image/svg+xml;base64,PHN2Zy8+")}');
});

it('preserves dollar sequences in imported stylesheet text', async () => {
  const imported = '.sd-doc::before{content:"$& $$ $` $\'"}';
  const output = await stylesheet('@import "import.css";', { 'import.css': imported });
  expect(output).toContain(imported);
});

it.each(['missing.png', 'https://example.com/pixel.png'])('refuses real unavailable CSS resources: %s', async resource => {
  await expect(stylesheet(`.sd-doc{background:url("${resource}")}`)).rejects.toThrow(resource.startsWith('https:') ? 'Cannot embed remote stylesheet resource' : 'ENOENT');
});

it.each(['combined', 'folder'])('refuses duplicate generated page destinations before writing: %s', async mode => {
  const { root, input, singleFile } = await fixture();
  await mkdir(path.join(input, 'docs'));
  await writeFile(path.join(input, 'a.md'), '# First');
  // A manifest can select this collision even on a case-insensitive filesystem.
  await writeFile(path.join(input, 'a.html'), '# Second');
  await writeFile(path.join(input, 'docs/DOCUMENTS.json'), JSON.stringify({ version: 1, inventory: [], documents: [{ id: 'guide', sections: [
    { id: 'first', path: 'a.md', anchor: 'first' }, { id: 'second', path: 'a.html', anchor: 'second' },
  ] }] }));
  const out = path.join(root, 'folder');
  const exported = mode === 'combined'
    ? exportSite(input, { out, singleFile }, { mermaid: false })
    : renderSite(input, out, { mermaid: false });
  await expect(exported).rejects.toThrow('Duplicate generated page destination: a.html (a.md, a.html)');
  expect(await readdir(root)).toEqual(['input']);
});

it.each(['input', 'home'])('refuses an external URL containing an absolute %s path before writing', async kind => {
  const { root, input, singleFile } = await fixture();
  const url = `https://example.com/?path=${kind === 'input' ? input : homedir()}/private.txt`;
  await writeFile(path.join(input, 'index.md'), `# Guide\n\n[External](${url})`);
  await expect(exportSite(input, { out: path.join(root, 'folder'), singleFile }, { mermaid: false })).rejects.toThrow(`External URL contains an absolute input or home path: index.md -> ${url}`);
  expect(await readdir(root)).toEqual(['input']);
});

it('preserves external URLs without machine paths in both exports', async () => {
  const { root, input, singleFile } = await fixture();
  const urls = ['https://example.com/?path=/portable/guide&view=1', 'mailto:reader@example.com', '//example.com/guide', 'tel:+123456'];
  await writeFile(path.join(input, 'index.md'), '# Guide\n\n' + urls.map(url => `[External](${url})`).join('\n\n'));
  const out = path.join(root, 'folder');
  await exportSite(input, { out, singleFile }, { mermaid: false });
  for (const file of [singleFile, path.join(out, 'index.html')]) {
    expect((await readFile(file, 'utf8')).replaceAll('&#x26;', '&amp;').match(/<a href="[^"]*">External<\/a>/g)).toEqual(urls.map(url => `<a href="${url.replaceAll('&', '&amp;')}">External</a>`));
  }
});

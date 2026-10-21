import { afterEach, expect, it } from 'vitest';
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { exportSite } from '../src/single-file.js';
import { prepareSite, renderSite, writeSite } from '../src/site.js';

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
  for (const [name, text] of Object.entries(resources)) {
    const file = path.join(setup.root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
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

it.each([
  [String.raw`\22`, String.raw`\"`],
  [String.raw`\5c`, String.raw`\\`],
  [String.raw`line\a break`, String.raw`line\a break`],
  [String.raw`line\d break`, String.raw`line\d break`],
  [String.raw`line\c break`, String.raw`line\c break`],
  [String.raw`control\1 f`, String.raw`control\1 f`],
  [String.raw`control\9 f`, String.raw`control\9 f`],
  [String.raw`control\1f f`, String.raw`control\1f f`],
  [String.raw`control\7f f`, String.raw`control\7f f`],
])('serializes embedded CSS URL fragments without changing their meaning: %s', async (fragment, serialized) => {
  const output = await stylesheet(`.sd-doc{background:url("pixel.svg#${fragment}")}`, { 'pixel.svg': '<svg/>' });
  expect(output).toContain(`.sd-doc{background:url("data:image/svg+xml;base64,PHN2Zy8+#${serialized}")}`);
});

it.each([
  ['pixel.svg ', ''], [' pixel.svg', ''], ['\t pixel.svg \t', ''], [' pixel.svg#paint ', '#paint'],
])('excludes surrounding CSS URL whitespace from embedded local references: %s', async (reference, fragment) => {
  const output = await stylesheet(`.sd-doc{background:url("${reference}")}`, { 'pixel.svg': '<svg/>' });
  expect(output).toContain(`.sd-doc{background:url("data:image/svg+xml;base64,PHN2Zy8+${fragment}")}`);
});

it('treats a decoded backslash as a file-URL path separator on POSIX', async () => {
  const output = await stylesheet(String.raw`.sd-doc{background:url("icons\\pixel.svg")}`, { 'icons/pixel.svg': '<svg/>' });
  expect(output).toContain('.sd-doc{background:url("data:image/svg+xml;base64,PHN2Zy8+")}');
});

it('resolves CSS imports after excluding surrounding URL whitespace', async () => {
  const output = await stylesheet('@import " import.css ";', { 'import.css': ':root{--imported:yes}' });
  expect(output).toContain(':root{--imported:yes}');
});

it.each(['missing.png', 'https://example.com/pixel.png'])('refuses real unavailable CSS resources: %s', async resource => {
  await expect(stylesheet(`.sd-doc{background:url("${resource}")}`)).rejects.toThrow(resource.startsWith('https:') ? 'Cannot embed remote stylesheet resource' : 'ENOENT');
});

it.each([String.raw`\1 file://server/share/pixel.png`, String.raw`\1 //server/share/pixel.png`])('refuses a CSS resource that parses to a network host: %s', async resource => {
  await expect(stylesheet(`.sd-doc{background:url("${resource}")}`)).rejects.toThrow('Cannot embed remote stylesheet resource');
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

it.each(['#url(private.txt)', 'éurl("private.txt")', String.raw`#u\72l(private.txt)`, '😀url("private.txt")', '1url("private.txt")', '@url("private.txt")'])(
  'does not read an existing private file in a non-resource CSS token: %s', async css => {
    const { root, input, singleFile, theme } = await fixture();
    await writeFile(theme, css);
    const privateFile = path.join(root, 'private.txt');
    await writeFile(privateFile, 'Synthetic private bytes');
    // A successful export also proves the scanner never tried to read this file.
    await chmod(privateFile, 0);
    await exportSite(input, { singleFile }, { theme, mermaid: false });
    const output = (await readFile(singleFile, 'utf8')).match(/<style>([\s\S]*?)<\/style>/)![1]!;
    expect({ token: output.includes(css), embedded: output.includes(Buffer.from('Synthetic private bytes').toString('base64')) })
      .toEqual({ token: true, embedded: false });
  },
);

it.each([
  String.raw`u\72l("pixel.svg")`, String.raw`\75\000072 l(pixel.svg)`,
  String.raw`URL("p\69xel.svg")`, String.raw`url(p\69xel.svg)`,
  'url(\t\r\n"pi\\\r\nxel.svg")', String.raw`url("pixel\0.svg")`,
  String.raw`url("pixel\d800.svg")`, String.raw`url("pixel\110000.svg")`,
])('embeds CSS resources using decoded escapes: %s', async css => {
  const output = await stylesheet(`.sd-doc{background:${css}}`, { 'pixel.svg': '<svg/>', 'pixel�.svg': '<svg/>' });
  expect(output).toContain('.sd-doc{background:url("data:image/svg+xml;base64,PHN2Zy8+")}');
});

it.each([String.raw`@\69mport "import.css";`, String.raw`@IMPORT u\72l("import.css");`])(
  'embeds CSS imports using decoded names: %s', async css => {
    const output = await stylesheet(css, { 'import.css': ':root{--imported:yes}' });
    expect(output).toContain(':root{--imported:yes}');
    expect(output).not.toContain(css);
  },
);

it('preserves comment-shaped characters inside an unquoted CSS URL', async () => {
  const output = await stylesheet('.sd-doc{background:url(a/*b*/c.svg)}', {
    'a/*b*/c.svg': '<svg/>', 'ac.svg': 'Wrong file',
  });
  expect(output).toContain('.sd-doc{background:url("data:image/svg+xml;base64,PHN2Zy8+")}');
});

it('allows exactly one concurrent folder export and preserves all of its files', async () => {
  const { root, input } = await fixture();
  const other = path.join(root, 'other');
  await mkdir(other);
  await writeFile(path.join(input, 'first.md'), '# First export');
  await writeFile(path.join(other, 'second.md'), '# Second export');
  const sites = await Promise.all([
    prepareSite(input, { mermaid: false }),
    prepareSite(other, { mermaid: false, theme: 'symbiotic' }),
  ]);
  const out = path.join(root, 'folder');
  await mkdir(out);
  // Both snapshots are ready before either writer attempts admission to the empty folder.
  const results = await Promise.allSettled(sites.map(site => writeSite(site, out)));
  expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  const winner = results.findIndex(result => result.status === 'fulfilled');
  const baseline = path.join(root, 'baseline');
  await writeSite(sites[winner]!, baseline);
  const contents = async (directory: string) => {
    const names = (await readdir(directory, { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile()).map(entry => path.relative(directory, path.join(entry.parentPath, entry.name))).sort();
    return Promise.all(names.map(async name => [name, (await readFile(path.join(directory, name))).toString('base64')]));
  };
  expect(await contents(out)).toEqual(await contents(baseline));
});

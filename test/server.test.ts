import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { access, cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startViewer, type Viewer } from '../src/server.js';

const fixture = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));
const origin = (viewer: Viewer): string => new URL(viewer.url).origin + '/';
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const viewers: Viewer[] = [];
const children: ChildProcess[] = [];
const directories: string[] = [];
let cliFixture: string;
beforeAll(async () => {
  cliFixture = await mkdtemp(path.join(tmpdir(), 'md-render-cli-fixture-'));
  await cp(fixture, cliFixture, { recursive: true });
  const tour = path.join(cliFixture, 'chapters/start.md');
  // Lifecycle assertions need the real corpus order and content, but no diagram build.
  await writeFile(tour, (await readFile(tour, 'utf8')).replace(/```mermaid[\s\S]*?```/g, ''));
});
afterAll(async () => { if (cliFixture) await rm(cliFixture, { recursive: true, force: true }); });
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  }
  await Promise.all(viewers.splice(0).map((viewer) => viewer.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function startChild(args: string[]): Promise<{ child: ChildProcess; output: string }> {
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  return new Promise((resolve, reject) => {
    // Runaway guard only; CLI startup should finish in seconds.
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Child startup exceeded 60s: ${output}`)); }, 60_000);
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Temporary output:')) { clearTimeout(timeout); resolve({ child, output }); }
    });
    child.stderr!.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); if (!output.includes('Temporary output:')) reject(new Error(`Child exited ${code}: ${output}`)); });
  });
}

it('serves pages on a free loopback port and removes output on close', async () => {
  const viewer = await startViewer(fixture, { mermaid: false });
  viewers.push(viewer);
  expect(new URL(viewer.url).hostname).toBe('127.0.0.1');
  const response = await fetch(`${origin(viewer)}chapters/start.html`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/html');
  expect(await response.text()).toContain('<h1 id="tour-1">Tour</h1>');
  expect((await fetch(`${origin(viewer)}missing.html`)).status).toBe(404);
  expect((await fetch(`${origin(viewer)}%ZZ`)).status).toBe(400);
  expect((await fetch(viewer.url, { method: 'POST' })).status).toBe(405);
  await viewer.close();
  await expect(access(viewer.directory)).rejects.toMatchObject({ code: 'ENOENT' });
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  it(`removes temporary CLI output on ${signal}`, async () => {
    const { child, output } = await startChild([cli, cliFixture]);
    const directory = /Temporary output: (.+)/.exec(output)![1]!;
    await access(directory);
    const exited = once(child, 'exit');
    child.kill(signal);
    const [code] = await exited;
    expect(code).toBe(signal === 'SIGINT' ? 130 : 143);
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 90_000);
}
it('removes output on normal process exit', async () => {
  const server = new URL('../dist/server.js', import.meta.url).href;
  const script = `import {startViewer} from ${JSON.stringify(server)}; const viewer=await startViewer(${JSON.stringify(fixture)},{mermaid:false}); console.log('Temporary output: '+viewer.directory); process.exit(0);`;
  const { child, output } = await startChild(['--input-type=module', '-e', script]);
  if (child.exitCode === null) await once(child, 'exit');
  expect(child.exitCode).toBe(0);
  await expect(access(/Temporary output: (.+)/.exec(output)![1]!)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('keeps static output after the CLI exits', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'md-render-static-test-'));
  directories.push(output);
  const child = spawn(process.execPath, [cli, cliFixture, '--out', output], { stdio: 'ignore' });
  children.push(child);
  expect((await once(child, 'exit'))[0]).toBe(0);
  expect(await readFile(path.join(output, 'chapters/start.html'), 'utf8')).toContain('<h1 id="tour-1">Tour</h1>');
});
it('returns a visible error for invalid input and cleans startup resources', async () => {
  const before = process.listenerCount('exit');
  await expect(startViewer(path.join(fixture, 'missing.md'), { mermaid: false })).rejects.toMatchObject({ code: 'ENOENT' });
  expect(process.listenerCount('exit')).toBe(before);
});

it('opens the first manifest page even when index.md appears later', async () => {
  const { child, output } = await startChild([cli, cliFixture]);
  const url = /http:\/\/127\.0\.0\.1:\d+\/[^\s]*/.exec(output)![0];
  expect(new URL(url).pathname).toBe('/chapters/nested/home.html');
  expect(await (await fetch(url)).text()).toContain('<title>Home</title>');
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
}, 90_000);

it('revalidates HTML and caches session assets', async () => {
  for (const seconds of [undefined, 7200]) {
    // The Symbiotic theme carries a logo asset, so every kind of session asset is checked.
    const viewer = await startViewer(fixture, { mermaid: false, theme: 'symbiotic',
      navigation: { version: 1, assetMaxAgeSeconds: seconds } });
    viewers.push(viewer);
    for (const method of ['GET', 'HEAD']) {
      expect((await fetch(viewer.url, { method })).headers.get('cache-control')).toBe('no-cache');
      for (const asset of ['base.css', 'navigation.js', 'logo.svg']) {
        expect((await fetch(`${origin(viewer)}_md-render/${asset}`, { method })).headers.get('cache-control'))
          .toBe(`max-age=${seconds ?? 3600}`);
      }
    }
  }
});

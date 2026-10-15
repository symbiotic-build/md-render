import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

const run = (selector: string) => spawnSync(process.execPath, [
  'scripts/vitest-selector.mjs', 'test/renderer.test.ts', encodeURIComponent(selector),
], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] });

it('reports a missing selector instead of passing an entirely skipped Vitest file', () => {
  const result = run('^no such acceptance selector$');
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(2);
});

it('runs the named test and propagates invalid-pattern failures', () => {
  const passed = run('^preserves Unicode heading fragments and disambiguates repeated headings$');
  expect(passed.error).toBeUndefined();
  expect(passed.status, passed.stdout + passed.stderr).toBe(0);
  const failed = run('[');
  expect(failed.error).toBeUndefined();
  expect(failed.status, failed.stdout + failed.stderr).toBe(1);
});

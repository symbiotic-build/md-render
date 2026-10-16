import { beforeEach, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { runBatch } from '../scripts/vitest-batch.mjs';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
beforeEach(() => {
  vi.mocked(spawnSync).mockReset();
  vi.mocked(spawnSync).mockReturnValue({ status: 0, signal: null });
});

it('batches every cited file in one Vitest process with EOF on standard input', () => {
  expect(runBatch('results.xml', [
    'test/renderer.test.ts::generated navigation regions > first case',
    'test/browser.test.ts::second case',
    'test/renderer.test.ts::third case',
  ])).toBe(0);
  expect(spawnSync).toHaveBeenCalledExactlyOnceWith('pnpm', [
    'exec', 'vitest', 'run', 'test/renderer.test.ts', 'test/browser.test.ts',
    '--reporter=default', '--reporter=junit', '--outputFile', 'results.xml',
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
});

it('propagates unsuccessful exits, startup errors and signals', () => {
  vi.mocked(spawnSync).mockReturnValueOnce({ status: 2, signal: null });
  expect(runBatch('results.xml', ['test/a.test.ts::case'])).toBe(2);
  const error = new Error('cannot start Vitest');
  vi.mocked(spawnSync).mockReturnValueOnce({ error });
  expect(() => runBatch('results.xml', ['test/a.test.ts::case'])).toThrow(error);
  vi.mocked(spawnSync).mockReturnValueOnce({ status: null, signal: 'SIGTERM' });
  expect(() => runBatch('results.xml', ['test/a.test.ts::case'])).toThrow('Vitest terminated by SIGTERM');
  vi.mocked(spawnSync).mockReturnValueOnce({ status: null, signal: null });
  expect(() => runBatch('results.xml', ['test/a.test.ts::case'])).toThrow('Vitest exited without a status');
});

it('refuses incomplete invocations before starting Vitest', () => {
  for (const [report, selectors] of [['', ['test/a.test.ts::case']], ['results.xml', []],
    ['results.xml', ['missing separator']], ['results.xml', ['::case']], ['results.xml', ['file::']]]) {
    expect(() => runBatch(report, selectors)).toThrow();
  }
  expect(spawnSync).not.toHaveBeenCalled();
});

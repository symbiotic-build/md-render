import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Run all cited files once; the shared audit matches exact names in the report. */
export function runBatch(report, selectors) {
  if (!report || !selectors.length) throw new Error('Expected a JUnit report path and file::test selectors');
  const files = [...new Set(selectors.map((selector) => {
    const separator = selector.indexOf('::');
    if (separator < 1 || !selector.slice(separator + 2)) throw new Error(`Invalid selector: ${selector}`);
    return selector.slice(0, separator);
  }))];
  const result = spawnSync('pnpm', [
    'exec', 'vitest', 'run', ...files, '--reporter=default', '--reporter=junit', '--outputFile', report,
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Vitest terminated by ${result.signal}`);
  if (result.status === null) throw new Error('Vitest exited without a status');
  return result.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [report, ...selectors] = process.argv.slice(2);
  process.exitCode = runBatch(report, selectors);
}

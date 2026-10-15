import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [file, selector] = process.argv.slice(2);
if (!file || !selector) throw new Error('Expected a test file and URI-encoded test-name pattern');
const reportDirectory = mkdtempSync(path.join(tmpdir(), 'md-render-selector-'));
try {
  const report = path.join(reportDirectory, 'result.json');
  const result = spawnSync('pnpm', [
    'exec', 'vitest', 'run', file, '-t', decodeURIComponent(selector), '--reporter=json', '--outputFile', report,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(readFileSync(report, 'utf8') + '\n');
    process.exitCode = 1;
  }
  else {
    const summary = JSON.parse(readFileSync(report, 'utf8'));
    console.log(`Vitest: ${summary.numPassedTests} passed, ${summary.numFailedTests} failed, ${summary.numPendingTests} skipped`);
    process.exitCode = summary.numPassedTests > 0 ? 0 : 2;
  }
} finally {
  rmSync(reportDirectory, { recursive: true, force: true });
}

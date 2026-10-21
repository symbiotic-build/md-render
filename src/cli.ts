#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { exportSite } from './single-file.js';
import { startViewer } from './server.js';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    out: { type: 'string' }, 'single-file': { type: 'string' }, 'max-linked-file-bytes': { type: 'string' }, theme: { type: 'string', default: 'default' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: md-render <Markdown file|folder|repository> [--out <empty directory>] [--single-file <path.html>] [--theme <default|symbiotic|path.css>] [--max-linked-file-bytes <bytes>]');
  } else {
    if (positionals.length !== 1) throw new Error('Usage: md-render <path> [--out <dir>] [--theme <name|path>]');
    const input = positionals[0]!;
    const limit = values['max-linked-file-bytes'];
    if (limit !== undefined && !/^[0-9]+$/.test(limit)) throw new Error('Invalid --max-linked-file-bytes byte count');
    const bundle = limit === undefined ? undefined : { version: 1 as const, maxFileBytes: Number(limit) };
    if (values.out || values['single-file']) {
      const result = await exportSite(input, { out: values.out, singleFile: values['single-file'] }, { theme: values.theme, bundle });
      console.log(`Rendered ${result.pages.length} files; ${result.links} local document links checked.${result.directory ? `\nStatic output: ${result.directory}\nEntry page: ${result.pages[0]}` : ''}\nSingle file: ${result.singleFile} (${result.bytes} bytes)`);
      for (const warning of result.warnings) console.error(`md-render: ${warning}`);
      if (!result.mermaid) console.log('Offline Mermaid unavailable; diagrams show readable source.');
    } else {
      const viewer = await startViewer(input, { theme: values.theme });
      console.log(`Rendered ${viewer.pages.length} files; ${viewer.links} local document links checked.\n${viewer.url}\nTemporary output: ${viewer.directory}\nPress Ctrl+C to stop and remove temporary output.`);
      for (const warning of viewer.warnings) console.error(`md-render: ${warning}`);
      if (!viewer.mermaid) console.log('Offline Mermaid unavailable; diagrams show readable source.');
    }
  }
} catch (error) {
  console.error(`md-render: ${(error as Error).message}`);
  process.exitCode = 1;
}

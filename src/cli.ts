#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { renderSite } from './site.js';
import { startViewer } from './server.js';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    out: { type: 'string' }, theme: { type: 'string', default: 'default' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: md-render <Markdown file|folder|repository> [--out <empty directory>] [--theme <default|symbiotic|path.css>]');
  } else {
    if (positionals.length !== 1) throw new Error('Usage: md-render <path> [--out <dir>] [--theme <name|path>]');
    const input = positionals[0]!;
    if (values.out) {
      const result = await renderSite(input, values.out, { theme: values.theme });
      console.log(`Rendered ${result.pages.length} files; ${result.links} local document links checked.\nStatic output: ${result.directory}\nEntry page: ${result.pages[0]}`);
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

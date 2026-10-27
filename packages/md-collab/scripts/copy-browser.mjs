// The sidebar's browser files ship beside the compiled code; tsc copies only TypeScript.
import { cp } from 'node:fs/promises';
await cp(new URL('../src/browser', import.meta.url), new URL('../dist/browser', import.meta.url), { recursive: true });

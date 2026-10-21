import { copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Writes the neutral theme beside a small logo into `directory` and returns the CSS path.
 *  The built-in themes ship no logo, so tests of logo handling bring their own. */
export async function logoTheme(directory: string): Promise<string> {
  const css = path.join(directory, 'brand.css');
  await copyFile(fileURLToPath(new URL('../themes/default.css', import.meta.url)), css);
  await writeFile(path.join(directory, 'brand.logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>');
  return css;
}

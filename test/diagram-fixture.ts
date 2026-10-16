import { vi } from 'vitest';

const actual = await vi.importActual<typeof import('../src/diagrams.js')>('../src/diagrams.js');
const rendered = new Map<string, ReturnType<typeof actual.renderDiagrams>>();

/** Reuses real Mermaid output only for identical immutable bodies in this test file. */
export function renderDiagrams(pages: string[], enabled: boolean): ReturnType<typeof actual.renderDiagrams> {
  const key = JSON.stringify([pages, enabled]);
  let result = rendered.get(key);
  if (!result) {
    result = actual.renderDiagrams(pages, enabled);
    rendered.set(key, result);
  }
  return result;
}

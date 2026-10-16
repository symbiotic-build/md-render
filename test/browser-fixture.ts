import { afterAll, beforeAll, vi } from 'vitest';
import type { BrowserHost, BrowserSession } from '../src/browser.js';

let host: BrowserHost;
// Both build-time diagrams and UI checks use the real transport on this file's host.
vi.mock('../src/browser.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/browser.js')>();
  return { ...actual, withBrowser: <T>(work: (browser: BrowserSession) => Promise<T>) => host.withPage(work) };
});

/** One Chromium per test file; every callback receives a new context and target. */
export function useBrowser(): <T>(work: (browser: BrowserSession) => Promise<T>) => Promise<T> {
  beforeAll(async () => {
    const { launchBrowser } = await vi.importActual<typeof import('../src/browser.js')>('../src/browser.js');
    host = await launchBrowser();
  });
  afterAll(async () => { await host?.close(); });
  return work => host.withPage(work);
}

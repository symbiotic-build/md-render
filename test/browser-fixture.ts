import { afterAll, beforeAll } from 'vitest';
import { launchBrowser, type BrowserHost, type BrowserSession } from '../src/browser.js';

let host: BrowserHost;

/** One Chromium per test file; every callback receives a new context and target. */
export function useBrowser(): <T>(work: (browser: BrowserSession) => Promise<T>) => Promise<T> {
  beforeAll(async () => {
    host = await launchBrowser();
  });
  afterAll(async () => { await host?.close(); });
  return work => host.withPage(work);
}

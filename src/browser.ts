import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

/** A local Chrome DevTools session; commands fail visibly on browser errors or timeout. */
export interface BrowserSession {
  send(method: string, params?: object): Promise<any>;
  navigate(url: string): Promise<void>;
  /** Waits for the full load caused by an action, including a normal-link fallback. */
  waitForNavigation(action: () => Promise<unknown>): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
}

/** A Chromium process that owns isolated page sessions and its temporary profile. */
export interface BrowserHost {
  withPage<T>(work: (browser: BrowserSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Uses an installed Chromium browser over a pipe, with an isolated temporary profile. */
export async function withBrowser<T>(work: (browser: BrowserSession) => Promise<T>): Promise<T> {
  const host = await launchBrowser();
  try { return await host.withPage(work); }
  finally { await host.close(); }
}

/** Starts Chromium once; each withPage call owns a fresh context, target and storage. */
export async function launchBrowser(): Promise<BrowserHost> {
  const candidates = process.env.MD_RENDER_BROWSER ? [process.env.MD_RENDER_BROWSER] : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']
    : (process.env.PATH ?? '').split(path.delimiter).flatMap((dir) => ['chromium', 'chromium-browser', 'google-chrome'].map((name) => path.join(dir, name)));
  let executable: string | undefined;
  for (const candidate of candidates) {
    try { await access(candidate); executable = candidate; break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (!executable) throw new Error('Build-time Mermaid needs an installed Chromium browser; set MD_RENDER_BROWSER to its executable');
  const profile = await mkdtemp(path.join(tmpdir(), 'md-render-browser-'));
  const child = spawn(executable, ['--headless', '--no-startup-window', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--disable-extensions', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const input = child.stdio[3] as Writable;
  const output = child.stdio[4] as Readable;
  let sequence = 0;
  let buffer = '';
  let stderr = '';
  const sessions = new Map<string, { loaded?: () => void; committed: boolean }>();
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  function fail(error: Error): void {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  }
  child.stderr!.on('data', (chunk) => { stderr += String(chunk); });
  child.on('error', fail);
  child.on('exit', (code) => fail(new Error(`Headless browser exited (${code}): ${stderr}`)));
  input.on('error', fail);
  output.setEncoding('utf8');
  output.on('data', (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      // A load event counts only after the main frame commits the awaited
      // document; a late event from the previous page must not end the wait.
      const session = sessions.get(message.sessionId);
      if (session && message.method === 'Page.frameNavigated' && !message.params.frame.parentId) session.committed = true;
      if (session && message.method === 'Page.loadEventFired' && session.committed) session.loaded?.();
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  function send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Headless browser timed out: ${method}. ${stderr}`)); }, 30_000);
      pending.set(id, { resolve, reject, timer });
      input.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  }
  async function withPage<T>(work: (browser: BrowserSession) => Promise<T>): Promise<T> {
    const { browserContextId } = await send('Target.createBrowserContext');
    let sessionId: string | undefined;
    try {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
      sessionId = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
      const state: { loaded?: () => void; committed: boolean } = { committed: false };
      sessions.set(sessionId!, state);
      async function waitForNavigation(action: () => Promise<unknown>): Promise<void> {
        await browser.send('Page.enable');
        let timer: NodeJS.Timeout;
        const load = new Promise<void>((resolve, reject) => {
          state.loaded = resolve;
          timer = setTimeout(() => reject(new Error('Page load timed out')), 30_000);
        });
        state.committed = false;
        try { await action(); await load; }
        finally { clearTimeout(timer!); state.loaded = undefined; }
      }
      const browser: BrowserSession = {
        send: (method, params) => send(method, params, sessionId),
        waitForNavigation,
        async navigate(url) {
          await waitForNavigation(async () => {
            const result = await browser.send('Page.navigate', { url });
            if (result.errorText) throw new Error(result.errorText);
          });
        },
        async evaluate<T>(expression: string): Promise<T> {
          const result = await browser.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
          if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
          return result.result.value as T;
        },
      };
      return await work(browser);
    } finally {
      if (sessionId) sessions.delete(sessionId);
      await send('Target.disposeBrowserContext', { browserContextId });
    }
  }
  async function close(): Promise<void> {
    const exited = child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => child.once('exit', () => resolve()));
    // A requested close also stops Chromium's helper processes, which can
    // otherwise keep writing into the profile after the main process exits.
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      send('Browser.close').then(() => exited, () => undefined),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, 5_000); }),
    ]);
    clearTimeout(timer);
    fail(new Error('Headless browser closed'));
    child.kill();
    await exited;
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  return { withPage, close };
}

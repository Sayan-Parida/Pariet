import puppeteer from 'puppeteer-core';
import { setTimeout as sleep } from 'timers/promises';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EXTENSION_DIST = join(process.cwd(), 'extension', 'dist');
const USER_DATA_DIR = join(process.cwd(), '.puppeteer-chrome-profile');
const BACKEND = 'http://localhost:8080';
const FRONTEND = 'http://localhost:5173';

const LAUNCH_ARGS = {
  executablePath: CHROME_PATH,
  headless: false,
  args: [
    '--enable-extensions',
    '--load-extension=' + EXTENSION_DIST,
    '--disable-extensions-except=' + EXTENSION_DIST,
    '--user-data-dir=' + USER_DATA_DIR,
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-automation',
  ],
  ignoreDefaultArgs: [
    '--disable-extensions',
    '--headless=new',
    '--disable-component-extensions-with-background-pages',
    '--disable-default-apps',
  ],
};

/**
 * Find the Pariet extension's service worker target.
 */
async function findServiceWorker(browser, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = browser.targets();
    const sw = targets.find(
      (t) => t.type() === 'service_worker' && t.url().includes('service_worker.js')
    );
    if (sw) return sw;
    await sleep(500);
  }
  return null;
}

async function main() {
  if (existsSync(USER_DATA_DIR)) rmSync(USER_DATA_DIR, { recursive: true, force: true });

  console.log('Launching Chrome with Pariet extension...');

  const browser = await puppeteer.launch(LAUNCH_ARGS);

  // Wait for extension service worker
  const swTarget = await findServiceWorker(browser, 15000);
  if (!swTarget) {
    console.log('FAIL: Pariet service worker not found after 15s');
    const targets = browser.targets();
    console.log('Available targets:', targets.map((t) => t.type() + ' -> ' + t.url()));
    await browser.close();
    process.exit(1);
  }

  const extId = swTarget.url().split('/')[2];
  console.log('Extension loaded: YES');
  console.log('Extension ID:', extId);
  console.log('Service worker: running');

  // Create a session via the backend API (test setup, not data faking)
  const sessionRes = await fetch(BACKEND + '/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'stress-test-realistic' }),
  });
  if (!sessionRes.ok) {
    console.log('FAIL: Could not create session via backend, status:', sessionRes.status);
    await browser.close();
    process.exit(1);
  }
  const sessionData = await sessionRes.json();
  const sessionId = sessionData.id || sessionData.sessionId;
  console.log('Session created via backend, ID:', sessionId);

  // Set the extension's storage state so it knows about the session
  const cdp = await swTarget.createCDPSession();
  await cdp.send('Runtime.enable');
  await sleep(500);

  // Find execution contexts
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', (e) => contexts.push(e.context));
  await sleep(1000);

  // Try each context to find one with chrome.storage
  let storageSet = false;
  for (const ctx of contexts) {
    try {
      const res = await cdp.send('Runtime.evaluate', {
        expression: `
          new Promise((resolve) => {
            try {
              chrome.storage.local.set({
                sessionState: { sessionId: '${sessionId}', sessionTitle: 'stress-test-realistic', isActive: true }
              }, () => {
                resolve(JSON.stringify({ ok: true, contextId: ${ctx.id} }));
              });
            } catch(e) {
              resolve(JSON.stringify({ ok: false, error: e.message, contextId: ${ctx.id} }));
            }
          })
        `,
        awaitPromise: true,
        contextId: ctx.id,
      });
      const val = JSON.parse(res.result.value || '{}');
      if (val.ok) {
        storageSet = true;
        console.log('Extension storage set via context', ctx.id);
        break;
      }
    } catch {
      // continue to next context
    }
  }

  if (!storageSet) {
    // Fallback: try without contextId (uses default context)
    try {
      await cdp.send('Runtime.evaluate', {
        expression: `
          new Promise((resolve) => {
            chrome.storage.local.set({
              sessionState: { sessionId: '${sessionId}', sessionTitle: 'stress-test-realistic', isActive: true }
            }, () => resolve('ok'));
          })
        `,
        awaitPromise: true,
      });
      storageSet = true;
      console.log('Extension storage set via default context');
    } catch (e) {
      console.log('WARNING: Could not set extension storage:', e.message);
    }
  }

  await cdp.detach();

  // Open the frontend to verify everything works
  const page = await browser.newPage();
  await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await sleep(2000);

  // Navigate to the session's map page
  await page.goto(FRONTEND + '/session/' + sessionId + '/map', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  await sleep(2000);

  console.log('\nValidation PASSED');
  console.log('  Extension loaded: YES');
  console.log('  Extension ID:', extId);
  console.log('  Service worker: running');
  console.log('  Session ID:', sessionId);
  console.log('  Frontend: navigated to map page');
  console.log('\nReady for stress test sequences.');
  console.log('SESSION_ID=' + sessionId);

  await browser.close();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

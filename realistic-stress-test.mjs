/*
  Pariet Realistic Stress Test
  ----------------------------
  Connects to an already-running Chrome instance via its DevTools WebSocket
  endpoint (read from Chrome's DevToolsActivePort file). The Chrome instance
  must have the Pariet extension loaded and remote debugging enabled.

  Produces real same-tab navigation provenance (transitionType="link",
  PAGE_TO_PAGE chains) that the Pariet extension captures.

  Unlike a naive page.goto() approach, this test CLICKS actual search result
  links so that Chrome records transitionType="link" for result navigations.

  Requirements:
    - Node.js with puppeteer-core installed (npm install puppeteer-core)
    - Chrome running with remote debugging (DevToolsActivePort present)
    - Pariet extension loaded in that Chrome instance
    - Backend running at http://localhost:8080

  Usage:
    node realistic-stress-test.mjs
    node realistic-stress-test.mjs --delay 3000
*/

import puppeteer from 'puppeteer-core';
import { setTimeout as sleep } from 'timers/promises';
import { readFileSync } from 'fs';
import { join } from 'path';

const DELAY_MS = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--delay') || '2000', 10);
const PROTOCOL_TIMEOUT = 60000;

// Realistic research sequences: search query + how many result links to click
const RESEARCH_SEQUENCES = [
  { search: 'apache kafka getting started', clicks: 3 },
  { search: 'kafka exactly once semantics', clicks: 3 },
  { search: 'redis data structures explained', clicks: 3 },
  { search: 'redis persistence RDB vs AOF', clicks: 3 },
  { search: 'postgresql indexing best practices', clicks: 3 },
  { search: 'postgresql query optimization explain analyze', clicks: 3 },
  { search: 'docker best practices dockerfile', clicks: 3 },
  { search: 'docker multi stage build optimization', clicks: 3 },
  { search: 'kubernetes architecture explained', clicks: 3 },
  { search: 'kubernetes deployment rolling update', clicks: 3 },
  { search: 'java virtual threads project loom', clicks: 3 },
  { search: 'java CompletableFuture chaining examples', clicks: 3 },
];

const GOOGLE_INTERNAL_PATTERNS = [
  'google.com/search',
  'google.com/url',
  'google.com/maps',
  'google.com/image',
  'google.com/news',
  'gstatic.com',
  'googleapis.com',
  'accounts.google.com',
  'support.google.com',
  'policies.google.com',
  'chrome://',
  'about:',
  'blank',
];

function isGoogleInternalUrl(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  for (const pattern of GOOGLE_INTERNAL_PATTERNS) {
    if (lower.includes(pattern)) return true;
  }
  if (lower.startsWith('chrome-extension://')) return true;
  return false;
}

function getExternalDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return 'unknown';
  }
}

function getWebSocketUrl() {
  const chromeUserData = join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
  const portFile = join(chromeUserData, 'DevToolsActivePort');
  try {
    const lines = readFileSync(portFile, 'utf-8').trim().split('\n');
    const port = lines[0].trim();
    const path = lines[1].trim();
    return `ws://127.0.0.1:${port}${path}`;
  } catch {
    return null;
  }
}

/**
 * Collect all valid organic result hrefs from the current Google search page.
 * Returns an array of { href, index } for visible, non-Google anchor links.
 */
async function collectOrganicLinks(page) {
  return await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    // Primary: links inside div.r containers (standard organic results)
    const divR = document.querySelectorAll('div.r a[href]');
    for (const a of divR) {
      const href = a.href;
      if (!href || seen.has(href)) continue;
      if (href.includes('google.com') || href.includes('gstatic.com') || href.includes('googleapis.com')) continue;
      if (!href.startsWith('http')) continue;
      if (a.offsetParent === null) continue;
      seen.add(href);
      results.push({ href, selector: `a[href="${CSS.escape(href)}"]` });
    }

    // Fallback: any visible http link not pointing to Google domains
    if (results.length === 0) {
      const allLinks = document.querySelectorAll('a[href^="http"]');
      for (const a of allLinks) {
        const href = a.href;
        if (!href || seen.has(href)) continue;
        if (href.includes('google.com') || href.includes('gstatic.com') || href.includes('googleapis.com')) continue;
        if (a.offsetParent === null) continue;
        // Skip very short links (likely UI elements)
        if (a.textContent.trim().length < 5) continue;
        seen.add(href);
        results.push({ href, selector: `a[href="${CSS.escape(href)}"]` });
      }
    }

    return results;
  });
}

/**
 * Wait for the page URL to change away from Google search, with a timeout.
 * Handles Google redirect URLs (google.com/url?q=...) by waiting for final redirect.
 */
async function waitForExternalDestination(page, timeout = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const currentUrl = page.url();

    // If we're on a Google redirect URL, wait a bit for the redirect to complete
    if (currentUrl.includes('google.com/url') || currentUrl.includes('google.com/sorry')) {
      await sleep(500);
      continue;
    }

    // If we've left Google entirely, we're done
    if (!isGoogleInternalUrl(currentUrl)) {
      return currentUrl;
    }

    // Still on Google search page - navigation may not have happened yet
    await sleep(300);
  }

  return page.url();
}

/**
 * Safely click an anchor element by its href and wait for navigation.
 * Returns the final URL after navigation.
 */
async function clickAnchorAndNavigate(page, href, timeout = 15000) {
  const urlBeforeClick = page.url();

  // Build a precise selector for the anchor with this href
  const escapedHref = href.replace(/"/g, '\\"');
  const selector = `a[href="${escapedHref}"]`;

  try {
    // Try clicking the anchor directly
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout }).catch(() => null),
      page.click(selector, { timeout: 10000 }),
    ]);
  } catch {
    // Fallback: click via coordinate or JS click
    try {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.click();
      }, selector);
      await sleep(1000);
    } catch {
      // give up
    }
  }

  // Wait for final destination
  const finalUrl = await waitForExternalDestination(page, timeout);
  return finalUrl;
}

async function main() {
  const totalClicksRequested = RESEARCH_SEQUENCES.reduce((sum, s) => sum + s.clicks, 0);

  console.log('');
  console.log('========================================');
  console.log('  PARIET REALISTIC STRESS TEST');
  console.log('========================================');
  console.log('');
  console.log(`  Sequences           : ${RESEARCH_SEQUENCES.length}`);
  console.log(`  Clicks requested    : ${totalClicksRequested}`);
  console.log(`  Delay               : ${DELAY_MS}ms between actions`);
  console.log(`  Protocol timeout    : ${PROTOCOL_TIMEOUT}ms`);
  console.log('');

  const wsUrl = getWebSocketUrl();
  if (!wsUrl) {
    console.error('FAIL: Could not read DevToolsActivePort file.');
    console.error('  Ensure Chrome is running with remote debugging enabled.');
    process.exit(1);
  }
  console.log('  WebSocket:', wsUrl);

  let browser;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: wsUrl,
      protocolTimeout: PROTOCOL_TIMEOUT,
    });
  } catch (err) {
    console.error('FAIL: Could not connect to Chrome via WebSocket.');
    console.error('  Error:', err.message);
    process.exit(1);
  }
  console.log('  Connected to Chrome.');

  const pages = await browser.pages();
  console.log(`  Open tabs: ${pages.length}`);
  for (const p of pages) {
    const title = await p.title().catch(() => '');
    console.log(`    - ${p.url()}  ${title ? '(' + title.slice(0, 60) + ')' : ''}`);
  }

  // Verify Pariet extension
  const allTargets = browser.targets();
  const swTarget = allTargets.find(
    (t) => t.type() === 'service_worker' && (t.url().includes('service_worker.js') || t.url().includes('background.js'))
  );

  if (!swTarget) {
    console.log('');
    console.log('FAIL: Pariet extension service worker not found.');
    console.log('  Detected targets:');
    for (const t of allTargets) {
      console.log(`    - [${t.type()}] ${t.url()}`);
    }
    browser.disconnect();
    process.exit(1);
  }

  const extId = swTarget.url().split('/')[2];
  console.log('');
  console.log('  Pariet extension: FOUND');
  console.log('    Extension ID  :', extId);
  console.log('    Service worker:', swTarget.url());

  // Get or create a test page
  let testPage = pages.find((p) => p.url().startsWith('http://localhost:5173'));
  if (!testPage) {
    testPage = pages[pages.length - 1];
    if (!testPage || testPage.url().startsWith('chrome://')) {
      testPage = await browser.newPage();
    }
  }
  console.log('  Navigation tab:', testPage.url());

  // Statistics
  let searchesAttempted = 0;
  let actualResultClicks = 0;
  let successfulExternal = 0;
  let failedClicks = 0;
  let linkTransitions = 0;
  const successfulClicks = [];

  console.log('');
  console.log('  Starting research sequences...');
  console.log('  Each search CLICKS actual result links (transitionType="link").');
  console.log('');

  for (let i = 0; i < RESEARCH_SEQUENCES.length; i++) {
    const seq = RESEARCH_SEQUENCES[i];
    console.log(`[${i + 1}/${RESEARCH_SEQUENCES.length}] Search: "${seq.search}"`);
    searchesAttempted++;

    // Navigate to Google search
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(seq.search)}`;
    try {
      await testPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch {
      console.log('  WARNING: Search page navigation timed out, continuing...');
    }
    await sleep(DELAY_MS);

    // Collect available organic links
    const availableLinks = await collectOrganicLinks(testPage);
    const maxClickable = Math.min(seq.clicks, availableLinks.length);

    if (availableLinks.length === 0) {
      console.log('  WARNING: No organic results found, skipping');
      continue;
    }

    console.log(`  Found ${availableLinks.length} organic results, will click up to ${maxClickable}`);

    // Click each available link
    for (let j = 0; j < maxClickable; j++) {
      const linkInfo = availableLinks[j];
      const urlBefore = testPage.url();

      actualResultClicks++;

      let finalUrl;
      try {
        finalUrl = await clickAnchorAndNavigate(testPage, linkInfo.href, 15000);
      } catch (err) {
        console.log(`  WARNING: Click ${j + 1} failed: ${err.message}`);
        failedClicks++;
        // Navigate back to search results
        await testPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await sleep(DELAY_MS / 2);
        continue;
      }

      // Validate the destination
      if (!isGoogleInternalUrl(finalUrl) && finalUrl !== urlBefore) {
        successfulExternal++;
        linkTransitions++;
        const domain = getExternalDomain(finalUrl);
        console.log(`  SEARCH: "${seq.search}"`);
        console.log(`  CLICK -> ${finalUrl}`);
        successfulClicks.push({ search: seq.search, url: finalUrl, domain });
      } else {
        failedClicks++;
        console.log(`  FAILED: Click ${j + 1} stayed on Google (${finalUrl.substring(0, 80)}...)`);
      }

      await sleep(DELAY_MS);

      // Go back to search results for the next click
      if (j < maxClickable - 1) {
        try {
          await testPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        } catch {
          // If navigation fails, try goBack
          await testPage.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
        }
        await sleep(DELAY_MS / 2);

        // Re-collect links after going back (indices may have shifted)
        const refreshedLinks = await collectOrganicLinks(testPage);
        if (refreshedLinks.length === 0) {
          console.log('  WARNING: No results after going back, moving to next search');
          break;
        }
        // Update remaining links
        availableLinks.length = 0;
        availableLinks.push(...refreshedLinks);
      }
    }

    console.log('');
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('========================================');
  console.log('  STRESS TEST COMPLETE');
  console.log('========================================');
  console.log('');
  console.log(`  Searches attempted        : ${searchesAttempted}`);
  console.log(`  Actual result clicks      : ${actualResultClicks}`);
  console.log(`  Successful external dests : ${successfulExternal}`);
  console.log(`  Failed clicks             : ${failedClicks}`);
  console.log(`  Link transitions observed : ${linkTransitions}`);
  console.log('');

  if (successfulClicks.length > 0) {
    console.log('  Successful external destinations:');
    for (const c of successfulClicks) {
      console.log(`    SEARCH: "${c.search}"`);
      console.log(`    CLICK -> ${c.url}`);
    }
    console.log('');
  }

  console.log('  The Pariet extension should have captured these events.');
  console.log('  Each result click should have transitionType="link".');
  console.log('  Open Pariet to inspect the Research Map.');
  console.log('');

  browser.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

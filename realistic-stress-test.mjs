/*
  Pariet Realistic Stress Test
  ----------------------------
  Connects to an already-running Chrome instance via its DevTools WebSocket
  endpoint (read from Chrome's DevToolsActivePort file). The Chrome instance
  must have the Pariet extension loaded and remote debugging enabled.

  Produces real same-tab navigation provenance (transitionType="link",
  PAGE_TO_PAGE chains) that the Pariet extension captures.

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

// Realistic research sequences: search → result pages → next search
const RESEARCH_SEQUENCES = [
  {
    search: 'apache kafka getting started',
    pages: [
      'https://kafka.apache.org/documentation/',
      'https://kafka.apache.org/quickstart',
      'https://www.confluent.io/blog/kafka-fastest-messaging-system/',
    ]
  },
  {
    search: 'kafka exactly once semantics',
    pages: [
      'https://kafka.apache.org/documentation/streams#exactly-once',
      'https://stackoverflow.com/questions/60413717/kafka-exactly-once-delivery-semantics',
      'https://www.confluent.io/blog/exactly-once-semantics-in-apache-kafka/',
    ]
  },
  {
    search: 'redis data structures explained',
    pages: [
      'https://redis.io/docs/getting-started/',
      'https://redis.io/docs/data-types/',
      'https://redis.io/docs/data-types/stream/',
    ]
  },
  {
    search: 'redis persistence RDB vs AOF',
    pages: [
      'https://redis.io/docs/management/persistence/',
      'https://redis.io/docs/data-types/stream/',
      'https://stackoverflow.com/questions/14591798/redis-persistence-explained',
    ]
  },
  {
    search: 'postgresql indexing best practices',
    pages: [
      'https://www.postgresql.org/docs/current/tutorial.html',
      'https://www.postgresql.org/docs/current/indexes.html',
      'https://www.postgresql.org/docs/current/indexes-types.html',
    ]
  },
  {
    search: 'postgresql query optimization explain analyze',
    pages: [
      'https://www.postgresql.org/docs/current/using-explain.html',
      'https://stackoverflow.com/questions/11522638/postgresql-query-optimization',
      'https://hakibenita.com/postgresql-unused-index-size',
    ]
  },
  {
    search: 'docker best practices dockerfile',
    pages: [
      'https://docs.docker.com/get-started/dockerfile/',
      'https://docs.docker.com/build/building/best-practices/',
      'https://docs.docker.com/build/buildx/',
    ]
  },
  {
    search: 'docker multi stage build optimization',
    pages: [
      'https://docs.docker.com/build/building/multi-stage/',
      'https://github.com/moby/moby/blob/master/Dockerfile',
      'https://stackoverflow.com/questions/23677836/dockerfile-best-practices',
    ]
  },
  {
    search: 'kubernetes architecture explained',
    pages: [
      'https://kubernetes.io/docs/concepts/overview/components/',
      'https://kubernetes.io/docs/concepts/workloads/pods/',
      'https://kubernetes.io/docs/concepts/services-networking/service/',
    ]
  },
  {
    search: 'kubernetes deployment rolling update',
    pages: [
      'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/',
      'https://kubernetes.io/docs/reference/kubectl/cheatsheet/',
      'https://stackoverflow.com/questions/53285389/kubernetes-pod-scheduling-explained',
    ]
  },
  {
    search: 'java virtual threads project loom',
    pages: [
      'https://openjdk.org/projects/loom/',
      'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Thread.html',
      'https://openjdk.org/jeps/444',
    ]
  },
  {
    search: 'java CompletableFuture chaining examples',
    pages: [
      'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CompletableFuture.html',
      'https://www.baeldung.com/java-completablefuture',
      'https://stackoverflow.com/questions/38324942/java-virtual-threads-explained',
    ]
  },
];

/**
 * Read Chrome's DevToolsActivePort file to get the WebSocket endpoint.
 * Chrome writes this file when started with remote debugging enabled.
 * Format: line 1 = port, line 2 = /devtools/browser/<guid>
 */
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

async function main() {
  const totalNavs = RESEARCH_SEQUENCES.reduce((sum, s) => sum + 1 + s.pages.length, 0);

  console.log('');
  console.log('========================================');
  console.log('  PARIET REALISTIC STRESS TEST');
  console.log('========================================');
  console.log('');
  console.log(`  Sequences  : ${RESEARCH_SEQUENCES.length}`);
  console.log(`  Total navs : ${totalNavs}`);
  console.log(`  Delay      : ${DELAY_MS}ms between navigations`);
  console.log('');

  // ── Read WebSocket URL from DevToolsActivePort ──────────────────────────
  const wsUrl = getWebSocketUrl();
  if (!wsUrl) {
    console.error('FAIL: Could not read DevToolsActivePort file.');
    console.error('  Ensure Chrome is running with remote debugging enabled.');
    process.exit(1);
  }
  console.log('  WebSocket:', wsUrl);

  // ── Connect to existing Chrome ──────────────────────────────────────────
  let browser;
  try {
    browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
  } catch (err) {
    console.error('FAIL: Could not connect to Chrome via WebSocket.');
    console.error('  Error:', err.message);
    process.exit(1);
  }
  console.log('  Connected to Chrome.');

  // ── List existing tabs ──────────────────────────────────────────────────
  const pages = await browser.pages();
  console.log(`  Open tabs: ${pages.length}`);
  for (const p of pages) {
    const title = await p.title().catch(() => '');
    console.log(`    - ${p.url()}  ${title ? '(' + title.slice(0, 60) + ')' : ''}`);
  }

  // ── Verify Pariet extension is present ──────────────────────────────────
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
  console.log('    Extension ID :', extId);
  console.log('    Service worker:', swTarget.url());

  // ── Get or create a page for navigation ─────────────────────────────────
  let testPage = pages.find((p) => p.url().startsWith('http://localhost:5173'));
  if (!testPage) {
    testPage = pages[pages.length - 1];
    if (!testPage || testPage.url().startsWith('chrome://')) {
      testPage = await browser.newPage();
    }
  }
  console.log('  Navigation tab:', testPage.url());

  // ── Run research sequences ──────────────────────────────────────────────
  console.log('');
  console.log('  Starting research sequences...');
  let totalNavigations = 0;

  for (let i = 0; i < RESEARCH_SEQUENCES.length; i++) {
    const seq = RESEARCH_SEQUENCES[i];
    console.log(`\n  [${i + 1}/${RESEARCH_SEQUENCES.length}] Search: "${seq.search}"`);

    // Navigate to Google search (same tab)
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(seq.search)}`;
    console.log(`    → ${searchUrl}`);
    await testPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    totalNavigations++;
    await sleep(DELAY_MS);

    // Visit each result page in the same tab
    for (let j = 0; j < seq.pages.length; j++) {
      const url = seq.pages[j];
      console.log(`    → ${url}`);
      await testPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      totalNavigations++;
      await sleep(DELAY_MS);
    }
  }

  // ── Done ────────────────────────────────────────────────────────────────
  console.log('');
  console.log('========================================');
  console.log('  STRESS TEST COMPLETE');
  console.log('========================================');
  console.log('');
  console.log(`  Total navigations: ${totalNavigations}`);
  console.log('  The Pariet extension should have captured these events.');
  console.log('  Open Pariet to inspect the Research Map.');
  console.log('');

  // Disconnect (do NOT close the browser)
  browser.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

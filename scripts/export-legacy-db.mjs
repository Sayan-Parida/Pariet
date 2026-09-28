/**
 * Export the legacy SQLite database to JSON.
 *
 * The Spring backend is being removed, and it is the only thing that can read
 * backend/data/trak.db. This dumps its contents to a plain JSON file first so
 * the research is not lost with the code.
 *
 * The output is deliberately gitignored: it contains real browsing history.
 *
 *   node scripts/export-legacy-db.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dbPath = join(root, 'backend', 'data', 'trak.db');
const outPath = join(root, 'data-export', 'legacy-research.json');

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`);
  console.error('Nothing to export.');
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

const read = (sql) => {
  try {
    return db.prepare(sql).all();
  } catch (error) {
    console.warn(`  skipped query (${error.message.slice(0, 60)})`);
    return [];
  }
};

const sessions = read('SELECT * FROM research_session ORDER BY start_time');
const events = read('SELECT * FROM browser_event ORDER BY timestamp');
const pages = read('SELECT * FROM page_visit ORDER BY first_visited');
const searches = read('SELECT * FROM search_query ORDER BY timestamp');

const payload = {
  exportedAt: new Date().toISOString(),
  source: 'legacy SQLite backend (backend/data/trak.db)',
  note: 'Contains real browsing history. Keep private; this path is gitignored.',
  counts: {
    sessions: sessions.length,
    events: events.length,
    pages: pages.length,
    searches: searches.length
  },
  sessions,
  events,
  pages,
  searches
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

db.close();

console.log('Exported:');
console.log(`  ${sessions.length} sessions, ${events.length} events, ${pages.length} pages, ${searches.length} searches`);
console.log(`  -> ${outPath}`);

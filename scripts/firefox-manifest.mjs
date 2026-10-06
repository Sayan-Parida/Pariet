/**
 * Rewrite the built manifest.json for Firefox (addons.mozilla.org).
 *
 * Chrome and Firefox both read the same extension folder, but want different
 * keys: Chrome requires `background.service_worker`, Firefox requires
 * `background.scripts` plus a `browser_specific_settings.gecko` block. The
 * code itself needs no changes — every API Pariet uses (runtime, tabs,
 * webNavigation, windows, storage, IndexedDB) works in both.
 *
 * Run after the normal build: `npm run build && node scripts/firefox-manifest.mjs`
 *
 * Firefox generates the add-on ID itself on first submission and keeps it;
 * AMO requires the ID field to stay out of the manifest for updates to work.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, '..', 'extension', 'dist', 'manifest.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

delete manifest.background.service_worker;
manifest.background = { scripts: ['background.js'] };

// The ID is a placeholder: AMO generates the permanent add-on ID on first
// upload and sends it back in the signed package. Keep this key, but never
// commit a real ID here — a mismatched ID on a resubmission reads as a
// different add-on.
//
// `data_collection_permissions` is required for all new AMO submissions
// (since Nov 2025). Pariet stores everything in local IndexedDB and never
// sends data off the machine, so `required: ["none"]` is the honest answer.
manifest.browser_specific_settings = {
  gecko: {
    id: 'pariet@example.com',
    data_collection_permissions: {
      required: ['none']
    },
    strict_min_version: '109.0'
  }
};

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('Firefox manifest written:');
console.log(`  background.scripts: ${JSON.stringify(manifest.background.scripts)}`);
console.log(`  gecko.id: ${manifest.browser_specific_settings.gecko.id}`);
console.log(`  gecko.data_collection_permissions: ${JSON.stringify(manifest.browser_specific_settings.gecko.data_collection_permissions)}`);
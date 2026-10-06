/**
 * Package the built extension into a zip for manual installation.
 *
 * Friends can install an unpacked extension by pointing Chrome at a folder, but
 * Chrome will not load one from a .zip directly. So the zip here contains the
 * built files at the top level: your friend unzips it, gets a folder, and loads
 * that. No Node.js or npm needed on their side.
 *
 *   npm run package            -> pariet-<version>.zip (Chrome)
 *   npm run package:firefox    -> pariet-<version>-firefox.zip (Firefox/AMO)
 *
 * Writes at the repo root, where .gitignore already keeps *.zip out of git.
 * The version comes from extension/manifest.json so the zip can never disagree
 * with the build.
 *
 * The Firefox zip rewrites dist/manifest.json first (see firefox-manifest.mjs),
 * so package the Chrome zip before the Firefox one if you run both — or just
 * rebuild in between. `npm run package` never touches the manifest.
 */
import { readFileSync, existsSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const distDir = join(root, 'extension', 'dist');

if (!existsSync(join(distDir, 'manifest.json'))) {
  console.error('No build found at extension/dist.');
  console.error('Run `npm run build` first.');
  process.exit(1);
}

const target = process.argv[2] === 'firefox' ? 'firefox' : 'chrome';

const { version } = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'));
const zipName = target === 'firefox' ? `pariet-${version}-firefox.zip` : `pariet-${version}.zip`;
const zipPath = join(root, zipName);

// Rebuild from scratch every time so a deleted file cannot survive in the zip.
if (existsSync(zipPath)) rmSync(zipPath);

// Collect files, because `zip -r . dist` would nest everything under a dist/ folder
// and Chrome would not find manifest.json where it expects it.
const entries = [];
const walk = (dir, prefix = '') => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) walk(full, rel);
    else entries.push(rel);
  }
};
walk(distDir);

const windows = process.platform === 'win32';

// One invocation, whole file list. On Windows `tar -a -c -f` replaces the archive
// rather than appending, and silently ignored the .zip extension, so --format zip
// is explicit here. `*` avoids the '.' entry that bsdtar rejects in zip format.
if (windows) {
  execFileSync('tar.exe', ['--format', 'zip', '-c', '-f', zipPath, '*'], { cwd: distDir, stdio: 'inherit' });
} else {
  execFileSync('zip', ['-q', '-r', zipPath, '.'], { cwd: distDir, stdio: 'inherit' });
}

console.log(`Packaged ${entries.length} files`);
console.log(`  -> ${zipPath}`);
console.log('');
if (target === 'firefox') {
  console.log('Upload this file at https://addons.mozilla.org/developers/addon/submit/distribution');
  console.log('AMO signs it and either lists it or returns a signed copy for self-distribution.');
} else {
  console.log('To install: unzip it somewhere permanent, then in Chrome go to');
  console.log('chrome://extensions, turn on Developer mode, and click Load unpacked');
  console.log('picking the folder you unzipped.');
}
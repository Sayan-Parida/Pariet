/**
 * Verify the README install path from a clean clone, exactly as written.
 */
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmp = mkdtempSync(join(tmpdir(), 'pariet-clone-'));
const run = (cmd, cwd) => {
  console.log(`  $ ${cmd}`);
  try {
    execSync(cmd, { cwd, stdio: 'pipe', timeout: 1200000 });
    return true;
  } catch (e) {
    const out = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
    console.log('    FAILED:', String(e.message).split('\n')[0].slice(0, 100));
    const hint = out.split('\n').filter((l) => /error|ERR!/i.test(l)).slice(0, 3);
    hint.forEach((l) => console.log('      ' + l.trim().slice(0, 110)));
    return false;
  }
};

let failed = false;
try {
  console.log('--- clone ---');
  if (!run('git clone --depth 1 https://github.com/Sayan-Parida/Pariet.git repo', tmp)) {
    console.log('CLONE_FAILED (is the README change pushed yet?)');
    failed = true;
  } else {
    const repo = join(tmp, 'repo');
    console.log('--- npm install ---');
    if (!run('npm install', repo)) failed = true;
    console.log('--- npm run build ---');
    if (!run('npm run build', repo)) failed = true;

    console.log('--- dist loadable? ---');
    const dist = join(repo, 'extension', 'dist');
    const mp = join(dist, 'manifest.json');
    if (!existsSync(mp)) { console.log('  no manifest.json'); failed = true; }
    else {
      const m = JSON.parse(readFileSync(mp, 'utf8'));
      console.log('  name:', m.name, '| version:', m.version);
      for (const f of ['background.js', 'popup.html', 'popup.js', 'dashboard/index.html']) {
        const ok = existsSync(join(dist, f));
        console.log(`  ${ok ? 'ok     ' : 'MISSING'} ${f}`);
        if (!ok) failed = true;
      }
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? '\nINSTALL_PATH_BROKEN' : '\nINSTALL_PATH_VERIFIED');
process.exit(failed ? 1 : 0);

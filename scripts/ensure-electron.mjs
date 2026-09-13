import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Electron's npm package carries its platform binary in a separate download
 * step. pnpm does not run it for us — the published package declares no install
 * script it can hook — so a fresh `pnpm install` leaves node_modules without the
 * binary and `pnpm dev` fails with "Electron uninstall". This puts it in place.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'apps', 'desktop', 'package.json'));

let manifest;
try {
  manifest = require.resolve('electron/package.json');
} catch {
  process.exit(0); // Electron is not installed in this checkout; nothing to do.
}

const dir = path.dirname(manifest);
if (existsSync(path.join(dir, 'path.txt'))) process.exit(0);

const installer = path.join(dir, 'install.js');
if (!existsSync(installer)) process.exit(0);

console.log('Electron 바이너리를 내려받습니다…');
execFileSync(process.execPath, [installer], { cwd: dir, stdio: 'inherit' });

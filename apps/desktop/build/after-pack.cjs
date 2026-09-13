'use strict';
const { execFileSync } = require('node:child_process');

/**
 * Flipping Electron fuses rewrites the binary, which invalidates whatever
 * signature it already carried. On Apple silicon the kernel then refuses to run
 * it at all (SIGKILL, no output), so an unsigned local build has to be re-signed
 * ad hoc afterwards. A real release signs with a Developer ID instead, and
 * electron-builder does that after this hook runs.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const app = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log(`  • re-signed ad hoc after fuses  app=${app}`);
};

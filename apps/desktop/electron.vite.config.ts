import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Everything except Electron and Node builtins is bundled into main/preload.
 * The workspace packages ship TypeScript sources, so they must not be left as
 * bare `require()` calls, and a self-contained bundle keeps packaging simple.
 */
const external = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

const alias = {
  '@grok-desktop/shared/channels': `${workspaceRoot}packages/shared/src/channels.ts`,
  '@grok-desktop/shared': `${workspaceRoot}packages/shared/src/index.ts`,
  '@grok-desktop/security': `${workspaceRoot}packages/security/src/index.ts`,
  '@grok-desktop/acp-client': `${workspaceRoot}packages/acp-client/src/index.ts`,
};

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      sourcemap: true,
      rollupOptions: {
        external,
        input: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
      },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      sourcemap: true,
      rollupOptions: {
        external,
        input: fileURLToPath(new URL('./src/preload/index.ts', import.meta.url)),
      },
    },
  },
  renderer: {
    root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
    // Renderer only ever imports @grok-desktop/shared; main-only packages are
    // blocked by lint so they can never reach the sandboxed window.
    resolve: { alias: { '@grok-desktop/shared': alias['@grok-desktop/shared'] } },
    plugins: [react()],
    server: {
      fs: { allow: [workspaceRoot] },
    },
    build: {
      // Keep the renderer next to main/preload so the packaged app can find it.
      outDir: fileURLToPath(new URL('./out/renderer', import.meta.url)),
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)),
      },
    },
  },
});

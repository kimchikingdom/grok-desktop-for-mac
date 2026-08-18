import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const alias = {
  '@grok-desktop/shared': r('./packages/shared/src/index.ts'),
  '@grok-desktop/security': r('./packages/security/src/index.ts'),
  '@grok-desktop/acp-client': r('./packages/acp-client/src/index.ts'),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts', 'apps/desktop/src/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'security',
          environment: 'node',
          include: ['tests/security/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['tests/e2e/**/*.test.ts'],
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
    ],
  },
});

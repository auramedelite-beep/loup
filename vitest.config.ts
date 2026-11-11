import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    external: ['node:sqlite'],
  },
  test: {
    environment: 'node',
    include: ['server/src/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    server: {
      deps: {
        external: ['node:sqlite'],
      },
    },
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});

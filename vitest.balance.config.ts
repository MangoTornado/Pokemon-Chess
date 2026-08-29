import { defineConfig } from 'vitest/config';

/**
 * The balance measurements, which the default config deliberately excludes.
 *
 * They take minutes by necessity — a smaller sample proves nothing about a search-depth edge, and shortening
 * the games ends most of them in a capped draw, which drowns the signal. So they are opt-in
 * (`npm run test:balance`) rather than a tax on every `npm test`.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.slow.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
  },
});

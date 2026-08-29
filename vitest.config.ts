import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts'],
    // `*.slow.test.ts` are balance measurements that take minutes by necessity (a smaller sample proves
    // nothing, and a shorter game length ends most games in a capped draw). They run via `npm run
    // test:balance`, so the ordinary loop stays fast.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.slow.test.ts'],
    environment: 'node',
  },
});

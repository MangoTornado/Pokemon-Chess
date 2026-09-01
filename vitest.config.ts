import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts'],
    // `*.slow.test.ts` are balance measurements that take minutes by necessity (a smaller sample proves
    // nothing, and a shorter game length ends most games in a capped draw). They run via `npm run
    // test:balance`, so the ordinary loop stays fast.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.slow.test.ts'],
    environment: 'node',
    /**
     * Vitest defaults to 5 s, which is a unit-test budget. The smallest unit of work in much of this suite is
     * "simulate a game of Pokemon Chess" — a full gym battle, a 90-ply fuzz, a real negamax search — so tests that
     * are perfectly healthy sat right at that line and tipped over it whenever the machine was busy. That failed
     * about half of runs in three separate files, and it reads as noise rather than as the expense it actually is;
     * an external reviewer twice reported this suite as failing while it passed locally.
     *
     * Raised once here rather than sprinkled per file, so a new simulation test inherits a sane budget instead of
     * discovering this the hard way. A genuinely hung test still fails, just later.
     */
    testTimeout: 60_000,
  },
});

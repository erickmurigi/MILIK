import { defineConfig } from "vitest/config";

// Plain Node environment (no DOM/jsdom) — this is a backend-only API.
// setupFiles runs test/setup.js before every test file: it boots the in-memory
// Mongo, connects mongoose, sets dummy env vars, and wires the afterEach/afterAll
// hooks that clear collections and tear everything down.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./test/setup.js"],
    include: ["**/*.test.js"],
    exclude: ["node_modules", "MilikClient/**"],
    // Cold-starting mongod + mongoose per file adds up; a single worker keeps
    // the in-memory server/connection shared across the whole run.
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

// Global Vitest setup (wired via vitest.config.js -> test.setupFiles).
// Runs once per worker before any test file's imports resolve, so every
// dummy env var below MUST be set here — before any test file imports
// application code that reads process.env at call time (JWT_SECRET etc).
//
// Individual test files don't need to import anything from here — just
// write `describe`/`it` as normal (globals: true) and the DB is ready.
// Collections are wiped after every test automatically (afterEach below).

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-do-not-use-in-prod";
process.env.NODE_ENV = "test";
process.env.MILIK_ADMIN_EMAIL = process.env.MILIK_ADMIN_EMAIL || "admin@test.local";
process.env.MILIK_ADMIN_NAME = process.env.MILIK_ADMIN_NAME || "Milik Test";
process.env.EMAIL_ENABLED = "false";

import { afterAll, afterEach, beforeAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

let mongod;

beforeAll(async () => {
  // A single-node REPLICA SET, not a plain standalone MongoMemoryServer — this
  // codebase's ledger posting (services/ledgerPostingService.js) uses real Mongo
  // sessions/transactions, which MongoDB only allows on a replica set or mongos.
  // A standalone instance fails every transactional write with
  // "Transaction numbers are only allowed on a replica set member or mongos".
  //
  // launchTimeout above the mongodb-memory-server default (10s) — a cold/slow
  // disk (first-run binary extraction, constrained CI/sandbox CPU) can take
  // mongod noticeably longer than that just to report "waiting for connections".
  mongod = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ launchTimeout: 120000 }],
  });
  await mongoose.connect(mongod.getUri(), { dbName: "milik-test" });
}, 150000);

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}, 60000);

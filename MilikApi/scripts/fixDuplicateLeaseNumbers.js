/**
 * fixDuplicateLeaseNumbers.js
 *
 * Problem: Old parallel imports created multiple Lease documents for the SAME
 * business with the SAME agreementNumber (e.g., two leases both have
 * "AGR-202606-0001"). This causes a MongoDB unique index conflict whenever
 * a tenant edit tries to save the active lease.
 *
 * What this script does:
 *  1. Finds every (business, agreementNumber) combination that has more than one lease.
 *  2. For each duplicate group, keeps the "best" lease unchanged:
 *       priority: active > draft > pending_signature > terminated > other
 *       tie-break: newest (createdAt desc)
 *  3. Clears agreementNumber="" on all others so they fall out of the unique index.
 *  4. Regenerates unique agreement numbers for the cleared leases (sequential, one-by-one).
 *  5. Prints a full summary and DELETES ITSELF on success.
 *
 * Run from the project root:
 *   node MilikApi/scripts/fixDuplicateLeaseNumbers.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import fs from "fs";

dotenv.config();

const MONGO_URI = process.env.MONGO_URL;
if (!MONGO_URI) {
  console.error("MONGO_URL env variable is not set. Aborting.");
  process.exit(1);
}

// ── Minimal inline schemas (avoids importing the full app) ───────────────────

const LeaseSchema = new mongoose.Schema(
  {
    business:        { type: mongoose.Schema.Types.ObjectId },
    tenant:          { type: mongoose.Schema.Types.ObjectId },
    agreementNumber: { type: String, trim: true, default: "" },
    status:          { type: String, default: "active" },
  },
  { timestamps: true }
);

LeaseSchema.index(
  { business: 1, agreementNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { agreementNumber: { $type: "string", $ne: "" } },
  }
);

const Lease = mongoose.models.Lease || mongoose.model("Lease", LeaseSchema);

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_PRIORITY = { active: 0, draft: 1, pending_signature: 2, terminated: 3 };
const statusRank = (s) => STATUS_PRIORITY[s] ?? 99;

const buildPrefix = (dateValue = new Date()) => {
  const d = new Date(dateValue);
  return `AGR-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}-`;
};

const escapeRegExp = (v = "") => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function generateNextNumber(businessId, prefix) {
  const re = new RegExp(`^${escapeRegExp(prefix)}\\d+$`);
  const latest = await Lease.findOne(
    { business: businessId, agreementNumber: { $regex: re } },
    { agreementNumber: 1 }
  ).sort({ agreementNumber: -1 }).lean();
  const seq = latest?.agreementNumber
    ? Number(String(latest.agreementNumber).split("-").pop()) || 0
    : 0;
  return `${prefix}${String(seq + 1).padStart(4, "0")}`;
}

async function assignFreshNumber(lease, prefix, maxTries = 30) {
  for (let i = 0; i < maxTries; i++) {
    const num = await generateNextNumber(lease.business, prefix);
    try {
      await Lease.updateOne({ _id: lease._id }, { $set: { agreementNumber: num } });
      return num;
    } catch (err) {
      if (err?.code !== 11000) throw err;
      // Another doc grabbed that number — loop and try the next one
    }
  }
  throw new Error(`Could not assign a unique number after ${maxTries} attempts for lease ${lease._id}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB.\n");

  // Find all (business, agreementNumber) groups with more than 1 lease
  const duplicates = await Lease.aggregate([
    { $match: { agreementNumber: { $ne: "" } } },
    { $group: { _id: { business: "$business", agreementNumber: "$agreementNumber" }, count: { $sum: 1 }, ids: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (duplicates.length === 0) {
    console.log("No duplicate agreementNumbers found. Database is clean.");
    await mongoose.disconnect();
    const __filename = fileURLToPath(import.meta.url);
    fs.unlinkSync(__filename);
    return;
  }

  console.log(`Found ${duplicates.length} duplicate agreementNumber group(s).\n`);

  let totalCleared = 0;
  let totalReassigned = 0;
  let totalFailed = 0;

  for (const group of duplicates) {
    const { business, agreementNumber } = group._id;

    // Load the full docs to rank them
    const leases = await Lease.find({ business, agreementNumber }).sort({ createdAt: -1 }).lean();

    // Sort: best status first, then newest
    leases.sort((a, b) => {
      const sr = statusRank(a.status) - statusRank(b.status);
      return sr !== 0 ? sr : new Date(b.createdAt) - new Date(a.createdAt);
    });

    const [keeper, ...losers] = leases;

    console.log(`  Group: ${agreementNumber} (business ${business})`);
    console.log(`    Keeping  : ${keeper._id} [${keeper.status}] tenant=${keeper.tenant}`);

    for (const loser of losers) {
      // Clear the agreementNumber so it falls out of the unique index
      await Lease.updateOne({ _id: loser._id }, { $set: { agreementNumber: "" } });
      totalCleared++;
      console.log(`    Cleared  : ${loser._id} [${loser.status}] tenant=${loser.tenant}`);
    }

    // Regenerate unique numbers for cleared leases (one-by-one to avoid race)
    for (const loser of losers) {
      const prefix = buildPrefix(loser.createdAt || new Date());
      try {
        const newNum = await assignFreshNumber(loser, prefix);
        totalReassigned++;
        console.log(`    Reassigned: ${loser._id} → ${newNum}`);
      } catch (err) {
        totalFailed++;
        console.error(`    FAILED to reassign ${loser._id}: ${err.message}`);
      }
    }
  }

  console.log(`\nDone.`);
  console.log(`  Cleared  : ${totalCleared} lease(s)`);
  console.log(`  Reassigned: ${totalReassigned} lease(s)`);
  console.log(`  Failed   : ${totalFailed} lease(s)\n`);

  await mongoose.disconnect();

  const __filename = fileURLToPath(import.meta.url);
  fs.unlinkSync(__filename);
  console.log("Script deleted itself. Cleanup complete.");
}

run().catch((err) => {
  console.error("Script failed:", err);
  mongoose.disconnect();
  process.exit(1);
});

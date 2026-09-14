import mongoose from "mongoose";
import dotenv from "dotenv";
import ProcessedStatement from "../models/ProcessedStatement.js";
import LandlordStatementTenantBalance from "../models/LandlordStatementTenantBalance.js";
import Property from "../models/Property.js";
import { computeTenantInvoiceSnapshotsBatch } from "../controllers/propertyController/tenantInvoices.js";
import { round2 } from "../utils/math.js";

dotenv.config();

// Only these two categories feed the rent-ledger balanceCF chain in
// landlordStatementService.js (see getReceiptRentLedgerCash / row.balanceCF) — deposit and
// late-penalty charges are tracked as separate liability buckets, never folded into this
// number, so they're deliberately excluded here to compare like with like.
const RENT_LEDGER_CATEGORIES = new Set(["RENT_CHARGE", "UTILITY_CHARGE"]);
const DEPOSIT_MEMO_KEYS = new Set(["__deposit:manager__", "__deposit:landlord__"]);
const TOLERANCE = 0.01;

const getArg = (name) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");

  const businessArg = getArg("business");
  const apply = hasFlag("apply");

  await mongoose.connect(mongoUrl);

  // ── Step 1: find the current "chain head" per property — the LandlordStatementTenantBalance
  // rows belonging to each property's most recently PROCESSED statement. That's the only
  // record that matters: it's what the next generated statement's Bal B/F will read.
  const processedQuery = {};
  if (businessArg) processedQuery.business = businessArg;

  const latestProcessedPerProperty = await ProcessedStatement.aggregate([
    { $match: processedQuery },
    { $sort: { cutoffAt: -1 } },
    {
      $group: {
        _id: "$property",
        statementId: { $first: "$sourceStatement" },
        business: { $first: "$business" },
        landlord: { $first: "$landlord" },
        cutoffAt: { $first: "$cutoffAt" },
        periodEnd: { $first: "$periodEnd" },
      },
    },
  ]);

  console.log(`Found ${latestProcessedPerProperty.length} propert(y/ies) with a processed statement.`);

  const propertyIds = latestProcessedPerProperty.map((p) => String(p._id));
  const properties = await Property.find({ _id: { $in: propertyIds } }).select("propertyName name").lean();
  const propertyNameMap = new Map(properties.map((p) => [String(p._id), p.propertyName || p.name || String(p._id)]));

  const divergences = [];
  let rowsChecked = 0;

  for (const head of latestProcessedPerProperty) {
    if (!head.statementId) continue;

    const balanceRows = await LandlordStatementTenantBalance.find({ statement: head.statementId })
      .select("_id tenant tenantKey balanceCF periodEnd")
      .lean();

    const tenantRows = balanceRows.filter((r) => !DEPOSIT_MEMO_KEYS.has(r.tenantKey) && r.tenant);
    if (tenantRows.length === 0) continue;

    const tenantIds = tenantRows.map((r) => String(r.tenant));
    const asOfDate = head.cutoffAt || head.periodEnd;

    const snapshotMap = await computeTenantInvoiceSnapshotsBatch({
      businessId: String(head.business),
      tenantIds,
      asOfDate,
      invoiceQuery: {},
    });

    for (const row of tenantRows) {
      rowsChecked += 1;
      const snapshot = snapshotMap.get(String(row.tenant)) || { invoiceSnapshots: [] };
      const groundTruth = round2(
        (snapshot.invoiceSnapshots || [])
          .filter((inv) => RENT_LEDGER_CATEGORIES.has(String(inv.category || "").toUpperCase()))
          .reduce((sum, inv) => sum + Number(inv.outstanding || 0), 0)
      );

      const stored = round2(Number(row.balanceCF || 0));
      const diff = round2(stored - groundTruth);

      if (Math.abs(diff) > TOLERANCE) {
        divergences.push({
          property: propertyNameMap.get(String(head._id)) || String(head._id),
          tenantKey: row.tenantKey,
          balanceRowId: String(row._id),
          storedBalanceCF: stored,
          liveGroundTruth: groundTruth,
          diff,
          asOfDate: asOfDate ? new Date(asOfDate).toISOString().slice(0, 10) : null,
        });
      }
    }
  }

  console.log(`Checked ${rowsChecked} tenant balance row(s) across ${latestProcessedPerProperty.length} propert(y/ies).`);
  console.log(`Found ${divergences.length} divergence(s) beyond Ksh ${TOLERANCE} tolerance.`);

  if (divergences.length > 0) {
    console.table(
      divergences.map((d) => ({
        property: d.property,
        tenantKey: d.tenantKey,
        storedBalanceCF: d.storedBalanceCF,
        liveGroundTruth: d.liveGroundTruth,
        diff: d.diff,
        asOfDate: d.asOfDate,
      }))
    );
  }

  if (!apply || divergences.length === 0) {
    console.log(apply ? "Nothing to update." : "Dry run only. Re-run with --apply to persist corrections.");
    await mongoose.disconnect();
    return;
  }

  const bulkOps = divergences.map((d) => ({
    updateOne: {
      filter: { _id: d.balanceRowId },
      update: { $set: { balanceCF: d.liveGroundTruth } },
    },
  }));

  const result = await LandlordStatementTenantBalance.bulkWrite(bulkOps, { ordered: false });
  console.log(`Corrected ${result.modifiedCount || 0} chain-head balance row(s).`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Landlord statement balance reconciliation failed:", error);
  try {
    await mongoose.disconnect();
  } catch (_error) {
    // ignore disconnect cleanup issue
  }
  process.exit(1);
});

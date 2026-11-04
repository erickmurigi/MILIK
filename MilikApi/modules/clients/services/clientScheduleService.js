// Keeps each contract's persisted billing schedule (ClientBillingSchedule rows) in step with the
// contract: lines, versions, billing day, proration, suspension and termination. Rows already
// invoiced are never touched; rows still scheduled/held are re-priced or cancelled as the contract
// changes. All the date/amount arithmetic lives in clientLineMath.buildContractSchedule.
import ClientBillingSchedule from "../models/ClientBillingSchedule.js";
import ClientContractVersion from "../models/ClientContractVersion.js";
import { buildContractSchedule, calculateLineAmounts, toUTCDate } from "./clientLineMath.js";
import { addMonthsPreservingDayUTC } from "../../../services/billingPeriodService.js";
import { getClientTaxContext, resolveClientLineTax } from "./clientTaxService.js";
import { createError } from "../../../utils/error.js";

const UNBILLABLE_CONTRACT_STATUSES = new Set(["draft", "pending_approval", "cancelled"]);
const MUTABLE_ROW_STATUSES = new Set(["scheduled", "held", "cancelled"]);
export const OPEN_ENDED_HORIZON_MONTHS = 12;

export const loadContractVersions = async (contract) => {
  const versions = await ClientContractVersion.find({ contract: contract._id, status: { $in: ["applied", "superseded"] } })
    .select("version effectiveDate snapshot.lines")
    .sort({ effectiveDate: 1, version: 1 })
    .lean();
  return versions.map((v) => ({ version: v.version, effectiveDate: v.effectiveDate, lines: v.snapshot?.lines || [] }));
};

const horizonFor = (contract, asOf = new Date()) => {
  if (!contract.openEnded && contract.endDate) return null;
  const base = toUTCDate(asOf) > toUTCDate(contract.startDate) ? toUTCDate(asOf) : toUTCDate(contract.startDate);
  return addMonthsPreservingDayUTC(base, OPEN_ENDED_HORIZON_MONTHS);
};

const priceRow = (row, taxCtx, taxMode) => {
  const tax = resolveClientLineTax(taxCtx, row.taxCodeKey);
  const calc = calculateLineAmounts({ ...row, ...tax, taxMode });
  return { netAmount: calc.netAmount, taxAmount: calc.taxAmount, totalAmount: calc.totalAmount };
};

const sameValue = (a, b) => (a instanceof Date || b instanceof Date
  ? new Date(a || 0).getTime() === new Date(b || 0).getTime()
  : String(a ?? "") === String(b ?? ""));

const ROW_FIELDS = [
  "contractVersion", "from", "to", "billingDate", "prorationFactor", "itemName", "description", "quantity",
  "unitPrice", "discountPercent", "taxCodeKey", "billingFrequency", "billingTiming", "revenueRecognition",
  "incomeAccount", "netAmount", "taxAmount", "totalAmount",
];

export const syncContractSchedule = async ({ contract, asOf = new Date(), taxCtx = null } = {}) => {
  if (!contract?._id) throw createError(400, "Contract is required to build a schedule");

  const existing = await ClientBillingSchedule.find({ business: contract.business, contract: contract._id }).lean();
  const existingByKey = new Map(existing.map((r) => [r.idempotencyKey, r]));

  if (UNBILLABLE_CONTRACT_STATUSES.has(contract.status)) {
    const stale = existing.filter((r) => ["scheduled", "held"].includes(r.status)).map((r) => r._id);
    if (stale.length) {
      await ClientBillingSchedule.updateMany({ _id: { $in: stale } }, { $set: { status: "cancelled", statusReason: `Contract ${contract.status}`, statusChangedAt: new Date() } });
    }
    return { created: 0, updated: 0, cancelled: stale.length };
  }

  const ctx = taxCtx || (await getClientTaxContext(contract.business));
  const versions = await loadContractVersions(contract);
  const desired = buildContractSchedule({ contract, versions, horizonEnd: horizonFor(contract, asOf) });
  const suspendedFrom = contract.status === "suspended" && contract.suspendedAt ? toUTCDate(contract.suspendedAt) : null;

  const ops = [];
  let created = 0;
  let updated = 0;
  const desiredKeys = new Set();

  for (const row of desired) {
    desiredKeys.add(row.idempotencyKey);
    const priced = { ...row, ...priceRow(row, ctx, contract.taxMode) };
    const current = existingByKey.get(row.idempotencyKey);

    if (!current) {
      const held = suspendedFrom && priced.from >= suspendedFrom;
      ops.push({
        insertOne: {
          document: {
            ...priced,
            business: contract.business,
            client: contract.client,
            contract: contract._id,
            status: held ? "held" : "scheduled",
            holdSource: held ? "suspension" : null,
            statusReason: held ? "Contract suspended" : "",
          },
        },
      });
      created += 1;
      continue;
    }
    if (!MUTABLE_ROW_STATUSES.has(current.status)) continue;

    const $set = {};
    for (const field of ROW_FIELDS) {
      if (!sameValue(current[field], priced[field])) $set[field] = priced[field];
    }
    // A row cut by an earlier amendment/termination that is back in the plan becomes billable again.
    if (current.status === "cancelled") {
      $set.status = "scheduled";
      $set.statusReason = "";
    }
    if (Object.keys($set).length) {
      ops.push({ updateOne: { filter: { _id: current._id, status: current.status }, update: { $set } } });
      updated += 1;
    }
  }

  let cancelled = 0;
  for (const row of existing) {
    if (desiredKeys.has(row.idempotencyKey) || !["scheduled", "held"].includes(row.status)) continue;
    ops.push({
      updateOne: {
        filter: { _id: row._id, status: row.status },
        update: { $set: { status: "cancelled", statusReason: contract.terminationEffectiveDate ? "Contract terminated" : "No longer in the contract schedule", statusChangedAt: new Date() } },
      },
    });
    cancelled += 1;
  }

  if (ops.length) {
    try {
      await ClientBillingSchedule.bulkWrite(ops, { ordered: false });
    } catch (err) {
      // Two syncs racing (cron + manual) both try to insert the same new period; the unique
      // idempotencyKey keeps one, which is the outcome we want — only re-throw real failures.
      const writeErrors = err?.writeErrors || err?.result?.result?.writeErrors || [];
      const onlyDuplicates = writeErrors.length > 0 && writeErrors.every((e) => e.code === 11000 || e.err?.code === 11000);
      if (!(err?.code === 11000 || onlyDuplicates)) throw err;
    }
  }
  return { created, updated, cancelled };
};

// ─── Suspension ───────────────────────────────────────────────────────────────
// Periods starting on/after the suspension date are held. On resume, those that started before the
// resume date are skipped (the service wasn't provided) and the rest go back to scheduled.
export const holdScheduleForSuspension = ({ contract, from }) =>
  ClientBillingSchedule.updateMany(
    { business: contract.business, contract: contract._id, status: "scheduled", from: { $gte: toUTCDate(from) } },
    { $set: { status: "held", holdSource: "suspension", statusReason: "Contract suspended", statusChangedAt: new Date() } }
  );

export const releaseScheduleAfterSuspension = async ({ contract, resumeDate, userId }) => {
  const resume = toUTCDate(resumeDate);
  const base = { business: contract.business, contract: contract._id, status: "held", holdSource: "suspension" };
  const now = new Date();
  const [skipped, released] = await Promise.all([
    ClientBillingSchedule.updateMany(
      { ...base, from: { $lt: resume } },
      { $set: { status: "skipped", holdSource: null, statusReason: "Not billed — contract was suspended", statusChangedBy: userId || null, statusChangedAt: now } }
    ),
    ClientBillingSchedule.updateMany(
      { ...base, from: { $gte: resume } },
      { $set: { status: "scheduled", holdSource: null, statusReason: "", statusChangedBy: userId || null, statusChangedAt: now } }
    ),
  ]);
  return { skipped: skipped.modifiedCount, released: released.modifiedCount };
};

// ─── Manual hold / skip / release of one period ───────────────────────────────
const ROW_TRANSITIONS = {
  hold: { from: ["scheduled"], to: "held" },
  skip: { from: ["scheduled", "held"], to: "skipped" },
  release: { from: ["held", "skipped"], to: "scheduled" },
};

export const changeScheduleRowStatus = async ({ business, contractId, rowId, action, reason = "", userId }) => {
  const transition = ROW_TRANSITIONS[action];
  if (!transition) throw createError(400, `Unknown schedule action '${action}'`);
  if (action !== "release" && !String(reason || "").trim()) throw createError(400, "A reason is required");

  const row = await ClientBillingSchedule.findOneAndUpdate(
    { _id: rowId, business, contract: contractId, status: { $in: transition.from } },
    {
      $set: {
        status: transition.to,
        holdSource: transition.to === "held" ? "manual" : null,
        statusReason: action === "release" ? "" : String(reason).trim(),
        statusChangedBy: userId || null,
        statusChangedAt: new Date(),
      },
    },
    { new: true }
  );
  if (!row) {
    const current = await ClientBillingSchedule.findOne({ _id: rowId, business, contract: contractId }).select("status").lean();
    if (!current) throw createError(404, "Schedule period not found");
    throw createError(400, `A ${current.status} period cannot be ${action === "hold" ? "held" : action === "skip" ? "skipped" : "released"}`);
  }
  return row;
};

export const releaseScheduleRowsForInvoice = (invoiceId) =>
  ClientBillingSchedule.updateMany(
    { invoice: invoiceId, status: { $in: ["invoiced", "invoicing"] } },
    { $set: { status: "scheduled", invoice: null, invoiceNumber: "", billingRun: null, claimedAt: null, statusReason: "Invoice cancelled — period billable again", statusChangedAt: new Date() } }
  );

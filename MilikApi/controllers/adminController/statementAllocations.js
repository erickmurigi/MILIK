import mongoose from "mongoose";
import RentPayment from "../../models/RentPayment.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import TenantInvoiceNote from "../../models/TenantInvoiceNote.js";
import MeterReading from "../../models/MeterReading.js";
import AuditLog from "../../models/AuditLog.js";
import Tenant from "../../models/Tenant.js";
import { recomputeTenantFinancialState, computeTenantInvoiceSnapshots } from "../propertyController/tenantInvoices.js";
import { postReceiptUnappliedAllocationReleaseJournal } from "../propertyController/rentPayment.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { round2 } from "../../utils/math.js";

const isAdmin = (u) => Boolean(u?.isSystemAdmin || u?.superAdminAccess);
const isOid = (id) => mongoose.Types.ObjectId.isValid(id);

const CATEGORY_TO_SUMMARY_KEY = {
  RENT_CHARGE: "rent",
  DEPOSIT_CHARGE: "deposit",
  UTILITY_CHARGE: "utility",
  LATE_PENALTY_CHARGE: "latePenalty",
  OTHER_CHARGE: "other",
  DEBIT_NOTE: "debitNote",
};

function rebuildAllocationSummary(allocations = []) {
  const s = { rent: 0, deposit: 0, utility: 0, latePenalty: 0, debitNote: 0, other: 0, unapplied: 0 };
  for (const a of allocations) {
    let key;
    if (!a.invoice) {
      key = "unapplied";
    } else if (a.priorityGroup === "debit_note") {
      // Debit notes store their real charge category (e.g. UTILITY_CHARGE), not "DEBIT_NOTE",
      // so CATEGORY_TO_SUMMARY_KEY would misroute them to "utility". Use priorityGroup instead.
      key = "debitNote";
    } else {
      key = CATEGORY_TO_SUMMARY_KEY[a.category] || "other";
    }
    s[key] = round2(s[key] + Number(a.appliedAmount || 0));
  }
  return s;
}

function invoiceStatus(outstanding, amount) {
  const o = round2(outstanding);
  if (o <= 0) return "paid";
  if (o < round2(amount)) return "partially_paid";
  return "pending";
}

// Formalizes implicit FIFO allocations (computed by buildLegacyReceiptAllocations) into
// persistent RentPayment.allocations[] records. Only writes if the receipt currently has
// NO formal allocations — never overwrites manual or admin-reallocated records.
async function autoAllocateLegacyReceipts({ businessId, tenantId, snapshotBundle }) {
  const { receiptAllocations = [] } = snapshotBundle;

  // Only process receipts whose rows came from legacy implicit matching (no formal records)
  const toWrite = receiptAllocations.filter(
    (ra) => ra.rows.length > 0 && ra.rows.every((r) => r.source === "legacy_payment_type")
  );
  if (toWrite.length === 0) return 0;

  const bIdObj = new mongoose.Types.ObjectId(businessId);
  const bulkOps = toWrite.map(({ receiptId, rows }) => {
    const allocations = rows
      .filter((r) => r.invoice)
      .map((r) => ({
        invoice: new mongoose.Types.ObjectId(r.invoice),
        invoiceNumber: r.invoiceNumber || "",
        category: r.category || "",
        priorityGroup: r.priorityGroup || "",
        appliedAmount: round2(Number(r.appliedAmount || 0)),
        beforeOutstanding: round2(Number(r.beforeOutstanding || 0)),
        afterOutstanding: round2(Number(r.afterOutstanding || 0)),
        invoiceDate: r.invoiceDate || null,
        dueDate: r.dueDate || null,
        description: r.description || "",
        utilityType: r.utilityType || undefined,
        metadata: { autoAllocated: true, utilityType: r.utilityType || undefined },
      }));
    const allocationSummary = rebuildAllocationSummary(allocations);
    return {
      updateOne: {
        filter: {
          _id: new mongoose.Types.ObjectId(receiptId),
          business: bIdObj,
          // Guard: only write if no formal allocations exist yet
          $or: [{ allocations: { $exists: false } }, { "allocations.0": { $exists: false } }],
        },
        update: { $set: { allocations, allocationSummary } },
      },
    };
  });

  const result = await RentPayment.bulkWrite(bulkOps, { ordered: false });
  return result.modifiedCount || 0;
}

function getBizId(req) {
  return String(req.headers?.["x-active-company-id"] || req.query?.business || req.body?.business || "");
}

const POPULATE_UNIT = { path: "unit", select: "unitNumber property", populate: { path: "property", select: "propertyName" } };
const POPULATE_TENANT = { path: "tenant", select: "name tenantCode" };

function shapePayment(p) {
  const receiptNum = p.receiptNumber || null;
  const refNum = p.referenceNumber || null;
  return {
    _id: p._id, type: "payment",
    refNumber: receiptNum || refNum,
    // Show bank/payment ref separately if it differs from receipt number
    refAlt: (receiptNum && refNum && receiptNum !== refNum) ? refNum : null,
    tenantName: p.tenant?.name || "-", tenantId: p.tenant?._id,
    unitNumber: p.unit?.unitNumber || "-", propertyName: p.unit?.property?.propertyName || "-",
    amount: p.amount, transactionDate: p.paymentDate,
    bookingDate: p.bookingDate || null,
    effectiveDate: p.bookingDate || p.paymentDate,
    status: p.isCancelled ? "cancelled" : p.isReversed ? "reversed" : p.isConfirmed ? "confirmed" : "pending",
    description: p.description || "",
    subType: p.paymentType, allocationSummary: p.allocationSummary, allocations: p.allocations,
  };
}

function shapeInvoice(i) {
  const tax = i.taxSnapshot || {};
  return {
    _id: i._id, type: "invoice",
    refNumber: i.invoiceNumber, tenantName: i.tenant?.name || "-", tenantId: i.tenant?._id,
    unitNumber: i.unit?.unitNumber || "-", propertyName: i.unit?.property?.propertyName || "-",
    amount: i.amount, transactionDate: i.invoiceDate,
    bookingDate: i.bookingDate || null, effectiveDate: i.bookingDate || i.invoiceDate,
    status: i.status, subType: i.category, outstanding: i.outstanding,
    description: i.description || "",
    taxAmount: tax.isTaxable ? (tax.taxAmount || 0) : 0,
    taxRate: tax.isTaxable ? (tax.taxRate || 0) : 0,
    taxMode: tax.isTaxable ? (tax.taxMode || "exclusive") : null,
  };
}

function shapeNote(n) {
  return {
    _id: n._id, type: n.noteType === "CREDIT_NOTE" ? "credit_note" : "debit_note",
    refNumber: n.noteNumber, tenantName: n.tenant?.name || "-", tenantId: n.tenant?._id,
    unitNumber: n.unit?.unitNumber || "-", propertyName: n.unit?.property?.propertyName || "-",
    amount: n.amount, transactionDate: n.noteDate,
    bookingDate: n.bookingDate || null, effectiveDate: n.bookingDate || n.noteDate,
    status: n.status, subType: n.category,
    description: n.description || "",
  };
}

function shapeMeterReading(m) {
  return {
    _id: m._id, type: "meter_reading",
    refNumber: m.billingPeriod || "-", tenantName: m.tenant?.name || "-", tenantId: m.tenant?._id,
    unitNumber: m.unit?.unitNumber || "-", propertyName: m.unit?.property?.propertyName || "-",
    amount: m.amount, transactionDate: m.readingDate,
    bookingDate: m.billedInvoice?.bookingDate || null,
    effectiveDate: m.billedInvoice?.bookingDate || m.billedInvoice?.invoiceDate || m.readingDate,
    status: m.status, subType: "meter_reading",
    linkedInvoiceId: m.billedInvoice?._id, linkedInvoiceNumber: m.billedInvoice?.invoiceNumber,
  };
}

// autoApplyPrepayments (rentPayment.js) removes a held prepayment's placeholder allocation
// row the moment it recognizes it against a real invoice — the live receipt.allocations
// array only ever shows the CURRENT state, never the "it used to be a held credit" fact.
// The prepayment_recognized AuditLog entry it writes is the only surviving record of that
// held state; reshape it back into the same transaction shape searchTransactions already
// returns so it renders as its own historical ledger row, purely for visibility — its
// amount must never be summed into totals since the live recognized row already counts it.
function shapePrepaymentHistory(log, receipt) {
  if (!receipt) return null;
  const m = log.metadata || {};
  const receiptNum = receipt.receiptNumber || null;
  const refNum = receipt.referenceNumber || null;
  return {
    _id: `hist-${log._id}`,
    type: "payment",
    refNumber: receiptNum || refNum,
    refAlt: (receiptNum && refNum && receiptNum !== refNum) ? refNum : null,
    tenantName: receipt.tenant?.name || "-", tenantId: receipt.tenant?._id,
    unitNumber: receipt.unit?.unitNumber || "-", propertyName: receipt.unit?.property?.propertyName || "-",
    amount: m.amount, transactionDate: m.heldSince,
    bookingDate: m.heldSince, effectiveDate: m.heldSince,
    status: "recognized",
    description: m.prepaymentLabel || "Prepayment",
    subType: m.billItemKey || "rent",
    allocationSummary: null, allocations: null,
    _historical: true,
    _propertyId: receipt.unit?.property?._id ? String(receipt.unit.property._id) : null,
    _recognizedInvoiceNumber: m.invoiceNumber || null,
    _recognizedInvoiceDate: m.invoiceDate || null,
  };
}

// ─── SEARCH ────────────────────────────────────────────────────────────────────
export const searchTransactions = async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: "Milik Admin access required" });

    const businessId = getBizId(req);
    if (!isOid(businessId)) return res.status(400).json({ error: "Valid business required" });

    const { type = "all", search = "", dateFrom, dateTo, property, tenantId, page = 1 } = req.query;
    const bId = new mongoose.Types.ObjectId(businessId);
    const PER_PAGE = 50;
    const skip = (Math.max(1, parseInt(page)) - 1) * PER_PAGE;

    const dateRange = {};
    if (dateFrom) dateRange.$gte = new Date(dateFrom);
    if (dateTo) { const d = new Date(dateTo); d.setHours(23, 59, 59, 999); dateRange.$lte = d; }
    const hasDate = Object.keys(dateRange).length > 0;
    const propOid = property && isOid(property) ? new mongoose.Types.ObjectId(property) : null;

    // Direct tenant ID filter takes priority over text-based tenant search
    let directTenantOid = null;
    let tenantIds = null;
    if (tenantId && isOid(tenantId)) {
      directTenantOid = new mongoose.Types.ObjectId(tenantId);
    } else if (search) {
      const ts = await Tenant.find({
        business: bId,
        $or: [{ name: { $regex: search, $options: "i" } }, { tenantCode: { $regex: search, $options: "i" } }],
      }).select("_id").lean();
      tenantIds = ts.map((t) => t._id);
    }

    const buildSearchOr = (refFields) => {
      if (!search) return {};
      const or = refFields.map((f) => ({ [f]: { $regex: search, $options: "i" } }));
      if (tenantIds?.length) or.push({ tenant: { $in: tenantIds } });
      return { $or: or };
    };

    const dateOr = (dateField) => hasDate
      ? { $or: [{ bookingDate: dateRange }, { [dateField]: dateRange }] }
      : {};

    const queries = [];
    const LIM = PER_PAGE;

    if (type === "all" || type === "payment") {
      const f = { business: bId, isCancellationEntry: { $ne: true }, reversalOf: null, ...buildSearchOr(["referenceNumber", "receiptNumber"]), ...dateOr("paymentDate") };
      if (propOid) f.property = propOid;
      if (directTenantOid) f.tenant = directTenantOid;
      queries.push(
        RentPayment.find(f)
          .select("_id referenceNumber receiptNumber tenant unit amount paymentDate paymentType paymentMethod isConfirmed isCancelled isReversed allocationSummary allocations bookingDate description")
          .populate(POPULATE_TENANT).populate(POPULATE_UNIT)
          .sort({ paymentDate: -1 }).limit(LIM).lean()
          .then((rows) => rows.map(shapePayment))
      );

      // Held-prepayment history — see shapePrepaymentHistory above for why this can't be
      // read off RentPayment.allocations directly.
      const histFilter = { company: bId, action: "prepayment_recognized" };
      if (hasDate) histFilter["metadata.heldSince"] = dateRange;
      if (directTenantOid) histFilter["metadata.tenant"] = String(directTenantOid);
      else if (tenantIds?.length) histFilter["metadata.tenant"] = { $in: tenantIds.map(String) };
      queries.push(
        AuditLog.find(histFilter).select("metadata createdAt").sort({ createdAt: -1 }).limit(LIM).lean()
          .then(async (logs) => {
            if (!logs.length) return [];
            const receiptIds = [...new Set(logs.map((l) => l.metadata?.receiptId).filter(Boolean))];
            const receipts = await RentPayment.find({ _id: { $in: receiptIds } })
              .select("_id receiptNumber referenceNumber tenant unit")
              .populate(POPULATE_TENANT).populate(POPULATE_UNIT).lean();
            const receiptMap = new Map(receipts.map((r) => [String(r._id), r]));
            return logs
              .map((log) => shapePrepaymentHistory(log, receiptMap.get(String(log.metadata?.receiptId))))
              .filter((row) => row && (!propOid || row._propertyId === String(propOid)));
          })
      );
    }

    if (type === "all" || type === "invoice") {
      const f = { business: bId, status: { $nin: ["cancelled", "reversed"] }, ...buildSearchOr(["invoiceNumber", "description"]), ...dateOr("invoiceDate") };
      if (propOid) f.property = propOid;
      if (directTenantOid) f.tenant = directTenantOid;
      queries.push(
        TenantInvoice.find(f)
          .select("_id invoiceNumber tenant unit amount invoiceDate bookingDate dueDate status category description outstanding taxSnapshot")
          .populate(POPULATE_TENANT).populate(POPULATE_UNIT)
          .sort({ bookingDate: -1, invoiceDate: -1 }).limit(LIM).lean()
          .then((rows) => rows.map(shapeInvoice))
      );
    }

    if (type === "all" || type === "credit_note" || type === "debit_note") {
      const f = { business: bId, status: { $nin: ["cancelled", "reversed"] }, ...buildSearchOr(["noteNumber", "description"]), ...dateOr("noteDate") };
      if (type === "credit_note") f.noteType = "CREDIT_NOTE";
      else if (type === "debit_note") f.noteType = "DEBIT_NOTE";
      if (propOid) f.property = propOid;
      if (directTenantOid) f.tenant = directTenantOid;
      queries.push(
        TenantInvoiceNote.find(f)
          .select("_id noteNumber noteType tenant unit amount noteDate bookingDate status category description")
          .populate(POPULATE_TENANT).populate(POPULATE_UNIT)
          .sort({ noteDate: -1 }).limit(LIM).lean()
          .then((rows) => rows.map(shapeNote))
      );
    }

    if (type === "all" || type === "meter_reading") {
      const f = { business: bId, status: { $nin: ["void", "deleted"] }, ...dateOr("readingDate") };
      if (propOid) f.property = propOid;
      if (directTenantOid) f.tenant = directTenantOid;
      else if (search && tenantIds?.length) f.tenant = { $in: tenantIds };
      queries.push(
        MeterReading.find(f)
          .select("_id tenant unit readingDate billedInvoice unitsConsumed rate amount status billingPeriod")
          .populate(POPULATE_TENANT).populate(POPULATE_UNIT)
          .populate("billedInvoice", "invoiceNumber bookingDate invoiceDate")
          .sort({ readingDate: -1 }).limit(LIM).lean()
          .then((rows) => rows.map(shapeMeterReading))
      );
    }

    const settled = await Promise.all(queries);
    const all = settled.flat().sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate));

    res.json({ data: all.slice(skip, skip + PER_PAGE), total: all.length, page: parseInt(page), limit: PER_PAGE });
  } catch (err) {
    console.error("[statementAllocations.searchTransactions]", err);
    next(err);
  }
};

// ─── ADJUST BOOKING DATE ────────────────────────────────────────────────────────
export const adjustBookingDate = async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: "Milik Admin access required" });

    const businessId = getBizId(req);
    const { type, id, bookingDate, narration, reason } = req.body;

    if (!type || !id || !reason?.trim())
      return res.status(400).json({ error: "type, id, and reason are all required" });
    if (!bookingDate && narration === undefined)
      return res.status(400).json({ error: "At least one of bookingDate or narration must be provided" });
    if (!isOid(id) || !isOid(businessId))
      return res.status(400).json({ error: "Invalid ID" });

    const newDate = bookingDate ? new Date(bookingDate) : null;
    if (newDate && isNaN(newDate.getTime())) return res.status(400).json({ error: "Invalid booking date" });

    const MODEL_MAP = {
      payment:    { Model: RentPayment,       dateField: "paymentDate",  refField: "receiptNumber"  },
      invoice:    { Model: TenantInvoice,     dateField: "invoiceDate",  refField: "invoiceNumber"  },
      credit_note:{ Model: TenantInvoiceNote, dateField: "noteDate",     refField: "noteNumber"     },
      debit_note: { Model: TenantInvoiceNote, dateField: "noteDate",     refField: "noteNumber"     },
    };

    let doc, originalDate, refNumber, targetType;

    if (type === "meter_reading") {
      const reading = await MeterReading.findOne({ _id: id, business: businessId }).lean();
      if (!reading) return res.status(404).json({ error: "Meter reading not found" });
      if (!reading.billedInvoice) return res.status(400).json({ error: "This meter reading has no linked invoice" });
      doc = await TenantInvoice.findOne({ _id: reading.billedInvoice, business: businessId });
      if (!doc) return res.status(404).json({ error: "Linked invoice not found" });
      originalDate = doc.bookingDate || doc.invoiceDate;
      refNumber = doc.invoiceNumber;
      targetType = "TenantInvoice";
    } else {
      const conf = MODEL_MAP[type];
      if (!conf) return res.status(400).json({ error: `Unknown transaction type: ${type}` });
      doc = await conf.Model.findOne({ _id: id, business: businessId });
      if (!doc) return res.status(404).json({ error: "Transaction not found" });
      originalDate = doc.bookingDate || doc[conf.dateField];
      refNumber = doc[conf.refField];
      targetType = conf.Model.modelName;
    }

    const originalNarration = doc.description || null;
    if (newDate) doc.bookingDate = newDate;
    if (narration !== undefined) doc.description = narration;
    await doc.save();

    const changeParts = [];
    if (newDate) changeParts.push(`date: ${originalDate ? new Date(originalDate).toDateString() : "N/A"} → ${newDate.toDateString()}`);
    if (narration !== undefined) changeParts.push(`narration: "${originalNarration || ""}" → "${narration}"`);

    await AuditLog.create({
      company: new mongoose.Types.ObjectId(businessId),
      actor: req.user._id,
      action: "booking_date_adjusted",
      category: "finance",
      severity: "important",
      targetType,
      targetId: String(doc._id),
      targetName: refNumber || String(doc._id),
      message: `Transaction edited: ${changeParts.join("; ")}`,
      metadata: {
        originalDate: newDate ? originalDate : undefined,
        newBookingDate: newDate || undefined,
        originalNarration: narration !== undefined ? originalNarration : undefined,
        newNarration: narration !== undefined ? narration : undefined,
        reason: reason.trim(),
        adjustedBy: req.user._id,
        adjustedAt: new Date(),
        transactionType: type,
      },
    });

    // Background: auto-allocate unallocated receipts then recompute invoice statuses
    if (doc.tenant) {
      const tenantId = String(doc.tenant);
      if (type === "payment") {
        computeTenantInvoiceSnapshots({ businessId, tenantId })
          .then((bundle) => autoAllocateLegacyReceipts({ businessId, tenantId, snapshotBundle: bundle }))
          .then(() => recomputeTenantFinancialState({ businessId, tenantId }))
          .catch((e) => console.error("[adjustBookingDate] post-save recompute:", e.message));
      } else {
        recomputeTenantFinancialState({ businessId, tenantId })
          .catch((e) => console.error("[adjustBookingDate] post-save recompute:", e.message));
      }
    }

    res.json({ success: true, bookingDate: newDate || undefined, docId: doc._id });
  } catch (err) {
    console.error("[statementAllocations.adjustBookingDate]", err);
    next(err);
  }
};

// ─── REALLOCATE PAYMENT ─────────────────────────────────────────────────────────
export const reallocatePayment = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!isAdmin(req.user)) {
      await session.abortTransaction(); session.endSession();
      return res.status(403).json({ error: "Milik Admin access required" });
    }

    const businessId = getBizId(req);
    const { paymentId, allocations: newAllocs = [], reason } = req.body;

    if (!paymentId || !isOid(paymentId) || !isOid(businessId)) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ error: "Valid paymentId and business required" });
    }
    if (!reason?.trim()) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ error: "Reason is required" });
    }
    if (!Array.isArray(newAllocs) || newAllocs.length === 0) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ error: "At least one allocation entry required" });
    }

    const payment = await RentPayment.findOne({ _id: paymentId, business: businessId }).session(session);
    if (!payment) {
      await session.abortTransaction(); session.endSession();
      return res.status(404).json({ error: "Payment not found" });
    }
    if (payment.isCancelled || payment.isReversed) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ error: "Cannot reallocate a cancelled or reversed payment" });
    }

    // Validate: submitted allocation totals must equal payment amount
    const totalNew = round2(newAllocs.reduce((s, a) => s + Number(a.amount || 0), 0));
    if (Math.abs(totalNew - round2(payment.amount)) > 0.01) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ error: `Allocation total (Ksh ${totalNew.toLocaleString()}) must equal payment amount (Ksh ${payment.amount.toLocaleString()}). Difference: Ksh ${round2(totalNew - payment.amount).toLocaleString()}` });
    }

    // Validate: no duplicate invoice IDs in submission
    const invoiceIdCounts = {};
    for (const a of newAllocs) {
      if (!a.invoiceId) continue;
      invoiceIdCounts[a.invoiceId] = (invoiceIdCounts[a.invoiceId] || 0) + 1;
    }
    const dupEntry = Object.entries(invoiceIdCounts).find(([, n]) => n > 1);
    if (dupEntry) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ error: `Invoice ${dupEntry[0]} appears ${dupEntry[1]} times. Each invoice may only appear once per allocation.` });
    }

    // Collect all invoice IDs involved
    const oldIds = (payment.allocations || []).filter((a) => a.invoice).map((a) => String(a.invoice));
    const newIds = newAllocs.filter((a) => a.invoiceId && isOid(a.invoiceId)).map((a) => a.invoiceId);
    const allIds = [...new Set([...oldIds, ...newIds])];

    const invoiceLeanList = await TenantInvoice.find({ _id: { $in: allIds }, business: businessId })
      .select("_id amount outstanding status invoiceNumber category invoiceDate dueDate description metadata tenant")
      .session(session).lean();

    // Debit note IDs live in TenantInvoiceNote, not TenantInvoice — fetch them separately
    // so the state map covers all allocation targets (invoice or debit note).
    const foundInvoiceIds = new Set(invoiceLeanList.map((i) => String(i._id)));
    const missingIds = allIds.filter((id) => !foundInvoiceIds.has(id));
    const debitNoteLeanList = missingIds.length > 0
      ? await TenantInvoiceNote.find({
          _id: { $in: missingIds }, business: businessId,
          noteType: "DEBIT_NOTE",
          status: { $nin: ["cancelled", "reversed"] },
        })
        .select("_id amount outstanding status noteNumber category noteDate description metadata tenant")
        .session(session).lean()
      : [];
    const debitNoteIdSet = new Set(debitNoteLeanList.map((n) => String(n._id)));

    // Mutable working state map — we mutate outstanding in memory, then bulk-save at end
    const stateMap = new Map([
      ...invoiceLeanList.map((i) => [String(i._id), {
        _id: i._id,
        amount: round2(i.amount || 0),
        outstanding: round2(i.outstanding || 0),
        status: i.status || "pending",
        invoiceNumber: i.invoiceNumber || "",
        category: i.category || "",
        invoiceDate: i.invoiceDate || null,
        dueDate: i.dueDate || null,
        description: i.description || "",
        metadata: i.metadata || {},
        tenant: i.tenant,
        isDebitNote: false,
      }]),
      ...debitNoteLeanList.map((n) => [String(n._id), {
        _id: n._id,
        amount: round2(n.amount || 0),
        // Use stored outstanding if available (set by snapshot engine); fall back to full amount
        outstanding: round2(n.outstanding ?? n.amount ?? 0),
        status: n.status || "posted",
        invoiceNumber: n.noteNumber || "",
        category: n.category || "",
        invoiceDate: n.noteDate || null,
        dueDate: n.noteDate || null,
        description: n.description || "",
        metadata: n.metadata || {},
        tenant: n.tenant,
        isDebitNote: true,
      }]),
    ]);

    // Security: each NEW target invoice must belong to the same tenant as the payment
    // and must not be in a terminal state
    for (const invId of newIds) {
      const inv = stateMap.get(invId);
      if (!inv) {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ error: `Invoice ${invId} not found in this business` });
      }
      if (String(inv.tenant) !== String(payment.tenant)) {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ error: `Invoice ${inv.invoiceNumber} does not belong to this payment's tenant` });
      }
      const terminalStatuses = ["cancelled", "reversed", "void"];
      if (terminalStatuses.includes(String(inv.status || "").toLowerCase())) {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ error: `Invoice ${inv.invoiceNumber} is ${inv.status} and cannot receive payment allocations` });
      }
    }

    // Capture unapplied amount before any mutation — used for GL release below
    const prevUnapplied = round2(Number(payment.allocationSummary?.unapplied || 0));

    // Snapshot old allocations for audit trail
    const oldAllocsSnapshot = (payment.allocations || []).map((a) => ({
      invoiceId: a.invoice ? String(a.invoice) : null,
      invoiceNumber: a.invoiceNumber,
      category: a.category,
      appliedAmount: a.appliedAmount,
      beforeOutstanding: a.beforeOutstanding,
      afterOutstanding: a.afterOutstanding,
    }));

    // Step 1 — Reverse old allocations: restore outstanding on each invoice (capped at invoice.amount)
    for (const alloc of payment.allocations || []) {
      if (!alloc.invoice) continue;
      const inv = stateMap.get(String(alloc.invoice));
      if (!inv) continue;
      inv.outstanding = round2(Math.min(inv.amount, inv.outstanding + Number(alloc.appliedAmount || 0)));
    }

    // Step 2 — Apply new allocations
    const builtAllocations = [];
    for (const alloc of newAllocs) {
      const amount = round2(Number(alloc.amount || 0));
      if (amount <= 0) continue;

      if (!alloc.invoiceId) {
        // Unapplied / prepayment — preserve prepayment tags so auto-allocation still works
        builtAllocations.push({
          invoice: null, invoiceNumber: "",
          category: alloc.category || "",
          priorityGroup: alloc.priorityGroup || "",
          utilityType: alloc.utilityType || "",
          billItemKey: alloc.billItemKey || null,
          prepaymentLabel: alloc.prepaymentLabel || null,
          isPrepayment: Boolean(alloc.isPrepayment),
          appliedAmount: amount,
          beforeOutstanding: 0, afterOutstanding: 0,
          description: alloc.description || "Unapplied balance",
          metadata: { adminReallocated: true },
        });
        continue;
      }

      if (!isOid(alloc.invoiceId)) {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ error: `Invalid invoice ID: ${alloc.invoiceId}` });
      }

      const inv = stateMap.get(String(alloc.invoiceId));
      if (!inv) {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ error: `Invoice not found: ${alloc.invoiceId}` });
      }

      const beforeOutstanding = round2(inv.outstanding);
      // Trust the admin-submitted amount directly — the first validation already guarantees
      // sum(amounts) = payment.amount. Capping at outstanding breaks when an invoice has
      // outstanding=0 due to data state (e.g. pending status with zero balance) but the
      // admin explicitly wants to apply funds to it and correct its status.
      const appliedAmount = amount;
      inv.outstanding = round2(Math.max(0, inv.outstanding - appliedAmount));

      builtAllocations.push({
        invoice: inv._id,
        invoiceNumber: inv.invoiceNumber,
        category: inv.category,
        priorityGroup: alloc.priorityGroup || "",
        appliedAmount,
        beforeOutstanding,
        afterOutstanding: inv.outstanding,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        description: inv.description || "",
        // Carry utilityType so the landlord statement service routes it to the correct column
        utilityType: inv.metadata?.utilityType || alloc.utilityType || undefined,
        metadata: { adminReallocated: true, utilityType: inv.metadata?.utilityType || alloc.utilityType || undefined },
      });
    }

    // Guard: actual applied total must equal payment amount (amounts <= 0 are skipped in Step 2).
    const actualApplied = round2(builtAllocations.reduce((s, a) => s + Number(a.appliedAmount || 0), 0));
    if (Math.abs(actualApplied - round2(payment.amount)) > 0.01) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({
        error: `Applied total (Ksh ${actualApplied.toLocaleString()}) does not equal payment amount (Ksh ${payment.amount.toLocaleString()}). One or more invoices may have been partially paid by another receipt since this panel was opened. Refresh and re-check outstanding balances before saving.`,
      });
    }

    // Step 3 — Persist updated outstanding + status for every involved invoice/debit note.
    // Debit notes live in TenantInvoiceNote (different collection + different status enum).
    if (stateMap.size > 0) {
      const invoiceBulkOps = [];
      const debitNoteBulkOps = [];
      for (const inv of stateMap.values()) {
        if (inv.isDebitNote) {
          const o = round2(inv.outstanding);
          const noteStatus = o <= 0 ? "paid" : o < round2(inv.amount) ? "partially_paid" : "posted";
          debitNoteBulkOps.push({
            updateOne: {
              filter: { _id: inv._id },
              update: { $set: { outstanding: inv.outstanding, status: noteStatus } },
            },
          });
        } else {
          invoiceBulkOps.push({
            updateOne: {
              filter: { _id: inv._id },
              update: { $set: { outstanding: inv.outstanding, status: invoiceStatus(inv.outstanding, inv.amount) } },
            },
          });
        }
      }
      await Promise.all([
        invoiceBulkOps.length > 0 ? TenantInvoice.bulkWrite(invoiceBulkOps, { session }) : Promise.resolve(),
        debitNoteBulkOps.length > 0 ? TenantInvoiceNote.bulkWrite(debitNoteBulkOps, { session }) : Promise.resolve(),
      ]);
    }

    // Step 4 — Rebuild payment allocations + summary
    payment.allocations = builtAllocations;
    payment.allocationSummary = rebuildAllocationSummary(builtAllocations);
    await payment.save({ session });

    // Step 4b — Release unapplied balance from GL account 2130 (Unallocated Receipts)
    // Only fires when the payment was previously posted to the GL with an unapplied balance.
    // Atomic with the PMS update: if account 2130 is not configured the whole transaction
    // rolls back and the admin is prompted to set up their chart of accounts first.
    if (prevUnapplied > 0 && payment.journalGroupId) {
      let releaseRemaining = prevUnapplied;
      const releaseRows = [];
      for (const a of builtAllocations.filter((x) => x.invoice)) {
        if (releaseRemaining <= 0) break;
        const take = round2(Math.min(a.appliedAmount, releaseRemaining));
        releaseRows.push({ ...a, appliedAmount: take });
        releaseRemaining = round2(releaseRemaining - take);
      }
      if (releaseRows.length > 0) {
        const glActorId = await resolveAuditActorUserId({
          req,
          businessId,
          candidateUserIds: [],
        });
        await postReceiptUnappliedAllocationReleaseJournal({
          payment,
          releaseRows,
          actorId: glActorId,
          reason: reason.trim(),
          session,
        });
      }
    }

    // Step 5 — Audit log
    await AuditLog.create(
      [{
        company: new mongoose.Types.ObjectId(businessId),
        actor: req.user._id,
        action: "payment_reallocated",
        category: "finance",
        severity: "important",
        targetType: "RentPayment",
        targetId: String(paymentId),
        targetName: payment.receiptNumber || payment.referenceNumber,
        message: `Payment reallocated by admin. Reason: ${reason.trim()}`,
        metadata: {
          reason: reason.trim(),
          previousAllocations: oldAllocsSnapshot,
          newAllocations: builtAllocations.map((a) => ({
            invoiceId: String(a.invoice || ""),
            invoiceNumber: a.invoiceNumber,
            category: a.category,
            appliedAmount: a.appliedAmount,
          })),
          adjustedBy: req.user._id,
          adjustedAt: new Date(),
        },
      }],
      { session }
    );

    await session.commitTransaction();

    // Full snapshot recompute after commit. The in-memory Step 1/2 outstanding
    // calculation starts from the DB value, which already embeds other receipts
    // applied to the same invoices — only a full replay gives the correct result.
    await recomputeTenantFinancialState({
      businessId,
      tenantId: String(payment.tenant),
    }).catch((e) => console.error("[reallocatePayment] post-commit recompute:", e.message));

    res.json({
      success: true,
      allocationSummary: payment.allocationSummary,
      allocations: payment.allocations,
      statementWarning: "Payment allocation changed. Regenerate the landlord statement for the affected period to reflect updated figures.",
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("[statementAllocations.reallocatePayment]", err);
    next(err);
  } finally {
    session.endSession();
  }
};

// Converts a TenantInvoiceNote doc to the invoice-shaped object the picker expects
const noteToInvoiceShape = (note) => ({
  _id: note._id,
  invoiceNumber: note.noteNumber || "",
  category: note.category || "",
  amount: Math.abs(Number(note.amount || 0)),
  outstanding: round2(note.outstanding ?? Math.abs(Number(note.amount || 0))),
  invoiceDate: note.noteDate || null,
  dueDate: note.noteDate || null,
  bookingDate: null,
  description: note.description || `Debit note ${note.noteNumber || ""}`,
  metadata: {
    ...(note.metadata || {}),
    sourceTransactionType: "invoice_note",
    invoicePriorityCategory: "debit_note",
    noteType: "DEBIT_NOTE",
    noteNumber: note.noteNumber || "",
  },
  createdAt: note.createdAt || null,
  _isDebitNote: true,
});

// ─── GET TENANT INVOICES (for reallocation picker) ─────────────────────────────
export const getTenantInvoicesForRealloc = async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: "Milik Admin access required" });

    const businessId = getBizId(req);
    const { tenantId, paymentId } = req.query;
    if (!isOid(businessId) || !isOid(tenantId)) return res.status(400).json({ error: "Valid business and tenantId required" });

    const bId = new mongoose.Types.ObjectId(businessId);
    const tId = new mongoose.Types.ObjectId(tenantId);
    const INV_SELECT = "_id invoiceNumber category amount outstanding invoiceDate dueDate bookingDate description metadata";

    // Run open-invoice query, debit note query, payment-lookup, and snapshot in parallel.
    // Snapshots give us the authoritative computed outstanding (replays all active receipts)
    // so the picker is always correct even if the DB outstanding field is stale.
    const openInvoicesPromise = TenantInvoice.find({
      business: bId, tenant: tId,
      status: { $nin: ["cancelled", "reversed", "void"] },
    }).select(INV_SELECT).sort({ invoiceDate: -1 }).lean();

    // Debit notes also appear as allocation targets but live in a different collection
    const openDebitNotesPromise = TenantInvoiceNote.find({
      business: bId, tenant: tId,
      noteType: "DEBIT_NOTE",
      status: { $nin: ["cancelled", "reversed"] },
    }).select("_id noteNumber category amount outstanding noteDate description metadata createdAt").sort({ noteDate: -1 }).lean();

    const allocatedPromise = (async () => {
      if (!paymentId || !isOid(paymentId)) return [];
      const pay = await RentPayment.findOne({ _id: paymentId, business: bId }).select("allocations").lean();
      const allocIds = (pay?.allocations || [])
        .filter((a) => a.invoice && isOid(String(a.invoice))).map((a) => a.invoice);
      if (!allocIds.length) return [];
      // Fetch from both collections — some IDs may be debit notes
      const [invDocs, noteDocs] = await Promise.all([
        TenantInvoice.find({ _id: { $in: allocIds }, business: bId, tenant: tId, status: { $nin: ["pending", "partially_paid"] } }).select(INV_SELECT).lean(),
        TenantInvoiceNote.find({ _id: { $in: allocIds }, business: bId, tenant: tId, noteType: "DEBIT_NOTE", status: { $nin: ["cancelled", "reversed"] } }).select("_id noteNumber category amount outstanding noteDate description metadata createdAt").lean(),
      ]);
      return [
        ...invDocs.map((i) => ({ ...i, _currentlyAllocated: true })),
        ...noteDocs.map((n) => ({ ...noteToInvoiceShape(n), _currentlyAllocated: true })),
      ];
    })();

    const snapshotPromise = computeTenantInvoiceSnapshots({ businessId: bId, tenantId: tId });

    const [openInvoices, openDebitNotes, currentlyAllocated, snapshotBundle] = await Promise.all([
      openInvoicesPromise, openDebitNotesPromise, allocatedPromise, snapshotPromise,
    ]);

    // Build a map of _id → computed outstanding from the snapshot engine
    const snapMap = new Map(
      (snapshotBundle.invoiceSnapshots || []).map((s) => [String(s._id), round2(s.outstanding ?? 0)])
    );

    const applyComputedOutstanding = (inv) => {
      const computed = snapMap.get(String(inv._id));
      const outstanding = computed != null ? computed : round2(inv.outstanding ?? inv.amount ?? 0);
      return { ...inv, outstanding };
    };

    // Exclude from open lists any item already in currentlyAllocated to prevent duplicates
    const allocatedIdSet = new Set(currentlyAllocated.map((i) => String(i._id)));
    res.json({
      data: [
        ...openInvoices.filter((i) => !allocatedIdSet.has(String(i._id))).map(applyComputedOutstanding),
        ...openDebitNotes.filter((n) => !allocatedIdSet.has(String(n._id))).map((n) => applyComputedOutstanding(noteToInvoiceShape(n))),
        ...currentlyAllocated.map(applyComputedOutstanding),
      ],
    });
  } catch (err) {
    next(err);
  }
};

// ─── RECOMPUTE TENANT INVOICE BALANCES ──────────────────────────────────────────
export const recomputeTenantState = async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: "Milik Admin access required" });
    const businessId = getBizId(req);
    const { tenantId } = req.body;
    if (!isOid(businessId) || !isOid(tenantId)) return res.status(400).json({ error: "Valid business and tenantId required" });

    // Compute snapshots to identify receipts with only implicit (legacy) FIFO allocations,
    // then write those as formal records so the statement panel can display them correctly.
    const snapshotBundle = await computeTenantInvoiceSnapshots({ businessId, tenantId });
    const autoAllocated = await autoAllocateLegacyReceipts({ businessId, tenantId, snapshotBundle });

    // Full recompute after auto-allocation so invoice statuses reflect new formal allocations
    await recomputeTenantFinancialState({ businessId, tenantId });

    res.json({ success: true, autoAllocated });
  } catch (err) {
    next(err);
  }
};

// ─── ADJUSTMENT HISTORY ─────────────────────────────────────────────────────────
export const getAdjustmentHistory = async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: "Milik Admin access required" });

    const businessId = getBizId(req);
    if (!isOid(businessId)) return res.status(400).json({ error: "Valid business required" });

    const { dateFrom, dateTo, page = 1 } = req.query;
    const PER_PAGE = 50;
    const skip = (Math.max(1, parseInt(page)) - 1) * PER_PAGE;

    const filter = {
      company: new mongoose.Types.ObjectId(businessId),
      action: { $in: ["booking_date_adjusted", "payment_reallocated", "prepayment_recognized"] },
    };
    if (dateFrom || dateTo) {
      const range = {};
      if (dateFrom) range.$gte = new Date(dateFrom);
      if (dateTo) { const d = new Date(dateTo); d.setHours(23, 59, 59, 999); range.$lte = d; }
      filter.createdAt = range;
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 }).skip(skip).limit(PER_PAGE)
        .populate("actor", "username firstName lastName email")
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ data: logs, total, page: parseInt(page), limit: PER_PAGE });
  } catch (err) {
    console.error("[statementAllocations.getAdjustmentHistory]", err);
    next(err);
  }
};


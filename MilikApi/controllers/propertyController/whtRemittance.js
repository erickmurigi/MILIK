import mongoose from "mongoose";
import TaxRemittance from "../../models/TaxRemittance.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { findSystemAccountByCode } from "../../services/chartOfAccountsService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { createError } from "../../utils/error.js";
import { normalizeCompanyId } from "../verifyToken.js";
import { round2 } from "../../utils/math.js";

// req.user.company is always trusted first — a client-supplied business/company
// value is only used as a fallback for requests with no authenticated company
// context (mirrors resolveBusinessId in controllers/propertyController/
// statementController.js). Every function below previously read req.query.business
// / req.body.business directly, with no check against the caller's own company —
// any authenticated user could read or remit/void another company's WHT filings.
const resolveOwnBusinessId = (req, explicit) => {
  const ownId = normalizeCompanyId(req.user?.company);
  if (ownId && mongoose.Types.ObjectId.isValid(ownId)) return ownId;
  const explicitId = normalizeCompanyId(explicit);
  return explicitId && mongoose.Types.ObjectId.isValid(explicitId) ? explicitId : null;
};

const getWhtAccount = async (businessId) =>
  findSystemAccountByCode(businessId, "2141").catch(() => null);

// Aggregate WHT Payable 2141 ledger credits/debits for a period
const aggregateWhtForPeriod = async (businessId, accountId, periodStart, periodEnd) => {
  const rows = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        business: new mongoose.Types.ObjectId(String(businessId)),
        accountId: new mongoose.Types.ObjectId(String(accountId)),
        status: { $nin: ["void", "draft"] },
        transactionDate: { $gte: periodStart, $lte: periodEnd },
      },
    },
    { $group: { _id: "$direction", total: { $sum: "$amount" } } },
  ]).allowDiskUse(true);

  const result = { credit: 0, debit: 0 };
  rows.forEach((r) => { result[r._id] = round2(r.total); });
  return result;
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/wht-remittance/summary?business=&year=&month=
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const getWhtReturnSummary = async (req, res, next) => {
  try {
    const businessId = resolveOwnBusinessId(req, req.query.business);
    const year  = parseInt(req.query.year  || new Date().getFullYear(), 10);
    const month = parseInt(req.query.month || (new Date().getMonth() + 1), 10);

    if (!businessId || !mongoose.Types.ObjectId.isValid(businessId)) {
      return next(createError(400, "Valid business ID is required."));
    }
    if (month < 1 || month > 12 || Number.isNaN(year)) {
      return next(createError(400, "Valid year and month are required."));
    }

    const periodStart = new Date(year, month - 1, 1);
    const periodEnd   = new Date(year, month, 0, 23, 59, 59, 999);

    const [whtAccount, remittances] = await Promise.all([
      getWhtAccount(businessId),
      TaxRemittance.find({
        business: businessId,
        periodYear: year,
        periodMonth: month,
        taxType: "wht",
        status: { $ne: "voided" },
      }).sort({ createdAt: -1 }).lean(),
    ]);

    if (!whtAccount) {
      return res.status(200).json({
        periodYear: year, periodMonth: month,
        whtAccountFound: false,
        totalCollected: 0, totalRemitted: 0, balanceDue: 0,
        remittances: [],
        breakdown: [],
      });
    }

    const [totals, vouchers] = await Promise.all([
      aggregateWhtForPeriod(businessId, whtAccount._id, periodStart, periodEnd),
      PaymentVoucher.find({
        business: businessId,
        status: "paid",
        whtAmount: { $gt: 0 },
        paidDate: { $gte: periodStart, $lte: periodEnd },
      })
        .populate("serviceProvider", "name providerCode kraPin")
        .select("voucherNo amount whtAmount paidDate serviceProvider narration")
        .lean(),
    ]);

    const totalCollected = totals.credit;
    const totalRemitted  = totals.debit;
    const balanceDue     = round2(totalCollected - totalRemitted);

    // Group breakdown by service provider
    const spMap = new Map();
    for (const v of vouchers) {
      const key = String(v.serviceProvider?._id || "unknown");
      const sp  = spMap.get(key) || {
        serviceProviderId: key,
        providerName: v.serviceProvider?.name || "Unknown Provider",
        providerCode: v.serviceProvider?.providerCode || "",
        kraPin:       v.serviceProvider?.kraPin || "",
        whtTotal: 0, voucherCount: 0,
      };
      sp.whtTotal     = round2(sp.whtTotal + Number(v.whtAmount || 0));
      sp.voucherCount += 1;
      spMap.set(key, sp);
    }

    return res.status(200).json({
      periodYear: year, periodMonth: month,
      whtAccountFound: true,
      whtAccountCode: whtAccount.code,
      whtAccountName: whtAccount.name,
      totalCollected,
      totalRemitted,
      balanceDue,
      remittances,
      breakdown: Array.from(spMap.values()).sort((a, b) => b.whtTotal - a.whtTotal),
      vouchers: vouchers.map((v) => ({
        _id: v._id, voucherNo: v.voucherNo, amount: v.amount,
        whtAmount: v.whtAmount, paidDate: v.paidDate, narration: v.narration,
        providerName: v.serviceProvider?.name || "â€”",
      })),
    });
  } catch (err) {
    return next(err);
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/wht-remittance
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const getWhtRemittanceHistory = async (req, res, next) => {
  try {
    const { year } = req.query;
    const businessId = resolveOwnBusinessId(req, req.query.business);
    if (!businessId || !mongoose.Types.ObjectId.isValid(businessId)) {
      return next(createError(400, "Valid business ID is required."));
    }
    const filter = { business: businessId, taxType: "wht" };
    if (year) filter.periodYear = parseInt(year, 10);

    const remittances = await TaxRemittance.find(filter)
      .sort({ periodYear: -1, periodMonth: -1, createdAt: -1 })
      .populate("cashbookAccountId", "code name")
      .lean();

    return res.status(200).json(remittances);
  } catch (err) {
    return next(err);
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/wht-remittance/remit
// GL: Dr WHT Payable 2141 (amount), Cr Cashbook (amount)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const remitWht = async (req, res, next) => {
  let remittance = null;
  try {
    const { year, month, amountRemitted, paymentDate, paymentReference, cashbookAccountId, notes } = req.body;
    const businessId = resolveOwnBusinessId(req, req.body.business);

    if (!businessId || !mongoose.Types.ObjectId.isValid(businessId)) {
      return next(createError(400, "Valid business ID is required."));
    }
    if (!year || !month || Number(month) < 1 || Number(month) > 12) {
      return next(createError(400, "Valid year and month are required."));
    }
    if (!amountRemitted || Number(amountRemitted) <= 0) {
      return next(createError(400, "Amount remitted must be greater than zero."));
    }
    if (!paymentDate) return next(createError(400, "Payment date is required."));
    if (!cashbookAccountId || !mongoose.Types.ObjectId.isValid(cashbookAccountId)) {
      return next(createError(400, "A valid cashbook account is required."));
    }

    const amount      = round2(Number(amountRemitted));
    const txDate      = new Date(paymentDate);
    const periodStart = new Date(Number(year), Number(month) - 1, 1);
    const periodEnd   = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);

    const [actorUserId, cashbookAccount, whtAccount, priorRemittances] = await Promise.all([
      resolveAuditActorUserId({ req, businessId }),
      ChartOfAccount.findOne({ _id: cashbookAccountId, business: businessId, isActive: { $ne: false }, isPosting: { $ne: false }, isHeader: { $ne: true } }).select("_id code name").lean(),
      getWhtAccount(businessId),
      TaxRemittance.find({ business: businessId, periodYear: Number(year), periodMonth: Number(month), taxType: "wht", status: { $ne: "voided" } }).select("amountRemitted").lean(),
    ]);

    if (!cashbookAccount) return next(createError(404, "Cashbook account not found or is inactive."));
    if (!whtAccount)      return next(createError(500, "WHT Payable account (2141) not found. Ensure chart of accounts is seeded."));

    const alreadyRemitted = round2(priorRemittances.reduce((s, r) => s + Number(r.amountRemitted || 0), 0));
    const periodLabel     = new Date(Number(year), Number(month) - 1, 1).toLocaleString("en-KE", { month: "long", year: "numeric" });

    let touchedAccountIds = [];

    // The two GL legs (Dr WHT Payable / Cr Cashbook) and the TaxRemittance record itself are
    // wrapped in one Mongo transaction instead of create-then-post-then-manually-delete-on-catch.
    // The old manual rollback (TaxRemittance.deleteOne + FinancialLedgerEntry.deleteMany) assumed
    // "the call threw => nothing was written" - false under a ghost write (a write that commits on
    // the primary but loses its acknowledgment, e.g. a dropped connection or a replica election
    // mid-request), which can leave one leg inserted with no offsetting leg and no TaxRemittance
    // left to explain it. A real transaction rolls back every write from this attempt atomically,
    // inserts included, if any leg fails.
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        touchedAccountIds = [];

        [remittance] = await TaxRemittance.create([{
          business: businessId,
          periodYear:  Number(year),
          periodMonth: Number(month),
          taxType: "wht",
          alreadyRemitted,
          amountRemitted: amount,
          status: "remitted",
          paymentDate:      txDate,
          paymentReference: paymentReference || "",
          cashbookAccountId,
          notes: notes || "",
          createdBy:  actorUserId,
          remittedBy: actorUserId,
          remittedAt: new Date(),
        }], { session });

        const journalGroupId = new mongoose.Types.ObjectId();
        const commonEntry = {
          business:              businessId,
          sourceTransactionType: "tax_remittance",
          sourceTransactionId:   String(remittance._id),
          transactionDate:       txDate,
          statementPeriodStart:  periodStart,
          statementPeriodEnd:    periodEnd,
          category:              "TAX_REMITTANCE",
          journalGroupId,
          payer: "n/a", receiver: "n/a",
          notes: `KRA WHT remittance â€“ ${periodLabel}${paymentReference ? ` (Ref: ${paymentReference})` : ""}`,
          createdBy: actorUserId, approvedBy: actorUserId, approvedAt: new Date(),
          status: "approved",
          allowUnscoped: true,
        };

        // Dr WHT Payable 2141 â€” reduces the liability
        await postEntry({ ...commonEntry, accountId: whtAccount._id, amount, direction: "debit", metadata: { postingRole: "wht_payable_reduction", accountCode: "2141" }, session });
        touchedAccountIds.push(whtAccount._id);

        // Cr Cashbook â€” cash leaves to KRA
        await postEntry({ ...commonEntry, accountId: cashbookAccountId, amount, direction: "credit", metadata: { postingRole: "cashbook_outflow", kraReference: paymentReference || "" }, session });
        touchedAccountIds.push(cashbookAccountId);

        remittance.journalGroupId = journalGroupId;
        await remittance.save({ session });
      });
    } finally {
      await session.endSession();
    }

    aggregateChartOfAccountBalances(businessId, touchedAccountIds).catch(() => {});

    return res.status(201).json(remittance);
  } catch (err) {
    return next(err);
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PATCH /api/wht-remittance/:id/void
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const voidWhtRemittance = async (req, res, next) => {
  try {
    const { id }     = req.params;
    const { reason } = req.body;
    const businessId = resolveOwnBusinessId(req, req.body.business);

    if (!id || !mongoose.Types.ObjectId.isValid(id)) return next(createError(400, "Valid remittance ID is required."));
    if (!businessId) return next(createError(400, "Business ID is required."));

    const remittance = await TaxRemittance.findOne({ _id: id, business: businessId, taxType: "wht" });
    if (!remittance)                      return next(createError(404, "WHT remittance not found."));
    if (remittance.status === "voided")   return next(createError(400, "Already voided."));

    const actorUserId = await resolveAuditActorUserId({ req, businessId });

    const entries = await FinancialLedgerEntry.find({
      business: new mongoose.Types.ObjectId(String(businessId)),
      sourceTransactionType: "tax_remittance",
      sourceTransactionId:   String(remittance._id),
      status: { $ne: "reversed" },
    }).lean();

    // Reverse every leg inside one Mongo transaction (see deleteTenantInvoice for the same
    // pattern). Without it, a later leg's reversal failing has no way to undo an earlier leg's
    // reversal insert that already landed, and the remittance itself would stay half-voided.
    // Any failure in this attempt rolls back every write from it, inserts included.
    const touchedAccountIds = [];
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        touchedAccountIds.length = 0;
        for (const entry of entries) {
          const reversal = await postReversal({ entryId: entry._id, reason: reason || "WHT remittance voided", userId: actorUserId, session });
          if (reversal?.reversalEntry?.accountId) touchedAccountIds.push(reversal.reversalEntry.accountId);
        }

        remittance.status     = "voided";
        remittance.voidedAt   = new Date();
        remittance.voidedBy   = actorUserId;
        remittance.voidReason = reason || "";
        await remittance.save({ session });
      });
    } finally {
      await session.endSession();
    }

    aggregateChartOfAccountBalances(businessId, touchedAccountIds).catch(() => {});

    return res.status(200).json(remittance);
  } catch (err) {
    return next(err);
  }
};

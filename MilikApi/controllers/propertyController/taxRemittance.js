import mongoose from "mongoose";
import TaxRemittance from "../../models/TaxRemittance.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { resolveOutputVatAccount, getCompanyTaxConfiguration } from "../../services/taxCalculationService.js";
import { findSystemAccountByCode } from "../../services/chartOfAccountsService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { createError } from "../../utils/error.js";
import { normalizeCompanyId } from "../verifyToken.js";
import { round2 } from "../../utils/math.js";
import { claimPaymentReference, releasePaymentReference } from "../../services/paymentReferenceGuard.js";

// req.user.company is always trusted first — a client-supplied business/company
// value is only used as a fallback for requests with no authenticated company
// context (mirrors resolveBusinessId in controllers/propertyController/
// statementController.js). Every function below previously read req.query.business
// / req.body.business directly, with no check against the caller's own company —
// any authenticated user could read or remit/void another company's VAT filings.
const resolveOwnBusinessId = (req, explicit) => {
  const ownId = normalizeCompanyId(req.user?.company);
  if (ownId && mongoose.Types.ObjectId.isValid(ownId)) return ownId;
  const explicitId = normalizeCompanyId(explicit);
  return explicitId && mongoose.Types.ObjectId.isValid(explicitId) ? explicitId : null;
};

// Resolve both possible VAT liability accounts: 2140 (PM/primary) and 2190 (inventory/POS).
// Uses the company's configured account code for the primary, then always checks 2190 separately.
const resolveVatAccounts = async (businessId, companyTaxConfig) => {
  const [primary, inventory] = await Promise.all([
    resolveOutputVatAccount({ businessId, companyTaxConfig }).catch(() => null),
    findSystemAccountByCode(businessId, "2190").catch(() => null),
  ]);

  const seen = new Set();
  return [primary, inventory].filter((a) => {
    if (!a?._id) return false;
    const key = String(a._id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Aggregate credits (VAT collected) and debits (VAT remitted) from the ledger
// for the given accounts within a calendar-month date range.
// Returns a Map: accountId string â†’ { credit, debit }
const aggregateVatForPeriod = async (businessId, accountIds, periodStart, periodEnd) => {
  if (!accountIds.length) return new Map();

  const rows = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        business: new mongoose.Types.ObjectId(String(businessId)),
        accountId: { $in: accountIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
        status: { $nin: ["void", "draft"] },
        transactionDate: { $gte: periodStart, $lte: periodEnd },
      },
    },
    {
      // Debits are split into actual KRA remittances and everything else (credit notes, reversals of
      // sales), so the return can show output VAT net of adjustments instead of counting a credit
      // note's VAT as "remitted". credit - debit (the balance) is unchanged.
      $group: {
        _id: {
          accountId: "$accountId",
          direction: "$direction",
          remittance: { $eq: ["$sourceTransactionType", "tax_remittance"] },
        },
        total: { $sum: "$amount" },
      },
    },
  ]).allowDiskUse(true);

  const map = new Map();
  for (const row of rows) {
    const key   = String(row._id.accountId);
    const entry = map.get(key) || { credit: 0, debit: 0, remittedDebit: 0, adjustmentDebit: 0 };
    if (row._id.direction === "credit") entry.credit = round2(entry.credit + row.total);
    if (row._id.direction === "debit") {
      entry.debit = round2(entry.debit + row.total);
      if (row._id.remittance) entry.remittedDebit = round2(entry.remittedDebit + row.total);
      else entry.adjustmentDebit = round2(entry.adjustmentDebit + row.total);
    }
    map.set(key, entry);
  }
  return map;
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/vat-remittance/summary?business=&year=&month=
// Returns VAT collected, already remitted, and balance due for the period.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const getVatReturnSummary = async (req, res, next) => {
  try {
    const businessId = resolveOwnBusinessId(req, req.query.business);
    const year       = parseInt(req.query.year  || new Date().getFullYear(),  10);
    const month      = parseInt(req.query.month || (new Date().getMonth() + 1), 10);

    if (!businessId || !mongoose.Types.ObjectId.isValid(businessId)) {
      return next(createError(400, "Valid business ID is required."));
    }
    if (month < 1 || month > 12 || Number.isNaN(year)) {
      return next(createError(400, "Valid year and month (1-12) are required."));
    }

    const periodStart = new Date(year, month - 1, 1);
    const periodEnd   = new Date(year, month, 0, 23, 59, 59, 999);

    const [companyTaxConfig, remittances] = await Promise.all([
      getCompanyTaxConfiguration(businessId).catch(() => null),
      TaxRemittance.find({
        business: businessId,
        periodYear: year,
        periodMonth: month,
        taxType: "vat_output",
        status: { $ne: "voided" },
      }).sort({ createdAt: -1 }).lean(),
    ]);

    const vatAccounts   = await resolveVatAccounts(businessId, companyTaxConfig);
    const vatAccountIds = vatAccounts.map((a) => a._id);
    const totalsMap     = await aggregateVatForPeriod(businessId, vatAccountIds, periodStart, periodEnd);

    const breakdown = vatAccounts.map((account) => {
      const totals       = totalsMap.get(String(account._id)) || { credit: 0, debit: 0, remittedDebit: 0, adjustmentDebit: 0 };
      const vatCharged   = round2(totals.credit);
      const vatAdjustments = round2(totals.adjustmentDebit || 0);
      const vatCollected = round2(vatCharged - vatAdjustments);
      const vatRemitted  = round2(totals.remittedDebit || 0);
      return {
        accountId:    String(account._id),
        accountCode:  account.code,
        accountName:  account.name,
        vatCharged,
        vatAdjustments,
        vatCollected,
        vatRemitted,
        balance: round2(vatCollected - vatRemitted),
      };
    });

    const totalCollected = round2(breakdown.reduce((s, b) => s + b.vatCollected, 0));
    const totalRemitted  = round2(breakdown.reduce((s, b) => s + b.vatRemitted,  0));
    const balanceDue     = round2(totalCollected - totalRemitted);

    return res.status(200).json({
      periodYear:     year,
      periodMonth:    month,
      periodLabel:    new Date(year, month - 1, 1).toLocaleString("en-KE", { month: "long", year: "numeric" }),
      breakdown,
      totalCollected,
      totalRemitted,
      balanceDue,
      remittances,
    });
  } catch (err) {
    return next(err);
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/vat-remittance?business=&year=
// Lists all remittances for a business, optionally filtered by year.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const getRemittanceHistory = async (req, res, next) => {
  try {
    const { year } = req.query;
    const businessId = resolveOwnBusinessId(req, req.query.business);
    if (!businessId || !mongoose.Types.ObjectId.isValid(businessId)) {
      return next(createError(400, "Valid business ID is required."));
    }

    const filter = { business: businessId, taxType: "vat_output" };
    if (year) filter.periodYear = parseInt(year, 10);

    const remittances = await TaxRemittance.find(filter)
      .sort({ periodYear: -1, periodMonth: -1, createdAt: -1 })
      .populate("cashbookAccountId", "code name")
      .populate("createdBy", "username")
      .lean();

    return res.status(200).json(remittances);
  } catch (err) {
    return next(err);
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/vat-remittance/remit
// Records a VAT payment to KRA.
//
// GL entries posted:
//   Dr VAT Payable 2140  (amount from PM module, proportional)   â† reduces liability
//   Dr VAT Payable 2190  (amount from inventory module, proportional) â† reduces liability
//   Cr Cashbook           (total paid to KRA)                    â† cash out
//
// All legs share the same journalGroupId.
// If GL posting fails after TaxRemittance creation, the record is deleted to
// prevent an orphaned document with no matching GL entries.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const remitVat = async (req, res, next) => {
  let remittance = null;

  try {
    const {
      year,
      month,
      amountRemitted,
      paymentDate,
      paymentReference,
      cashbookAccountId,
      notes,
    } = req.body;
    const businessId = resolveOwnBusinessId(req, req.body.business);

    if (!businessId || !mongoose.Types.ObjectId.isValid(businessId)) {
      return next(createError(400, "Valid business ID is required."));
    }
    if (!year || !month || Number(month) < 1 || Number(month) > 12) {
      return next(createError(400, "Valid year and month (1-12) are required."));
    }
    if (!amountRemitted || Number(amountRemitted) <= 0) {
      return next(createError(400, "Amount remitted must be greater than zero."));
    }
    if (!paymentDate) {
      return next(createError(400, "Payment date is required."));
    }
    if (!cashbookAccountId || !mongoose.Types.ObjectId.isValid(cashbookAccountId)) {
      return next(createError(400, "A valid cashbook account is required."));
    }

    const amount      = round2(Number(amountRemitted));
    const txDate      = new Date(paymentDate);
    const periodStart = new Date(Number(year), Number(month) - 1, 1);
    const periodEnd   = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);

    const [actorUserId, cashbookAccount, companyTaxConfig, priorRemittances] = await Promise.all([
      resolveAuditActorUserId({ req, businessId }),
      ChartOfAccount.findOne({
        _id: cashbookAccountId,
        business: businessId,
        isActive: { $ne: false },
        isPosting: { $ne: false },
        isHeader: { $ne: true },
      }).select("_id code name").lean(),
      getCompanyTaxConfiguration(businessId).catch(() => null),
      // Compute prior remittances for this period to snapshot alreadyRemitted correctly
      TaxRemittance.find({
        business: businessId,
        periodYear:  Number(year),
        periodMonth: Number(month),
        taxType: "vat_output",
        status: { $ne: "voided" },
      }).select("amountRemitted").lean(),
    ]);

    if (!cashbookAccount) {
      return next(createError(404, "Cashbook account not found or is inactive."));
    }

    const alreadyRemitted = round2(
      priorRemittances.reduce((s, r) => s + Number(r.amountRemitted || 0), 0)
    );

    const vatAccounts = await resolveVatAccounts(businessId, companyTaxConfig);
    if (!vatAccounts.length) {
      return next(createError(500, "No VAT Payable account found for this business. Ensure accounts are seeded."));
    }

    // Compute outstanding balance per VAT account for the period
    const totalsMap = await aggregateVatForPeriod(businessId, vatAccounts.map((a) => a._id), periodStart, periodEnd);

    const balancePerAccount = vatAccounts.map((account) => {
      const totals  = totalsMap.get(String(account._id)) || { credit: 0, debit: 0 };
      return { account, balance: Math.max(0, round2(totals.credit - totals.debit)) };
    });

    const totalBalance       = round2(balancePerAccount.reduce((s, b) => s + b.balance, 0));
    const vatAccount2140Amount = round2(balancePerAccount.find((b) => b.account.code === "2140")?.balance ?? 0);
    const vatAccount2190Amount = round2(balancePerAccount.find((b) => b.account.code === "2190")?.balance ?? 0);
    const periodLabel = new Date(Number(year), Number(month) - 1, 1)
      .toLocaleString("en-KE", { month: "long", year: "numeric" });

    // Claim the payment reference ONCE, before the transaction even opens — session.withTransaction
    // below will silently retry its whole callback on a transient transaction error, and
    // claimPaymentReference/releasePaymentReference don't take a session (PaymentReferenceLock
    // can't join the Mongo transaction), so claiming it from inside a retryable callback can
    // double-claim the same reference against itself on retry. Pre-generating the TaxRemittance's
    // _id lets the claim (keyed to that id) happen up front, outside any retry loop, while the
    // record itself is still created inside the transaction below.
    const remittanceId = new mongoose.Types.ObjectId();
    await claimPaymentReference({ business: businessId, reference: paymentReference, sourceModel: "TaxRemittance", sourceId: remittanceId });

    let touchedAccountIds = [];

    // The TaxRemittance record and every GL leg below are wrapped in one Mongo transaction instead
    // of create-then-post-then-manually-delete-on-catch. The old manual rollback
    // (TaxRemittance.deleteOne + FinancialLedgerEntry.deleteMany) assumed "the call threw => nothing
    // was written" - false under a ghost write (a write that commits on the primary but loses its
    // acknowledgment, e.g. a dropped connection or a replica election mid-request), which can leave
    // one GL leg inserted with no offsetting leg and no TaxRemittance left to explain it. A real
    // transaction rolls back every write from this attempt atomically, inserts included, if any
    // step fails. If the transaction itself fails after the reference was already claimed above,
    // the claim is released as an explicit compensating action in the outer catch below.
    const session = await mongoose.startSession();
    try {
      try {
        await session.withTransaction(async () => {
          touchedAccountIds = [];

          // Create the TaxRemittance record before posting GL so its _id is the sourceTransactionId
          [remittance] = await TaxRemittance.create([{
            _id: remittanceId,
            business: businessId,
            periodYear:  Number(year),
            periodMonth: Number(month),
            taxType: "vat_output",
            vatAccount2140Amount,
            vatAccount2190Amount,
            totalOutputVat:  totalBalance,
            alreadyRemitted,
            amountRemitted:  amount,
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
            payer:    "n/a",
            receiver: "n/a",
            notes:    `KRA VAT remittance â€“ ${periodLabel}${paymentReference ? ` (Ref: ${paymentReference})` : ""}`,
            createdBy:    actorUserId,
            approvedBy:   actorUserId,
            approvedAt:   new Date(),
            status:       "approved",
            allowUnscoped: true,
          };

          // Proportionally debit each VAT account based on outstanding balance.
          // Ensures 2140 and 2190 are independently reduced â€” not lumped onto one account.
          let remaining = amount;
          for (const { account, balance } of balancePerAccount) {
            if (balance <= 0 || remaining <= 0) continue;
            const share = totalBalance > 0
              ? round2((balance / totalBalance) * amount)
              : remaining;
            const debitAmount = round2(Math.min(remaining, share));
            if (debitAmount <= 0) continue;

            await postEntry({
              ...commonEntry,
              accountId: account._id,
              amount:    debitAmount,
              direction: "debit",
              metadata:  { postingRole: "vat_payable_reduction", accountCode: account.code },
              session,
            });

            touchedAccountIds.push(account._id);
            remaining = round2(remaining - debitAmount);
          }

          // Absorb any sub-cent rounding dust into the primary VAT account
          if (remaining > 0.009 && balancePerAccount[0]?.account) {
            await postEntry({
              ...commonEntry,
              accountId: balancePerAccount[0].account._id,
              amount:    remaining,
              direction: "debit",
              metadata:  { postingRole: "vat_payable_rounding", accountCode: balancePerAccount[0].account.code },
              session,
            });
            touchedAccountIds.push(balancePerAccount[0].account._id);
          }

          // Credit cashbook â€” cash leaves the business to KRA
          await postEntry({
            ...commonEntry,
            accountId: cashbookAccountId,
            amount,
            direction: "credit",
            metadata:  { postingRole: "cashbook_outflow", kraReference: paymentReference || "" },
            session,
          });
          touchedAccountIds.push(cashbookAccountId);

          // Persist journalGroupId back onto the remittance record
          remittance.journalGroupId = journalGroupId;
          await remittance.save({ session });
        });
      } finally {
        await session.endSession();
      }
    } catch (err) {
      await releasePaymentReference({ business: businessId, reference: paymentReference, sourceModel: "TaxRemittance", sourceId: remittanceId }).catch(() => {});
      throw err;
    }

    // Refresh cached account balances (non-blocking)
    aggregateChartOfAccountBalances(businessId, touchedAccountIds).catch(() => {});

    return res.status(201).json(remittance);
  } catch (err) {
    return next(err);
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PATCH /api/vat-remittance/:id/void
// Reverses all GL entries for a remittance and marks it voided.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const voidRemittance = async (req, res, next) => {
  try {
    const { id }     = req.params;
    const { reason } = req.body;
    const businessId = resolveOwnBusinessId(req, req.body.business);

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return next(createError(400, "Valid remittance ID is required."));
    }
    if (!businessId) return next(createError(400, "Business ID is required."));

    const remittance = await TaxRemittance.findOne({ _id: id, business: businessId, taxType: "vat_output" });
    if (!remittance)              return next(createError(404, "VAT remittance not found."));
    if (remittance.status === "voided") return next(createError(400, "Remittance is already voided."));

    const actorUserId = await resolveAuditActorUserId({ req, businessId });

    // Reverse all active GL entries linked to this remittance
    const entries = await FinancialLedgerEntry.find({
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
          const reversal = await postReversal({ entryId: entry._id, reason: reason || "Remittance voided", userId: actorUserId, session });
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
    await releasePaymentReference({ business: businessId, reference: remittance.paymentReference, sourceModel: "TaxRemittance", sourceId: remittance._id }).catch(() => {});

    aggregateChartOfAccountBalances(businessId, touchedAccountIds).catch(() => {});

    return res.status(200).json(remittance);
  } catch (err) {
    return next(err);
  }
};

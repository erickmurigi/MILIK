import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import RentPayment from "../../models/RentPayment.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import Unit from "../../models/Unit.js";
import Property from "../../models/Property.js";
import { postEntry } from "../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { ensureSystemChartOfAccounts, findSystemAccountByCode } from "../../services/chartOfAccountsService.js";

export const checkInvoiceLedgerEntries = async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { period } = req.query;
    const businessId = req.user?.company;

    if (!businessId) {
      return res.status(400).json({ error: "Business context required" });
    }

    let periodStart;
    let periodEnd;
    if (period) {
      const [year, month] = period.split("-").map(Number);
      periodStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
      periodEnd = new Date(year, month, 0, 23, 59, 59, 999);
    }

    const invoiceQuery = { business: businessId };
    if (propertyId) invoiceQuery.property = propertyId;
    if (periodStart && periodEnd) invoiceQuery.invoiceDate = { $gte: periodStart, $lte: periodEnd };

    const invoices = await TenantInvoice.find(invoiceQuery)
      .populate("tenant", "name")
      .populate("unit", "unitNumber property")
      .lean();

    const diagnostics = await Promise.all(
      invoices.map(async (invoice) => {
        const ledgerEntries = await FinancialLedgerEntry.find({
          business: businessId,
          sourceTransactionType: "invoice",
          sourceTransactionId: String(invoice._id),
          status: { $ne: "void" },
        }).lean();

        return {
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          tenant: invoice.tenant?.name || "Unknown",
          unit: invoice.unit?.unitNumber || "Unknown",
          amount: invoice.amount,
          category: invoice.category,
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate,
          status: invoice.status,
          ledgerCount: ledgerEntries.length,
          hasLedgerEntry: ledgerEntries.length > 0,
          ledgerEntries,
        };
      })
    );

    return res.status(200).json({
      diagnostics,
      summary: {
        totalInvoices: diagnostics.length,
        invoicesWithLedger: diagnostics.filter((row) => row.hasLedgerEntry).length,
        invoicesWithoutLedger: diagnostics.filter((row) => !row.hasLedgerEntry).length,
        invoicesWithUnexpectedLegCount: diagnostics.filter((row) => row.ledgerCount !== 2).length,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const resolveTenantReceivableAccount = async (businessId) => {
  await ensureSystemChartOfAccounts(businessId);

  const exact = await findSystemAccountByCode(businessId, "1200");
  if (exact) return exact;

  const fallback = await ChartOfAccount.findOne({
    business: businessId,
    type: "asset",
    $or: [
      { name: { $regex: "^tenant receivable", $options: "i" } },
      { name: { $regex: "accounts receivable", $options: "i" } },
      { name: { $regex: "receivable", $options: "i" } },
    ],
  }).lean();

  if (!fallback) {
    throw new Error("Tenant receivable account not found for invoice reposting.");
  }

  return fallback;
};

export const repostInvoicesToLedger = async (req, res) => {
  try {
    const { propertyId, period } = req.body;
    const businessId = req.user?.company;
    const userId = req.user?._id || req.user?.id;

    if (!businessId || !userId) {
      return res.status(400).json({ error: "Authentication required" });
    }

    let periodStart;
    let periodEnd;
    if (period) {
      const [year, month] = period.split("-").map(Number);
      periodStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
      periodEnd = new Date(year, month, 0, 23, 59, 59, 999);
    }

    const invoiceQuery = { business: businessId };
    if (propertyId) invoiceQuery.property = propertyId;
    if (periodStart && periodEnd) invoiceQuery.invoiceDate = { $gte: periodStart, $lte: periodEnd };

    const invoices = await TenantInvoice.find(invoiceQuery).lean();
    let posted = 0;
    let skipped = 0;
    const errors = [];
    const touchedAccountIds = new Set();

    for (const invoice of invoices) {
      const existingLedgerEntries = await FinancialLedgerEntry.find({
        business: businessId,
        sourceTransactionType: "invoice",
        sourceTransactionId: String(invoice._id),
        status: { $ne: "void" },
      }).lean();

      if (existingLedgerEntries.length > 0) {
        skipped += 1;
        existingLedgerEntries.forEach((entry) => entry.accountId && touchedAccountIds.add(String(entry.accountId)));
        continue;
      }

      try {
        const receivableAccount = await resolveTenantReceivableAccount(invoice.business);
        const txDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date();
        const monthStart = new Date(txDate.getFullYear(), txDate.getMonth(), 1, 0, 0, 0, 0);
        const monthEnd = new Date(txDate.getFullYear(), txDate.getMonth() + 1, 0, 23, 59, 59, 999);
        const journalGroupId = invoice.journalGroupId || undefined;

        const receivableEntry = await postEntry({
          business: invoice.business,
          property: invoice.property,
          landlord: invoice.landlord,
          tenant: invoice.tenant,
          unit: invoice.unit,
          sourceTransactionType: "invoice",
          sourceTransactionId: String(invoice._id),
          transactionDate: txDate,
          statementPeriodStart: monthStart,
          statementPeriodEnd: monthEnd,
          category: invoice.category,
          amount: Math.abs(Number(invoice.amount || 0)),
          direction: "debit",
          debit: Math.abs(Number(invoice.amount || 0)),
          credit: 0,
          accountId: receivableAccount._id,
          journalGroupId,
          payer: "tenant",
          receiver: "manager",
          notes: `Rebuilt receivable leg for invoice ${invoice.invoiceNumber}`,
          metadata: {
            includeInLandlordStatement: true,
            includeInCategoryTotals: true,
            rebuiltByDiagnostics: true,
          },
          createdBy: userId,
          approvedBy: userId,
          approvedAt: new Date(),
          status: "approved",
        });

        const incomeEntry = await postEntry({
          business: invoice.business,
          property: invoice.property,
          landlord: invoice.landlord,
          tenant: invoice.tenant,
          unit: invoice.unit,
          sourceTransactionType: "invoice",
          sourceTransactionId: String(invoice._id),
          transactionDate: txDate,
          statementPeriodStart: monthStart,
          statementPeriodEnd: monthEnd,
          category: invoice.category,
          amount: Math.abs(Number(invoice.amount || 0)),
          direction: "credit",
          debit: 0,
          credit: Math.abs(Number(invoice.amount || 0)),
          accountId: invoice.chartAccount,
          journalGroupId,
          payer: "tenant",
          receiver: "manager",
          notes: `Rebuilt income leg for invoice ${invoice.invoiceNumber}`,
          metadata: {
            includeInLandlordStatement: false,
            includeInCategoryTotals: false,
            rebuiltByDiagnostics: true,
          },
          createdBy: userId,
          approvedBy: userId,
          approvedAt: new Date(),
          status: "approved",
        });

        touchedAccountIds.add(String(receivableEntry.accountId || ""));
        touchedAccountIds.add(String(incomeEntry.accountId || ""));
        posted += 1;
      } catch (err) {
        errors.push({
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          error: err.message,
        });
      }
    }

    if (touchedAccountIds.size > 0) {
      await aggregateChartOfAccountBalances(businessId, Array.from(touchedAccountIds).filter(Boolean));
    }

    return res.json({
      success: true,
      posted,
      skipped,
      errors,
      message: `Rebuilt ledger for ${posted} invoice(s); skipped ${skipped} invoice(s) that already had ledger entries.`,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Repost failed" });
  }
};

export const recomputeChartBalances = async (req, res) => {
  try {
    const businessId = req.user?.company;
    if (!businessId) {
      return res.status(400).json({ error: "Business context required" });
    }

    const accounts = await ChartOfAccount.find({ business: businessId }).select("_id").lean();
    const updated = await aggregateChartOfAccountBalances(
      businessId,
      accounts.map((account) => account._id)
    );

    return res.json({
      success: true,
      count: updated.length,
      message: "Chart of account balances were recomputed from immutable ledger entries.",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Balance recompute failed" });
  }
};

export const checkUtilityReceiptLedgerEntries = async (req, res) => {
  try {
    const { propertyId, landlordId, periodStart, periodEnd } = req.query;
    const match = {
      status: "approved",
      category: { $in: ["UTILITY_RECEIPT_MANAGER", "UTILITY_RECEIPT_LANDLORD"] },
    };

    if (propertyId) match.property = propertyId;
    if (landlordId) match.landlord = landlordId;
    if (periodStart || periodEnd) {
      match.transactionDate = {};
      if (periodStart) match.transactionDate.$gte = new Date(periodStart);
      if (periodEnd) match.transactionDate.$lte = new Date(periodEnd);
    }

    const entries = await FinancialLedgerEntry.find(match).lean();
    return res.json({ count: entries.length, entries });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

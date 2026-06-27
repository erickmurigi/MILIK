import express from "express";
import mongoose from "mongoose";
import { requireCompanyModule, verifyUser, GL_ACCESS_MODULES } from "../controllers/verifyToken.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import TenantInvoice from "../models/TenantInvoice.js";
import Property from "../models/Property.js";
import {
  ensureSystemChartOfAccounts,
  findChartOfAccounts,
  normalizeChartAccountPayload,
} from "../services/chartOfAccountsService.js";
import { aggregateChartOfAccountBalances } from "../services/chartAccountAggregationService.js";
import { postCorrection } from "../services/ledgerPostingService.js";
import {
  entrySignedForAccount,
  normalizeAccountGroup,
  getNormalBalanceSide,
  getSubGroupOptionsForType,
} from "../services/accountingClassificationService.js";

const router = express.Router();

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const PROTECTED_CODES = new Set(["1200", "4100", "4102"]);

const resolveBusiness = (req) => {
  const requested = req.query.business || req.body.business || null;
  const authenticated = req.user?.company?._id || req.user?.company || null;

  if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
    return requested || authenticated || null;
  }

  return authenticated || requested || null;
};

const hasLedgerAdminAccess = (user = {}) => {
  if (user?.superAdminAccess || user?.adminAccess || user?.isSystemAdmin) return true;
  const profile = String(user?.profile || "").toLowerCase();
  if (["administrator", "accountant"].includes(profile)) return true;
  const accountAccess = String(user?.moduleAccess?.accounts || "").toLowerCase();
  return accountAccess === "full access";
};

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const normalizeDate = (value, edge = "start") => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (edge === "end") date.setHours(23, 59, 59, 999);
  else date.setHours(0, 0, 0, 0);
  return date;
};

const isTruthy = (value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const buildLedgerActivityMatch = ({ business, accountId, start, end, direction, sourceTransactionType, includeReversed = false }) => {
  const match = {
    business: toObjectId(business),
    accountId: toObjectId(accountId),
    status: includeReversed ? { $nin: ["void", "draft"] } : { $nin: ["void", "draft", "reversed"] },
  };

  if (!includeReversed) {
    match.reversalOf = null;
  }

  if (direction === "debit" || direction === "credit") {
    match.direction = direction;
  }

  if (sourceTransactionType) {
    match.sourceTransactionType = sourceTransactionType;
  }

  if (start || end) {
    match.transactionDate = {};
    if (start) match.transactionDate.$gte = start;
    if (end) match.transactionDate.$lte = end;
  }

  return match;
};

const decorateLedgerActivityEntry = (entry = {}) => ({
  ...entry,
  isReversalEntry: Boolean(entry?.reversalOf),
  isReversedOriginal: String(entry?.status || "").toLowerCase() === "reversed",
  auditDisplayType: entry?.reversalOf
    ? "reversal_entry"
    : String(entry?.status || "").toLowerCase() === "reversed"
    ? "reversed_original"
    : "live_entry",
  auditLinkId: entry?.reversalOf || entry?.reversedByEntry || null,
});

const serializeAccount = (account = {}) => ({
  ...account,
  group: normalizeAccountGroup(account.group, account.type),
  normalBalanceSide: getNormalBalanceSide(account.type),
  allowedSubGroups: getSubGroupOptionsForType(account.type),
  accountClass: String(account.subGroup || "").trim() || "",
});

router.get("/", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), async (req, res) => {
  try {
    const business = resolveBusiness(req);

    if (!business) {
      return res.status(400).json({
        error: "business query parameter is required",
      });
    }

    await ensureSystemChartOfAccounts(business);
    await aggregateChartOfAccountBalances(business);

    const accounts = await findChartOfAccounts({
      businessId: business,
      code: req.query.code || null,
      type: req.query.type || null,
      group: req.query.group || null,
      search: req.query.search || null,
      moduleScope: req.query.moduleScope || null,
    });

    return res.status(200).json(accounts.map(serializeAccount));
  } catch (err) {
    console.error("Failed to fetch ChartOfAccounts:", err);
    return res.status(500).json({
      error: err?.message || "Failed to fetch ChartOfAccounts",
    });
  }
});

router.get("/:id/activity", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), async (req, res) => {
  try {
    const business = resolveBusiness(req);
    const { id } = req.params;
    const { startDate, endDate, direction, sourceTransactionType, includeReversed } = req.query;

    if (!business) {
      return res.status(400).json({ error: "business is required" });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid chart account id" });
    }

    // Fetch account without recomputing balance snapshot — activity computes its own
    const account = await ChartOfAccount.findOne({ _id: id, business })
      .populate("parentAccount", "code name")
      .lean();

    if (!account) {
      return res.status(404).json({ error: "Chart account not found" });
    }

    const start = normalizeDate(startDate, "start");
    const end = normalizeDate(endDate, "end");

    const shouldIncludeReversed = isTruthy(includeReversed);

    const match = buildLedgerActivityMatch({
      business,
      accountId: id,
      start,
      end,
      direction,
      sourceTransactionType,
      includeReversed: shouldIncludeReversed,
    });

    // Opening balance via aggregation — avoids loading N full documents just to sum amounts
    let openingBalance = 0;
    if (start) {
      const openingMatch = buildLedgerActivityMatch({
        business,
        accountId: id,
        start: null,
        end: null,
        direction,
        sourceTransactionType,
        includeReversed: shouldIncludeReversed,
      });
      openingMatch.transactionDate = { $lt: start };

      const normalSide = getNormalBalanceSide(account.type);
      const [agg] = await FinancialLedgerEntry.aggregate([
        { $match: openingMatch },
        {
          $group: {
            _id: null,
            debitSum:  { $sum: { $cond: [{ $eq: ["$direction", "debit"]  }, "$amount", 0] } },
            creditSum: { $sum: { $cond: [{ $eq: ["$direction", "credit"] }, "$amount", 0] } },
          },
        },
      ]);
      openingBalance = normalSide === "debit"
        ? (agg?.debitSum || 0) - (agg?.creditSum || 0)
        : (agg?.creditSum || 0) - (agg?.debitSum || 0);
    }

    // Load entries — skip PM-specific populates (tenant/unit/property/landlord are null for carwash)
    const entries = await FinancialLedgerEntry.find(match)
      .sort({ transactionDate: 1, createdAt: 1, _id: 1 })
      .populate("accountId", "code name type")
      .populate("createdBy", "firstName lastName")
      .lean();

    // For reversed entries, look up the creator of the reversal entry to show a name
    const reversedByEntryIds = entries.filter((e) => e.reversedByEntry).map((e) => e.reversedByEntry);
    const reversalCreatorMap = new Map();
    if (reversedByEntryIds.length > 0) {
      const reversalEntries = await FinancialLedgerEntry.find({ _id: { $in: reversedByEntryIds } })
        .select("_id createdBy")
        .populate("createdBy", "firstName lastName")
        .lean();
      for (const re of reversalEntries) {
        const u = re.createdBy;
        reversalCreatorMap.set(
          String(re._id),
          u ? [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || null : null
        );
      }
    }

    let runningBalance = openingBalance;
    const rows = entries.map((entry) => {
      runningBalance += entrySignedForAccount(entry, account.type);
      const u = entry.createdBy;
      const createdByName = u ? [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || null : null;
      const reversedByUserName = entry.reversedByEntry
        ? reversalCreatorMap.get(String(entry.reversedByEntry)) || null
        : null;
      return decorateLedgerActivityEntry({
        ...entry,
        runningBalance,
        createdByName,
        reversedByUserName,
      });
    });

    return res.status(200).json({
      success: true,
      data: {
        account: serializeAccount(account),
        includeReversed: shouldIncludeReversed,
        openingBalance,
        closingBalance: runningBalance,
        count: rows.length,
        entries: rows,
      },
    });
  } catch (err) {
    console.error("Failed to fetch chart account activity:", err);
    return res.status(500).json({
      error: err?.message || "Failed to fetch chart account activity",
    });
  }
});

router.post("/activity/:entryId/reclassify", verifyUser, requireCompanyModule("accounts"), async (req, res) => {
  try {
    if (!hasLedgerAdminAccess(req.user)) {
      return res.status(403).json({ error: "Only accountant/admin users can reclassify ledger entries." });
    }

    const business = resolveBusiness(req);
    const { entryId } = req.params;
    const { newAccountId, reason } = req.body || {};

    if (!business) {
      return res.status(400).json({ error: "business is required" });
    }

    if (!isValidObjectId(entryId) || !isValidObjectId(newAccountId)) {
      return res.status(400).json({ error: "Valid entryId and newAccountId are required" });
    }

    const [entry, newAccount] = await Promise.all([
      FinancialLedgerEntry.findOne({ _id: entryId, business }),
      ChartOfAccount.findOne({ _id: newAccountId, business }),
    ]);

    if (!entry) {
      return res.status(404).json({ error: "Ledger entry not found" });
    }

    if (!newAccount) {
      return res.status(404).json({ error: "Destination account not found" });
    }

    if (!newAccount.isPosting || newAccount.isHeader) {
      return res.status(400).json({ error: "Destination account must be a posting ledger account" });
    }

    if (String(entry.accountId || "") === String(newAccount._id)) {
      return res.status(400).json({ error: "Entry is already posted to that account" });
    }

    if (entry.status === "reversed") {
      return res.status(400).json({ error: "Reversed entries cannot be reclassified" });
    }

    const actorId = req.user?._id || req.user?.id;

    const correction = await postCorrection({
      entryId,
      reason: reason || `Reclassified from account ${entry.accountId} to ${newAccount._id}`,
      userId: actorId,
      correctedPayload: {
        accountId: newAccount._id,
        category: entry.category,
        amount: entry.amount,
        direction: entry.direction,
        notes: reason || entry.notes || `Reclassified ledger entry ${entry._id}`,
        metadata: {
          ...(entry.metadata || {}),
          reclassifiedFromAccountId: String(entry.accountId || ""),
          reclassifiedToAccountId: String(newAccount._id),
        },
      },
    });

    await aggregateChartOfAccountBalances(business, [entry.accountId, newAccount._id]);

    return res.status(200).json({
      success: true,
      message: "Ledger entry reclassified successfully",
      data: {
        originalEntryId: correction.originalEntry._id,
        reversalEntryId: correction.reversalEntry._id,
        correctedEntryId: correction.correctedEntry._id,
      },
    });
  } catch (err) {
    console.error("Failed to reclassify ledger entry:", err);
    return res.status(500).json({
      error: err?.message || "Failed to reclassify ledger entry",
    });
  }
});

router.post("/", verifyUser, requireCompanyModule("accounts"), async (req, res) => {
  try {
    const business = resolveBusiness(req);

    if (!business) {
      return res.status(400).json({ error: "business is required" });
    }

    const payload = normalizeChartAccountPayload(req.body);

    if (!payload.code || !payload.name || !payload.type) {
      return res.status(400).json({
        error: "code, name and type are required",
      });
    }

    await ensureSystemChartOfAccounts(business);

    const existing = await ChartOfAccount.findOne({
      business,
      code: payload.code,
    }).lean();

    if (existing) {
      return res.status(409).json({
        error: "Account code already exists for this business",
      });
    }

    let parentAccount = null;
    let level = 0;

    if (payload.parentAccount) {
      if (!isValidObjectId(payload.parentAccount)) {
        return res.status(400).json({
          error: "parentAccount must be a valid account id",
        });
      }

      parentAccount = await ChartOfAccount.findOne({
        _id: payload.parentAccount,
        business,
      });

      if (!parentAccount) {
        return res.status(404).json({
          error: "Parent account not found for this business",
        });
      }

      level = Number(parentAccount.level || 0) + 1;

      payload.type = parentAccount.type;
      payload.group = normalizeAccountGroup(parentAccount.group, parentAccount.type);
      if (!payload.subGroup) {
        payload.subGroup = String(parentAccount.subGroup || "").trim();
      }
    }

    const account = await ChartOfAccount.create({
      business,
      code: payload.code,
      name: payload.name,
      type: payload.type,
      group: payload.group,
      subGroup: payload.subGroup,
      parentAccount: parentAccount?._id || null,
      level,
      isHeader: payload.isHeader,
      isPosting: payload.isHeader ? false : payload.isPosting,
      isSystem: false,
      moduleScopes: payload.moduleScopes || [],
      balance: 0,
    });

    const populated = await ChartOfAccount.findById(account._id).populate("parentAccount", "code name type group subGroup").lean();
    return res.status(201).json(serializeAccount(populated));
  } catch (err) {
    console.error("Failed to create ChartOfAccount:", err);
    return res.status(500).json({
      error: err?.message || "Failed to create ChartOfAccount",
    });
  }
});

router.put("/:id", verifyUser, requireCompanyModule("accounts"), async (req, res) => {
  try {
    const business = resolveBusiness(req);
    const { id } = req.params;

    if (!business) {
      return res.status(400).json({ error: "business is required" });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid chart account id" });
    }

    const account = await ChartOfAccount.findOne({ _id: id, business });
    if (!account) {
      return res.status(404).json({ error: "Chart account not found" });
    }

    const payload = normalizeChartAccountPayload(req.body);

    if (!payload.code || !payload.name || !payload.type) {
      return res.status(400).json({
        error: "code, name and type are required",
      });
    }

    if (account.isSystem && PROTECTED_CODES.has(account.code)) {
      if (payload.code !== account.code || payload.type !== account.type) {
        return res.status(400).json({
          error: `Core account ${account.code} cannot change code or type.`,
        });
      }
    }

    const duplicate = await ChartOfAccount.findOne({
      business,
      code: payload.code,
      _id: { $ne: account._id },
    }).lean();

    if (duplicate) {
      return res.status(409).json({
        error: "Another account already uses that code",
      });
    }

    let parent = null;
    let level = 0;

    if (payload.parentAccount) {
      if (!isValidObjectId(payload.parentAccount)) {
        return res.status(400).json({ error: "parentAccount must be a valid account id" });
      }

      if (String(payload.parentAccount) === String(account._id)) {
        return res.status(400).json({ error: "An account cannot be its own parent" });
      }

      parent = await ChartOfAccount.findOne({
        _id: payload.parentAccount,
        business,
      });

      if (!parent) {
        return res.status(404).json({ error: "Parent account not found" });
      }

      level = Number(parent.level || 0) + 1;

      payload.type = parent.type;
      payload.group = normalizeAccountGroup(parent.group, parent.type);
      if (!payload.subGroup) {
        payload.subGroup = String(parent.subGroup || "").trim();
      }
    }

    account.code = payload.code;
    account.name = payload.name;
    account.type = payload.type;
    account.group = payload.group;
    account.subGroup = payload.subGroup;
    account.parentAccount = parent?._id || null;
    account.level = level;
    account.isHeader = payload.isHeader;
    account.isPosting = payload.isHeader ? false : payload.isPosting;
    if (payload.moduleScopes !== undefined) {
      account.moduleScopes = payload.moduleScopes;
    }

    await account.save();

    const populated = await ChartOfAccount.findById(account._id).populate("parentAccount", "code name type group subGroup").lean();
    return res.status(200).json(serializeAccount(populated));
  } catch (err) {
    console.error("Failed to update ChartOfAccount:", err);
    return res.status(500).json({
      error: err?.message || "Failed to update ChartOfAccount",
    });
  }
});

router.delete("/:id", verifyUser, requireCompanyModule("accounts"), async (req, res) => {
  try {
    const business = resolveBusiness(req);
    const { id } = req.params;

    if (!business) {
      return res.status(400).json({ error: "business is required" });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid chart account id" });
    }

    const account = await ChartOfAccount.findOne({ _id: id, business });
    if (!account) {
      return res.status(404).json({ error: "Chart account not found" });
    }

    if (PROTECTED_CODES.has(account.code)) {
      return res.status(400).json({
        error: `Core account ${account.code} cannot be deleted.`,
      });
    }

    const childCount = await ChartOfAccount.countDocuments({
      business,
      parentAccount: account._id,
    });

    if (childCount > 0) {
      return res.status(400).json({
        error: "This account has sub-accounts. Move or delete the children first.",
      });
    }

    const [ledgerUsage, invoiceUsage] = await Promise.all([
      FinancialLedgerEntry.countDocuments({ accountId: account._id }),
      TenantInvoice.countDocuments({ chartAccount: account._id }),
    ]);

    // Accounts with ledger or invoice history are soft-deleted (audit trail preserved).
    // Clean accounts with no history are physically removed.
    if (ledgerUsage > 0 || invoiceUsage > 0) {
      if (account.isActive === false) {
        return res.status(400).json({ error: "Account is already deactivated." });
      }
      account.isActive = false;
      account.deletedAt = new Date();
      account.deletedBy = req.user?._id || null;
      await account.save();
      return res.status(200).json({
        success: true,
        softDeleted: true,
        message: "Account deactivated — it has transaction history and cannot be physically removed. It is now inactive and will not appear in posting selectors.",
      });
    }

    await account.deleteOne();

    return res.status(200).json({
      success: true,
      softDeleted: false,
      message: "Chart account deleted successfully",
    });
  } catch (err) {
    console.error("Failed to delete ChartOfAccount:", err);
    return res.status(500).json({
      error: err?.message || "Failed to delete ChartOfAccount",
    });
  }
});

// One-time migration: remove property GL sub-accounts (1200-PRO001 etc.) and clean up
// the stale propertyAccounts field from Property documents.
// Safe to run multiple times. Requires admin access.
router.post("/admin/cleanup-property-sub-accounts", verifyUser, async (req, res) => {
  try {
    if (!req.user?.superAdminAccess && !req.user?.adminAccess && !req.user?.isSystemAdmin) {
      return res.status(403).json({ error: "Admin access required." });
    }

    const business = resolveBusiness(req);
    if (!business) {
      return res.status(400).json({ error: "business is required" });
    }

    // Delete all property-specific sub-accounts (have a property ref, code is NOT PCTRL-)
    const deleteResult = await ChartOfAccount.deleteMany({
      business,
      property: { $exists: true, $ne: null },
      code: { $not: /^PCTRL-/ },
    });

    // Remove stale propertyAccounts subdoc from Property documents
    const unsetResult = await Property.updateMany(
      { business, propertyAccounts: { $exists: true } },
      { $unset: { propertyAccounts: "" } }
    );

    return res.status(200).json({
      success: true,
      message: `Cleanup complete. ${deleteResult.deletedCount} sub-accounts deleted, ${unsetResult.modifiedCount} property documents cleaned.`,
      deletedAccounts: deleteResult.deletedCount,
      cleanedProperties: unsetResult.modifiedCount,
    });
  } catch (err) {
    console.error("Cleanup failed:", err);
    return res.status(500).json({ error: err?.message || "Cleanup failed" });
  }
});

export default router;

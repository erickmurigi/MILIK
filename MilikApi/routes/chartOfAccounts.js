import express from "express";
import mongoose from "mongoose";
import { requireCompanyModule, verifyUser } from "../controllers/verifyToken.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import TenantInvoice from "../models/TenantInvoice.js";
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

const serializeAccount = (account = {}) => ({
  ...account,
  group: normalizeAccountGroup(account.group, account.type),
  normalBalanceSide: getNormalBalanceSide(account.type),
  allowedSubGroups: getSubGroupOptionsForType(account.type),
  accountClass: String(account.subGroup || "").trim() || "",
});

router.get("/", verifyUser, requireCompanyModule("accounts"), async (req, res) => {
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
    });

    return res.status(200).json(accounts.map(serializeAccount));
  } catch (err) {
    console.error("Failed to fetch ChartOfAccounts:", err);
    return res.status(500).json({
      error: err?.message || "Failed to fetch ChartOfAccounts",
    });
  }
});

router.get("/:id/activity", verifyUser, requireCompanyModule("accounts"), async (req, res) => {
  try {
    const business = resolveBusiness(req);
    const { id } = req.params;
    const { startDate, endDate, direction, sourceTransactionType } = req.query;

    if (!business) {
      return res.status(400).json({ error: "business is required" });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid chart account id" });
    }

    await aggregateChartOfAccountBalances(business, [id]);

    const account = await ChartOfAccount.findOne({ _id: id, business })
      .populate("parentAccount", "code name")
      .lean();

    if (!account) {
      return res.status(404).json({ error: "Chart account not found" });
    }

    const start = normalizeDate(startDate, "start");
    const end = normalizeDate(endDate, "end");

    const match = {
      business: toObjectId(business),
      accountId: toObjectId(id),
      status: { $nin: ["void", "draft"] },
    };

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

    const openingMatch = {
      business: toObjectId(business),
      accountId: toObjectId(id),
      status: { $nin: ["void", "draft"] },
    };

    if (start) {
      openingMatch.transactionDate = { $lt: start };
    }

    const openingRows = start
      ? await FinancialLedgerEntry.find(openingMatch)
          .sort({ transactionDate: 1, createdAt: 1, _id: 1 })
          .lean()
      : [];

    let openingBalance = 0;
    for (const row of openingRows) {
      openingBalance += entrySignedForAccount(row, account.type);
    }

    const entries = await FinancialLedgerEntry.find(match)
      .sort({ transactionDate: 1, createdAt: 1, _id: 1 })
      .populate("tenant", "name tenantCode")
      .populate("unit", "unitNumber name")
      .populate("property", "propertyName propertyCode name")
      .populate("landlord", "firstName lastName")
      .populate("accountId", "code name type")
      .lean();

    let runningBalance = openingBalance;
    const rows = entries.map((entry) => {
      runningBalance += entrySignedForAccount(entry, account.type);
      return {
        ...entry,
        runningBalance,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        account: serializeAccount(account),
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
      balance: 0,
    });

    const populated = await ChartOfAccount.findById(account._id).populate("parentAccount", "code name type group subGroup");
    return res.status(201).json(serializeAccount(populated.toObject()));
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

    await account.save();

    const populated = await ChartOfAccount.findById(account._id).populate("parentAccount", "code name type group subGroup");
    return res.status(200).json(serializeAccount(populated.toObject()));
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

    if (ledgerUsage > 0 || invoiceUsage > 0) {
      return res.status(400).json({
        error: "This account is already used in transactions and cannot be deleted.",
      });
    }

    await account.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Chart account deleted successfully",
    });
  } catch (err) {
    console.error("Failed to delete ChartOfAccount:", err);
    return res.status(500).json({
      error: err?.message || "Failed to delete ChartOfAccount",
    });
  }
});

export default router;
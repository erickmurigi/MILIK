import express from "express";
import mongoose from "mongoose";
import { requireCompanyModule, requireCompanyPermission, verifyUser, verifyAdmin, GL_ACCESS_MODULES } from "../controllers/verifyToken.js";
import { resolveBusinessId } from "../utils/requestContext.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import TenantInvoice from "../models/TenantInvoice.js";
import Property from "../models/Property.js";
import RentPayment from "../models/RentPayment.js";
import LandlordReceipt from "../models/LandlordReceipt.js";
import BankReconciliation from "../models/BankReconciliation.js";
import Budget from "../models/Budget.js";
import {
  ensureSystemChartOfAccounts,
  findChartOfAccounts,
  normalizeChartAccountPayload,
  defaultScopesForNewAccount,
  getCompanyActiveScopes,
} from "../services/chartOfAccountsService.js";
import { aggregateChartOfAccountBalances, invalidateBalanceCache } from "../services/chartAccountAggregationService.js";
import { clearInvoiceAccountCache } from "../controllers/propertyController/tenantInvoices.js";
import { postCorrection } from "../services/ledgerPostingService.js";
import { resolveAuditActorUserId } from "../utils/systemActor.js";
import { findContraAccountIds } from "../services/glHealthChecks.js";
import {
  computeAccountBalance,
  normalizeAccountGroup,
  getNormalBalanceSide,
  getSubGroupOptionsForType,
} from "../services/accountingClassificationService.js";

const router = express.Router();

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const PROTECTED_CODES = new Set(["1200", "4100", "4102"]);

// A client-supplied business/company id is only honoured when the caller is actually entitled to act as that company
// (system admins, or a genuinely multi-company user) — the one rule every module now shares. Previously a non-admin
// whose own company was somehow blank on the request would fall straight through to an unverified client value, and a
// legitimate multi-company non-admin could never select anything but their primary company. See utils/requestContext.js.
const resolveBusiness = (req) => resolveBusinessId(req);

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

const buildLedgerActivityMatch = ({ business, accountId, start, end, direction, sourceTransactionType, property, includeReversed = false }) => {
  const match = {
    business: toObjectId(business),
    accountId: toObjectId(accountId),
    status: includeReversed ? { $nin: ["void", "draft"] } : { $nin: ["void", "draft", "reversed"] },
  };

  if (!includeReversed) {
    match.reversalOf = null;
    match.category = { $ne: "REVERSAL" };
  }

  if (direction === "debit" || direction === "credit") {
    match.direction = direction;
  }

  if (sourceTransactionType) {
    match.sourceTransactionType = sourceTransactionType;
  }

  // Optional — only meaningful for companies with the Property Management module; a shared
  // cashbook/ledger account (CarWash, HR, PropertySale, etc.) simply never sends this param.
  if (property && isValidObjectId(property)) {
    match.property = toObjectId(property);
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

const can = (action) => requireCompanyPermission("chartOfAccounts", action, "accounts");
const canCreate = can("create");
const canUpdate = can("update");
const canDelete = can("delete");

const serializeAccount = (account = {}) => ({
  ...account,
  group: normalizeAccountGroup(account.group, account.type),
  normalBalanceSide: getNormalBalanceSide(account.type),
  allowedSubGroups: getSubGroupOptionsForType(account.type),
  accountClass: String(account.subGroup || "").trim() || "",
});

// Debit and credit of a ledger row: explicit debit/credit first, direction + amount for older rows.
const debitExpr = {
  $cond: [{ $gt: ["$debit", 0] }, "$debit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] }, { $ifNull: ["$amount", 0] }, 0] }],
};
const creditExpr = {
  $cond: [{ $gt: ["$credit", 0] }, "$credit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] }, { $ifNull: ["$amount", 0] }, 0] }],
};
const entryDebit = (e) => (Number(e.debit) > 0 ? Number(e.debit) : String(e.direction).toLowerCase() === "debit" ? Number(e.amount || 0) : 0);
const entryCredit = (e) => (Number(e.credit) > 0 ? Number(e.credit) : String(e.direction).toLowerCase() === "credit" ? Number(e.amount || 0) : 0);

// The chart with every balance worked out from the ledger at read time, in two database round trips: the
// ledger totals, the company's modules and its contra accounts together, then the accounts. Stored balances that
// have drifted are written back in the background, so the page never waits on a write.
router.get("/", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), async (req, res) => {
  try {
    const business = resolveBusiness(req);

    if (!business) {
      return res.status(400).json({ success: false, status: 400, message: "business query parameter is required", error: "business query parameter is required" });
    }

    const businessOid = toObjectId(business);
    const [activeScopes, ledgerTotals, contraIds] = await Promise.all([
      getCompanyActiveScopes(businessOid),
      FinancialLedgerEntry.aggregate([
        { $match: { business: businessOid, status: { $nin: ["void", "draft"] } } },
        { $group: { _id: "$accountId", debit: { $sum: debitExpr }, credit: { $sum: creditExpr } } },
      ]).allowDiskUse(true),
      findContraAccountIds(businessOid),
    ]);
    const totals = new Map(ledgerTotals.filter((t) => t._id).map((t) => [String(t._id), t]));

    const accounts = await findChartOfAccounts({
      businessId: businessOid,
      code: req.query.code || null,
      type: req.query.type || null,
      group: req.query.group || null,
      search: req.query.search || null,
      moduleScope: req.query.moduleScope || null,
      activeScopes,
      // an account with postings is always listed, whatever module it is tagged for
      alwaysIncludeIds: ledgerTotals.map((t) => t._id).filter(Boolean),
    });

    const drifted = [];
    const rows = accounts.map((account) => {
      const t = totals.get(String(account._id)) || { debit: 0, credit: 0 };
      const balance = computeAccountBalance({ type: account.type, debit: t.debit, credit: t.credit });
      if (Number(account.balance || 0) !== Number(balance || 0)) {
        drifted.push({ updateOne: { filter: { _id: account._id }, update: { $set: { balance } } } });
      }
      // isContra: an account that rightly sits on the other side to its type (accumulated depreciation,
      // bad-debt allowances), so the page does not flag its balance as wrong-side.
      return { ...serializeAccount({ ...account, balance }), isContra: contraIds.has(String(account._id)) };
    });
    if (drifted.length) {
      ChartOfAccount.bulkWrite(drifted, { ordered: false }).catch((err) => console.error("Chart balance write-back failed:", err?.message));
    }

    return res.status(200).json(rows);
  } catch (err) {
    console.error("Failed to fetch ChartOfAccounts:", err);
    return res.status(500).json({ success: false, status: 500, message: err?.message || "Failed to fetch ChartOfAccounts", error: err?.message || "Failed to fetch ChartOfAccounts" });
  }
});

// Ledger activity for one account, newest first, a page at a time. Opening, closing, period totals and every
// running balance are summed in the database over the whole filtered ledger, so they stay right however many
// entries the account has. The debit/credit filter narrows the rows shown, never the balances.
//
// Everything runs in one parallel round trip: the account, one pass that sums opening + period + row count, the
// page itself (names joined in the same query), and the sum of entries newer than the page. The sort matches the
// { business, accountId, transactionDate, createdAt } index, so a page reads only its own rows.
const SORT_NEWEST = { transactionDate: -1, createdAt: -1 };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sumGroup = (expr) => ({ $sum: { $cond: [expr, 1, 0] } });
const userNameExpr = (path) => ({
  $let: {
    vars: { u: { $first: path } },
    in: {
      $cond: [
        { $or: [{ $not: ["$$u"] }, { $eq: ["$$u.isSystemAuditUser", true] }] },
        null,
        { $trim: { input: { $concat: [{ $ifNull: ["$$u.surname", ""] }, " ", { $ifNull: ["$$u.otherNames", ""] }] } } },
      ],
    },
  },
});
const lookupOne = (from, localField, project, as) => ({
  $lookup: { from, localField, foreignField: "_id", as, pipeline: [{ $project: project }] },
});

router.get("/:id/activity", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), async (req, res) => {
  try {
    const business = resolveBusiness(req);
    const { id } = req.params;
    const { startDate, endDate, direction, sourceTransactionType, includeReversed, property } = req.query;

    if (!business) {
      return res.status(400).json({ success: false, status: 400, message: "business is required", error: "business is required" });
    }
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, status: 400, message: "Invalid chart account id", error: "Invalid chart account id" });
    }

    const start = normalizeDate(startDate, "start");
    const end = normalizeDate(endDate, "end");
    const shouldIncludeReversed = isTruthy(includeReversed);
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const skip = (page - 1) * limit;
    const directionFilter = direction === "debit" || direction === "credit" ? direction : null;

    // everything up to the end date, so one pass yields both the opening and the period
    const scopeMatch = buildLedgerActivityMatch({ business, accountId: id, start: null, end, direction: null, sourceTransactionType, property, includeReversed: shouldIncludeReversed });
    const periodMatch = buildLedgerActivityMatch({ business, accountId: id, start, end, direction: null, sourceTransactionType, property, includeReversed: shouldIncludeReversed });
    const rowMatch = directionFilter ? { ...periodMatch, direction: directionFilter } : periodMatch;
    const inPeriod = start ? { $gte: ["$transactionDate", start] } : true;
    const isShown = directionFilter ? { $and: [inPeriod, { $eq: ["$direction", directionFilter] }] } : inPeriod;

    const [account, [sums = {}], entries, [newer = {}]] = await Promise.all([
      ChartOfAccount.findOne({ _id: id, business }).populate("parentAccount", "code name").lean(),
      FinancialLedgerEntry.aggregate([
        { $match: scopeMatch },
        {
          $group: {
            _id: null,
            openingDebit: { $sum: { $cond: [inPeriod, 0, debitExpr] } },
            openingCredit: { $sum: { $cond: [inPeriod, 0, creditExpr] } },
            periodDebit: { $sum: { $cond: [inPeriod, debitExpr, 0] } },
            periodCredit: { $sum: { $cond: [inPeriod, creditExpr, 0] } },
            shown: sumGroup(isShown),
          },
        },
      ]).allowDiskUse(true),
      FinancialLedgerEntry.aggregate([
        { $match: rowMatch },
        { $sort: SORT_NEWEST },
        { $skip: skip },
        { $limit: limit },
        lookupOne("users", "createdBy", { surname: 1, otherNames: 1, isSystemAuditUser: 1 }, "_createdBy"),
        lookupOne("tenants", "tenant", { name: 1 }, "_tenant"),
        lookupOne("units", "unit", { unitNumber: 1 }, "_unit"),
        lookupOne("landlords", "landlord", { landlordName: 1 }, "_landlord"),
        lookupOne("properties", "property", { name: 1, propertyName: 1 }, "_property"),
        {
          $lookup: {
            from: FinancialLedgerEntry.collection.name, localField: "reversedByEntry", foreignField: "_id", as: "_reversal",
            pipeline: [{ $project: { createdBy: 1 } }, lookupOne("users", "createdBy", { surname: 1, otherNames: 1, isSystemAuditUser: 1 }, "u")],
          },
        },
        {
          $addFields: {
            createdByName: userNameExpr("$_createdBy"),
            reversedByUserName: { $cond: [{ $gt: [{ $size: "$_reversal" }, 0] }, userNameExpr({ $first: "$_reversal.u" }), null] },
            _tenantName: { $first: "$_tenant.name" },
            _unitNumber: { $first: "$_unit.unitNumber" },
            _landlordName: { $first: "$_landlord.landlordName" },
            _propertyName: { $ifNull: [{ $first: "$_property.propertyName" }, { $first: "$_property.name" }] },
          },
        },
        { $project: { _createdBy: 0, _tenant: 0, _unit: 0, _landlord: 0, _property: 0, _reversal: 0 } },
      ]).allowDiskUse(true),
      // running balances: everything in the period newer than this page
      !directionFilter && skip > 0
        ? FinancialLedgerEntry.aggregate([
            { $match: periodMatch }, { $sort: SORT_NEWEST }, { $limit: skip },
            { $group: { _id: null, debit: { $sum: debitExpr }, credit: { $sum: creditExpr } } },
          ]).allowDiskUse(true)
        : [{}],
    ]);

    if (!account) {
      return res.status(404).json({ success: false, status: 404, message: "Chart account not found", error: "Chart account not found" });
    }

    const debitNormal = getNormalBalanceSide(account.type) === "debit";
    const signed = (debit = 0, credit = 0) => (debitNormal ? debit - credit : credit - debit);
    const total = sums.shown || 0;
    const pages = Math.max(1, Math.ceil(total / limit));
    const openingBalance = round2(signed(sums.openingDebit, sums.openingCredit));
    const closingBalance = round2(openingBalance + signed(sums.periodDebit, sums.periodCredit));

    let balance = closingBalance - signed(newer.debit, newer.credit);
    const rows = entries.map((entry) => {
      const debit = entryDebit(entry);
      const credit = entryCredit(entry);
      const runningBalance = directionFilter ? null : round2(balance);
      balance -= signed(debit, credit);

      const tenantName = entry._tenantName || null;
      const contextParts = [
        tenantName,
        entry._unitNumber ? `Unit ${entry._unitNumber}` : null,
        !tenantName && entry._landlordName ? entry._landlordName : null,
        entry._propertyName ? `[${entry._propertyName}]` : null,
      ].filter(Boolean);
      const baseNarration = entry.notes || entry.category || "";
      const displayNarration = contextParts.length
        ? (baseNarration ? `${baseNarration} — ${contextParts.join(", ")}` : contextParts.join(", "))
        : baseNarration || null;

      const { _tenantName, _unitNumber, _landlordName, _propertyName, ...rest } = entry;
      return decorateLedgerActivityEntry({
        ...rest,
        debit: round2(debit),
        credit: round2(credit),
        runningBalance,
        createdByName: entry.createdByName || null,
        reversedByUserName: entry.reversedByUserName || null,
        displayNarration,
      });
    });

    return res.status(200).json({
      success: true,
      data: {
        account: serializeAccount(account),
        includeReversed: shouldIncludeReversed,
        openingBalance,
        closingBalance,
        totals: { debit: round2(sums.periodDebit), credit: round2(sums.periodCredit) },
        count: total,
        page,
        pages,
        limit,
        entries: rows,
      },
    });
  } catch (err) {
    console.error("Failed to fetch chart account activity:", err);
    return res.status(500).json({ success: false, status: 500, message: err?.message || "Failed to fetch chart account activity", error: err?.message || "Failed to fetch chart account activity" });
  }
});

router.post("/activity/:entryId/reclassify", verifyUser, requireCompanyModule("accounts"), async (req, res) => {
  try {
    if (!hasLedgerAdminAccess(req.user)) {
      return res.status(403).json({ success: false, status: 403, message: "Only accountant/admin users can reclassify ledger entries.", error: "Only accountant/admin users can reclassify ledger entries." });
    }

    const business = resolveBusiness(req);
    const { entryId } = req.params;
    const { newAccountId, reason } = req.body || {};

    if (!business) {
      return res.status(400).json({ success: false, status: 400, message: "business is required", error: "business is required" });
    }

    if (!isValidObjectId(entryId) || !isValidObjectId(newAccountId)) {
      return res.status(400).json({ success: false, status: 400, message: "Valid entryId and newAccountId are required", error: "Valid entryId and newAccountId are required" });
    }

    const [entry, newAccount] = await Promise.all([
      FinancialLedgerEntry.findOne({ _id: entryId, business }),
      ChartOfAccount.findOne({ _id: newAccountId, business }),
    ]);

    if (!entry) {
      return res.status(404).json({ success: false, status: 404, message: "Ledger entry not found", error: "Ledger entry not found" });
    }

    if (!newAccount) {
      return res.status(404).json({ success: false, status: 404, message: "Destination account not found", error: "Destination account not found" });
    }

    if (!newAccount.isPosting || newAccount.isHeader) {
      return res.status(400).json({ success: false, status: 400, message: "Destination account must be a posting ledger account", error: "Destination account must be a posting ledger account" });
    }

    if (String(entry.accountId || "") === String(newAccount._id)) {
      return res.status(400).json({ success: false, status: 400, message: "Entry is already posted to that account", error: "Entry is already posted to that account" });
    }

    if (entry.status === "reversed") {
      return res.status(400).json({ success: false, status: 400, message: "Reversed entries cannot be reclassified", error: "Reversed entries cannot be reclassified" });
    }

    const actorId = await resolveAuditActorUserId({ req, businessId: business });

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
    return res.status(500).json({ success: false, status: 500, message: err?.message || "Failed to reclassify ledger entry", error: err?.message || "Failed to reclassify ledger entry" });
  }
});

router.post("/", verifyUser, canCreate, async (req, res) => {
  try {
    const business = resolveBusiness(req);

    if (!business) {
      return res.status(400).json({ success: false, status: 400, message: "business is required", error: "business is required" });
    }

    const payload = normalizeChartAccountPayload(req.body);

    if (!payload.code || !payload.name || !payload.type) {
      return res.status(400).json({ success: false, status: 400, message: "code, name and type are required", error: "code, name and type are required" });
    }

    await ensureSystemChartOfAccounts(business);

    const existing = await ChartOfAccount.findOne({
      business,
      code: payload.code,
    }).lean();

    if (existing) {
      return res.status(409).json({ success: false, status: 409, message: "Account code already exists for this business", error: "Account code already exists for this business" });
    }

    let parentAccount = null;
    let level = 0;

    if (payload.parentAccount) {
      if (!isValidObjectId(payload.parentAccount)) {
        return res.status(400).json({ success: false, status: 400, message: "parentAccount must be a valid account id", error: "parentAccount must be a valid account id" });
      }

      parentAccount = await ChartOfAccount.findOne({
        _id: payload.parentAccount,
        business,
      });

      if (!parentAccount) {
        return res.status(404).json({ success: false, status: 404, message: "Parent account not found for this business", error: "Parent account not found for this business" });
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
      moduleScopes: payload.moduleScopes?.length > 0
        ? payload.moduleScopes
        : defaultScopesForNewAccount(payload, await getCompanyActiveScopes(business)),
      balance: 0,
    });

    const populated = await ChartOfAccount.findById(account._id).populate("parentAccount", "code name type group subGroup").lean();
    return res.status(201).json(serializeAccount(populated));
  } catch (err) {
    console.error("Failed to create ChartOfAccount:", err);
    return res.status(500).json({ success: false, status: 500, message: err?.message || "Failed to create ChartOfAccount", error: err?.message || "Failed to create ChartOfAccount" });
  }
});

router.put("/:id", verifyUser, canUpdate, async (req, res) => {
  try {
    const business = resolveBusiness(req);
    const { id } = req.params;

    if (!business) {
      return res.status(400).json({ success: false, status: 400, message: "business is required", error: "business is required" });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, status: 400, message: "Invalid chart account id", error: "Invalid chart account id" });
    }

    const account = await ChartOfAccount.findOne({ _id: id, business });
    if (!account) {
      return res.status(404).json({ success: false, status: 404, message: "Chart account not found", error: "Chart account not found" });
    }

    const payload = normalizeChartAccountPayload(req.body);

    if (!payload.code || !payload.name || !payload.type) {
      return res.status(400).json({ success: false, status: 400, message: "code, name and type are required", error: "code, name and type are required" });
    }

    if (account.isSystem && PROTECTED_CODES.has(account.code)) {
      if (payload.code !== account.code || payload.type !== account.type) {
        return res.status(400).json({ success: false, status: 400, message: `Core account ${account.code} cannot change code or type.`, error: `Core account ${account.code} cannot change code or type.` });
      }
    }

    const duplicate = await ChartOfAccount.findOne({
      business,
      code: payload.code,
      _id: { $ne: account._id },
    }).lean();

    if (duplicate) {
      return res.status(409).json({ success: false, status: 409, message: "Another account already uses that code", error: "Another account already uses that code" });
    }

    let parent = null;
    let level = 0;

    if (payload.parentAccount) {
      if (!isValidObjectId(payload.parentAccount)) {
        return res.status(400).json({ success: false, status: 400, message: "parentAccount must be a valid account id", error: "parentAccount must be a valid account id" });
      }

      if (String(payload.parentAccount) === String(account._id)) {
        return res.status(400).json({ success: false, status: 400, message: "An account cannot be its own parent", error: "An account cannot be its own parent" });
      }

      parent = await ChartOfAccount.findOne({
        _id: payload.parentAccount,
        business,
      });

      if (!parent) {
        return res.status(404).json({ success: false, status: 404, message: "Parent account not found", error: "Parent account not found" });
      }

      level = Number(parent.level || 0) + 1;

      payload.type = parent.type;
      payload.group = normalizeAccountGroup(parent.group, parent.type);
      if (!payload.subGroup) {
        payload.subGroup = String(parent.subGroup || "").trim();
      }
    }

    const previousName = account.name;

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
    clearInvoiceAccountCache();
    invalidateBalanceCache(business);

    // Cascade name change to every model that denormalises the account name as a
    // plain string, so all transaction history always reflects the current name.
    if (payload.name && payload.name !== previousName) {
      await Promise.all([
        // Keyed by name string + business
        RentPayment.updateMany(
          { business: account.business, cashbook: previousName },
          { $set: { cashbook: payload.name } }
        ),
        LandlordReceipt.updateMany(
          { business: account.business, cashbook: previousName },
          { $set: { cashbook: payload.name } }
        ),
        // Keyed by account ObjectId (denormalized snapshot fields)
        BankReconciliation.updateMany(
          { business: account.business, account: account._id },
          { $set: { accountName: payload.name } }
        ),
        Budget.updateMany(
          { business: account.business, "lines.account": account._id },
          { $set: { "lines.$[line].accountName": payload.name } },
          { arrayFilters: [{ "line.account": account._id }] }
        ),
      ]);
    }

    const populated = await ChartOfAccount.findById(account._id).populate("parentAccount", "code name type group subGroup").lean();
    return res.status(200).json(serializeAccount(populated));
  } catch (err) {
    console.error("Failed to update ChartOfAccount:", err);
    return res.status(500).json({ success: false, status: 500, message: err?.message || "Failed to update ChartOfAccount", error: err?.message || "Failed to update ChartOfAccount" });
  }
});

router.delete("/:id", verifyUser, canDelete, async (req, res) => {
  try {
    const business = resolveBusiness(req);
    const { id } = req.params;

    if (!business) {
      return res.status(400).json({ success: false, status: 400, message: "business is required", error: "business is required" });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, status: 400, message: "Invalid chart account id", error: "Invalid chart account id" });
    }

    const account = await ChartOfAccount.findOne({ _id: id, business });
    if (!account) {
      return res.status(404).json({ success: false, status: 404, message: "Chart account not found", error: "Chart account not found" });
    }

    if (PROTECTED_CODES.has(account.code)) {
      return res.status(400).json({ success: false, status: 400, message: `Core account ${account.code} cannot be deleted.`, error: `Core account ${account.code} cannot be deleted.` });
    }

    const childCount = await ChartOfAccount.countDocuments({
      business,
      parentAccount: account._id,
    });

    if (childCount > 0) {
      return res.status(400).json({ success: false, status: 400, message: "This account has sub-accounts. Move or delete the children first.", error: "This account has sub-accounts. Move or delete the children first." });
    }

    const [ledgerUsage, invoiceUsage] = await Promise.all([
      FinancialLedgerEntry.countDocuments({ accountId: account._id }),
      TenantInvoice.countDocuments({ chartAccount: account._id }),
    ]);

    // Accounts with ledger or invoice history are soft-deleted (audit trail preserved).
    // Clean accounts with no history are physically removed.
    if (ledgerUsage > 0 || invoiceUsage > 0) {
      if (account.isActive === false) {
        return res.status(400).json({ success: false, status: 400, message: "Account is already deactivated.", error: "Account is already deactivated." });
      }

      // A deactivated account takes no new postings, so switching one off that still holds money (or that Milik itself
      // posts to) would make vouchers, receipts and journals start failing.
      if (account.isSystem) {
        return res.status(400).json({ success: false, status: 400, message: `${account.code} ${account.name} is a system account that Milik posts to, and it has transaction history, so it cannot be deleted.`, error: `${account.code} ${account.name} is a system account that Milik posts to, and it has transaction history, so it cannot be deleted.` });
      }
      const [held] = await FinancialLedgerEntry.aggregate([
        { $match: { accountId: account._id } },
        { $group: { _id: null, debit: { $sum: "$debit" }, credit: { $sum: "$credit" } } },
      ]);
      const balance = Math.round(((held?.debit || 0) - (held?.credit || 0)) * 100) / 100;
      if (Math.abs(balance) >= 0.01) {
        return res.status(400).json({ success: false, status: 400, message: `${account.code} ${account.name} still has a balance of ${balance.toLocaleString("en-KE", { minimumFractionDigits: 2 })}. Move it to another account with a journal before deleting.`, error: `${account.code} ${account.name} still has a balance of ${balance.toLocaleString("en-KE", { minimumFractionDigits: 2 })}. Move it to another account with a journal before deleting.` });
      }
      account.isActive = false;
      account.deletedAt = new Date();
      account.deletedBy = await resolveAuditActorUserId({ req, businessId: business }).catch(() => null);
      await account.save();
      clearInvoiceAccountCache();
      invalidateBalanceCache(business);
      return res.status(200).json({
        success: true,
        softDeleted: true,
        message: "Account deactivated — it has transaction history and cannot be physically removed. It is now inactive and will not appear in posting selectors.",
      });
    }

    await account.deleteOne();
    clearInvoiceAccountCache();
    invalidateBalanceCache(business);

    return res.status(200).json({
      success: true,
      softDeleted: false,
      message: "Chart account deleted successfully",
    });
  } catch (err) {
    console.error("Failed to delete ChartOfAccount:", err);
    return res.status(500).json({ success: false, status: 500, message: err?.message || "Failed to delete ChartOfAccount", error: err?.message || "Failed to delete ChartOfAccount" });
  }
});

// Undo a "delete" of an account that had history (it was only deactivated): it takes postings again.
router.post("/:id/reactivate", verifyUser, canUpdate, async (req, res) => {
  try {
    const business = resolveBusiness(req);
    const { id } = req.params;

    if (!business) return res.status(400).json({ success: false, status: 400, message: "business is required", error: "business is required" });
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, status: 400, message: "Invalid chart account id", error: "Invalid chart account id" });

    const account = await ChartOfAccount.findOne({ _id: id, business });
    if (!account) return res.status(404).json({ success: false, status: 404, message: "Chart account not found", error: "Chart account not found" });
    if (account.isActive !== false) return res.status(400).json({ success: false, status: 400, message: "Account is already active.", error: "Account is already active." });

    account.isActive = true;
    account.deletedAt = null;
    account.deletedBy = null;
    await account.save();
    clearInvoiceAccountCache();
    invalidateBalanceCache(business);

    return res.status(200).json(serializeAccount(account.toObject()));
  } catch (err) {
    console.error("Failed to reactivate ChartOfAccount:", err);
    return res.status(500).json({ success: false, status: 500, message: err?.message || "Failed to reactivate ChartOfAccount", error: err?.message || "Failed to reactivate ChartOfAccount" });
  }
});

// One-time migration: remove property GL sub-accounts (1200-PRO001 etc.) and clean up
// the stale propertyAccounts field from Property documents.
// Safe to run multiple times. Requires admin access.
router.post("/admin/cleanup-property-sub-accounts", verifyAdmin, requireCompanyModule("accounts"), async (req, res) => {
  try {

    const business = resolveBusiness(req);
    if (!business) {
      return res.status(400).json({ success: false, status: 400, message: "business is required", error: "business is required" });
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
    return res.status(500).json({ success: false, status: 500, message: err?.message || "Cleanup failed", error: err?.message || "Cleanup failed" });
  }
});

export default router;

import mongoose from "mongoose";
import FixedAsset from "../../models/FixedAsset.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { toObjectId } from "../../utils/db.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { createError } from "../../utils/error.js";

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// ─── Monthly depreciation for one asset ───────────────────────────────────────
const calcMonthlyDepreciation = (asset) => {
  const { depreciationMethod, purchaseCost, residualValue, usefulLifeYears, depreciationRate, accumulatedDepreciation } = asset;
  const cost = Number(purchaseCost || 0);
  const residual = Number(residualValue || 0);
  const accumulated = Number(accumulatedDepreciation || 0);
  const bookValue = Math.max(0, cost - accumulated);

  if (depreciationMethod === "none" || bookValue <= residual) return 0;

  if (depreciationMethod === "straight_line") {
    const years = Number(usefulLifeYears || 0);
    if (years <= 0) return 0;
    const annualDep = (cost - residual) / years;
    const monthly = annualDep / 12;
    return round2(Math.min(monthly, bookValue - residual));
  }

  if (depreciationMethod === "reducing_balance") {
    const rate = Number(depreciationRate || 0);
    if (rate <= 0) return 0;
    const monthly = (bookValue * rate) / 100 / 12;
    return round2(Math.min(monthly, bookValue - residual));
  }

  return 0;
};

// ─── List fixed assets ─────────────────────────────────────────────────────────
export const getFixedAssets = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const filter = { business: businessId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.category) filter.category = req.query.category;

    const assets = await FixedAsset.find(filter)
      .populate("assetAccount", "code name")
      .populate("depreciationExpenseAccount", "code name")
      .populate("accumulatedDepreciationAccount", "code name")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const enriched = assets.map((a) => ({
      ...a,
      bookValue: round2(Math.max(0, Number(a.purchaseCost || 0) - Number(a.accumulatedDepreciation || 0))),
      monthlyDepreciation: calcMonthlyDepreciation(a),
    }));

    return res.status(200).json(enriched);
  } catch (err) {
    next(err);
  }
};

// ─── Single asset ──────────────────────────────────────────────────────────────
export const getFixedAsset = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const asset = await FixedAsset.findOne({ _id: req.params.id, business: businessId })
      .populate("assetAccount", "code name")
      .populate("depreciationExpenseAccount", "code name")
      .populate("accumulatedDepreciationAccount", "code name")
      .lean();

    if (!asset) return next(createError(404, "Asset not found"));

    return res.status(200).json({
      ...asset,
      bookValue: round2(Math.max(0, Number(asset.purchaseCost || 0) - Number(asset.accumulatedDepreciation || 0))),
      monthlyDepreciation: calcMonthlyDepreciation(asset),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Create ────────────────────────────────────────────────────────────────────
export const createFixedAsset = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const {
      name, code, category, description,
      purchaseDate, purchaseCost, residualValue,
      depreciationMethod, usefulLifeYears, depreciationRate,
      assetAccount, depreciationExpenseAccount, accumulatedDepreciationAccount,
    } = req.body;

    if (!name) return next(createError(400, "Asset name is required"));
    if (!purchaseDate) return next(createError(400, "Purchase date is required"));
    if (Number(purchaseCost) <= 0) return next(createError(400, "Purchase cost must be greater than zero"));
    if (!assetAccount) return next(createError(400, "Asset GL account is required"));
    if (!depreciationExpenseAccount) return next(createError(400, "Depreciation expense account is required"));
    if (!accumulatedDepreciationAccount) return next(createError(400, "Accumulated depreciation account is required"));

    const asset = await FixedAsset.create({
      business: businessId,
      name: String(name).trim(),
      code: String(code || "").trim(),
      category: String(category || "").trim(),
      description: String(description || ""),
      purchaseDate: new Date(purchaseDate),
      purchaseCost: round2(Number(purchaseCost)),
      residualValue: round2(Number(residualValue || 0)),
      depreciationMethod: depreciationMethod || "straight_line",
      usefulLifeYears: Number(usefulLifeYears || 5),
      depreciationRate: Number(depreciationRate || 0),
      assetAccount: toObjectId(assetAccount),
      depreciationExpenseAccount: toObjectId(depreciationExpenseAccount),
      accumulatedDepreciationAccount: toObjectId(accumulatedDepreciationAccount),
      accumulatedDepreciation: 0,
      status: "active",
      createdBy: req.user?._id || req.user?.id || null,
    });

    return res.status(201).json(asset);
  } catch (err) {
    next(err);
  }
};

// ─── Update ────────────────────────────────────────────────────────────────────
export const updateFixedAsset = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const asset = await FixedAsset.findOne({ _id: req.params.id, business: businessId });
    if (!asset) return next(createError(404, "Asset not found"));
    if (asset.status === "disposed") return next(createError(400, "Disposed assets cannot be edited"));

    const allowed = [
      "name", "code", "category", "description",
      "purchaseDate", "purchaseCost", "residualValue",
      "depreciationMethod", "usefulLifeYears", "depreciationRate",
      "assetAccount", "depreciationExpenseAccount", "accumulatedDepreciationAccount",
    ];

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        if (["assetAccount", "depreciationExpenseAccount", "accumulatedDepreciationAccount"].includes(field)) {
          asset[field] = toObjectId(req.body[field]);
        } else if (["purchaseCost", "residualValue", "usefulLifeYears", "depreciationRate"].includes(field)) {
          asset[field] = Number(req.body[field]);
        } else if (field === "purchaseDate") {
          asset[field] = new Date(req.body[field]);
        } else {
          asset[field] = req.body[field];
        }
      }
    }

    await asset.save();
    return res.status(200).json(asset);
  } catch (err) {
    next(err);
  }
};

// ─── Preview depreciation (dry run) ───────────────────────────────────────────
export const previewDepreciation = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const assets = await FixedAsset.find({ business: businessId, status: "active" }).lean();

    const preview = assets.map((a) => {
      const monthly = calcMonthlyDepreciation(a);
      const bookValue = round2(Math.max(0, Number(a.purchaseCost || 0) - Number(a.accumulatedDepreciation || 0)));
      return {
        _id: a._id,
        name: a.name,
        code: a.code,
        category: a.category,
        purchaseCost: a.purchaseCost,
        accumulatedDepreciation: a.accumulatedDepreciation,
        bookValue,
        monthlyDepreciation: monthly,
        depreciationMethod: a.depreciationMethod,
        lastDepreciationDate: a.lastDepreciationDate,
      };
    });

    const totalDepreciation = round2(preview.reduce((sum, p) => sum + p.monthlyDepreciation, 0));
    return res.status(200).json({ preview, totalDepreciation });
  } catch (err) {
    next(err);
  }
};

// ─── Run depreciation for a given period ──────────────────────────────────────
export const runDepreciation = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const userId = req.user?._id || req.user?.id;
    const { periodStart, periodEnd, assetIds } = req.body;

    if (!periodStart || !periodEnd) return next(createError(400, "periodStart and periodEnd are required"));

    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    end.setHours(23, 59, 59, 999);

    const filter = { business: businessId, status: "active" };
    if (Array.isArray(assetIds) && assetIds.length) {
      filter._id = { $in: assetIds.map(toObjectId).filter(Boolean) };
    }

    const assets = await FixedAsset.find(filter)
      .populate("assetAccount", "_id code name")
      .populate("depreciationExpenseAccount", "_id code name")
      .populate("accumulatedDepreciationAccount", "_id code name");

    const results = [];
    const touchedAccounts = new Set();
    const bulkOps = [];

    await Promise.all(
      assets.map(async (asset) => {
        const monthly = calcMonthlyDepreciation(asset.toObject());
        if (monthly <= 0) {
          results.push({ assetId: asset._id, name: asset.name, skipped: true, reason: "No depreciation to post" });
          return;
        }

        const alreadyPosted = await FinancialLedgerEntry.findOne({
          sourceTransactionType: "fixed_asset_depreciation",
          sourceTransactionId: asset._id,
          statementPeriodStart: start,
          statementPeriodEnd: end,
        }).select("_id").lean();

        if (alreadyPosted) {
          results.push({ assetId: asset._id, name: asset.name, skipped: true, reason: "Already posted for this period" });
          return;
        }

        const journalGroupId = new mongoose.Types.ObjectId();
        const transactionDate = end;

        const basePayload = {
          business: businessId,
          allowUnscoped: true,
          sourceTransactionType: "fixed_asset_depreciation",
          sourceTransactionId: asset._id,
          transactionDate,
          statementPeriodStart: start,
          statementPeriodEnd: end,
          category: "DEPRECIATION",
          journalGroupId,
          amount: monthly,
          createdBy: userId,
          approvedBy: userId,
          approvedAt: new Date(),
          status: "approved",
          notes: `Depreciation — ${asset.name} (${String(asset.code || "").trim()}) for period ${periodStart} to ${periodEnd}`,
        };

        // DR Depreciation Expense and CR Accumulated Depreciation in parallel
        await Promise.all([
          postEntry({ ...basePayload, accountId: asset.depreciationExpenseAccount._id, direction: "debit" }),
          postEntry({ ...basePayload, accountId: asset.accumulatedDepreciationAccount._id, direction: "credit" }),
        ]);

        touchedAccounts.add(String(asset.depreciationExpenseAccount._id));
        touchedAccounts.add(String(asset.accumulatedDepreciationAccount._id));

        const newAccumulated = round2(Number(asset.accumulatedDepreciation || 0) + monthly);
        const bookValue = round2(Math.max(0, Number(asset.purchaseCost || 0) - newAccumulated));
        const residual = round2(Number(asset.residualValue || 0));
        const updateFields = {
          accumulatedDepreciation: newAccumulated,
          lastDepreciationDate: transactionDate,
          ...(bookValue <= residual ? { status: "fully_depreciated" } : {}),
        };

        bulkOps.push({ updateOne: { filter: { _id: asset._id }, update: { $set: updateFields } } });
        results.push({ assetId: asset._id, name: asset.name, depreciation: monthly, newBookValue: bookValue });
      })
    );

    if (bulkOps.length) await FixedAsset.bulkWrite(bulkOps, { ordered: false });
    if (touchedAccounts.size) {
      await aggregateChartOfAccountBalances(businessId, [...touchedAccounts]);
    }

    return res.status(200).json({ success: true, periodStart, periodEnd, results });
  } catch (err) {
    next(err);
  }
};

// ─── Dispose asset ─────────────────────────────────────────────────────────────
// Journal structure (always balanced):
//   DR Accumulated Depreciation   = accumulated
//   DR/CR depreciationExpenseAccount = net gain/loss vs proceeds
//   CR Asset Account              = cost
//   DR proceedsAccount (optional) = proceeds (if provided)
export const disposeFixedAsset = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const userId = req.user?._id || req.user?.id;
    const asset = await FixedAsset.findOne({ _id: req.params.id, business: businessId })
      .populate("assetAccount", "_id code name")
      .populate("accumulatedDepreciationAccount", "_id code name")
      .populate("depreciationExpenseAccount", "_id code name");

    if (!asset) return next(createError(404, "Asset not found"));
    if (asset.status === "disposed") return next(createError(400, "Asset already disposed"));

    const { disposalDate, disposalProceeds = 0, disposalNotes = "", proceedsAccount } = req.body;
    const disposalAt = disposalDate ? new Date(disposalDate) : new Date();
    const proceeds = round2(Number(disposalProceeds || 0));
    const proceedsAccountId = proceedsAccount ? toObjectId(proceedsAccount) : null;

    const accumulated = round2(Number(asset.accumulatedDepreciation || 0));
    const cost = round2(Number(asset.purchaseCost || 0));
    const bookValue = round2(Math.max(0, cost - accumulated));

    // Net gain/loss. Positive = gain; negative = loss.
    // When no proceedsAccount: we recognise the full bookValue as a loss (proceeds handled via cash receipt later).
    const netGainLoss = proceedsAccountId ? round2(proceeds - bookValue) : round2(-bookValue);

    const journalGroupId = new mongoose.Types.ObjectId();
    const touchedAccounts = new Set();

    const basePayload = {
      business: businessId,
      allowUnscoped: true,
      sourceTransactionType: "fixed_asset_disposal",
      sourceTransactionId: asset._id,
      transactionDate: disposalAt,
      statementPeriodStart: disposalAt,
      statementPeriodEnd: disposalAt,
      category: "DISPOSAL",
      journalGroupId,
      createdBy: userId,
      approvedBy: userId,
      approvedAt: new Date(),
      status: "approved",
      notes: `Asset disposal — ${asset.name} on ${disposalAt.toISOString().split("T")[0]}`,
    };

    const postedLegs = [];
    try {
      // 1. DR Accumulated Depreciation (clear contra-asset)
      if (accumulated > 0) {
        const leg = await postEntry({ ...basePayload, accountId: asset.accumulatedDepreciationAccount._id, direction: "debit", amount: accumulated });
        postedLegs.push(leg);
        touchedAccounts.add(String(asset.accumulatedDepreciationAccount._id));
      }

      // 2. DR Proceeds Account (if provided and proceeds > 0)
      if (proceedsAccountId && proceeds > 0) {
        const leg = await postEntry({ ...basePayload, accountId: proceedsAccountId, direction: "debit", amount: proceeds });
        postedLegs.push(leg);
        touchedAccounts.add(String(proceedsAccountId));
      }

      // 3. DR Loss on Disposal / CR Gain on Disposal (balancing leg via depreciationExpenseAccount)
      //    netGainLoss > 0 → gain → CR; netGainLoss < 0 → loss → DR
      if (Math.abs(netGainLoss) > 0.005) {
        const gainLossDir = netGainLoss > 0 ? "credit" : "debit";
        const leg = await postEntry({
          ...basePayload,
          accountId: asset.depreciationExpenseAccount._id,
          direction: gainLossDir,
          amount: Math.abs(netGainLoss),
          notes: `${netGainLoss > 0 ? "Gain" : "Loss"} on disposal — ${asset.name}`,
        });
        postedLegs.push(leg);
        touchedAccounts.add(String(asset.depreciationExpenseAccount._id));
      }

      // 4. CR Asset Account (remove at cost)
      if (cost > 0) {
        const leg = await postEntry({ ...basePayload, accountId: asset.assetAccount._id, direction: "credit", amount: cost });
        postedLegs.push(leg);
        touchedAccounts.add(String(asset.assetAccount._id));
      }
    } catch (glError) {
      for (const leg of postedLegs) {
        if (leg?._id) {
          await postReversal({ entryId: leg._id, reason: `Auto-reversal: GL balance protection for failed disposal of ${asset.name}`, userId }).catch(() => null);
        }
      }
      throw glError;
    }

    if (touchedAccounts.size) {
      await aggregateChartOfAccountBalances(businessId, [...touchedAccounts]);
    }

    asset.status = "disposed";
    asset.disposalDate = disposalAt;
    asset.disposalProceeds = proceeds;
    asset.disposalNotes = String(disposalNotes);
    asset.disposedBy = userId || null;
    await asset.save();

    return res.status(200).json({
      success: true,
      bookValue,
      proceeds,
      gainLoss: round2(proceeds - bookValue),
      asset,
    });
  } catch (err) {
    next(err);
  }
};

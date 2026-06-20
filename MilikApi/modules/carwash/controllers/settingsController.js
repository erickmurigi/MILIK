import mongoose from "mongoose";
import Company from "../../../models/Company.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";
import { CW_SMS_TEMPLATE_DEFAULTS, invalidateSmsSettingsCache } from "../services/carwashSmsService.js";

const METHODS = ["cash", "mpesa", "bank", "card", "other"];

const toOidOrNull = (value) => {
  const s = String(value || "").trim();
  return s && mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
};

// Merge saved templates with defaults so the UI always gets a full list even for
// newly added template types that an older company document doesn't have yet.
const mergeSmsTemplates = (saved = []) => {
  const savedMap = new Map((saved || []).map((t) => [t.key, t]));
  return CW_SMS_TEMPLATE_DEFAULTS.map((def) => {
    const override = savedMap.get(def.key);
    if (!override) return { ...def };
    return {
      ...def,                           // keep placeholders/description from defaults
      enabled:     override.enabled ?? def.enabled,
      messageBody: override.messageBody ?? def.messageBody,
    };
  });
};

export const getCarWashSettings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const company = await Company.findById(business)
      .select("carwashSettings")
      .lean();

    const raw = company?.carwashSettings?.defaultCashbooks || {};

    const ids = METHODS.map((m) => raw[m]).filter(Boolean);
    const accounts = ids.length
      ? await ChartOfAccount.find({ _id: { $in: ids }, business }).select("_id code name subGroup").lean()
      : [];
    const byId = new Map(accounts.map((a) => [String(a._id), a]));

    const defaultCashbooks = METHODS.reduce((acc, m) => {
      const id = raw[m] ? String(raw[m]) : null;
      acc[m] = id ? { _id: id, ...(byId.get(id) || {}) } : null;
      return acc;
    }, {});

    const savingsDeductionPerJob = Number(company?.carwashSettings?.savingsDeductionPerJob ?? 100);
    const savingsEnabled = company?.carwashSettings?.savingsEnabled !== false;
    const smsTemplates = mergeSmsTemplates(company?.carwashSettings?.smsTemplates);
    const queueDisplayName    = String(company?.carwashSettings?.queueDisplayName    || "").trim();
    const discountMinJobPrice = Number(company?.carwashSettings?.discountMinJobPrice ?? 0);
    const discountMaxPercent  = Number(company?.carwashSettings?.discountMaxPercent  ?? 0);
    const damageDeductionMode  = company?.carwashSettings?.damageDeductionMode  || "full";
    const damageDeductionValue = company?.carwashSettings?.damageDeductionValue != null
      ? Number(company.carwashSettings.damageDeductionValue) : null;

    res.json({ success: true, data: { defaultCashbooks, savingsEnabled, savingsDeductionPerJob, smsTemplates, queueDisplayName, discountMinJobPrice, discountMaxPercent, damageDeductionMode, damageDeductionValue } });
  } catch (err) {
    next(err);
  }
};

export const updateCarWashSettings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { defaultCashbooks = {}, savingsEnabled, savingsDeductionPerJob, smsTemplates, queueDisplayName, discountMinJobPrice, discountMaxPercent, damageDeductionMode, damageDeductionValue } = req.body;

    const update = {};

    for (const method of METHODS) {
      const val = toOidOrNull(defaultCashbooks[method]);
      if (val) {
        const account = await ChartOfAccount.findOne({
          _id: val,
          business,
          type: "asset",
          isPosting: true,
          subGroup: { $regex: "cashbook", $options: "i" },
        }).lean();
        if (!account) {
          return next({ status: 400, message: `Invalid cashbook for method "${method}" — must be a posting Cashbooks account` });
        }
      }
      update[`carwashSettings.defaultCashbooks.${method}`] = val;
    }

    if (savingsEnabled !== undefined) {
      update["carwashSettings.savingsEnabled"] = Boolean(savingsEnabled);
    }

    if (savingsDeductionPerJob !== undefined) {
      const amt = Number(savingsDeductionPerJob);
      if (!Number.isFinite(amt) || amt < 0) {
        return next({ status: 400, message: "Savings deduction per job must be zero or more" });
      }
      update["carwashSettings.savingsDeductionPerJob"] = Math.round(amt * 100) / 100;
    }

    if (Array.isArray(smsTemplates)) {
      const validKeys = new Set(CW_SMS_TEMPLATE_DEFAULTS.map((t) => t.key));
      const cleaned = smsTemplates
        .filter((t) => t?.key && validKeys.has(t.key))
        .map((t) => ({
          key:         String(t.key),
          enabled:     Boolean(t.enabled),
          messageBody: String(t.messageBody ?? "").trim(),
        }));
      update["carwashSettings.smsTemplates"] = cleaned;
    }

    if (queueDisplayName !== undefined) {
      update["carwashSettings.queueDisplayName"] = String(queueDisplayName).trim().slice(0, 60);
    }

    if (discountMinJobPrice !== undefined) {
      const v = Number(discountMinJobPrice);
      if (!Number.isFinite(v) || v < 0) return next({ status: 400, message: "Minimum job price must be zero or more" });
      update["carwashSettings.discountMinJobPrice"] = Math.round(v * 100) / 100;
    }

    if (discountMaxPercent !== undefined) {
      const v = Number(discountMaxPercent);
      if (!Number.isFinite(v) || v < 0 || v > 100) return next({ status: 400, message: "Max discount must be between 0 and 100%" });
      update["carwashSettings.discountMaxPercent"] = Math.round(v * 100) / 100;
    }

    const VALID_DMG_MODES = ["full", "percent", "fixed"];
    if (damageDeductionMode !== undefined) {
      if (!VALID_DMG_MODES.includes(damageDeductionMode)) {
        return next({ status: 400, message: "Invalid damage deduction mode" });
      }
      update["carwashSettings.damageDeductionMode"] = damageDeductionMode;
      if (damageDeductionMode === "percent") {
        const pct = Number(damageDeductionValue);
        if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
          return next({ status: 400, message: "Damage percent deduction must be 1–100" });
        }
        update["carwashSettings.damageDeductionValue"] = Math.round(pct * 100) / 100;
      } else if (damageDeductionMode === "fixed") {
        const fixed = Number(damageDeductionValue);
        if (!Number.isFinite(fixed) || fixed <= 0) {
          return next({ status: 400, message: "Damage fixed deduction must be greater than zero" });
        }
        update["carwashSettings.damageDeductionValue"] = Math.round(fixed * 100) / 100;
      } else {
        update["carwashSettings.damageDeductionValue"] = null;
      }
    }

    await Company.updateOne({ _id: business }, { $set: update });
    invalidateSmsSettingsCache(business);
    res.json({ success: true, message: "Car Wash settings saved" });
  } catch (err) {
    next(err);
  }
};

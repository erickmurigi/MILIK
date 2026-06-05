import mongoose from "mongoose";
import Company from "../../../models/Company.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";
import { CW_SMS_TEMPLATE_DEFAULTS } from "../services/carwashSmsService.js";

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
    const smsTemplates = mergeSmsTemplates(company?.carwashSettings?.smsTemplates);

    res.json({ success: true, data: { defaultCashbooks, savingsDeductionPerJob, smsTemplates } });
  } catch (err) {
    next(err);
  }
};

export const updateCarWashSettings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { defaultCashbooks = {}, savingsDeductionPerJob, smsTemplates } = req.body;

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

    await Company.updateOne({ _id: business }, { $set: update });
    res.json({ success: true, message: "Car Wash settings saved" });
  } catch (err) {
    next(err);
  }
};

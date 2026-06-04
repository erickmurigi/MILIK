import mongoose from "mongoose";
import Company from "../../../models/Company.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";

const METHODS = ["cash", "mpesa", "bank", "card", "other"];

const toOidOrNull = (value) => {
  const s = String(value || "").trim();
  return s && mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
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

    res.json({ success: true, data: { defaultCashbooks, savingsDeductionPerJob } });
  } catch (err) {
    next(err);
  }
};

export const updateCarWashSettings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { defaultCashbooks = {}, savingsDeductionPerJob } = req.body;

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

    await Company.updateOne({ _id: business }, { $set: update });
    res.json({ success: true, message: "Car Wash settings saved" });
  } catch (err) {
    next(err);
  }
};

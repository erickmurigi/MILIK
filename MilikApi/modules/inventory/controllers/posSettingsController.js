import InvPOSSettings from "../models/InvPOSSettings.js";
import { createError } from "../../../utils/error.js";
import { resolveActiveBusinessId } from "../services/inventoryScope.js";

const ALLOWED_FIELDS = [
  "receiptHeader", "receiptFooter", "showVATBreakdown", "showCashierName",
  "showReceiptNumber", "autoReceiptPrint", "currency", "currencySymbol",
  "vatPIN", "kraETIMSEnabled", "decimalPlaces",
];

export const getPOSSettings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    let doc = await InvPOSSettings.findOne({ business }).lean();
    if (!doc) doc = await InvPOSSettings.create({ business });
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
};

export const updatePOSSettings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const update = {};
    for (const key of ALLOWED_FIELDS) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const doc = await InvPOSSettings.findOneAndUpdate(
      { business },
      { $set: update },
      { new: true, upsert: true, runValidators: true }
    );
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
};

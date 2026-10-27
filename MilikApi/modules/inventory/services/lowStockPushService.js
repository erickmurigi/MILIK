import mongoose from "mongoose";
import InvStockEntry from "../models/InvStockEntry.js";
import InvProduct from "../models/InvProduct.js";
import Company from "../../../models/Company.js";
import { sendPushToUsers, resolveUsersWithModuleAccess } from "../../../utils/pushNotify.js";

// Daily digest per company — repeats every day an item stays at/below its reorder level
// (that's the point: a still-low item should keep nagging until it's restocked), one
// notification per company rather than one per product.
export const processLowStockPushDigest = async () => {
  const companies = await Company.find({}).select("_id").lean();
  let notified = 0;

  for (const { _id: businessId } of companies) {
    try {
      const balances = await InvStockEntry.aggregate([
        { $match: { business: new mongoose.Types.ObjectId(String(businessId)) } },
        { $group: { _id: "$product", balance: { $sum: "$qty" } } },
      ]);
      if (!balances.length) continue;

      const balanceMap = new Map(balances.map((b) => [String(b._id), b.balance]));
      const products = await InvProduct.find({
        _id: { $in: balances.map((b) => b._id) },
        business: businessId,
        trackStock: true,
        reorderLevel: { $gt: 0 },
      }).select("name reorderLevel").lean();

      const lowItems = products.filter((p) => (balanceMap.get(String(p._id)) ?? 0) <= p.reorderLevel);
      if (!lowItems.length) continue;

      const userIds = await resolveUsersWithModuleAccess(businessId, "inventory");
      if (!userIds.length) continue;

      const body = lowItems.length === 1
        ? `${lowItems[0].name} is at or below its reorder level`
        : `${lowItems.length} products are at or below their reorder level`;

      await sendPushToUsers(userIds, {
        title: "Low stock alert",
        body,
        data: { type: "low_stock", count: lowItems.length },
      });
      notified += lowItems.length;
    } catch (err) {
      console.error(`[LowStockPush] Error for company ${businessId}:`, err?.message);
    }
  }

  return notified;
};

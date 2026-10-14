import mongoose from "mongoose";
import PaymentVoucher from "../../../models/PaymentVoucher.js";
import SaleAdvocateRemittance from "../models/SaleAdvocateRemittance.js";
import { round2 } from "../../../utils/math.js";

const toId = (v) => new mongoose.Types.ObjectId(String(v));

// Each of an owner's recoverable-expense vouchers (approved/paid "sale_owner_expense" PaymentVouchers —
// the asset recognized on 1313 Owner Expense Recoverable) with its own still-outstanding balance,
// oldest-due-first, net of whatever's already been recovered against that SAME voucher via an advocate
// remittance's appliedTo split (postRecoverableExpenseSettlement's "recoverable_expense" leg — see
// propertySaleAccountingService.js). Matching is voucher-by-voucher (appliedTo.refId), so this is exact
// without needing SaleAdvocateRemittance to carry an owner field of its own. Fully recovered vouchers
// (outstanding <= 0) are left out.
//
// Owner-scoped, not deal-scoped — a recharge made on one deal can be recovered from a remittance tied
// to a different deal under the same owner, which is exactly the gap this helper closes (an owner's
// recoverable expenses previously only self-cleared if netted against one specific deal).
//
// A caller allocating a remittance against outstanding expenses (e.g. advocateRemittancesController.js)
// walks this list oldest-first, taking min(voucher.outstanding, amountLeftToAllocate) from each.
export const outstandingRecoverableExpenseVouchers = async (business, ownerId) => {
  const vouchers = await PaymentVoucher.find({
    business, saleOwner: ownerId, category: "sale_owner_expense", status: { $in: ["approved", "paid"] },
  }).select("amount dueDate paidDate").sort({ dueDate: 1, _id: 1 }).lean();
  if (!vouchers.length) return [];

  const voucherIds = vouchers.map((v) => toId(v._id));
  const recoveredRows = await SaleAdvocateRemittance.aggregate([
    { $match: { business: toId(business) } },
    { $unwind: "$appliedTo" },
    { $match: { "appliedTo.category": "recoverable_expense", "appliedTo.refId": { $in: voucherIds } } },
    { $group: { _id: "$appliedTo.refId", total: { $sum: "$appliedTo.amount" } } },
  ]);
  const recoveredByVoucher = new Map(recoveredRows.map((r) => [String(r._id), round2(r.total || 0)]));

  return vouchers
    .map((v) => ({
      voucherId: v._id,
      amount: round2(v.amount || 0),
      outstanding: round2(Math.max(0, Number(v.amount || 0) - (recoveredByVoucher.get(String(v._id)) || 0))),
    }))
    .filter((v) => v.outstanding > 0);
};

// Outstanding recoverable-expense balance for an owner — the sum of outstandingRecoverableExpenseVouchers
// above. Owner-scoped, not deal-scoped (see that function's comment for why).
export const outstandingRecoverableExpense = async (business, ownerId) =>
  round2((await outstandingRecoverableExpenseVouchers(business, ownerId)).reduce((sum, v) => sum + v.outstanding, 0));

import mongoose from "mongoose";
import PaymentVoucher from "../../../models/PaymentVoucher.js";
import SaleAdvocateRemittance from "../models/SaleAdvocateRemittance.js";
import SaleAdvocateRechargeRemittance from "../models/SaleAdvocateRechargeRemittance.js";
import { round2 } from "../../../utils/math.js";

const toId = (v) => new mongoose.Types.ObjectId(String(v));

// Each of an owner's recoverable-expense vouchers (approved/paid "sale_owner_expense" PaymentVouchers —
// the asset recognized on 1313 Owner Expense Recoverable) with its own still-outstanding balance,
// oldest-due-first, net of whatever's already been recovered against that SAME voucher. Two sources
// count as "recovered":
//   1. SaleAdvocateRechargeRemittance.allocations — the current, explicit flow: an advocate deliberately
//      remits cash earmarked for one or more named vouchers (see propertySaleAccountingService.js's
//      postAdvocateRechargeRemittance, Dr cashbook / Cr 1313).
//   2. SaleAdvocateRemittance.appliedTo (category "recoverable_expense") — the LEGACY flow: a deal-scoped
//      trust remittance used to automatically net a portion of its cash against the owner's outstanding
//      recoverable expenses (postRecoverableExpenseSettlement, Dr 2185 / Cr 1313). createRemittance no
//      longer computes this automatically for new remittances (advocateRemittancesController.js), but
//      historical entries already posted under it must still count — otherwise a voucher legitimately
//      settled before this change would wrongly reappear as outstanding today.
// Fully recovered vouchers (outstanding <= 0) are left out.
//
// Owner-scoped, not deal-scoped — a recharge made on one deal can be recovered independently of which
// deal of the same owner it's tied to.
//
// A caller allocating a remittance against outstanding expenses walks this list oldest-first, taking
// min(voucher.outstanding, amountLeftToAllocate) from each.
export const outstandingRecoverableExpenseVouchers = async (business, ownerId) => {
  const vouchers = await PaymentVoucher.find({
    business, saleOwner: ownerId, category: "sale_owner_expense", status: { $in: ["approved", "paid"] },
  }).select("amount dueDate paidDate narration payeeName voucherNo saleProject").sort({ dueDate: 1, _id: 1 }).lean();
  if (!vouchers.length) return [];

  const voucherIds = vouchers.map((v) => toId(v._id));
  const [legacyRows, rechargeRows] = await Promise.all([
    SaleAdvocateRemittance.aggregate([
      { $match: { business: toId(business), status: { $ne: "cancelled" } } },
      { $unwind: "$appliedTo" },
      { $match: { "appliedTo.category": "recoverable_expense", "appliedTo.refId": { $in: voucherIds } } },
      { $group: { _id: "$appliedTo.refId", total: { $sum: "$appliedTo.amount" } } },
    ]),
    SaleAdvocateRechargeRemittance.aggregate([
      { $match: { business: toId(business), status: { $ne: "cancelled" } } },
      { $unwind: "$allocations" },
      { $match: { "allocations.voucher": { $in: voucherIds } } },
      { $group: { _id: "$allocations.voucher", total: { $sum: "$allocations.amount" } } },
    ]),
  ]);
  const recoveredByVoucher = new Map();
  for (const r of [...legacyRows, ...rechargeRows]) {
    const key = String(r._id);
    recoveredByVoucher.set(key, round2((recoveredByVoucher.get(key) || 0) + (r.total || 0)));
  }

  return vouchers
    .map((v) => ({
      voucherId: v._id,
      amount: round2(v.amount || 0),
      outstanding: round2(Math.max(0, Number(v.amount || 0) - (recoveredByVoucher.get(String(v._id)) || 0))),
      dueDate: v.dueDate || null,
      paidDate: v.paidDate || null,
      narration: v.narration || "",
      payeeName: v.payeeName || "",
      voucherNo: v.voucherNo || "",
      saleProject: v.saleProject || null,
    }))
    .filter((v) => v.outstanding > 0);
};

// Outstanding recoverable-expense balance for an owner — the sum of outstandingRecoverableExpenseVouchers
// above. Owner-scoped, not deal-scoped (see that function's comment for why).
export const outstandingRecoverableExpense = async (business, ownerId) =>
  round2((await outstandingRecoverableExpenseVouchers(business, ownerId)).reduce((sum, v) => sum + v.outstanding, 0));

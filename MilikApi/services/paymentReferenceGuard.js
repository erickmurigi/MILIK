import PaymentReferenceLock from "../models/PaymentReferenceLock.js";
import { cleanVoucherReference, voucherReferenceKey } from "../utils/voucherReference.js";
import { createError } from "../utils/error.js";

// System-wide duplicate-reference guard: no two money-transaction records in the same business — whatever
// module they live in (Sale Payments, Car Wash, Rent Payments, Payment Vouchers, ...) — may carry the same
// external reference (bank ref, M-Pesa code, cheque no). A blank reference is exempt (most cash payments
// have none) and never claims a slot. Reuses PaymentVoucher's own case/whitespace-insensitive normalization
// (voucherReferenceKey) so "RTGS/001" and "rtgs/001 " collide with each other everywhere, consistently.

// Friendly label shown in the conflict message. Extend as each module is wired in.
const SOURCE_LABELS = {
  SalePayment:             "Sale Payment",
  SaleCommission:          "Commission Payout",
  SaleAdvocateRechargeRemittance: "Advocate Recharge Remittance",
  SaleAgencyCommissionPayout: "Agency Commission Payout",
  SaleOwnerPayout:         "Owner Payout",
  CarWashPayment:          "Car Wash Payment",
  CarWashDeposit:          "Car Wash Deposit",
  CarWashExpense:          "Car Wash Expense",
  CarWashCommissionPayout: "Car Wash Commission Payout",
  CarWashAccountTopup:     "Car Wash Account Topup",
  RentPayment:             "Rent Receipt",
  LandlordReceipt:         "Landlord Receipt",
  TaxRemittance:           "VAT Remittance",
  ClientPayment:           "Client Payment",
  InvSupplierPayment:      "Supplier Payment",
  POSSale:                 "POS Sale",
};

const labelFor = (sourceModel) => SOURCE_LABELS[sourceModel] || sourceModel;

// Claims `reference` for (sourceModel, sourceId) within `business`. No-ops on a blank reference.
// Throws a 409 createError if another record already holds it.
export async function claimPaymentReference({ business, reference, sourceModel, sourceId }) {
  const referenceKey = voucherReferenceKey(reference);
  if (!referenceKey) return null;
  try {
    return await PaymentReferenceLock.create({
      business, referenceKey, sourceModel, sourceId,
      rawReference: cleanVoucherReference(reference),
    });
  } catch (err) {
    if (err?.code === 11000) {
      const existing = await PaymentReferenceLock.findOne({ business, referenceKey }).lean();
      throw createError(409, `Reference "${cleanVoucherReference(reference)}" is already used on another ${existing ? labelFor(existing.sourceModel) : "payment"} record.`);
    }
    throw err;
  }
}

// Frees `reference` so it can be claimed again (voided/deleted/reference-changed record). No-ops on blank.
export async function releasePaymentReference({ business, reference, sourceModel, sourceId }) {
  const referenceKey = voucherReferenceKey(reference);
  if (!referenceKey) return;
  await PaymentReferenceLock.deleteOne({ business, referenceKey, sourceModel, sourceId });
}

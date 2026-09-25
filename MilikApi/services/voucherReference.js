import PaymentVoucher from "../models/PaymentVoucher.js";
import { createError } from "../utils/error.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { cleanVoucherReference, voucherReferenceKey } from "../utils/voucherReference.js";

/**
 * A payment voucher reference may be used by one live voucher per company. A reversed voucher lets go of its reference,
 * so a wrongly-entered voucher can be reversed and entered again with the same one.
 * Vouchers saved before the reference key existed are matched on the reference text itself.
 */
export const assertVoucherReferenceUnused = async ({ business, reference, excludeId = null }) => {
  const key = voucherReferenceKey(reference);
  if (!key) return;

  const legacy = new RegExp(`^\s*${key.split(" ").map(escapeRegex).join("\s+")}\s*$`, "i");
  const clash = await PaymentVoucher.findOne({
    business,
    status: { $ne: "reversed" },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    $or: [{ referenceKey: key }, { reference: legacy }],
  }).select("voucherNo").lean();

  if (clash) {
    throw createError(409, `Reference "${cleanVoucherReference(reference)}" is already used by payment voucher ${clash.voucherNo}. Each payment voucher must have its own reference.`);
  }
};

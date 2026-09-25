// A voucher reference (M-Pesa code, cheque number, invoice number...) is compared ignoring case and stray spaces,
// so "UIIBC7DPWP", "uiibc7dpwp " and "UIIBC7 DPWP" count as the same reference.
export const cleanVoucherReference = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 100);

export const voucherReferenceKey = (value) => cleanVoucherReference(value).toLowerCase() || null;

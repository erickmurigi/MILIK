// Single source of truth for "who does this invoice's money belong to" — landlord or
// manager. Used by landlordStatementService.js so the report can never recognise an
// invoice's revenue for the wrong party. Categories are intentionally exhaustive: a new
// category must be added here deliberately rather than silently defaulting.
const LANDLORD_PASS_THROUGH_CATEGORIES = new Set(["RENT_CHARGE", "UTILITY_CHARGE", "DEPOSIT_CHARGE"]);

export const resolveChargeOwner = ({ invoice = {}, incomeRules = {} } = {}) => {
  const category = String(invoice?.category || "").toUpperCase();
  if (LANDLORD_PASS_THROUGH_CATEGORIES.has(category)) return "landlord";

  if (category === "LATE_PENALTY_CHARGE") {
    return (incomeRules?.latePenaltyBeneficiary || "manager") === "landlord" ? "landlord" : "manager";
  }

  const metadata = invoice?.metadata || {};
  const billItemKey = String(metadata?.billItemKey || "").toLowerCase();
  if (billItemKey === "lease_fee") {
    return (incomeRules?.leaseFeeBeneficiary || "manager") === "landlord" ? "landlord" : "manager";
  }

  // Ad-hoc OTHER_CHARGE invoices (e.g. move-out charges raised by the Deposit Settlement
  // flow) carry their own explicit per-charge owner rather than a company-wide rule —
  // the person settling the deposit picks it per line item.
  const chargeOwner = String(metadata?.chargeOwner || "").toLowerCase();
  if (chargeOwner === "landlord") return "landlord";
  if (chargeOwner === "propertymanager" || chargeOwner === "manager") return "manager";

  // No explicit signal — matches the existing default assumption for generic OTHER_CHARGE
  // invoices (service/admin fees the manager raises on their own account).
  return "manager";
};

// Move-out charges raised by the Deposit Settlement flow (controllers/propertyController/
// depositSettlement.js via MilikClient's DepositSettlementModal) always need the manager to
// go spend real cash to fulfil them (hire a contractor, etc.) once settled from a deposit —
// unlike a plain pass-through bill, so they're flagged regardless of resolveChargeOwner's result.
export const isExitCharge = (invoice = {}) => {
  const metadata = invoice?.metadata || {};
  return Boolean(metadata?.depositSettlement === true || metadata?.moveOutCharge === true);
};

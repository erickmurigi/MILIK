// Shared helpers for the "search" box on list endpoints (tenants, receipts, invoices, maintenance, M-Pesa notifications), so a
// user can find a record by what they actually remember: the person, the unit number, the property, a phone number.
import Tenant from "../models/Tenant.js";
import Unit from "../models/Unit.js";
import Property from "../models/Property.js";
import { escapeRegex } from "./escapeRegex.js";

const LIMIT = 1000;

export const cleanTerm = (value) => String(value ?? "").trim().slice(0, 100);

export const searchRegex = (term) => new RegExp(escapeRegex(cleanTerm(term)), "i");

/**
 * Phone numbers are stored in many shapes (0712 345 678, +254712345678, 254-712-345678). When the search looks like a phone
 * number, match on its last 9 digits with any separators between them, so 0712345678 finds +254 712 345 678.
 * Returns null when the term is not phone-like.
 */
export const phoneSearchRegex = (term) => {
  const raw = cleanTerm(term);
  if (!/^[\d\s+()-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6) return null;
  // (String.raw so the backslash reaches the regular expression)
  return new RegExp(digits.slice(-9).split("").join(String.raw`\D*`));
};

/** Tenants whose name, code, phone, e-mail or ID number matches. */
export const matchTenantIds = async (business, term) => {
  const re = searchRegex(term);
  const phone = phoneSearchRegex(term);
  const rows = await Tenant.find({
    business,
    $or: [
      { name: re }, { tenantName: re }, { firstName: re }, { lastName: re }, { tenantCode: re }, { email: re }, { idNumber: re },
      { phone: phone || re },
    ],
  }).select("_id").limit(LIMIT).lean();
  return rows.map((r) => r._id);
};

/** Units whose number matches, plus every unit of a property whose name or code matches. */
export const matchUnitIds = async (business, term) => {
  const re = searchRegex(term);
  const [byNumber, properties] = await Promise.all([
    Unit.find({ business, unitNumber: re }).select("_id").limit(LIMIT).lean(),
    Property.find({ business, $or: [{ propertyName: re }, { propertyCode: re }] }).select("_id").limit(200).lean(),
  ]);
  const ids = byNumber.map((u) => u._id);
  if (properties.length) {
    const inProperties = await Unit.find({ business, property: { $in: properties.map((p) => p._id) } }).select("_id").limit(LIMIT).lean();
    ids.push(...inProperties.map((u) => u._id));
  }
  return ids;
};

/** Properties whose name or code matches. */
export const matchPropertyIds = async (business, term) => {
  const re = searchRegex(term);
  const rows = await Property.find({ business, $or: [{ propertyName: re }, { propertyCode: re }] }).select("_id").limit(200).lean();
  return rows.map((r) => r._id);
};

// Search helpers for the Inventory / POS list endpoints. The old searches only matched one field (PO number, receipt number,
// or whole words with $text); these match substrings, and every word typed must be found (in any of the fields), so
// "milk 500" finds "Fresh Milk 500ml" and "kam" finds "Kamau Traders".
import InvProduct from "../models/InvProduct.js";
import InvSupplier from "../models/InvSupplier.js";
import { cleanTerm, phoneSearchRegex } from "../../../utils/listSearch.js";
import { escapeRegex } from "../../../utils/escapeRegex.js";

const wordRegexes = (term) =>
  cleanTerm(term).split(/\s+/).filter(Boolean).slice(0, 6).map((w) => new RegExp(escapeRegex(w), "i"));

const combine = (clauses) => (clauses.length === 1 ? clauses[0] : { $and: clauses });

/** Products by name, SKU, barcode or description; null when the term is empty. */
export const productSearchFilter = (term) => {
  const regexes = wordRegexes(term);
  if (!regexes.length) return null;
  return combine(regexes.map((rx) => ({ $or: [{ name: rx }, { sku: rx }, { barcode: rx }, { description: rx }] })));
};

/** Stock movements by reference / notes, or by the name / SKU / barcode of the product moved; null when the term is empty. */
export const movementSearchFilter = async (business, term) => {
  const regexes = wordRegexes(term);
  if (!regexes.length) return null;
  const products = await InvProduct.find({ business, $or: regexes.flatMap((rx) => [{ name: rx }, { sku: rx }, { barcode: rx }]) })
    .select("_id name sku barcode").limit(500).lean();
  return combine(regexes.map((rx) => {
    const or = [{ reference: rx }, { notes: rx }];
    const ids = products.filter((p) => rx.test(p.name) || rx.test(p.sku || "") || rx.test(p.barcode || "")).map((p) => p._id);
    if (ids.length) or.push({ product: { $in: ids } });
    return { $or: or };
  }));
};

/** Purchase orders by PO number or by the supplier's name / phone; null when the term is empty. */
export const purchaseOrderSearchFilter = async (business, term) => {
  const regexes = wordRegexes(term);
  if (!regexes.length) return null;
  const suppliers = await InvSupplier.find({ business, $or: regexes.flatMap((rx) => [{ name: rx }, { contactName: rx }, { phone: rx }]) })
    .select("_id name contactName phone").limit(200).lean();
  return combine(regexes.map((rx) => {
    const or = [{ poNumber: rx }];
    const ids = suppliers.filter((s) => rx.test(s.name) || rx.test(s.contactName || "") || rx.test(s.phone || "")).map((s) => s._id);
    if (ids.length) or.push({ supplier: { $in: ids } });
    return { $or: or };
  }));
};

/** POS sales by receipt number, customer name or phone (a phone-like term matches its last digits); null when the term is empty. */
export const saleSearchFilter = (term) => {
  const clean = cleanTerm(term);
  if (!clean) return null;
  const phone = phoneSearchRegex(clean);
  if (phone) {
    const rx = new RegExp(escapeRegex(clean), "i");
    return { $or: [{ receiptNumber: rx }, { customerName: rx }, { customerPhone: phone }] };
  }
  return combine(wordRegexes(clean).map((rx) => ({ $or: [{ receiptNumber: rx }, { customerName: rx }, { customerPhone: rx }, { notes: rx }] })));
};

/** Adds `clause` to `filter` without clobbering an existing $and / $or. */
export const andInto = (filter, clause) => {
  if (clause) filter.$and = [...(filter.$and || []), clause];
  return filter;
};

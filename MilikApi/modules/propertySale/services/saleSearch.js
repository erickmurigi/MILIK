// Search helpers for the Property Sales list endpoints. The old $text search only matched whole words, so typing
// "Kam" never found "Kamau"; these match substrings, and every word typed must be found (in any of the fields).
import { cleanTerm, phoneSearchRegex } from "../../../utils/listSearch.js";
import { escapeRegex } from "../../../utils/escapeRegex.js";

/**
 * Filter fragment for `term` over `fields` (case-insensitive substring), or null when the term is empty.
 * `phoneFields` are also matched by the last digits of a phone-like term (0712345678 finds +254 712 345 678).
 */
export const wordsSearchFilter = (term, fields, { phoneFields = [] } = {}) => {
  const clean = cleanTerm(term);
  if (!clean) return null;
  const phone = phoneFields.length ? phoneSearchRegex(clean) : null;
  if (phone) {
    const rx = new RegExp(escapeRegex(clean), "i");
    return { $or: [...fields.map((f) => ({ [f]: rx })), ...phoneFields.map((f) => ({ [f]: phone }))] };
  }
  const clauses = clean.split(/\s+/).slice(0, 6).map((word) => {
    const rx = new RegExp(escapeRegex(word), "i");
    return { $or: fields.map((f) => ({ [f]: rx })) };
  });
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
};

/** Adds `clause` to `filter` without clobbering an existing $and. */
export const andInto = (filter, clause) => {
  if (clause) filter.$and = [...(filter.$and || []), clause];
  return filter;
};

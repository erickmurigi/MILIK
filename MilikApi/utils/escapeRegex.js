/**
 * Escapes all regex special characters in a user-supplied string before
 * embedding it in a MongoDB $regex query. Prevents ReDoS and unintended
 * wildcard matches (e.g. "." matching any character).
 */
export const escapeRegex = (value = "") =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

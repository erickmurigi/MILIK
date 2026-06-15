/**
 * Strip every non-alphanumeric character, then uppercase.
 * "KCA 123A", "KCA-123A", "kca.123a" all become "KCA123A".
 */
export const normalizePlate = (v = "") =>
  String(v || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Build a MongoDB-compatible regex that matches a plate regardless of
 * separators (spaces, dashes, dots) between characters.
 * "KCA123A" matches "KCA 123A", "KCA-123A", "KCA123A", etc.
 */
export const buildPlateRegex = (plate = "") => {
  const normalized = normalizePlate(plate);
  return new RegExp(
    `^${normalized
      .split("")
      .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^A-Z0-9]*")}$`,
    "i"
  );
};

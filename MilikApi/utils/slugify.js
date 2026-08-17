/**
 * Turns free text into a URL-safe slug segment, e.g. "Kilimani Heights A3" -> "kilimani-heights-a3".
 * Appends a short suffix (last 6 chars of an id) to keep slugs unique per-business without a DB round trip.
 */
export const slugify = (text = "") =>
  String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const slugifyWithSuffix = (text, id) => {
  const base = slugify(text) || "listing";
  const suffix = String(id || "").slice(-6);
  return suffix ? `${base}-${suffix}` : base;
};

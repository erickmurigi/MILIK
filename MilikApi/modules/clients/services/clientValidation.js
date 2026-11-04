// Client master-data validation: KRA PIN, the one-phone-number house rule,
// and duplicate detection. Kept free of Express so the billing run, imports
// and the M-Pesa matcher can reuse the same rules.
import Client, { KRA_PIN_PATTERN } from "../models/Client.js";
import { escapeRegex } from "../../../utils/escapeRegex.js";

const PLACEHOLDERS = new Set(["", "-", "--", "n/a", "na", "none"]);
export const isPlaceholder = (value) =>
  value === null || value === undefined || PLACEHOLDERS.has(String(value).trim().toLowerCase());

export const normalizeKraPin = (value) => (isPlaceholder(value) ? "" : String(value).trim().toUpperCase());

// Returns { value, warning } or { error }. The A/P prefix is advisory only —
// KRA has issued edge cases (e.g. trusts) that don't follow it.
export const validateKraPin = (raw, clientType = "company") => {
  const value = normalizeKraPin(raw);
  if (!value) return { value: "" };
  if (!KRA_PIN_PATTERN.test(value)) {
    return { error: "KRA PIN must be a letter, 9 digits and a letter (e.g. P051234567X)" };
  }
  let warning = "";
  if (clientType === "individual" && !value.startsWith("A")) warning = "Individual KRA PINs normally start with 'A'";
  if (clientType !== "individual" && !value.startsWith("P")) warning = "Non-individual KRA PINs normally start with 'P'";
  return { value, warning };
};

const PHONE_ERROR = "Enter one phone number, e.g. 0712 345 678, or - for none";

// Kenyan mobiles are stored as 0XXXXXXXXX (same as tenants/landlords). Clients
// are often companies, so a single landline/international number is accepted
// too — but never two numbers in one field.
export const normalizeClientPhone = (raw) => {
  if (isPlaceholder(raw)) return { value: "" };
  const text = String(raw).trim();
  if (/[,;/]|\bor\b|&/i.test(text)) return { error: PHONE_ERROR };
  const digits = text.replace(/\D/g, "");
  let local = digits;
  if (digits.length === 12 && digits.startsWith("254")) local = `0${digits.slice(3)}`;
  else if (digits.length === 9 && /^[17]/.test(digits)) local = `0${digits}`;
  if (/^0[17]\d{8}$/.test(local)) return { value: local };
  if (!/^\+?[\d\s()-]+$/.test(text) || digits.length < 7 || digits.length > 15) return { error: PHONE_ERROR };
  return { value: text.replace(/\s+/g, " ") };
};

// All the shapes the same Kenyan number may have been typed in, for lookups.
export const phoneVariants = (phone) => {
  const { value } = normalizeClientPhone(phone);
  if (!value) return [];
  if (/^0[17]\d{8}$/.test(value)) {
    const rest = value.slice(1);
    return [value, `254${rest}`, `+254${rest}`, rest];
  }
  return [value];
};

const NAME_NOISE = new Set(["ltd", "limited", "plc", "co", "company", "inc", "llc", "the", "kenya", "k", "and", "group", "holdings", "enterprises", "services"]);

export const normalizeNameTokens = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !NAME_NOISE.has(token));

const bigrams = (text) => {
  const grams = new Map();
  for (let i = 0; i < text.length - 1; i += 1) {
    const gram = text.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) || 0) + 1);
  }
  return grams;
};

// Sørensen–Dice on character bigrams of the noise-stripped name: tolerant of
// "Acme Ltd" vs "ACME Limited" and small typos, cheap enough to run in JS
// over the small candidate set the indexed query returns.
export const nameSimilarity = (a, b) => {
  const left = normalizeNameTokens(a).join(" ");
  const right = normalizeNameTokens(b).join(" ");
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  let overlap = 0;
  for (const [gram, count] of leftGrams) overlap += Math.min(count, rightGrams.get(gram) || 0);
  const size = left.length - 1 + right.length - 1;
  return size > 0 ? Math.round(((2 * overlap) / size) * 100) / 100 : 0;
};

const NAME_THRESHOLD = 0.8;

export const findDuplicateClients = async ({ business, name = "", taxPin = "", phone = "", email = "", excludeId = null, limit = 10 }) => {
  const pin = normalizeKraPin(taxPin);
  const mail = isPlaceholder(email) ? "" : String(email).trim().toLowerCase();
  const phones = phoneVariants(phone);
  const tokens = normalizeNameTokens(name);

  const or = [];
  if (pin) or.push({ taxPin: pin });
  if (mail) or.push({ email: mail });
  if (phones.length) or.push({ phone: { $in: phones } });
  // Anchor on the longest significant token: narrows candidates without
  // missing re-ordered or suffix-variant names.
  const anchor = [...tokens].sort((x, y) => y.length - x.length)[0];
  if (anchor && anchor.length >= 3) or.push({ name: new RegExp(escapeRegex(anchor), "i") });
  if (!or.length) return [];

  const filter = { business, $or: or };
  if (excludeId) filter._id = { $ne: excludeId };

  const candidates = await Client.find(filter)
    .select("name tradingName clientCode taxPin email phone status")
    .limit(100)
    .lean();

  return candidates
    .map((candidate) => {
      const reasons = [];
      if (pin && candidate.taxPin === pin) reasons.push("taxPin");
      if (mail && String(candidate.email || "").toLowerCase() === mail) reasons.push("email");
      if (phones.length && phones.includes(candidate.phone)) reasons.push("phone");
      const similarity = Math.max(nameSimilarity(name, candidate.name), nameSimilarity(name, candidate.tradingName));
      if (similarity >= NAME_THRESHOLD) reasons.push("name");
      // PIN is an identity match; email/phone strong; name alone is a hint.
      const score = Math.min(1, (reasons.includes("taxPin") ? 1 : 0) + (reasons.includes("email") ? 0.6 : 0)
        + (reasons.includes("phone") ? 0.5 : 0) + (reasons.includes("name") ? similarity * 0.5 : 0));
      return { client: candidate, reasons, nameSimilarity: similarity, score: Math.round(score * 100) / 100 };
    })
    .filter((row) => row.reasons.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

// Custom fields per item type. A property type (Sale Settings) may define extra fields (a vehicle: registration, make,
// mileage) and hide standard ones (title deed, size). A listing stores the values in `attributes` ({ fieldKey: value }).
// Everything here is pure: definitions are validated when a type is saved, values when a listing is saved.

export const FIELD_KINDS = ["text", "number", "select", "date", "boolean"];
// Standard listing fields a type may hide: they are simply not asked for on the form
export const HIDEABLE_GROUPS = ["size", "location", "titleDeed", "amenities"];

const MAX_FIELDS = 20;
const MAX_OPTIONS = 30;
const MAX_LABEL = 40;
const MAX_TEXT = 200;
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export const typeValue = (name) => String(name ?? "").trim().toLowerCase();

const slug = (label) =>
  String(label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9_]+/, "").slice(0, 36);

// Validates a type's field definitions. Existing keys are kept (so stored values stay attached when a label is renamed);
// new fields get a key derived from the label. Returns { fields, hiddenFields } or { error }.
export const sanitizeTypeConfig = ({ fields, hiddenFields } = {}) => {
  const outFields = [];
  if (fields !== undefined) {
    if (!Array.isArray(fields)) return { error: "fields must be a list" };
    if (fields.length > MAX_FIELDS) return { error: `A type can have at most ${MAX_FIELDS} extra fields` };
    const used = new Set();
    for (const raw of fields) {
      const label = String(raw?.label ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
      if (!label) return { error: "Every extra field needs a name" };
      const kind = FIELD_KINDS.includes(raw?.kind) ? raw.kind : "text";
      let key = KEY_RE.test(String(raw?.key ?? "")) ? String(raw.key) : slug(label) || "field";
      const base = key;
      for (let n = 2; used.has(key); n++) key = `${base}_${n}`.slice(0, 40);
      used.add(key);

      let options = [];
      if (kind === "select") {
        options = [...new Set((Array.isArray(raw.options) ? raw.options : []).map((o) => String(o ?? "").trim().slice(0, MAX_LABEL)).filter(Boolean))];
        if (!options.length) return { error: `"${label}" is a list, so it needs at least one choice` };
        if (options.length > MAX_OPTIONS) return { error: `"${label}" can have at most ${MAX_OPTIONS} choices` };
      }
      outFields.push({ key, label, kind, options, required: Boolean(raw?.required) });
    }
  }
  let outHidden;
  if (hiddenFields !== undefined) {
    if (!Array.isArray(hiddenFields)) return { error: "hiddenFields must be a list" };
    outHidden = [...new Set(hiddenFields.filter((g) => HIDEABLE_GROUPS.includes(g)))];
  }
  return { fields: fields !== undefined ? outFields : undefined, hiddenFields: outHidden };
};

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

/**
 * Cleans a listing's attribute values against its type's field definitions: only defined keys are kept, values are
 * coerced to the field kind, a list value must be one of its choices, and required fields must be filled
 * (unless enforceRequired is false, used when generating many units at once).
 * Returns { attributes } or { error }.
 */
export const cleanAttributes = (fields = [], input, { enforceRequired = true } = {}) => {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const attributes = {};
  for (const f of fields) {
    const raw = source[f.key];
    if (isBlank(raw)) {
      if (f.required && enforceRequired) return { error: `${f.label} is required` };
      continue;
    }
    switch (f.kind) {
      case "number": {
        const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
        if (!Number.isFinite(n)) return { error: `${f.label} must be a number` };
        attributes[f.key] = n;
        break;
      }
      case "date": {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return { error: `${f.label} must be a valid date` };
        attributes[f.key] = d.toISOString().slice(0, 10);
        break;
      }
      case "select": {
        const v = String(raw).trim();
        if (!f.options.includes(v)) return { error: `${f.label} must be one of: ${f.options.join(", ")}` };
        attributes[f.key] = v;
        break;
      }
      case "boolean":
        attributes[f.key] = raw === true || raw === "true" || raw === "Yes" || raw === "yes";
        break;
      default:
        attributes[f.key] = String(raw).trim().slice(0, MAX_TEXT);
    }
  }
  return { attributes };
};

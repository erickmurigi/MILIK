import { createError } from "../../../utils/error.js";
import SaleListing from "../models/SaleListing.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleSettings from "../models/SaleSettings.js";
import { cleanAttributes } from "../services/listingAttributes.js";
import { resolveActiveBusinessId, currentUserId, reserveSequentialNumberBlock } from "../services/businessScope.js";

const LISTING_PROPERTY_TYPES = ["plot", "house", "apartment", "commercial", "land", "other"];
const LISTING_SIZE_UNITS     = ["sqm", "sqft", "acres", "hectares"];
// under_contract / sold / reserved are driven by the offers + deals workflow and must never be
// imported directly (they would bypass every deal/offer guard).
const LISTING_IMPORT_STATUSES = ["available", "withdrawn"];
const BUYER_SOURCES          = ["walk_in", "referral", "online", "social_media", "agent", "cold_call", "other"];
const BUYER_KYC_STATUSES     = ["pending", "verified", "rejected"];

// Property types and sources are free-form: the built-ins plus whatever the business added in Sale Settings.
// Incoming values are matched case-insensitively and stored in the same form the forms use
// (types: lowercase name; sources: lowercase name with underscores).
const typeValue   = (v) => String(v ?? "").trim().toLowerCase();
const sourceValue = (v) => typeValue(v).replace(/\s+/g, "_");
const allowedFrom = async (business, builtIn, key, toValue) => {
  const settings = await SaleSettings.findOne({ business }).select(key).lean();
  const custom = (settings?.[key] ?? []).filter((i) => i.isActive !== false).map((i) => toValue(i.name));
  return new Set([...builtIn, ...custom]);
};

// Case-insensitive matching for the duplicate look-ups
const CI_COLLATION = { locale: "en", strength: 2 };
const norm    = (v) => String(v ?? "").trim().toLowerCase();
const clean   = (v) => String(v ?? "").trim();
const isBlank = (v) => v == null || String(v).trim() === "";

/**
 * Validates every doc against the Mongoose schema first (so one bad row never aborts the batch), then
 * inserts the rest with { ordered: false } and harvests per-row write errors.
 * Returns { inserted: Set<idx>, errors: Map<idx, message> } — never throws for row-level problems.
 * `numberField` is the unique sequence field used to match insertMany's returned docs back to input rows.
 */
const insertBatch = async (Model, docs, numberField) => {
  const errors = new Map();
  const inserted = new Set();
  const toInsert = [];
  const idxMap = [];

  docs.forEach((d, idx) => {
    const vErr = new Model(d).validateSync();
    if (vErr) {
      const first = Object.values(vErr.errors || {})[0];
      errors.set(idx, first?.message || vErr.message);
    } else {
      toInsert.push(d);
      idxMap.push(idx);
    }
  });

  if (!toInsert.length) return { inserted, errors };

  try {
    const result = await Model.insertMany(toInsert, { ordered: false });
    const savedNumbers = new Set(result.map((doc) => doc[numberField]));
    toInsert.forEach((d, k) => {
      if (savedNumbers.has(d[numberField])) inserted.add(idxMap[k]);
      else errors.set(idxMap[k], "Record was not saved");
    });
  } catch (err) {
    const writeErrors = [].concat(err?.writeErrors || []);
    if (writeErrors.length) {
      const failedAt = new Map(
        writeErrors.map((we) => [we.index ?? we.err?.index, we.errmsg || we.err?.errmsg || we.message || "Write failed"])
      );
      toInsert.forEach((_, k) => {
        if (failedAt.has(k)) errors.set(idxMap[k], failedAt.get(k));
        else inserted.add(idxMap[k]);
      });
    } else {
      // Non-bulk failure (e.g. connection) — nothing is known to be saved; report every remaining row.
      idxMap.forEach((idx) => errors.set(idx, err?.message || "Insert failed"));
    }
  }
  return { inserted, errors };
};

// ── Listings bulk import ──────────────────────────────────────────────────────

const bulkImportListingsHandler = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const rows     = req.body;

    if (!Array.isArray(rows) || rows.length === 0)
      return next(createError(400, "No records provided"));
    if (rows.length > 1000)
      return next(createError(400, "Maximum 1000 listings per import"));

    // Property types: the built-ins plus the company's own; a type's extra fields come with it
    const typeSettings = await SaleSettings.findOne({ business }).select("propertyTypes").lean();
    const allowedTypes = new Set([
      ...LISTING_PROPERTY_TYPES,
      ...(typeSettings?.propertyTypes ?? []).filter((t) => t.isActive !== false).map((t) => typeValue(t.name)),
    ]);
    const fieldsByType = new Map((typeSettings?.propertyTypes ?? []).map((t) => [typeValue(t.name), t.fields ?? []]));
    const failed = [];
    const validRows = []; // { row, rowNo, key, deed }

    rows.forEach((raw, i) => {
      const row = raw && typeof raw === "object" ? raw : {};
      try {
        if (isBlank(row.title))
          throw new Error("Title is required");
        if (isBlank(row.askingPrice) || !Number.isFinite(Number(row.askingPrice)) || Number(row.askingPrice) < 0)
          throw new Error("Asking Price must be a valid non-negative number");
        if (!isBlank(row.size) && (!Number.isFinite(Number(row.size)) || Number(row.size) < 0))
          throw new Error("Size must be a valid non-negative number");
        if (!isBlank(row.propertyType)) {
          const pt = typeValue(row.propertyType);
          if (!allowedTypes.has(pt)) throw new Error(`Invalid Property Type: ${row.propertyType} (add it in Sale Settings first)`);
          row.propertyType = pt;
        }
        // Extra columns the file added (row.extra: { header: value }) are matched to the type's custom fields by name
        // or key, then validated exactly like the form does. Columns that belong to other types are ignored.
        const typeFields = fieldsByType.get(typeValue(row.propertyType) || "plot") ?? [];
        if (typeFields.length) {
          const extra = row.extra && typeof row.extra === "object" && !Array.isArray(row.extra) ? row.extra : {};
          const byHeader = new Map(Object.entries(extra).map(([h, v]) => [typeValue(String(h).replace(/\*/g, "")), v]));
          const input = {};
          for (const f of typeFields) input[f.key] = byHeader.get(typeValue(f.label)) ?? byHeader.get(f.key);
          const cleaned = cleanAttributes(typeFields, input);
          if (cleaned.error) throw new Error(cleaned.error);
          row.attributes = cleaned.attributes;
        }
        if (row.sizeUnit && !LISTING_SIZE_UNITS.includes(row.sizeUnit))
          throw new Error(`Invalid Size Unit: ${row.sizeUnit}`);
        if (row.status && !LISTING_IMPORT_STATUSES.includes(row.status))
          throw new Error(`Invalid Status: ${row.status} (only ${LISTING_IMPORT_STATUSES.join(" / ")} can be imported; sales statuses are set through offers and deals)`);
        // Natural key: title deed number when present, otherwise title + location
        const deed = norm(row.titleDeedNumber);
        const key = deed ? `d:${deed}` : `t:${norm(row.title)}|${norm(row.location)}`;
        validRows.push({ row, rowNo: i + 1, key, deed });
      } catch (err) {
        failed.push({ row: i + 1, title: row.title || "", error: err.message });
      }
    });

    // Idempotency: skip rows that already exist in this business, and repeats inside the file itself.
    let skippedDuplicates = 0;
    let candidates = validRows;
    if (validRows.length) {
      const deeds  = [...new Set(validRows.filter((v) => v.deed).map((v) => clean(v.row.titleDeedNumber)))];
      const titles = [...new Set(validRows.filter((v) => !v.deed).map((v) => clean(v.row.title)))];
      const or = [];
      if (deeds.length)  or.push({ titleDeedNumber: { $in: deeds } });
      if (titles.length) or.push({ title: { $in: titles } });

      const existingByKey = new Map();
      if (or.length) {
        const existing = await SaleListing.find({ business, $or: or })
          .collation(CI_COLLATION)
          .select("listingNumber title location titleDeedNumber")
          .lean();
        for (const e of existing) {
          if (e.titleDeedNumber) existingByKey.set(`d:${norm(e.titleDeedNumber)}`, e.listingNumber);
          existingByKey.set(`t:${norm(e.title)}|${norm(e.location)}`, e.listingNumber);
        }
      }

      const seenInFile = new Map();
      candidates = [];
      for (const v of validRows) {
        const existingNo = existingByKey.get(v.key);
        if (existingNo) {
          failed.push({ row: v.rowNo, title: v.row.title || "", duplicate: true, error: `Duplicate — already exists as ${existingNo}` });
          skippedDuplicates++;
        } else if (seenInFile.has(v.key)) {
          failed.push({ row: v.rowNo, title: v.row.title || "", duplicate: true, error: `Duplicate of row ${seenInFile.get(v.key)} in this file` });
          skippedDuplicates++;
        } else {
          seenInFile.set(v.key, v.rowNo);
          candidates.push(v);
        }
      }
    }

    // Reserve the whole numbering block in one round trip, then insert in one batch
    // instead of one findOneAndUpdate + one create() per row. Numbers reserved for rows that
    // later fail simply leave a gap in the sequence.
    const successful = [];
    if (candidates.length) {
      const listingNumbers = await reserveSequentialNumberBlock(business, "LST", candidates.length);
      const docs = candidates.map(({ row }, idx) => ({
        business,
        listingNumber: listingNumbers[idx],
        title:              String(row.title).trim(),
        propertyType:       row.propertyType      || "plot",
        attributes:         row.attributes         || {},
        size:               !isBlank(row.size) ? Number(row.size) : null,
        sizeUnit:           row.sizeUnit           || "sqm",
        location:           row.location           || "",
        town:               row.town               || "",
        county:             row.county             || "",
        country:            row.country            || "Kenya",
        askingPrice:        Number(row.askingPrice),
        negotiable:         row.negotiable !== false && row.negotiable !== "No",
        currency:           row.currency           || "KES",
        status:             row.status             || "available",
        titleDeedAvailable: row.titleDeedAvailable === true || row.titleDeedAvailable === "Yes",
        titleDeedNumber:    row.titleDeedNumber    || "",
        amenities:          Array.isArray(row.amenities) ? row.amenities : [],
        notes:              row.notes              || "",
        createdBy:          userId,
        updatedBy:          userId,
      }));

      const { inserted, errors } = await insertBatch(SaleListing, docs, "listingNumber");
      candidates.forEach((v, idx) => {
        if (inserted.has(idx)) successful.push({ listingNumber: docs[idx].listingNumber, title: docs[idx].title });
        else failed.push({ row: v.rowNo, title: v.row.title || "", error: errors.get(idx) || "Record was not saved" });
      });
    }

    failed.sort((a, b) => a.row - b.row);
    res.status(200).json({ successful, failed, total: rows.length, skippedDuplicates });
  } catch (err) {
    next(err);
  }
};

// ── Buyers bulk import ────────────────────────────────────────────────────────

const bulkImportBuyersHandler = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const rows     = req.body;

    if (!Array.isArray(rows) || rows.length === 0)
      return next(createError(400, "No records provided"));
    if (rows.length > 1000)
      return next(createError(400, "Maximum 1000 buyers per import"));

    const allowedSources = await allowedFrom(business, BUYER_SOURCES, "leadSources", sourceValue);
    const failed = [];
    const validRows = []; // { row, rowNo, key }

    rows.forEach((raw, i) => {
      const row = raw && typeof raw === "object" ? raw : {};
      try {
        if (isBlank(row.fullName))
          throw new Error("Full Name is required");
        if (!isBlank(row.source)) {
          const src = sourceValue(row.source);
          if (!allowedSources.has(src)) throw new Error(`Invalid Source: ${row.source} (add it in Sale Settings first)`);
          row.source = src;
        }
        if (row.kycStatus && !BUYER_KYC_STATUSES.includes(row.kycStatus))
          throw new Error(`Invalid KYC Status: ${row.kycStatus}`);
        // Natural key: ID number when present, else phone, else email
        const id = norm(row.idNumber), phone = norm(row.phone), email = norm(row.email);
        const key = id ? `id:${id}` : phone ? `ph:${phone}` : email ? `em:${email}` : null;
        validRows.push({ row, rowNo: i + 1, key });
      } catch (err) {
        failed.push({ row: i + 1, fullName: row.fullName || "", error: err.message });
      }
    });

    // Idempotency: skip rows that already exist in this business, and repeats inside the file itself.
    let skippedDuplicates = 0;
    let candidates = validRows;
    if (validRows.length) {
      const collect = (prefix, field) => [...new Set(
        validRows.filter((v) => v.key?.startsWith(prefix)).map((v) => clean(v.row[field]))
      )];
      const ids = collect("id:", "idNumber");
      const phones = collect("ph:", "phone");
      const emails = collect("em:", "email");
      const or = [];
      if (ids.length)    or.push({ idNumber: { $in: ids } });
      if (phones.length) or.push({ phone: { $in: phones } });
      if (emails.length) or.push({ email: { $in: emails } });

      const existingByKey = new Map();
      if (or.length) {
        const existing = await SaleBuyer.find({ business, $or: or })
          .collation(CI_COLLATION)
          .select("buyerNumber idNumber phone email")
          .lean();
        for (const e of existing) {
          if (e.idNumber) existingByKey.set(`id:${norm(e.idNumber)}`, e.buyerNumber);
          if (e.phone)    existingByKey.set(`ph:${norm(e.phone)}`, e.buyerNumber);
          if (e.email)    existingByKey.set(`em:${norm(e.email)}`, e.buyerNumber);
        }
      }

      const seenInFile = new Map();
      candidates = [];
      for (const v of validRows) {
        const existingNo = v.key && existingByKey.get(v.key);
        if (existingNo) {
          failed.push({ row: v.rowNo, fullName: v.row.fullName || "", duplicate: true, error: `Duplicate — already exists as ${existingNo}` });
          skippedDuplicates++;
        } else if (v.key && seenInFile.has(v.key)) {
          failed.push({ row: v.rowNo, fullName: v.row.fullName || "", duplicate: true, error: `Duplicate of row ${seenInFile.get(v.key)} in this file` });
          skippedDuplicates++;
        } else {
          if (v.key) seenInFile.set(v.key, v.rowNo);
          candidates.push(v);
        }
      }
    }

    // Reserve the whole numbering block in one round trip, then insert in one batch
    // instead of one findOneAndUpdate + one create() per row. Numbers reserved for rows that
    // later fail simply leave a gap in the sequence.
    const successful = [];
    if (candidates.length) {
      const buyerNumbers = await reserveSequentialNumberBlock(business, "BYR", candidates.length);
      const docs = candidates.map(({ row }, idx) => ({
        business,
        buyerNumber: buyerNumbers[idx],
        fullName:    String(row.fullName).trim(),
        idNumber:    row.idNumber    || "",
        phone:       row.phone       || "",
        email:       row.email       ? String(row.email).toLowerCase().trim() : "",
        address:     row.address     || "",
        nationality: row.nationality || "Kenyan",
        source:      row.source      || "walk_in",
        kycStatus:   row.kycStatus   || "pending",
        notes:       row.notes       || "",
        createdBy:   userId,
        updatedBy:   userId,
      }));

      const { inserted, errors } = await insertBatch(SaleBuyer, docs, "buyerNumber");
      candidates.forEach((v, idx) => {
        if (inserted.has(idx)) successful.push({ buyerNumber: docs[idx].buyerNumber, fullName: docs[idx].fullName });
        else failed.push({ row: v.rowNo, fullName: v.row.fullName || "", error: errors.get(idx) || "Record was not saved" });
      });
    }

    failed.sort((a, b) => a.row - b.row);
    res.status(200).json({ successful, failed, total: rows.length, skippedDuplicates });
  } catch (err) {
    next(err);
  }
};

// Only one import of each kind per business at a time: duplicate detection reads existing rows before inserting,
// so two overlapping uploads of the same file would otherwise both insert. (Single API process; the guard is in-memory.)
const runningImports = new Set();
const withImportLock = (kind, handler) => async (req, res, next) => {
  let key;
  try {
    key = `${resolveActiveBusinessId(req)}:${kind}`;
  } catch (err) {
    return next(err);
  }
  if (runningImports.has(key)) {
    return next(createError(409, "An import is already running for this business - wait for it to finish, then try again"));
  }
  runningImports.add(key);
  try {
    await handler(req, res, next);
  } finally {
    runningImports.delete(key);
  }
};

export const bulkImportListings = withImportLock("listings", bulkImportListingsHandler);
export const bulkImportBuyers = withImportLock("buyers", bulkImportBuyersHandler);

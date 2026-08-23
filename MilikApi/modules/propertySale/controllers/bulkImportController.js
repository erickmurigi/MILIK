import { createError } from "../../../utils/error.js";
import SaleListing from "../models/SaleListing.js";
import SaleBuyer from "../models/SaleBuyer.js";
import { resolveActiveBusinessId, currentUserId, generateSequentialNumber } from "../services/businessScope.js";

const LISTING_PROPERTY_TYPES = ["plot", "house", "apartment", "commercial", "land", "other"];
const LISTING_SIZE_UNITS     = ["sqm", "sqft", "acres", "hectares"];
const LISTING_STATUSES       = ["available", "reserved", "under_contract", "sold", "withdrawn"];
const BUYER_SOURCES          = ["walk_in", "referral", "online", "agent", "other"];
const BUYER_KYC_STATUSES     = ["pending", "verified", "rejected"];

// ── Listings bulk import ──────────────────────────────────────────────────────

export const bulkImportListings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const rows     = req.body;

    if (!Array.isArray(rows) || rows.length === 0)
      return next(createError(400, "No records provided"));
    if (rows.length > 1000)
      return next(createError(400, "Maximum 1000 listings per import"));

    const successful = [];
    const failed     = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        if (!row.title || String(row.title).trim() === "")
          throw new Error("Title is required");
        if (row.askingPrice == null || isNaN(Number(row.askingPrice)) || Number(row.askingPrice) < 0)
          throw new Error("Asking Price must be a valid non-negative number");
        if (row.propertyType && !LISTING_PROPERTY_TYPES.includes(row.propertyType))
          throw new Error(`Invalid Property Type: ${row.propertyType}`);
        if (row.sizeUnit && !LISTING_SIZE_UNITS.includes(row.sizeUnit))
          throw new Error(`Invalid Size Unit: ${row.sizeUnit}`);
        if (row.status && !LISTING_STATUSES.includes(row.status))
          throw new Error(`Invalid Status: ${row.status}`);

        const listingNumber = await generateSequentialNumber(SaleListing, business, "LST");
        const doc = await SaleListing.create({
          business,
          listingNumber,
          title:              String(row.title).trim(),
          propertyType:       row.propertyType      || "plot",
          size:               row.size != null && !isNaN(Number(row.size)) ? Number(row.size) : null,
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
        });

        successful.push({ listingNumber: doc.listingNumber, title: doc.title });
      } catch (err) {
        failed.push({ row: i + 1, title: row.title || "", error: err.message });
      }
    }

    res.status(200).json({ successful, failed, total: rows.length });
  } catch (err) {
    next(err);
  }
};

// ── Buyers bulk import ────────────────────────────────────────────────────────

export const bulkImportBuyers = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const rows     = req.body;

    if (!Array.isArray(rows) || rows.length === 0)
      return next(createError(400, "No records provided"));
    if (rows.length > 1000)
      return next(createError(400, "Maximum 1000 buyers per import"));

    const successful = [];
    const failed     = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        if (!row.fullName || String(row.fullName).trim() === "")
          throw new Error("Full Name is required");
        if (row.source && !BUYER_SOURCES.includes(row.source))
          throw new Error(`Invalid Source: ${row.source}`);
        if (row.kycStatus && !BUYER_KYC_STATUSES.includes(row.kycStatus))
          throw new Error(`Invalid KYC Status: ${row.kycStatus}`);

        const buyerNumber = await generateSequentialNumber(SaleBuyer, business, "BYR");
        const doc = await SaleBuyer.create({
          business,
          buyerNumber,
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
        });

        successful.push({ buyerNumber: doc.buyerNumber, fullName: doc.fullName });
      } catch (err) {
        failed.push({ row: i + 1, fullName: row.fullName || "", error: err.message });
      }
    }

    res.status(200).json({ successful, failed, total: rows.length });
  } catch (err) {
    next(err);
  }
};

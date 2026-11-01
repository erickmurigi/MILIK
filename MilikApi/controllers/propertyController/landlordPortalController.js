import mongoose from "mongoose";
import LandlordStatement from "../../models/LandlordStatement.js";
import Company from "../../models/Company.js";
import Property from "../../models/Property.js";
import Unit from "../../models/Unit.js";
import Tenant from "../../models/Tenant.js";
import Landlord from "../../models/Landlord.js";
import { generateStatementPdf, isPdfCached } from "../../services/statementPdfService.js";
import { generateLandlordStatement } from "../../services/landlordStatementService.js";
import { buildLandlordPropertyMatch } from "./landlord.js";
import { parsePagination } from "../../utils/pagination.js";
import { createError } from "../../utils/error.js";
import { COMPANY_PRINT_FIELDS } from "../../utils/printCompanyFields.js";

// Never show draft/reviewed — those are internal, not-yet-issued statements.
const LANDLORD_VISIBLE_STATEMENT_STATUSES = ["approved", "sent", "revised"];

// GET /api/landlord-portal/statements
export const listMyStatements = async (req, res, next) => {
  try {
    const { landlordId, companyId } = req.landlordPortal;
    const { page: pageInt, limit: limitInt, skip } = parsePagination(req, { defaultLimit: 20, maxLimit: 200 });

    const filter = {
      business: companyId,
      landlord: landlordId,
      status: { $in: LANDLORD_VISIBLE_STATEMENT_STATUSES },
    };

    const [statements, total] = await Promise.all([
      LandlordStatement.find(filter)
        .sort({ periodStart: -1, version: -1 })
        .skip(skip)
        .limit(limitInt)
        .populate("property", "propertyCode propertyName address city")
        .select("statementNumber periodStart periodEnd status periodNet openingBalance closingBalance currency sentAt property version")
        .lean(),
      LandlordStatement.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: { statements, pagination: { total, page: pageInt, limit: limitInt, totalPages: Math.ceil(total / limitInt) } },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/landlord-portal/statements/:statementId/pdf
export const downloadMyStatementPdf = async (req, res, next) => {
  try {
    const { landlordId, companyId } = req.landlordPortal;
    const { statementId } = req.params;

    // Ownership check: a statement belongs to exactly one landlord (required single ref),
    // so scoping the lookup by landlord here is sufficient — no cache-key change needed.
    const [leanStatement, companyStub] = await Promise.all([
      LandlordStatement.findOne(
        { _id: statementId, business: companyId, landlord: landlordId, status: { $in: LANDLORD_VISIBLE_STATEMENT_STATUSES } },
        "_id status updatedAt generatedAt statementNumber"
      ).lean(),
      Company.findById(companyId).select("updatedAt").lean(),
    ]);

    if (!leanStatement) {
      return next(createError(404, "Statement not found or access denied"));
    }

    const statement = isPdfCached(leanStatement, companyStub?.updatedAt)
      ? leanStatement
      : await LandlordStatement.findOne({ _id: statementId, business: companyId, landlord: landlordId })
          .populate("property", "propertyCode propertyName name address city commissionPercentage commissionRecognitionBasis commissionPaymentMode commissionFixedAmount totalUnits")
          .populate("landlord", "firstName lastName landlordName email phone phoneNumber")
          .populate("business", `${COMPANY_PRINT_FIELDS} slogan POBOX Street City`)
          .lean();

    if (!statement) {
      return next(createError(404, "Statement not found or access denied"));
    }

    const pdfBuffer = await generateStatementPdf(statementId, companyId, { statement });

    const filename = `Statement_${statement.statementNumber || statementId}.pdf`;
    const disposition = req.query?.preview === "true" ? "inline" : "attachment";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
};

const LIVE_STATEMENT_PRESETS = new Set(["this_month", "last_month"]);

const resolveLivePeriod = (preset) => {
  const now = new Date();
  const base = preset === "last_month"
    ? new Date(now.getFullYear(), now.getMonth() - 1, 1)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const periodStart = new Date(base.getFullYear(), base.getMonth(), 1);
  const periodEnd = preset === "last_month"
    ? new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999)
    : now;
  return { periodStart, periodEnd };
};

// Shared by both the summary (JSON) and PDF variants of the live view: verifies the
// property is really the caller's own, resolves the requested preset period, and runs the
// live computation. Never persists anything — createDraftStatement (the persisting wrapper
// around generateLandlordStatement) is deliberately never called from the portal.
const computeMyLiveStatement = async (req) => {
  const { landlordId, companyId } = req.landlordPortal;
  const landlord = await Landlord.findOne({ _id: landlordId, company: companyId }).select("_id company landlordName").lean();
  if (!landlord) throw createError(404, "Landlord not found");

  const { propertyId } = req.query;
  if (!propertyId) throw createError(400, "propertyId is required");

  // Ownership check — never trust a client-supplied propertyId on its own.
  const property = await Property.findOne({ _id: propertyId, ...buildLandlordPropertyMatch(landlord) })
    .select("propertyCode propertyName name address city commissionPercentage commissionRecognitionBasis commissionPaymentMode commissionFixedAmount totalUnits")
    .lean();
  if (!property) throw createError(404, "Property not found or access denied");

  const preset = LIVE_STATEMENT_PRESETS.has(req.query.period) ? req.query.period : "this_month";
  const { periodStart, periodEnd } = resolveLivePeriod(preset);

  const statementData = await generateLandlordStatement({
    propertyId,
    landlordId,
    statementPeriodStart: periodStart,
    statementPeriodEnd: periodEnd,
    cutoffAt: new Date(),
  });

  return { landlord, property, preset, statementData };
};

// GET /api/landlord-portal/live-statement?propertyId=&period=this_month|last_month
// Numbers can move before an admin ever reviews/approves a real statement for the period —
// the frontend must label this clearly as a live, unapproved snapshot.
export const getMyLiveStatement = async (req, res, next) => {
  try {
    const { property, preset, statementData } = await computeMyLiveStatement(req);

    res.status(200).json({
      success: true,
      data: {
        property: { _id: property._id, propertyCode: property.propertyCode, propertyName: property.propertyName },
        period: preset,
        periodStart: statementData.periodStart,
        periodEnd: statementData.periodEnd,
        openingBalance: statementData.openingBalance,
        periodNet: statementData.periodNet,
        closingBalance: statementData.closingBalance,
        currency: statementData.currency,
        totalsByCategory: statementData.totalsByCategory,
        generatedAt: statementData.generatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/landlord-portal/live-statement/pdf?propertyId=&period=this_month|last_month
// The actual "see it like in PMS" piece: generates a real PDF through the exact same
// renderer approved statements use (generateStatementPdf already accepts a non-persisted,
// in-memory "statement" object — see downloadMyStatementPdf's own preloaded-statement
// branch for the precedent), fed from the live computation's own `metadata` (== `workspace`
// in landlordStatementService.js), which already carries the full per-unit breakdown
// (rows/utilityColumns/totals) the PDF template renders — no new aggregation logic
// written here, so there's no new place for the numbers to drift from the real thing.
// Never cached (generateStatementPdf's cache key is deterministic from statement._id, and
// this "statement" never has one) and never persisted.
export const downloadMyLiveStatementPdf = async (req, res, next) => {
  try {
    const { landlord, property, preset, statementData } = await computeMyLiveStatement(req);
    const { companyId } = req.landlordPortal;

    const company = await Company.findById(companyId).select(`${COMPANY_PRINT_FIELDS} slogan POBOX Street City updatedAt`).lean();
    if (!company) return next(createError(404, "Company not found"));

    const fakeStatement = {
      // A fresh ObjectId every call, never persisted anywhere — just here so the PDF
      // renderer's cache key (built from statement._id + updatedAt) can never collide
      // between two concurrent live-preview requests for different properties/landlords.
      _id: new mongoose.Types.ObjectId(),
      status: "preview",
      statementNumber: `LIVE-PREVIEW-${preset === "last_month" ? "LAST-MONTH" : "THIS-MONTH"}`,
      property,
      landlord: { ...landlord, firstName: "", lastName: "", phone: "", phoneNumber: "" },
      business: company,
      periodStart: statementData.periodStart,
      periodEnd: statementData.periodEnd,
      openingBalance: statementData.openingBalance,
      periodNet: statementData.periodNet,
      closingBalance: statementData.closingBalance,
      currency: statementData.currency,
      generatedAt: statementData.generatedAt,
      updatedAt: statementData.generatedAt,
      metadata: { workspace: statementData.metadata },
    };

    const pdfBuffer = await generateStatementPdf(null, companyId, { statement: fakeStatement });

    const filename = `Live_Statement_${property.propertyCode || "property"}_${preset}.pdf`;
    const disposition = req.query?.preview === "true" ? "inline" : "attachment";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
};

// Shared chain: landlord -> properties -> units. Reused by both /units and /tenants.
const resolveMyPropertyAndUnitIds = async (landlordId, companyId) => {
  const landlord = await Landlord.findOne({ _id: landlordId, company: companyId }).select("_id company landlordName").lean();
  if (!landlord) return { propertyIds: [], unitIds: [] };

  const propertyIds = await Property.find(buildLandlordPropertyMatch(landlord)).distinct("_id");
  const unitIds = propertyIds.length ? await Unit.find({ property: { $in: propertyIds } }).distinct("_id") : [];
  return { propertyIds, unitIds };
};

// GET /api/landlord-portal/properties
export const listMyProperties = async (req, res, next) => {
  try {
    const { landlordId, companyId } = req.landlordPortal;
    const landlord = await Landlord.findOne({ _id: landlordId, company: companyId }).select("_id company landlordName").lean();
    if (!landlord) return next(createError(404, "Landlord not found"));

    const properties = await Property.find(buildLandlordPropertyMatch(landlord))
      .select("propertyCode propertyName address city status")
      .lean();

    res.status(200).json({ success: true, data: properties });
  } catch (err) {
    next(err);
  }
};

// GET /api/landlord-portal/units
export const listMyUnits = async (req, res, next) => {
  try {
    const { landlordId, companyId } = req.landlordPortal;
    const { propertyIds } = await resolveMyPropertyAndUnitIds(landlordId, companyId);
    if (!propertyIds.length) return res.status(200).json({ success: true, data: [] });

    const units = await Unit.find({ property: { $in: propertyIds } })
      .select("unitNumber property status isVacant rent")
      .populate("property", "propertyCode propertyName")
      .lean();

    res.status(200).json({ success: true, data: units });
  } catch (err) {
    next(err);
  }
};

// GET /api/landlord-portal/tenants
export const listMyTenants = async (req, res, next) => {
  try {
    const { landlordId, companyId } = req.landlordPortal;
    const { unitIds } = await resolveMyPropertyAndUnitIds(landlordId, companyId);
    if (!unitIds.length) return res.status(200).json({ success: true, data: [] });

    const tenants = await Tenant.find({
      business: companyId,
      $or: [{ unit: { $in: unitIds } }, { additionalUnits: { $in: unitIds } }],
    })
      .select("name tenantCode unit additionalUnits status email phone")
      .populate("unit", "unitNumber")
      .limit(1000)
      .lean();

    res.status(200).json({ success: true, data: tenants });
  } catch (err) {
    next(err);
  }
};

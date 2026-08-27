import mongoose from "mongoose";
import { escapeRegex } from "../../utils/escapeRegex.js";
import { getFieldOfficerPropertyIds } from "../../utils/fieldOfficerScope.js";
import Property from "../../models/Property.js";
import Unit from "../../models/Unit.js";
import Tenant from "../../models/Tenant.js";
import Landlord from "../../models/Landlord.js";
import Company from "../../models/Company.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import JournalEntry from "../../models/JournalEntry.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import TenantInvoiceNote from "../../models/TenantInvoiceNote.js";
import RentPayment from "../../models/RentPayment.js";
import Receipt from "../../models/Receipts.js";
import MeterReading from "../../models/MeterReading.js";
import Maintenance from "../../models/Maintenance.js";
import Inspection from "../../models/Inspection.js";
import Lease from "../../models/Lease.js";
import LandlordStatement from "../../models/LandlordStatement.js";
import ProcessedStatement from "../../models/ProcessedStatement.js";
import LandlordStandingOrder from "../../models/LandlordStandingOrder.js";
import LandlordAdvancement from "../../models/LandlordAdvancement.js";
import LandlordReceipt from "../../models/LandlordReceipt.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import ExpenseProperty from "../../models/ExpenseProperty.js";
import ExpenseRequisition from "../../models/ExpenseRequisition.js";
import LatePenaltyBatch from "../../models/LatePenaltyBatch.js";
import { ensureSystemChartOfAccounts } from "../../services/chartOfAccountsService.js";
import {
  uploadBufferToCloudinary,
  destroyCloudinaryAsset,
  publicIdFromCloudinaryUrl,
} from "../../utils/cloudinaryUpload.js";

const MAX_PROPERTY_IMAGES = 15;

const loadPropertyWithAccessCheck = async (req, propertyId) => {
  const property = await Property.findById(propertyId);
  if (!property) {
    return { error: { status: 404, message: "Property not found" } };
  }
  if (!req.user?.isSystemAdmin) {
    const userBusinessId = req.user?.company || req.user?.business;
    if (property.business.toString() !== userBusinessId?.toString()) {
      return { error: { status: 403, message: "Not authorized to access this property" } };
    }
  }
  return { property };
};
import {
  ensurePropertyControlAccount,
} from "../../services/propertyAccountingService.js";
import { createError } from "../../utils/error.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { isSelfManagingLandlordCompany } from "../../utils/companyModules.js";

const PROPERTY_CODE_PREFIX = "PRO";

const normalizePropertyCodeValue = (value = "") => String(value || "").trim().toUpperCase();

const extractPropertyCodeSequence = (value = "") => {
  const normalized = normalizePropertyCodeValue(value);
  const match = normalized.match(/^PRO(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
};

const generateNextPropertyCode = (existingCodes = [], reservedCodes = []) => {
  const takenCodes = new Set(
    [...existingCodes, ...reservedCodes]
      .map((code) => normalizePropertyCodeValue(code))
      .filter(Boolean)
  );

  let highestSequence = 0;
  for (const code of takenCodes) {
    const sequence = extractPropertyCodeSequence(code);
    if (sequence > highestSequence) {
      highestSequence = sequence;
    }
  }

  let nextSequence = highestSequence + 1;
  let candidate = `${PROPERTY_CODE_PREFIX}${String(nextSequence).padStart(3, "0")}`;

  while (takenCodes.has(candidate)) {
    nextSequence += 1;
    candidate = `${PROPERTY_CODE_PREFIX}${String(nextSequence).padStart(3, "0")}`;
  }

  return candidate;
};

const validatePropertyLandlords = async (businessId, landlords = []) => {
  const landlordIds = (Array.isArray(landlords) ? landlords : [])
    .map((item) => item?.landlordId)
    .filter((value) => mongoose.Types.ObjectId.isValid(value));

  if (landlordIds.length === 0) {
    return;
  }

  const uniqueLandlordIds = Array.from(new Set(landlordIds.map((id) => String(id))));
  if (uniqueLandlordIds.length !== landlordIds.length) {
    const error = new Error("The same landlord cannot be linked to the property more than once.");
    error.statusCode = 400;
    throw error;
  }

  const linkedLandlords = await Landlord.find({
    _id: { $in: uniqueLandlordIds },
    company: businessId,
  })
    .select("_id status")
    .lean();

  const linkedIds = new Set(linkedLandlords.map((item) => String(item._id)));
  const hasMismatch = uniqueLandlordIds.some((id) => !linkedIds.has(String(id)));

  if (hasMismatch) {
    const error = new Error("One or more selected landlords do not belong to this company.");
    error.statusCode = 400;
    throw error;
  }

  const archivedLandlord = linkedLandlords.find(
    (item) => String(item?.status || "").trim().toLowerCase() === "archived"
  );

  if (archivedLandlord) {
    const error = new Error("Archived landlords cannot be linked to a property. Restore the landlord first.");
    error.statusCode = 400;
    throw error;
  }
};

const normalizeOptionalString = (value = "") =>
  typeof value === "string" ? value.trim() : "";

const normalizeOptionalEmail = (value = "") => normalizeOptionalString(value).toLowerCase();

const generateLandlordCode = async (companyId) => {
  const result = await Landlord.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(String(companyId)), landlordCode: { $regex: /^LL\d+$/ } } },
    { $addFields: { codeNum: { $toInt: { $substr: ["$landlordCode", 2, -1] } } } },
    { $group: { _id: null, maxNum: { $max: "$codeNum" } } },
  ]);
  const next = (result[0]?.maxNum ?? 0) + 1;
  return `LL${String(next).padStart(3, "0")}`;
};

const getPropertyCompanyContext = async (businessId) => {
  if (!businessId || !mongoose.Types.ObjectId.isValid(businessId)) {
    const error = new Error("A valid company context is required for property creation.");
    error.statusCode = 400;
    throw error;
  }

  const company = await Company.findById(businessId)
    .select("companyName businessOwner registrationNo taxPIN email phoneNo postalAddress town roadStreet country companyMode")
    .lean();

  if (!company) {
    const error = new Error("Company not found for the supplied property context.");
    error.statusCode = 404;
    throw error;
  }

  return company;
};

const resolveSelfManagingCompanyLandlord = async ({ company, req, businessId }) => {
  const landlordName =
    normalizeOptionalString(company?.companyName) ||
    normalizeOptionalString(company?.businessOwner) ||
    "Company Owner";

  const regId =
    normalizeOptionalString(company?.registrationNo) ||
    `COMPANY-${String(company?._id || businessId)}`;

  const email =
    normalizeOptionalEmail(company?.email) ||
    `owner+${String(company?._id || businessId)}@milik.local`;

  const phoneNumber = normalizeOptionalString(company?.phoneNo) || "0000000000";

  const postalAddress =
    normalizeOptionalString(company?.postalAddress) ||
    normalizeOptionalString(company?.town) ||
    "Not provided";

  const location = [
    normalizeOptionalString(company?.roadStreet),
    normalizeOptionalString(company?.town),
    normalizeOptionalString(company?.country),
  ]
    .filter(Boolean)
    .join(", ");

  const taxPin =
    normalizeOptionalString(company?.taxPIN) ||
    `COMPANY-TAX-${String(company?._id || businessId).slice(-8).toUpperCase()}`;

  const candidateMatches = [
    { regId },
    { idNumber: regId },
    { landlordName, landlordType: "Company" },
  ];

  if (email) {
    candidateMatches.push({ email });
  }

  let ownerLandlord = await Landlord.findOne({
    company: businessId,
    $or: candidateMatches,
  });

  if (!ownerLandlord) {
    const createdById = await resolveAuditActorUserId({
      req,
      businessId,
      fallbackErrorMessage: "No valid company user could be resolved for self-managing landlord property setup.",
    });

    ownerLandlord = new Landlord({
      landlordCode: await generateLandlordCode(businessId),
      landlordType: "Company",
      landlordName,
      regId,
      idNumber: regId,
      taxPin,
      status: "Active",
      portalAccess: "Disabled",
      postalAddress,
      email,
      phoneNumber,
      location,
      company: businessId,
      createdBy: createdById,
    });

    await ownerLandlord.save();
  } else {
    ownerLandlord.landlordType = "Company";
    ownerLandlord.landlordName = landlordName;
    ownerLandlord.regId = regId;
    ownerLandlord.idNumber = regId;
    ownerLandlord.taxPin = taxPin;
    ownerLandlord.postalAddress = postalAddress;
    ownerLandlord.email = email;
    ownerLandlord.phoneNumber = phoneNumber;
    ownerLandlord.location = location;
    ownerLandlord.status = "Active";

    await ownerLandlord.save();
  }

  return [
    {
      landlordId: ownerLandlord._id,
      name: landlordName,
      contact: ownerLandlord.email || ownerLandlord.phoneNumber || "",
      isPrimary: true,
    },
  ];
};

const buildModeAwarePropertyAssignment = async ({ company, businessId, req, requestedLandlords = [] }) => {
  if (isSelfManagingLandlordCompany(company)) {
    return {
      landlords: await resolveSelfManagingCompanyLandlord({ company, req, businessId }),
      tenantsPaysTo: "landlord",
      depositHeldBy: "landlord",
      commissionPercentage: 0,
      commissionFixedAmount: 0,
      commissionPaymentMode: "percentage",
      commissionRecognitionBasis: "received",
      commissionTaxSettings: {
        enabled: false,
        taxCodeKey: "vat_standard",
        taxMode: "company_default",
        rateOverride: null,
      },
    };
  }

  const validLandlords = (requestedLandlords || [])
    .filter((landlord) => {
      const landlordName = landlord?.name?.trim() || landlord?.landlordName?.trim() || "";
      const hasLandlordId =
        landlord?.landlordId && mongoose.Types.ObjectId.isValid(landlord.landlordId);
      return landlordName && landlordName.toLowerCase() !== "default" && hasLandlordId;
    })
    .map((landlord, index) => ({
      landlordId: landlord.landlordId,
      name: (landlord?.name || landlord?.landlordName || "").trim(),
      contact: landlord?.contact?.trim() || "",
      isPrimary: index === 0,
    }));

  if (validLandlords.length === 0) {
    const error = new Error(
      "At least one landlord with a valid landlordId is required. Please select a landlord from the list."
    );
    error.statusCode = 400;
    throw error;
  }

  await validatePropertyLandlords(businessId, validLandlords);

  return {
    landlords: validLandlords,
  };
};

const getPropertyLifecycleStatus = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  return ["active", "maintenance", "closed", "archived"].includes(normalized)
    ? normalized
    : "active";
};

const countByIds = async (Model, field, ids = []) => {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  return Model.countDocuments({ [field]: { $in: ids } });
};

const countByPropertyOrUnits = async ({ Model, propertyId, unitIds = [], includeProperty = true } = {}) => {
  const clauses = [];

  if (includeProperty && propertyId) {
    clauses.push({ property: propertyId });
  }

  if (Array.isArray(unitIds) && unitIds.length > 0) {
    clauses.push({ unit: { $in: unitIds } });
  }

  if (clauses.length === 0) return 0;
  if (clauses.length === 1) return Model.countDocuments(clauses[0]);

  return Model.countDocuments({ $or: clauses });
};

const getPropertyDependencySummary = async (property) => {
  const propertyId = property?._id;
  const unitIds = await Unit.find({ property: propertyId }).distinct("_id");

  const [
    unitCount,
    tenantCount,
    leaseCount,
    maintenanceCount,
    inspectionCount,
    tenantInvoiceCount,
    tenantInvoiceNoteCount,
    receiptCount,
    legacyReceiptCount,
    meterReadingCount,
    latePenaltyBatchCount,
    processedStatementCount,
    landlordStatementCount,
    landlordStandingOrderCount,
    landlordAdvancementCount,
    landlordReceiptCount,
    paymentVoucherCount,
    expensePropertyCount,
    expenseRequisitionCount,
    journalEntryCount,
    financialLedgerCount,
    controlAccountPostingCount,
  ] = await Promise.all([
    Unit.countDocuments({ property: propertyId }),
    unitIds.length
      ? Tenant.countDocuments({
          $or: [
            { unit: { $in: unitIds } },
            { additionalUnits: { $in: unitIds } },
            { "unitTransferHistory.fromUnit": { $in: unitIds } },
            { "unitTransferHistory.toUnit": { $in: unitIds } },
          ],
        })
      : 0,
    countByIds(Lease, "unit", unitIds),
    countByIds(Maintenance, "unit", unitIds),
    countByPropertyOrUnits({ Model: Inspection, propertyId, unitIds }),
    TenantInvoice.countDocuments({ property: propertyId }),
    TenantInvoiceNote.countDocuments({ property: propertyId }),
    countByIds(RentPayment, "unit", unitIds),
    Receipt.countDocuments({ property: propertyId }),
    MeterReading.countDocuments({ property: propertyId }),
    LatePenaltyBatch.countDocuments({ property: propertyId }),
    ProcessedStatement.countDocuments({ property: propertyId }),
    LandlordStatement.countDocuments({ property: propertyId }),
    LandlordStandingOrder.countDocuments({ property: propertyId }),
    LandlordAdvancement.countDocuments({ property: propertyId }),
    LandlordReceipt.countDocuments({ property: propertyId }),
    PaymentVoucher.countDocuments({ property: propertyId }),
    ExpenseProperty.countDocuments({ property: propertyId }),
    ExpenseRequisition.countDocuments({ property: propertyId }),
    JournalEntry.countDocuments({ property: propertyId }),
    FinancialLedgerEntry.countDocuments({
      property: propertyId,
      status: { $nin: ["void", "draft"] },
    }),
    property?.controlAccount
      ? FinancialLedgerEntry.countDocuments({
          accountId: property.controlAccount,
          business: property.business,
          status: { $nin: ["void", "draft"] },
        })
      : 0,
  ]);

  const summary = {
    units: unitCount,
    tenants: tenantCount,
    leases: leaseCount,
    maintenance: maintenanceCount,
    inspections: inspectionCount,
    invoices: tenantInvoiceCount,
    invoiceNotes: tenantInvoiceNoteCount,
    receipts: receiptCount + legacyReceiptCount,
    meterReadings: meterReadingCount,
    latePenaltyBatches: latePenaltyBatchCount,
    processedStatements: processedStatementCount,
    landlordStatements: landlordStatementCount,
    standingOrders: landlordStandingOrderCount,
    landlordAdvancements: landlordAdvancementCount,
    landlordReceipts: landlordReceiptCount,
    paymentVouchers: paymentVoucherCount,
    propertyExpenses: expensePropertyCount,
    expenseRequisitions: expenseRequisitionCount,
    journalEntries: journalEntryCount,
    ledgerEntries: financialLedgerCount,
    controlAccountPostings: controlAccountPostingCount,
  };

  const activeDependencyCount = Object.values(summary).reduce(
    (total, count) => total + Number(count || 0),
    0
  );

  return {
    unitIds,
    summary,
    hasDependencies: activeDependencyCount > 0,
  };
};

const formatPropertyDependencyMessage = (summary = {}) => {
  const labels = {
    units: "units",
    tenants: "tenants",
    leases: "leases",
    maintenance: "maintenance records",
    inspections: "inspections",
    invoices: "invoices",
    invoiceNotes: "invoice notes",
    receipts: "receipts",
    meterReadings: "meter readings",
    latePenaltyBatches: "late penalty batches",
    processedStatements: "processed statements",
    landlordStatements: "landlord statements",
    standingOrders: "standing orders",
    landlordAdvancements: "landlord advancements",
    landlordReceipts: "landlord receipts",
    paymentVouchers: "payment vouchers",
    propertyExpenses: "property expenses",
    expenseRequisitions: "expense requisitions",
    journalEntries: "journal entries",
    ledgerEntries: "ledger entries",
    controlAccountPostings: "control account postings",
  };

  const parts = Object.entries(summary)
    .filter(([, count]) => Number(count || 0) > 0)
    .map(([key, count]) => `${count} ${labels[key] || key}`);

  return parts.slice(0, 6).join(", ");
};


const normalizePropertyServiceMode = (value = "Managing") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "letting") return "Letting";
  if (normalized === "both") return "Both";
  return "Managing";
};

/** True only for pure Letting — blocks statements and forces payment routing to landlord. */
const isLettingMode = (value) =>
  String(value || "").trim().toLowerCase() === "letting";

/** True for Letting OR Both — triggers the one-time letting fee on tenant add. */
const hasLettingFee = (value) => {
  const v = String(value || "").trim().toLowerCase();
  return v === "letting" || v === "both";
};

// Normalize to canonical values. Legacy "off-gl"/"OFF-GL (Property GL)" both
// map to "property-gl" — the new canonical name for the property-isolated ledger.
const normalizePropertyLedgerType = (value) => {
  const v = String(value || "").toLowerCase().trim();
  if (v.startsWith("off") || v === "property-gl" || v === "property gl") return "property-gl";
  return "in-gl";
};

const isPropertyGL = (value) => normalizePropertyLedgerType(value) === "property-gl";

// Create property
export const createProperty = async (req, res) => {
  try {
    const {
      dateAcquired,
      letManage,
      landlords,
      propertyCode,
      propertyName,
      lrNumber,
      category,
      propertyType,
      specification,
      multiStoreyType,
      numberOfFloors,
      country,
      townCityState,
      estateArea,
      roadStreet,
      zoneRegion,
      address,
      grossLettableArea,
      netLettableArea,
      unitMeasurement,
      rentPerMeasure,
      rentCurrency,
      accountLedgerType,
      propertyLedgerEnabled,
      primaryBank,
      alternativeTaxPin,
      invoicePrefix,
      invoicePaymentTerms,
      mpesaPaybill,
      disableMpesaStkPush,
      mpesaNarration,
      standingCharges,
      securityDeposits,
      smsExemptions,
      emailExemptions,
      excludeFeeSummary,
      exemptFromLatePenalties,
      drawerBank,
      bankBranch,
      accountName,
      accountNumber,
      notes,
      specificContactInfo,
      description,
      videoUrl,
      virtualTourUrl,
      status,
      images,
      business,
      lettingFeeMode,
      lettingFeeValue,
    } = req.body;

    const businessId = req.user?.company || req.user?.business || business;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message:
          "Business context is required to create a property. Please ensure you are logged in with a company account.",
      });
    }

    const normalizedPropertyCode = typeof propertyCode === "string" ? propertyCode.trim() : "";
    const normalizedPropertyName = typeof propertyName === "string" ? propertyName.trim() : "";
    const normalizedLrNumber = typeof lrNumber === "string" ? lrNumber.trim() : "";
    const normalizedPropertyType = typeof propertyType === "string" ? propertyType.trim() : "";

    if (!normalizedPropertyName || !normalizedPropertyType) {
      return res.status(400).json({
        success: false,
        message: "Property Name and Type are required fields",
      });
    }

    const [codeResult] = await Property.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(businessId)) } },
      { $addFields: { codeNum: { $toInt: { $substr: ["$propertyCode", PROPERTY_CODE_PREFIX.length, -1] } } } },
      { $group: { _id: null, maxNum: { $max: "$codeNum" } } },
    ]);
    const maxNum = codeResult?.maxNum ?? 0;

    const resolvedPropertyCode =
      normalizedPropertyCode ||
      generateNextPropertyCode(maxNum > 0 ? [`${PROPERTY_CODE_PREFIX}${String(maxNum).padStart(3, "0")}`] : []);

    const existingProperty = await Property.findOne({
      business: businessId,
      propertyCode: resolvedPropertyCode,
    }).lean();

    if (existingProperty) {
      return res.status(400).json({
        success: false,
        message: "Property with this code already exists",
      });
    }

    if (normalizedLrNumber) {
      const existingLrProperty = await Property.findOne({
        business: businessId,
        lrNumber: normalizedLrNumber,
      }).lean();

      if (existingLrProperty) {
        return res.status(400).json({
          success: false,
          message: "Property with this LR number already exists",
        });
      }
    }

    const [company, , createdById] = await Promise.all([
      getPropertyCompanyContext(businessId),
      ensureSystemChartOfAccounts(businessId),
      resolveAuditActorUserId({
        req,
        businessId,
        candidateUserIds: [req.body?.createdBy],
        fallbackErrorMessage: "No valid company user could be resolved for property creation.",
      }),
    ]);

    const bankingDetails = {
      drawerBank: drawerBank || "",
      bankBranch: bankBranch || "",
      accountName: accountName || "",
      accountNumber: accountNumber || "",
    };

    const cleanedData = {};
    if (typeof specification === "string" && specification.trim() !== "") {
      cleanedData.specification = specification.trim();
    }
    if (typeof multiStoreyType === "string" && multiStoreyType.trim() !== "") {
      cleanedData.multiStoreyType = multiStoreyType.trim();
    }
    if (typeof category === "string" && category.trim() !== "") {
      cleanedData.category = category.trim();
    }

    const modeAwareAssignment = await buildModeAwarePropertyAssignment({
      company,
      businessId,
      req,
      requestedLandlords: landlords,
    });

    const validStandingCharges = (standingCharges || [])
      .filter((charge) => charge?.serviceCharge?.trim())
      .map((charge) => ({
        serviceCharge: charge.serviceCharge.trim(),
        chargeMode: charge.chargeMode || "Monthly",
        billingCurrency: charge.billingCurrency || "KES",
        costPerArea: charge?.costPerArea?.trim() || "",
        chargeValue: Math.max(0, parseFloat(charge.chargeValue) || 0),
        vatRate: charge.vatRate || "16%",
        escalatesWithRent: charge.escalatesWithRent || false,
      }));

    const validSecurityDeposits = (securityDeposits || [])
      .filter((deposit) => deposit?.depositType?.trim())
      .map((deposit) => ({
        depositType: deposit.depositType.trim(),
        chargeMode: deposit.chargeMode || "Fixed Amount",
        amount: Math.max(0, parseFloat(deposit.amount) || 0),
        currency: deposit.currency || "KES",
        refundable: deposit.refundable !== false,
        terms: deposit?.terms?.trim() || "",
      }));

    const parsedFloors =
      numberOfFloors !== undefined && numberOfFloors !== null && numberOfFloors !== ""
        ? parseInt(numberOfFloors, 10)
        : 0;

    const resolvedLetManage = normalizePropertyServiceMode(letManage);
    const lettingOnly = isLettingMode(resolvedLetManage);
    const withLettingFee = hasLettingFee(resolvedLetManage);

    // Only pure Letting forces payment routing to the landlord — the agent steps away
    // after placement so the landlord must collect directly.
    // Managing and Both let the property's own tenantsPaysTo / depositHeldBy settings win.
    const resolvedTenantsPaysTo = lettingOnly
      ? "landlord"
      : (req.body.tenantsPaysTo || modeAwareAssignment.tenantsPaysTo || "propertyManager");
    const resolvedDepositHeldBy = lettingOnly
      ? "landlord"
      : (req.body.depositHeldBy || modeAwareAssignment.depositHeldBy || "propertyManager");

    const property = new Property({
      dateAcquired: dateAcquired ? new Date(dateAcquired) : null,
      letManage: resolvedLetManage,
      landlords: modeAwareAssignment.landlords,
      propertyCode: resolvedPropertyCode,
      propertyName: normalizedPropertyName,
      lrNumber: normalizedLrNumber,
      ...cleanedData,
      propertyType: normalizedPropertyType,
      numberOfFloors: Number.isNaN(parsedFloors) ? 0 : parsedFloors,
      country,
      townCityState,
      estateArea,
      roadStreet,
      zoneRegion,
      address:
        address ||
        `${roadStreet || ""}, ${estateArea || ""}, ${townCityState || ""}`
          .replace(/^,\s*|,\s*$/g, "")
          .replace(/,\s*,/g, ","),
      grossLettableArea: Math.max(0, parseFloat(grossLettableArea) || 0),
      netLettableArea: Math.max(0, parseFloat(netLettableArea) || 0),
      unitMeasurement: unitMeasurement || "Sq Ft",
      rentPerMeasure: Math.max(0, parseFloat(rentPerMeasure) || 0),
      rentCurrency: rentCurrency || "Kenyan Shilling [KES]",
      accountLedgerType: normalizePropertyLedgerType(accountLedgerType),
      propertyLedgerEnabled: isPropertyGL(accountLedgerType) ? !!propertyLedgerEnabled : false,
      primaryBank,
      alternativeTaxPin,
      invoicePrefix,
      invoicePaymentTerms,
      mpesaPaybill,
      disableMpesaStkPush,
      mpesaNarration,
      standingCharges: validStandingCharges,
      securityDeposits: validSecurityDeposits,
      smsExemptions,
      emailExemptions,
      excludeFeeSummary,
      exemptFromLatePenalties: !!exemptFromLatePenalties,
      bankingDetails,
      notes,
      specificContactInfo,
      description: description || notes,
      videoUrl: videoUrl || undefined,
      virtualTourUrl: virtualTourUrl || undefined,
      status: status || "active",
      images: images || [],
      business: businessId,
      createdBy: createdById,
      updatedBy: createdById,
      controlAccount: null,
      tenantsPaysTo: resolvedTenantsPaysTo,
      depositHeldBy: resolvedDepositHeldBy,
      commissionPercentage: modeAwareAssignment.commissionPercentage ?? 0,
      commissionFixedAmount: modeAwareAssignment.commissionFixedAmount ?? 0,
      commissionPaymentMode: modeAwareAssignment.commissionPaymentMode || "percentage",
      commissionRecognitionBasis: modeAwareAssignment.commissionRecognitionBasis || "received",
      commissionTaxSettings: modeAwareAssignment.commissionTaxSettings || undefined,
      lettingFeeMode: withLettingFee ? (lettingFeeMode === "fixed" ? "fixed" : "percentage") : "percentage",
      lettingFeeValue: withLettingFee ? Math.max(0, parseFloat(lettingFeeValue) || 100) : 100,
    });

    const savedProperty = await property.save();

    try {
      const controlAccount = await ensurePropertyControlAccount({
        businessId,
        propertyId: savedProperty._id,
        propertyCode: savedProperty.propertyCode,
        propertyName: savedProperty.propertyName,
      });

      if (
        controlAccount?._id &&
        String(savedProperty.controlAccount || "") !== String(controlAccount._id)
      ) {
        savedProperty.controlAccount = controlAccount._id;
        await savedProperty.save();
      }
    } catch (accountingError) {
      await Property.findByIdAndDelete(savedProperty._id);
      throw new Error(`Property control account creation failed: ${accountingError.message}`);
    }

    const populated = await Property.findById(savedProperty._id).populate(
      "controlAccount",
      "code name type group subGroup"
    ).lean();

    res.status(201).json({
      success: true,
      data: populated,
      message: "Property created successfully",
    });
  } catch (error) {
    console.error("Create property error:", error);

    let errorMessage = error.message || "Failed to create property";
    let statusCode = 500;

    if (error.name === "ValidationError" && error.errors) {
      const validationErrors = Object.values(error.errors)
        .filter((err) => err && err.message)
        .map((err) => err.message);

      if (validationErrors.length > 0) {
        errorMessage = validationErrors.join("; ");
        statusCode = 400;
      }
    } else if (error.code === 11000) {
      errorMessage = "A property with this code already exists";
      statusCode = 400;
    } else if (error.statusCode) {
      statusCode = error.statusCode;
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage,
    });
  }
};

// Get all properties
export const getProperties = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search: rawSearch,
      status,
      zone: rawZone,
      category: rawCategory,
      code: rawCode,
      name: rawName,
      lrNumber: rawLrNumber,
      landlord,
      location: rawLocation,
    } = req.query;
    const search = escapeRegex(rawSearch);
    const location = escapeRegex(rawLocation);
    const zone = escapeRegex(rawZone);
    const category = escapeRegex(rawCategory);
    const code = escapeRegex(rawCode);
    const name = escapeRegex(rawName);
    const lrNumber = escapeRegex(rawLrNumber);

    const businessId =
      req.user.isSystemAdmin && req.query.business
        ? req.query.business
        : req.user?.company;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required to fetch properties",
      });
    }

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limitNumber = Math.max(parseInt(limit, 10) || 10, 1);

    const query = { business: businessId };

    const foPropertyIds = await getFieldOfficerPropertyIds(req);
    if (foPropertyIds !== null) {
      query._id = { $in: foPropertyIds };
    }

    const orConditions = [];

    if (search) {
      orConditions.push(
        { propertyCode: { $regex: search, $options: "i" } },
        { propertyName: { $regex: search, $options: "i" } },
        { lrNumber: { $regex: search, $options: "i" } }
      );
    }

    if (location) {
      orConditions.push(
        { address: { $regex: location, $options: "i" } },
        { townCityState: { $regex: location, $options: "i" } },
        { estateArea: { $regex: location, $options: "i" } },
        { roadStreet: { $regex: location, $options: "i" } }
      );
    }

    if (orConditions.length > 0) {
      query.$or = orConditions;
    }

    if (status) query.status = status;
    if (zone) query.zoneRegion = { $regex: zone, $options: "i" };
    if (category) query.propertyType = { $regex: category, $options: "i" };
    if (code) query.propertyCode = { $regex: code, $options: "i" };
    if (name) query.propertyName = { $regex: name, $options: "i" };
    if (lrNumber) query.lrNumber = { $regex: lrNumber, $options: "i" };
    if (landlord) query["landlords.landlordId"] = landlord;

    const [properties, total] = await Promise.all([
      Property.find(query)
        .select(
          "propertyCode propertyName propertyType status letManage " +
          "totalUnits occupiedUnits vacantUnits landlords " +
          "address townCityState estateArea roadStreet zoneRegion lrNumber " +
          "accountLedgerType propertyLedgerEnabled commissionPercentage " +
          "commissionPaymentMode commissionCategoryKeys commissionTaxSettings " +
          "depositHeldBy vatRate taxMode taxCodeKey " +
          "grossLettableArea netLettableArea unitMeasurement rentPerMeasure rentCurrency " +
          "standingCharges securityDeposits " +
          "business controlAccount createdAt updatedAt"
        )
        .populate("landlords.landlordId", "_id landlordName firstName lastName")
        .limit(limitNumber)
        .skip((pageNumber - 1) * limitNumber)
        .sort({ createdAt: -1 })
        .lean(),
      Property.countDocuments(query),
    ]);

    // Attach fresh PCTRL balance to each property — how much the PM currently holds
    // for each landlord — using a single 2110 aggregate for the whole page.
    if (properties.length > 0) {
      const remittanceAcct = await ChartOfAccount.findOne({ business: businessId, code: "2110" })
        .select("_id").lean();
      if (remittanceAcct) {
        const propertyIds = properties.map((p) => p._id);
        const rows = await FinancialLedgerEntry.aggregate([
          {
            $match: {
              business: new mongoose.Types.ObjectId(String(businessId)),
              accountId: remittanceAcct._id,
              property: { $in: propertyIds },
              status: { $nin: ["void", "draft"] },
            },
          },
          { $group: { _id: "$property", credit: { $sum: "$credit" }, debit: { $sum: "$debit" } } },
        ]);
        const pctrlMap = new Map(rows.map((r) => [String(r._id), Math.max(0, r.credit - r.debit)]));
        properties.forEach((p) => { p.pctrlBalance = pctrlMap.get(String(p._id)) || 0; });
      }
    }

    res.json({
      success: true,
      data: properties,
      pagination: {
        total,
        page: pageNumber,
        pages: Math.ceil(total / limitNumber),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get single property
export const getProperty = async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id)
      .populate("business", "companyName")
      .populate("createdBy", "surname otherNames email")
      .populate("updatedBy", "surname otherNames email")
      .populate("landlords.landlordId", "_id landlordName firstName lastName email")
      .populate("controlAccount", "code name type group subGroup balance")
      .lean();

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    if (!req.user.isSystemAdmin) {
      const userBusinessId = req.user?.company;
      const propertyBusinessId = property.business?._id || property.business;
      if (String(propertyBusinessId) !== String(userBusinessId)) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to access this property",
        });
      }
    }

    const foPropertyIds = await getFieldOfficerPropertyIds(req);
    if (foPropertyIds !== null) {
      const foSet = new Set(foPropertyIds.map(String));
      if (!foSet.has(String(property._id))) {
        return next(createError(403, "Not authorized to access this property"));
      }
    }

    // Compute fresh PCTRL balance from 2110 entries tagged with this property
    const businessId = property.business?._id || property.business;
    const remittanceAcct = await ChartOfAccount.findOne({ business: businessId, code: "2110" })
      .select("_id").lean();
    if (remittanceAcct) {
      const rows = await FinancialLedgerEntry.aggregate([
        {
          $match: {
            business: new mongoose.Types.ObjectId(String(businessId)),
            accountId: remittanceAcct._id,
            property: new mongoose.Types.ObjectId(String(property._id)),
            status: { $nin: ["void", "draft"] },
          },
        },
        { $group: { _id: null, credit: { $sum: "$credit" }, debit: { $sum: "$debit" } } },
      ]);
      property.pctrlBalance = rows.length > 0
        ? Math.max(0, rows[0].credit - rows[0].debit)
        : 0;
    } else {
      property.pctrlBalance = 0;
    }

    res.json({
      success: true,
      data: property,
    });
  } catch (error) {
    next(error);
  }
};

// Update property
export const updateProperty = async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    if (!req.user.isSystemAdmin) {
      const userBusinessId = req.user?.company || req.user?.business;
      if (property.business.toString() !== userBusinessId?.toString()) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to update this property",
        });
      }
    }

    const company = await getPropertyCompanyContext(property.business);

    const trimmedPropertyCode =
      typeof req.body.propertyCode === "string" ? req.body.propertyCode.trim() : undefined;

    if (
      trimmedPropertyCode !== undefined &&
      trimmedPropertyCode &&
      trimmedPropertyCode !== property.propertyCode
    ) {
      const existingProperty = await Property.findOne({
        business: property.business,
        propertyCode: trimmedPropertyCode,
        _id: { $ne: property._id },
      }).lean();

      if (existingProperty) {
        return res.status(400).json({
          success: false,
          message: "Property with this code already exists",
        });
      }
    }

    if (req.body.lrNumber !== undefined && typeof req.body.lrNumber === "string") {
      const trimmedLrNumber = req.body.lrNumber.trim();
      if (trimmedLrNumber && trimmedLrNumber !== String(property.lrNumber || "")) {
        const existingLrProperty = await Property.findOne({
          business: property.business,
          lrNumber: trimmedLrNumber,
          _id: { $ne: property._id },
        }).lean();

        if (existingLrProperty) {
          return res.status(400).json({
            success: false,
            message: "Property with this LR number already exists",
          });
        }
      }
    }

    if (
      req.body.drawerBank !== undefined ||
      req.body.bankBranch !== undefined ||
      req.body.accountName !== undefined ||
      req.body.accountNumber !== undefined
    ) {
      req.body.bankingDetails = {
        drawerBank: req.body.drawerBank || property.bankingDetails?.drawerBank || "",
        bankBranch: req.body.bankBranch || property.bankingDetails?.bankBranch || "",
        accountName: req.body.accountName || property.bankingDetails?.accountName || "",
        accountNumber: req.body.accountNumber || property.bankingDetails?.accountNumber || "",
      };
    }

    const optionalEnumFields = ["category"];
    optionalEnumFields.forEach((field) => {
      if (req.body[field] === "" || req.body[field] === null) {
        req.body[field] = undefined;
      }
      if (typeof req.body[field] === "string") {
        req.body[field] = req.body[field].trim();
      }
    });

    if (req.body.dateAcquired === "") {
      req.body.dateAcquired = null;
    }

    if (isSelfManagingLandlordCompany(company)) {
      const modeAwareAssignment = await buildModeAwarePropertyAssignment({
        company,
        businessId: property.business,
        req,
        requestedLandlords:
          Object.prototype.hasOwnProperty.call(req.body || {}, "landlords")
            ? req.body.landlords
            : property.landlords,
      });

      req.body.landlords = modeAwareAssignment.landlords;

      if (modeAwareAssignment.tenantsPaysTo) {
        req.body.tenantsPaysTo = modeAwareAssignment.tenantsPaysTo;
      }
      if (modeAwareAssignment.depositHeldBy) {
        req.body.depositHeldBy = modeAwareAssignment.depositHeldBy;
      }
      if (modeAwareAssignment.commissionPercentage !== undefined) {
        req.body.commissionPercentage = modeAwareAssignment.commissionPercentage;
      }
      if (modeAwareAssignment.commissionFixedAmount !== undefined) {
        req.body.commissionFixedAmount = modeAwareAssignment.commissionFixedAmount;
      }
      if (modeAwareAssignment.commissionPaymentMode) {
        req.body.commissionPaymentMode = modeAwareAssignment.commissionPaymentMode;
      }
      if (modeAwareAssignment.commissionRecognitionBasis) {
        req.body.commissionRecognitionBasis = modeAwareAssignment.commissionRecognitionBasis;
      }
      if (modeAwareAssignment.commissionTaxSettings) {
        req.body.commissionTaxSettings = modeAwareAssignment.commissionTaxSettings;
      }
    } else if (Object.prototype.hasOwnProperty.call(req.body || {}, "landlords")) {
      const modeAwareAssignment = await buildModeAwarePropertyAssignment({
        company,
        businessId: property.business,
        req,
        requestedLandlords: req.body.landlords,
      });

      req.body.landlords = modeAwareAssignment.landlords;
    }

    delete req.body.specification;
    delete req.body.multiStoreyType;

    if (req.body.propertyCode !== undefined && typeof req.body.propertyCode === "string") {
      req.body.propertyCode = req.body.propertyCode.trim();
    }
    if (req.body.propertyName !== undefined && typeof req.body.propertyName === "string") {
      req.body.propertyName = req.body.propertyName.trim();
    }
    if (req.body.lrNumber !== undefined && typeof req.body.lrNumber === "string") {
      req.body.lrNumber = req.body.lrNumber.trim();
    }
    if (req.body.propertyType !== undefined && typeof req.body.propertyType === "string") {
      req.body.propertyType = req.body.propertyType.trim();
    }

    if (req.body.grossLettableArea !== undefined) {
      req.body.grossLettableArea = Math.max(0, parseFloat(req.body.grossLettableArea) || 0);
    }
    if (req.body.netLettableArea !== undefined) {
      req.body.netLettableArea = Math.max(0, parseFloat(req.body.netLettableArea) || 0);
    }
    if (req.body.rentPerMeasure !== undefined) {
      req.body.rentPerMeasure = Math.max(0, parseFloat(req.body.rentPerMeasure) || 0);
    }
    if (req.body.unitMeasurement !== undefined && typeof req.body.unitMeasurement === "string") {
      req.body.unitMeasurement = req.body.unitMeasurement.trim() || "Sq Ft";
    }
    if (req.body.rentCurrency !== undefined && typeof req.body.rentCurrency === "string") {
      req.body.rentCurrency = req.body.rentCurrency.trim() || "Kenyan Shilling [KES]";
    }

    if (req.body.letManage !== undefined) {
      req.body.letManage = normalizePropertyServiceMode(req.body.letManage);
    }

    if (req.body.accountLedgerType !== undefined) {
      req.body.accountLedgerType = normalizePropertyLedgerType(req.body.accountLedgerType);
    }
    // propertyLedgerEnabled is only meaningful when accountLedgerType === "property-gl"
    if (req.body.propertyLedgerEnabled !== undefined) {
      const effectiveLedgerType = req.body.accountLedgerType ?? property.accountLedgerType;
      req.body.propertyLedgerEnabled = isPropertyGL(effectiveLedgerType) ? !!req.body.propertyLedgerEnabled : false;
    }

    // Only pure Letting forces payment routing to landlord on save.
    // Managing and Both let the caller's explicit values (or existing values) stand.
    const effectiveLetManage = req.body.letManage !== undefined
      ? req.body.letManage
      : property.letManage;

    if (isLettingMode(effectiveLetManage)) {
      if (req.body.tenantsPaysTo === undefined) {
        req.body.tenantsPaysTo = "landlord";
      }
      if (req.body.depositHeldBy === undefined) {
        req.body.depositHeldBy = "landlord";
      }
    }

    if (req.body.lettingFeeMode !== undefined) {
      req.body.lettingFeeMode = req.body.lettingFeeMode === "fixed" ? "fixed" : "percentage";
    }
    if (req.body.lettingFeeValue !== undefined) {
      req.body.lettingFeeValue = Math.max(0, parseFloat(req.body.lettingFeeValue) || 0);
    }

    if (Array.isArray(req.body.standingCharges)) {
      req.body.standingCharges = req.body.standingCharges
        .filter((charge) => charge?.serviceCharge?.trim())
        .map((charge) => ({
          serviceCharge: charge.serviceCharge.trim(),
          chargeMode: charge.chargeMode || "Monthly",
          billingCurrency: charge.billingCurrency || "KES",
          costPerArea: charge?.costPerArea?.trim() || "",
          chargeValue: Math.max(0, parseFloat(charge.chargeValue) || 0),
          vatRate: charge.vatRate || "16%",
          escalatesWithRent: !!charge.escalatesWithRent,
        }));
    }

    if (Array.isArray(req.body.securityDeposits)) {
      req.body.securityDeposits = req.body.securityDeposits
        .filter((deposit) => deposit?.depositType?.trim())
        .map((deposit) => ({
          depositType: deposit.depositType.trim(),
          chargeMode: deposit.chargeMode || "Fixed Amount",
          amount: Math.max(0, parseFloat(deposit.amount) || 0),
          currency: deposit.currency || "KES",
          refundable: deposit.refundable !== false,
          terms: deposit?.terms?.trim() || "",
        }));
    }

    if (Array.isArray(req.body.utilityRates)) {
      req.body.utilityRates = req.body.utilityRates
        .filter((rate) => rate?.utilityType?.trim())
        .map((rate) => ({
          utilityType: rate.utilityType.trim(),
          unitCost: Math.max(0, parseFloat(rate.unitCost) || 0),
          billingCycle: ["monthly", "quarterly", "annually", "per_use"].includes(rate.billingCycle)
            ? rate.billingCycle
            : "monthly",
          isActive: rate.isActive !== false,
        }));
    }

    Object.keys(req.body).forEach((key) => {
      if (
        key !== "drawerBank" &&
        key !== "bankBranch" &&
        key !== "accountName" &&
        key !== "accountNumber" &&
        key !== "controlAccount" &&
        key !== "updatedBy" &&
        key !== "createdBy" &&
        key !== "business" &&
        req.body[key] !== undefined
      ) {
        property[key] = req.body[key];
      }
    });

    property.updatedBy = await resolveAuditActorUserId({
      req,
      businessId: property.business,
      candidateUserIds: [req.body?.updatedBy],
      fallbackErrorMessage: "No valid company user could be resolved for property update.",
    });
    property.updatedAt = Date.now();

    const updatedProperty = await property.save();

    res.json({
      success: true,
      data: updatedProperty,
      message: "Property updated successfully",
    });
  } catch (error) {
    console.error("Update property error:", error);

    let errorMessage = error.message || "Failed to update property";
    let statusCode = 500;

    if (error.name === "ValidationError" && error.errors) {
      const validationErrors = Object.values(error.errors)
        .filter((err) => err && err.message)
        .map((err) => err.message);
      if (validationErrors.length > 0) {
        errorMessage = validationErrors.join("; ");
        statusCode = 400;
      }
    } else if (error.code === 11000) {
      errorMessage = "A property with this code already exists";
      statusCode = 400;
    } else if (error.statusCode) {
      statusCode = error.statusCode;
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage,
    });
  }
};

// Delete property
export const deleteProperty = async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    if (!req.user.isSystemAdmin) {
      const userBusinessId = req.user?.company || req.user?.business;
      if (property.business.toString() !== userBusinessId?.toString()) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to delete this property",
        });
      }
    }

    const { summary, hasDependencies } = await getPropertyDependencySummary(property);

    if (hasDependencies) {
      const currentStatus = getPropertyLifecycleStatus(property.status);

      if (currentStatus !== "archived") {
        property.status = "archived";
        if (req.user?._id && mongoose.Types.ObjectId.isValid(String(req.user._id))) {
          property.updatedBy = req.user._id;
        }
        await property.save();
      }

      return res.status(200).json({
        success: true,
        mode: "archived",
        data: {
          id: String(property._id),
          status: property.status,
          dependencySummary: summary,
          controlAccountId: property.controlAccount || null,
        },
        message:
          currentStatus === "archived"
            ? `Property has historical records and remains archived. Hard delete is blocked to preserve accounting and audit history (${formatPropertyDependencyMessage(summary)}).`
            : `Property has historical records, so it was archived instead of deleted. Accounting, reports, and control account history were preserved (${formatPropertyDependencyMessage(summary)}).`,
      });
    }

    let controlAccountDeleted = false;
    if (property.controlAccount && mongoose.Types.ObjectId.isValid(String(property.controlAccount))) {
      const controlPostingCount = await FinancialLedgerEntry.countDocuments({
        business: property.business,
        accountId: property.controlAccount,
        status: { $nin: ["void", "draft"] },
      });

      if (controlPostingCount > 0) {
        property.status = "archived";
        if (req.user?._id && mongoose.Types.ObjectId.isValid(String(req.user._id))) {
          property.updatedBy = req.user._id;
        }
        await property.save();

        return res.status(200).json({
          success: true,
          mode: "archived",
          data: {
            id: String(property._id),
            status: property.status,
            dependencySummary: {
              ...summary,
              controlAccountPostings: controlPostingCount,
            },
            controlAccountId: property.controlAccount,
          },
          message:
            "Property control account already has postings, so the property was archived instead of deleted. Historical accounting links were preserved.",
        });
      }

      await ChartOfAccount.deleteOne({
        _id: property.controlAccount,
        business: property.business,
      });
      controlAccountDeleted = true;
    }

    await property.deleteOne();

    res.json({
      success: true,
      mode: "deleted",
      data: {
        id: String(req.params.id),
        controlAccountDeleted,
      },
      message: controlAccountDeleted
        ? "Property and unused control account deleted successfully."
        : "Property deleted successfully.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get property units
export const getPropertyUnits = async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id).select("_id business").lean();

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    if (!req.user.isSystemAdmin) {
      const userBusinessId = req.user?.company || req.user?.business;
      if (property.business.toString() !== userBusinessId?.toString()) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to access this property's units",
        });
      }
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
    const skip = (page - 1) * limit;

    const [units, total] = await Promise.all([
      Unit.find({ property: req.params.id })
        .populate("property", "propertyName address")
        .sort({ unitNumber: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Unit.countDocuments({ property: req.params.id }),
    ]);

    res.status(200).json({
      success: true,
      data: units,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};

// Get property tenants
export const getPropertyTenants = async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id).select("_id business").lean();

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    const propertyBusinessId = String(property.business?._id || property.business);
    if (!req.user.isSystemAdmin) {
      const userBusinessId = req.user?.company || req.user?.business;
      if (propertyBusinessId !== String(userBusinessId)) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to access this property's tenants",
        });
      }
    }

    const units = await Unit.find({ property: req.params.id }).distinct("_id");
    const tenants = await Tenant.find({
      business: propertyBusinessId,
      $or: [{ unit: { $in: units } }, { additionalUnits: { $in: units } }],
    })
      .select("name tenantCode unit additionalUnits rent deposit balance moveInDate moveOutDate status business")
      .populate("unit", "unitNumber rent")
      .limit(1000)
      .lean();

    res.status(200).json(tenants);
  } catch (err) {
    next(err);
  }
};

// Bulk import properties
export const bulkImportProperties = async (req, res, next) => {
  try {
    const { properties, business } = req.body;

    if (!Array.isArray(properties) || properties.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Properties array is required" });
    }

    if (properties.length > 1000) {
      return res
        .status(400)
        .json({ success: false, message: "Maximum 1000 properties per import" });
    }

    const businessId = req.user?.company || req.user?.business || business;

    if (!businessId) {
      return res
        .status(400)
        .json({ success: false, message: "Business/Company ID is required" });
    }

    await ensureSystemChartOfAccounts(businessId);
    const company = await getPropertyCompanyContext(businessId);
    const createdById = await resolveAuditActorUserId({
      req,
      businessId,
      candidateUserIds: [req.body?.createdBy],
      fallbackErrorMessage: "No valid company user could be resolved for property import.",
    });

    const normalizedProperties = properties.map((property) => ({
      ...property,
      propertyCode:
        typeof property?.propertyCode === "string" ? property.propertyCode.trim() : "",
      propertyName:
        typeof property?.propertyName === "string" ? property.propertyName.trim() : "",
      lrNumber: (() => { const v = typeof property?.lrNumber === "string" ? property.lrNumber.trim() : ""; const s = v.toLowerCase(); return (s === "-" || s === "--" || s === "n/a" || s === "na" || s === "none") ? "" : v; })(),
      propertyType:
        typeof property?.propertyType === "string" ? property.propertyType.trim() : "",
      category: typeof property?.category === "string" ? property.category.trim() : property?.category,
      townCityState:
        typeof property?.townCityState === "string"
          ? property.townCityState.trim()
          : property?.townCityState,
      estateArea:
        typeof property?.estateArea === "string" ? property.estateArea.trim() : property?.estateArea,
      roadStreet:
        typeof property?.roadStreet === "string" ? property.roadStreet.trim() : property?.roadStreet,
      zoneRegion:
        typeof property?.zoneRegion === "string" ? property.zoneRegion.trim() : property?.zoneRegion,
      landlordName:
        typeof property?.landlordName === "string"
          ? property.landlordName.trim()
          : property?.landlordName,
      letManage: normalizePropertyServiceMode(property?.letManage),
      lettingFeeMode: property?.lettingFeeMode === "fixed" ? "fixed" : "percentage",
      lettingFeeValue: property?.lettingFeeValue,
    }));

    const lrNumbers = normalizedProperties
      .filter((p) => p.lrNumber)
      .map((p) => p.lrNumber);

    const providedCodes = normalizedProperties
      .filter((p) => p.propertyCode)
      .map((p) => p.propertyCode);

    const [existingByLR, existingByCodes, allProperties] = await Promise.all([
      lrNumbers.length > 0
        ? Property.find({ lrNumber: { $in: lrNumbers }, business: businessId }).select("lrNumber").lean()
        : [],
      providedCodes.length > 0
        ? Property.find({ propertyCode: { $in: providedCodes }, business: businessId }).select("propertyCode").lean()
        : [],
      Property.find({ business: businessId }).select("propertyCode").limit(500).lean(),
    ]);

    const existingLRNumbers = new Set(existingByLR.map((p) => p.lrNumber));
    const existingPropertyCodes = new Set(existingByCodes.map((p) => p.propertyCode));
    const landlordLookupValues = normalizedProperties
      .map((p) => String(p.landlordName || "").trim())
      .filter(Boolean);
    const landlordDocs = landlordLookupValues.length
      ? await Landlord.find({ company: businessId }).select("_id landlordName landlordCode email phoneNumber status").limit(2000).lean()
      : [];
    const landlordMap = new Map();
    landlordDocs.forEach((landlord) => {
      if (landlord.landlordName) landlordMap.set(String(landlord.landlordName).trim().toLowerCase(), landlord);
      if (landlord.landlordCode) landlordMap.set(String(landlord.landlordCode).trim().toLowerCase(), landlord);
    });

    const results = {
      successful: [],
      failed: [],
      totalProcessed: 0,
    };

    const seenCodesInBatch = new Set();
    const seenLRInBatch = new Set();

    // For self-managing companies every property gets the same company-owner landlord — resolve once
    let cachedSelfManagingAssignment = null;
    if (isSelfManagingLandlordCompany(company)) {
      cachedSelfManagingAssignment = await buildModeAwarePropertyAssignment({ company, businessId, req, requestedLandlords: [] });
    }

    for (const property of normalizedProperties) {
      results.totalProcessed++;
      const errors = [];

      if (!property.propertyName) {
        errors.push("Property name is required");
      }
      if (!property.propertyType) {
        errors.push("Property type is required");
      }
      if (!isSelfManagingLandlordCompany(company) && !property.landlordName) {
        errors.push("Landlord name/code is required");
      }

      if (property.lrNumber) {
        if (existingLRNumbers.has(property.lrNumber) || seenLRInBatch.has(property.lrNumber)) {
          errors.push(`LR Number already exists: ${property.lrNumber}`);
        }
        seenLRInBatch.add(property.lrNumber);
      }

      if (property.propertyCode) {
        if (
          existingPropertyCodes.has(property.propertyCode) ||
          seenCodesInBatch.has(property.propertyCode)
        ) {
          errors.push(`Property Code already exists: ${property.propertyCode}`);
        }
        seenCodesInBatch.add(property.propertyCode);
      }

      if (errors.length > 0) {
        results.failed.push({
          propertyName: property.propertyName || "",
          error: errors.join("; "),
        });
        continue;
      }

      try {
        const generatedPropertyCode =
          property.propertyCode ||
          generateNextPropertyCode(
            allProperties.map((item) => item?.propertyCode),
            Array.from(new Set([...existingPropertyCodes, ...seenCodesInBatch]))
          );

        seenCodesInBatch.add(generatedPropertyCode);

        const landlordDoc = property.landlordName
          ? landlordMap.get(String(property.landlordName).trim().toLowerCase())
          : null;
        if (!isSelfManagingLandlordCompany(company) && !landlordDoc?._id) {
          throw new Error(`Landlord "${property.landlordName}" was not found. Use an existing landlord name or landlord code.`);
        }
        const requestedLandlords = landlordDoc?._id
          ? [{
              landlordId: landlordDoc._id,
              name: landlordDoc.landlordName,
              contact: landlordDoc.email || landlordDoc.phoneNumber || "",
              isPrimary: true,
            }]
          : [];
        let modeAwareAssignment;
        if (isSelfManagingLandlordCompany(company)) {
          modeAwareAssignment = cachedSelfManagingAssignment;
        } else {
          // Landlord already fetched and verified to belong to this business.
          // Check archived status inline — avoids a per-property Landlord.find round-trip.
          if (landlordDoc && String(landlordDoc.status || "").trim().toLowerCase() === "archived") {
            throw new Error("Archived landlords cannot be linked to a property. Restore the landlord first.");
          }
          modeAwareAssignment = {
            landlords: requestedLandlords.filter((l) => l.landlordId && mongoose.Types.ObjectId.isValid(String(l.landlordId))),
          };
        }
        const lettingOnly = isLettingMode(property.letManage);
        const withLettingFeeImport = hasLettingFee(property.letManage);
        const resolvedTenantsPaysTo = lettingOnly
          ? "landlord"
          : (property.tenantsPaysTo || modeAwareAssignment.tenantsPaysTo || "propertyManager");
        const resolvedDepositHeldBy = lettingOnly
          ? "landlord"
          : (property.depositHeldBy || modeAwareAssignment.depositHeldBy || "propertyManager");

        const newProperty = new Property({
          propertyCode: generatedPropertyCode,
          propertyName: property.propertyName,
          lrNumber: property.lrNumber || "",
          propertyType: property.propertyType || "Residential",
          category: property.category,
          townCityState: property.townCityState,
          estateArea: property.estateArea,
          roadStreet: property.roadStreet,
          zoneRegion: property.zoneRegion,
          totalUnits: property.totalUnits || 0,
          country: property.country || "Kenya",
          status: property.status || "active",
          accountLedgerType: normalizePropertyLedgerType(property.accountLedgerType),
          business: businessId,
          createdBy: createdById,
          updatedBy: createdById,
          letManage: property.letManage,
          landlords: modeAwareAssignment.landlords,
          tenantsPaysTo: resolvedTenantsPaysTo,
          depositHeldBy: resolvedDepositHeldBy,
          commissionPercentage: modeAwareAssignment.commissionPercentage ?? 0,
          commissionFixedAmount: modeAwareAssignment.commissionFixedAmount ?? 0,
          commissionPaymentMode: modeAwareAssignment.commissionPaymentMode || "percentage",
          commissionRecognitionBasis: modeAwareAssignment.commissionRecognitionBasis || "received",
          commissionTaxSettings: modeAwareAssignment.commissionTaxSettings || undefined,
          lettingFeeMode: withLettingFeeImport ? property.lettingFeeMode : "percentage",
          lettingFeeValue: withLettingFeeImport ? Math.max(0, parseFloat(property.lettingFeeValue) || 100) : 100,
        });

        const savedProperty = await newProperty.save();

        try {
          const controlAccount = await ensurePropertyControlAccount({
            businessId,
            propertyId: savedProperty._id,
            propertyCode: savedProperty.propertyCode,
            propertyName: savedProperty.propertyName,
          });

          if (
            controlAccount?._id &&
            String(savedProperty.controlAccount || "") !== String(controlAccount._id)
          ) {
            savedProperty.controlAccount = controlAccount._id;
            await savedProperty.save();
          }
        } catch (accountingError) {
          await Property.findByIdAndDelete(savedProperty._id);
          throw new Error(`Property control account creation failed: ${accountingError.message}`);
        }

        results.successful.push({
          propertyName: property.propertyName,
          code: generatedPropertyCode,
        });
      } catch (error) {
        results.failed.push({
          propertyName: property.propertyName || "",
          error: error.message || "Failed to create property",
        });
      }
    }

    const allFailed = results.successful.length === 0 && results.failed.length > 0;
    res.status(200).json({
      success: !allFailed,
      data: results,
    });
  } catch (err) {
    next(err);
  }
};

// Ensures every property has a PCTRL-{CODE} control account.
// Idempotent — safe to run multiple times.
export const backfillPropertyAccounts = async (req, res, next) => {
  try {
    const businessId =
      req.user?.company?._id ||
      req.user?.company ||
      req.query?.business ||
      req.body?.business ||
      null;

    if (!businessId) {
      return next(createError(400, "Company context is required."));
    }

    const properties = await Property.find({ business: businessId })
      .select("_id propertyCode propertyName controlAccount")
      .limit(500)
      .lean();

    const results = { total: properties.length, processed: 0, alreadyComplete: 0, failed: 0, errors: [] };

    for (const prop of properties) {
      if (prop.controlAccount) { results.alreadyComplete++; continue; }

      try {
        await ensurePropertyControlAccount({
          businessId,
          propertyId: prop._id,
          propertyCode: prop.propertyCode,
          propertyName: prop.propertyName,
        });
        results.processed++;
      } catch (err) {
        results.failed++;
        results.errors.push({
          propertyId: String(prop._id),
          propertyName: prop.propertyName,
          error: err.message,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Control account backfill complete. ${results.processed} propert${results.processed === 1 ? "y" : "ies"} updated, ${results.alreadyComplete} already complete${results.failed > 0 ? `, ${results.failed} failed` : ""}.`,
      ...results,
    });
  } catch (err) {
    next(err);
  }
};

// UPLOAD PROPERTY IMAGES (public listing photos)
export const uploadPropertyImages = async (req, res, next) => {
  try {
    const result = await loadPropertyWithAccessCheck(req, req.params.id);
    if (result.error) {
      return next(createError(result.error.status, result.error.message));
    }
    const property = result.property;

    const files = req.files || [];
    if (files.length === 0) {
      return next(createError(400, "No image files provided"));
    }

    const existingCount = (property.images || []).length;
    if (existingCount + files.length > MAX_PROPERTY_IMAGES) {
      return next(
        createError(
          400,
          `A property can have at most ${MAX_PROPERTY_IMAGES} images (${existingCount} already uploaded).`
        )
      );
    }

    const uploaded = await Promise.all(
      files.map((file) =>
        uploadBufferToCloudinary(file.buffer, {
          folder: `listings/properties/${property._id}`,
          resource_type: "image",
        })
      )
    );

    property.images = [...(property.images || []), ...uploaded.map((r) => r.secure_url)];
    const updatedProperty = await property.save();

    return res.status(200).json({ success: true, images: updatedProperty.images });
  } catch (err) {
    next(err);
  }
};

// DELETE A SINGLE PROPERTY IMAGE
export const deletePropertyImage = async (req, res, next) => {
  try {
    const result = await loadPropertyWithAccessCheck(req, req.params.id);
    if (result.error) {
      return next(createError(result.error.status, result.error.message));
    }
    const property = result.property;

    const { url } = req.body || {};
    if (!url || !(property.images || []).includes(url)) {
      return next(createError(400, "Image not found on this property"));
    }

    property.images = (property.images || []).filter((img) => img !== url);
    const updatedProperty = await property.save();

    const publicId = publicIdFromCloudinaryUrl(url);
    if (publicId) await destroyCloudinaryAsset(publicId);

    return res.status(200).json({ success: true, images: updatedProperty.images });
  } catch (err) {
    next(err);
  }
};

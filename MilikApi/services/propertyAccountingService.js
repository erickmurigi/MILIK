import mongoose from "mongoose";
import Property from "../models/Property.js";
import Landlord from "../models/Landlord.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import {
  ensureSystemChartOfAccounts,
  findSystemAccountByCode,
} from "./chartOfAccountsService.js";
import { resolveConfiguredAccountingDefaultAccount } from "./companyAccountingDefaultsService.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const escapeRegExp = (value = "") => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getPrimaryLandlordId = (propertyDoc) => {
  const landlords = Array.isArray(propertyDoc?.landlords) ? propertyDoc.landlords : [];
  const primary = landlords.find((item) => item?.isPrimary && item?.landlordId);
  const fallback = landlords.find((item) => item?.landlordId);
  return primary?.landlordId || fallback?.landlordId || null;
};

export const resolvePropertyAccountingContext = async ({
  propertyId,
  landlordId = null,
  businessId = null,
} = {}) => {
  if (!propertyId || !isValidObjectId(propertyId)) {
    throw new Error("A valid propertyId is required to resolve property accounting context.");
  }

  const property = await Property.findOne({
    _id: propertyId,
    ...(businessId && isValidObjectId(businessId) ? { business: businessId } : {}),
  })
    .select("_id business propertyCode propertyName landlords controlAccount")
    .lean();

  if (!property) {
    throw new Error("Property not found while resolving accounting context.");
  }

  const resolvedBusinessId = businessId || property.business || null;
  if (businessId && String(property.business || "") !== String(businessId)) {
    throw new Error("Property does not belong to the supplied business.");
  }

  const resolvedLandlordId = landlordId || getPrimaryLandlordId(property) || null;

  if (!resolvedBusinessId) {
    throw new Error("Business context could not be resolved from the property.");
  }

  if (!resolvedLandlordId) {
    throw new Error("Property has no linked landlord. Posting cannot continue.");
  }

  const linkedLandlordIds = (Array.isArray(property.landlords) ? property.landlords : [])
    .map((item) => String(item?.landlordId || ""))
    .filter(Boolean);

  if (!linkedLandlordIds.includes(String(resolvedLandlordId))) {
    throw new Error("Selected landlord is not linked to the supplied property.");
  }

  const landlord = await Landlord.findOne({
    _id: resolvedLandlordId,
    company: resolvedBusinessId,
  })
    .select("_id company")
    .lean();

  if (!landlord) {
    throw new Error("Linked landlord was not found in the supplied business.");
  }

  return {
    property,
    propertyId: property._id,
    businessId: resolvedBusinessId,
    landlordId: resolvedLandlordId,
    controlAccountId: property.controlAccount || null,
  };
};

export const ensurePropertyControlAccount = async ({
  businessId,
  propertyId,
  propertyCode,
  propertyName,
} = {}) => {
  if (!businessId || !isValidObjectId(businessId)) {
    throw new Error("Valid businessId is required to ensure a property control account.");
  }

  if (!propertyId || !isValidObjectId(propertyId)) {
    throw new Error("Valid propertyId is required to ensure a property control account.");
  }

  const property = await Property.findById(propertyId).select(
    "_id business propertyCode propertyName controlAccount"
  );

  if (!property) {
    throw new Error("Property not found while creating property control account.");
  }

  await ensureSystemChartOfAccounts(businessId);

  if (property.controlAccount && isValidObjectId(property.controlAccount)) {
    const existingLinked = await ChartOfAccount.findOne({
      _id: property.controlAccount,
      business: businessId,
    });

    if (existingLinked) {
      return existingLinked;
    }
  }

  const effectivePropertyCode = String(propertyCode || property.propertyCode || "").trim().toUpperCase();
  const effectivePropertyName = String(propertyName || property.propertyName || "").trim();

  if (!effectivePropertyCode || !effectivePropertyName) {
    throw new Error("Property code and property name are required to create a property control account.");
  }

  const controlCode = `PCTRL-${effectivePropertyCode}`;
  const exactExisting = await ChartOfAccount.findOne({
    business: businessId,
    code: controlCode,
  });

  let controlAccount = exactExisting;

  if (!controlAccount) {
    controlAccount = await ChartOfAccount.create({
      business: businessId,
      code: controlCode,
      name: `${effectivePropertyName} Property Control`,
      type: "asset",
      group: "assets",
      subGroup: "Receivables",
      parentAccount: null,
      level: 0,
      isHeader: false,
      isPosting: true,
      isSystem: true,
      balance: 0,
    });
  }

  if (String(property.controlAccount || "") !== String(controlAccount._id)) {
    property.controlAccount = controlAccount._id;
    await property.save();
  }

  return controlAccount;
};

export const resolveTenantDepositPayableAccount = async (businessId) => {
  await ensureSystemChartOfAccounts(businessId);

  const configured = await resolveConfiguredAccountingDefaultAccount({
    businessId,
    field: "depositLiabilityAccount",
  });
  if (configured) return configured;

  const exact = await findSystemAccountByCode(businessId, "2100");
  if (exact) return exact;

  const fallback = await ChartOfAccount.findOne({
    business: businessId,
    type: "liability",
    $or: [
      { name: { $regex: "^tenant deposit payable$", $options: "i" } },
      { name: { $regex: "^security deposits payable$", $options: "i" } },
      { name: { $regex: "tenant deposit", $options: "i" } },
      { name: { $regex: "security deposit", $options: "i" } },
    ],
  });

  if (!fallback) {
    throw new Error("Tenant Deposit Payable account was not found for this business.");
  }

  return fallback;
};

export const resolveLandlordRemittancePayableAccount = async (businessId) => {
  await ensureSystemChartOfAccounts(businessId);

  const exact = await findSystemAccountByCode(businessId, "2110");
  if (exact) return exact;

  const fallback = await ChartOfAccount.findOne({
    business: businessId,
    type: "liability",
    $or: [
      { name: { $regex: "^landlord remittance payable$", $options: "i" } },
      { name: { $regex: "^landlord payables?$", $options: "i" } },
      { name: { $regex: "landlord payable", $options: "i" } },
      { name: { $regex: "remittance payable", $options: "i" } },
    ],
  });

  if (!fallback) {
    throw new Error("Landlord Remittance Payable account was not found for this business.");
  }

  return fallback;
};

export const findPropertyControlAccount = async ({ businessId, propertyCode } = {}) => {
  if (!businessId || !propertyCode) return null;

  return ChartOfAccount.findOne({
    business: businessId,
    code: `PCTRL-${String(propertyCode || "").trim().toUpperCase()}`,
  });
};

export default {
  resolvePropertyAccountingContext,
  ensurePropertyControlAccount,
  resolveTenantDepositPayableAccount,
  resolveLandlordRemittancePayableAccount,
  findPropertyControlAccount,
};
export const getLandlordBalance = async (landlordId, businessId = null) => {
  if (!landlordId || !isValidObjectId(landlordId)) {
    throw new Error("Valid landlordId is required to calculate landlord balance.");
  }

  const landlord = await Landlord.findOne({
    _id: landlordId,
    ...(businessId && isValidObjectId(businessId) ? { company: businessId } : {}),
  }).select("_id company").lean();

  if (!landlord) {
    throw new Error("Landlord not found while calculating balance.");
  }

  const resolvedBusinessId = businessId || landlord.company;
  const payableAccount = await resolveLandlordRemittancePayableAccount(resolvedBusinessId);
  const FinancialLedgerEntry = (await import("../models/FinancialLedgerEntry.js")).default;

  const ledgerTotals = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        business: new mongoose.Types.ObjectId(String(resolvedBusinessId)),
        landlord: new mongoose.Types.ObjectId(String(landlordId)),
        accountId: payableAccount._id,
        status: { $ne: "reversed" },
        $or: [{ reversalOf: { $exists: false } }, { reversalOf: null }],
      },
    },
    { $group: { _id: null, debit: { $sum: "$debit" }, credit: { $sum: "$credit" }, count: { $sum: 1 } } },
  ]);

  const ledgerRow = ledgerTotals[0] || { debit: 0, credit: 0, count: 0 };
  if (ledgerRow.count > 0) {
    return Math.max(Number(ledgerRow.credit || 0) - Number(ledgerRow.debit || 0), 0);
  }

  const ProcessedStatement = (await import("../models/ProcessedStatement.js")).default;
  const LandlordPayment = (await import("../models/LandlordPayment.js")).default;

  const statementTotals = await ProcessedStatement.aggregate([
    {
      $match: {
        business: new mongoose.Types.ObjectId(String(resolvedBusinessId)),
        landlord: new mongoose.Types.ObjectId(String(landlordId)),
        status: { $ne: "reversed" },
        isNegativeStatement: { $ne: true },
      },
    },
    { $group: { _id: null, payable: { $sum: "$netAmountDue" } } },
  ]);

  const paymentTotals = await LandlordPayment.aggregate([
    {
      $match: {
        business: new mongoose.Types.ObjectId(String(resolvedBusinessId)),
        landlord: new mongoose.Types.ObjectId(String(landlordId)),
        status: { $ne: "reversed" },
      },
    },
    { $group: { _id: null, paid: { $sum: "$amount" } } },
  ]);

  return Math.max(Number(statementTotals[0]?.payable || 0) - Number(paymentTotals[0]?.paid || 0), 0);
};

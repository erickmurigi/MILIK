import mongoose from "mongoose";
import CompanySettings from "../models/CompanySettings.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import { findSystemAccountByCode } from "./chartOfAccountsService.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const normalizeText = (value = "") => String(value ?? "").trim();
const escapeRegExp = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const DEFAULT_ACCOUNTING_DEFAULTS = {
  tenantReceivableAccountCode: "1200",
  rentIncomeAccountCode: "4100",
  utilityRechargeIncomeAccountCode: "4102",
  penaltyIncomeAccountCode: "",
  depositLiabilityAccountCode: "2100",
  managementCommissionIncomeAccountCode: "4210",
};

export const normalizeAccountingDefaults = (raw = {}) => ({
  tenantReceivableAccountCode: normalizeText(raw?.tenantReceivableAccountCode) || DEFAULT_ACCOUNTING_DEFAULTS.tenantReceivableAccountCode,
  rentIncomeAccountCode: normalizeText(raw?.rentIncomeAccountCode) || DEFAULT_ACCOUNTING_DEFAULTS.rentIncomeAccountCode,
  utilityRechargeIncomeAccountCode:
    normalizeText(raw?.utilityRechargeIncomeAccountCode) || DEFAULT_ACCOUNTING_DEFAULTS.utilityRechargeIncomeAccountCode,
  penaltyIncomeAccountCode: normalizeText(raw?.penaltyIncomeAccountCode),
  depositLiabilityAccountCode:
    normalizeText(raw?.depositLiabilityAccountCode) || DEFAULT_ACCOUNTING_DEFAULTS.depositLiabilityAccountCode,
  managementCommissionIncomeAccountCode:
    normalizeText(raw?.managementCommissionIncomeAccountCode) || DEFAULT_ACCOUNTING_DEFAULTS.managementCommissionIncomeAccountCode,
});

export const getCompanyAccountingDefaults = async (businessId) => {
  const settings = await CompanySettings.findOne({ company: businessId }).select("accountingDefaults").lean();
  return normalizeAccountingDefaults(settings?.accountingDefaults || {});
};

const findAccountByConfiguredValue = async ({ businessId, configuredValue = "", type = null }) => {
  const raw = normalizeText(configuredValue);
  if (!raw) return null;

  const typeRegex = type ? new RegExp(`^${escapeRegExp(String(type))}$`, "i") : null;
  const baseQuery = {
    business: businessId,
    isHeader: { $ne: true },
    isPosting: { $ne: false },
  };

  const withType = (query = {}) => {
    if (!typeRegex) return query;
    const existingAnd = Array.isArray(query.$and) ? [...query.$and] : [];
    const nextQuery = { ...query };
    delete nextQuery.$and;
    return {
      ...nextQuery,
      $and: [
        ...existingAnd,
        {
          $or: [
            { type: typeRegex },
            { accountType: typeRegex },
            { nature: typeRegex },
            { accountNature: typeRegex },
          ],
        },
      ],
    };
  };

  if (isValidObjectId(raw)) {
    const byId = await ChartOfAccount.findOne(withType({ ...baseQuery, _id: raw })).lean();
    if (byId) return byId;
  }

  const byCode = await ChartOfAccount.findOne(withType({ ...baseQuery, code: raw })).lean();
  if (byCode) return byCode;

  const byAccountCode = await ChartOfAccount.findOne(withType({ ...baseQuery, accountCode: raw })).lean();
  if (byAccountCode) return byAccountCode;

  const exactNameRegex = new RegExp(`^${escapeRegExp(raw)}$`, "i");
  const byName = await ChartOfAccount.findOne(
    withType({
      ...baseQuery,
      $or: [{ name: exactNameRegex }, { accountName: exactNameRegex }],
    })
  ).lean();
  if (byName) return byName;

  return null;
};

const findAccountByCandidates = async ({ businessId, candidates = [] }) => {
  const baseQuery = {
    business: businessId,
    isHeader: { $ne: true },
    isPosting: { $ne: false },
  };

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const query = { ...baseQuery };
    const and = [];
    if (candidate?._id && isValidObjectId(candidate._id)) {
      query._id = candidate._id;
    } else {
      if (candidate?.type) {
        const typeRegex = new RegExp(`^${escapeRegExp(String(candidate.type))}$`, "i");
        and.push({
          $or: [
            { type: typeRegex },
            { accountType: typeRegex },
            { nature: typeRegex },
            { accountNature: typeRegex },
          ],
        });
      }
      if (candidate?.code) {
        and.push({ $or: [{ code: candidate.code }, { accountCode: candidate.code }] });
      }
      if (candidate?.nameRegex) {
        and.push({
          $or: [
            { name: { $regex: candidate.nameRegex, $options: "i" } },
            { accountName: { $regex: candidate.nameRegex, $options: "i" } },
          ],
        });
      }
      if (candidate?.group) {
        and.push({ group: candidate.group });
      }
      if (and.length > 0) query.$and = and;
    }

    const account = await ChartOfAccount.findOne(query).lean();
    if (account) return account;
  }

  return null;
};

export const resolveConfiguredChartAccount = async ({
  businessId,
  configuredValue = "",
  type = null,
  fallbackCode = null,
  fallbackCandidates = [],
} = {}) => {
  const configuredAccount = await findAccountByConfiguredValue({ businessId, configuredValue, type });
  if (configuredAccount) return configuredAccount;

  const normalizedFallbackCode = normalizeText(fallbackCode);
  if (normalizedFallbackCode) {
    const systemFallback = await findSystemAccountByCode(businessId, normalizedFallbackCode);
    if (systemFallback) {
      const normalizedRequestedType = normalizeText(type).toLowerCase();
      const normalizedSystemType = normalizeText(
        systemFallback?.type || systemFallback?.accountType || systemFallback?.nature || systemFallback?.accountNature
      ).toLowerCase();
      if (!normalizedRequestedType || !normalizedSystemType || normalizedRequestedType === normalizedSystemType) {
        return systemFallback;
      }
    }
  }

  return findAccountByCandidates({ businessId, candidates: fallbackCandidates });
};

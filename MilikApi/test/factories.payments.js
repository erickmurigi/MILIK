// Test data factories for the Receipts/Payments + Late Penalties + Meter Readings
// domain. Composes the base factories from test/factories.js rather than duplicating
// their logic — this file only adds what that file doesn't already cover:
//   - a tenant invoice to allocate a receipt against (created directly against the
//     TenantInvoice model — NOT via createTenantInvoiceRecord — because that helper
//     needs a full req/actor/GL context; direct creation is sufficient to exercise
//     the allocation engine, which just reads TenantInvoice documents from the DB)
//   - a late penalty rule
//
// Usage:
//   import { createTestTenantInvoice, createTestLatePenaltyRule } from "../../test/factories.payments.js";

import TenantInvoice from "../models/TenantInvoice.js";
import LatePenaltyRule from "../models/LatePenaltyRule.js";
import Property from "../models/Property.js";
import { createTestChartOfAccounts, createTestUser } from "./factories.js";

let uniqueCounter = 0;
const nextUniqueSuffix = () => `${Date.now().toString(36)}${(++uniqueCounter).toString(36)}${Math.floor(Math.random() * 1000)}`;

const idOf = (docOrId) => (docOrId && docOrId._id ? docOrId._id : docOrId);

const resolveLandlordId = async (property, landlord) => {
  if (landlord) return idOf(landlord);

  const landlords = Array.isArray(property?.landlords) ? property.landlords : null;
  if (landlords) {
    const primary = landlords.find((item) => item?.isPrimary) || landlords[0];
    if (primary?.landlordId) return idOf(primary.landlordId);
  }

  const propDoc = await Property.findById(idOf(property)).select("landlords").lean();
  const primary = (propDoc?.landlords || []).find((item) => item?.isPrimary) || (propDoc?.landlords || [])[0];
  return primary?.landlordId || null;
};

// Creates a minimal valid TenantInvoice (pending, open) directly against the model —
// per real schema requirements verified in models/TenantInvoice.js (business, property,
// landlord, tenant, unit, invoiceNumber, category, amount, invoiceDate, dueDate,
// createdBy, chartAccount are all required).
export const createTestTenantInvoice = async ({
  company,
  property,
  landlord,
  tenant,
  unit,
  createdBy,
  chartAccount,
  category = "RENT_CHARGE",
  amount = 15000,
  status = "pending",
  invoiceDate = new Date(),
  dueDate,
  ...overrides
} = {}) => {
  if (!company || !property || !tenant || !unit) {
    throw new Error("createTestTenantInvoice requires company, property, tenant, and unit.");
  }

  const businessId = idOf(company);

  const resolvedLandlordId = await resolveLandlordId(property, landlord);
  if (!resolvedLandlordId) {
    throw new Error("createTestTenantInvoice: could not resolve a landlord for the property.");
  }

  let resolvedChartAccount = chartAccount ? idOf(chartAccount) : null;
  if (!resolvedChartAccount) {
    const accounts = await createTestChartOfAccounts(businessId);
    const preferred = accounts.find((a) => a.code === "1200") || accounts[0];
    resolvedChartAccount = preferred?._id;
  }

  let resolvedCreatedBy = createdBy ? idOf(createdBy) : null;
  if (!resolvedCreatedBy) {
    const user = await createTestUser({ company: businessId });
    resolvedCreatedBy = user._id;
  }

  const resolvedInvoiceDate = new Date(invoiceDate);
  const resolvedDueDate = dueDate ? new Date(dueDate) : resolvedInvoiceDate;

  const invoice = await TenantInvoice.create({
    business: businessId,
    property: idOf(property),
    landlord: resolvedLandlordId,
    tenant: idOf(tenant),
    unit: idOf(unit),
    invoiceNumber: `INV-${nextUniqueSuffix()}`,
    category,
    amount,
    description: overrides.description || `Test ${category} invoice`,
    invoiceDate: resolvedInvoiceDate,
    dueDate: resolvedDueDate,
    status,
    createdBy: resolvedCreatedBy,
    chartAccount: resolvedChartAccount,
    ...overrides,
  });

  return invoice;
};

export const createTestLatePenaltyRule = async ({ company, postingAccount, ...overrides } = {}) => {
  if (!company) {
    throw new Error("createTestLatePenaltyRule requires company.");
  }
  const businessId = idOf(company);

  let resolvedPostingAccount = postingAccount ? idOf(postingAccount) : null;
  if (!resolvedPostingAccount) {
    const accounts = await createTestChartOfAccounts(businessId);
    const incomeAccount = accounts.find((a) => a.type === "income");
    resolvedPostingAccount = incomeAccount?._id;
  }

  return LatePenaltyRule.create({
    business: businessId,
    ruleName: `Test Rule ${nextUniqueSuffix()}`,
    effectiveFrom: new Date(2020, 0, 1),
    active: true,
    postingAccount: resolvedPostingAccount,
    graceDays: 0,
    minimumOverdueDays: 0,
    penalizeItem: "outstanding_invoice_balance",
    calculationType: "percentage_overdue_balance",
    rateOrAmount: 10,
    ...overrides,
  });
};

export default {
  createTestTenantInvoice,
  createTestLatePenaltyRule,
};

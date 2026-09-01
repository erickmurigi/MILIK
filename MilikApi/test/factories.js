// Test data factories for the core PMS entity graph.
// Every factory creates the minimum valid document per the real Mongoose
// schema (required fields / enums / refs) — verified against the model
// files directly, not guessed. Each factory returns the created Mongoose
// document (not .lean()) so callers can read ._id, re-save, etc.
//
// Chaining: pass a parent doc/id to reuse it, or omit it and the factory
// creates its own minimal parent for you, e.g.:
//   const { unit } = await createTestUnit({}); // creates its own property + company
//   const { unit } = await createTestUnit({ property }); // reuses an existing property
//
// Every factory returns an object bundling every ancestor it created/resolved
// (e.g. createTestLease returns { lease, tenant, unit, property, company, landlord })
// so a test can reach any level without a second factory call.
//
// Usage in a test file (Vitest globals are on — no need to import describe/it):
//
//   import { createTestLease } from "../test/factories.js";
//
//   it("does the thing", async () => {
//     const { lease, tenant, unit, property, company } = await createTestLease({});
//     ...
//   });

import Company from "../models/Company.js";
import CompanySettings from "../models/CompanySettings.js";
import Landlord from "../models/Landlord.js";
import Property from "../models/Property.js";
import Unit from "../models/Unit.js";
import Tenant from "../models/Tenant.js";
import Lease from "../models/Lease.js";
import User from "../models/User.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import { ensureSystemChartOfAccounts } from "../services/chartOfAccountsService.js";

let uniqueCounter = 0;
// Monotonic + random so parallel factory calls in the same millisecond never collide
// on the compound-unique indexes (business+propertyCode, business+unitNumber, etc).
const nextUniqueSuffix = () => `${Date.now().toString(36)}${(++uniqueCounter).toString(36)}${Math.floor(Math.random() * 1000)}`;

const idOf = (docOrId) => (docOrId && docOrId._id ? docOrId._id : docOrId);

export const createTestCompany = async (overrides = {}) => {
  const { modules, ...rest } = overrides;
  return Company.create({
    companyName: `Test Company ${nextUniqueSuffix()}`,
    postalAddress: "P.O. Box 100, Nairobi",
    baseCurrency: "KES",
    taxRegime: "VAT",
    fiscalStartMonth: "January",
    fiscalStartYear: new Date().getFullYear(),
    operationPeriodType: "Monthly",
    isActive: true,
    accountActive: true,
    ...rest,
    // propertyManagement defaults to false on Company — most PMS test paths
    // (chart of accounts scoping, invoice posting) need it on unless a test
    // explicitly overrides `modules`.
    modules: { propertyManagement: true, accounts: true, ...modules },
  });
};

// Self-heals the chart of accounts via the real production code path (the same
// function invoice/receipt posting calls) rather than hand-rolling GL accounts.
// Returns the resulting ChartOfAccount docs for convenience.
export const createTestChartOfAccounts = async (businessId) => {
  await ensureSystemChartOfAccounts(businessId, { force: true });
  return ChartOfAccount.find({ business: businessId }).lean();
};

export const createTestCompanySettings = async ({ company, ...overrides } = {}) => {
  const resolvedCompany = company || (await createTestCompany());
  const settings = await CompanySettings.create({
    company: idOf(resolvedCompany),
    ...overrides,
  });
  return { settings, company: resolvedCompany };
};

export const createTestLandlord = async ({ company, ...overrides } = {}) => {
  const resolvedCompany = company || (await createTestCompany());
  const landlord = await Landlord.create({
    landlordCode: `LL-${nextUniqueSuffix()}`,
    landlordType: "Individual",
    landlordName: `Test Landlord ${nextUniqueSuffix()}`,
    company: idOf(resolvedCompany),
    ...overrides,
  });
  return { landlord, company: resolvedCompany };
};

export const createTestProperty = async ({ company, landlord, ...overrides } = {}) => {
  const resolvedCompany = company || (await createTestCompany());

  // A property needs at least one linked landlord (marked primary) before any
  // invoice/receipt can post against it — resolvePropertyAccountingContext
  // throws "Property has no linked landlord" otherwise.
  const resolvedLandlord = landlord || (await createTestLandlord({ company: resolvedCompany })).landlord;

  const property = await Property.create({
    propertyCode: `PROP-${nextUniqueSuffix()}`,
    propertyName: `Test Property ${nextUniqueSuffix()}`,
    propertyType: "Residential",
    business: idOf(resolvedCompany),
    landlords: [
      { landlordId: idOf(resolvedLandlord), name: resolvedLandlord.landlordName || "Test Landlord", isPrimary: true },
    ],
    ...overrides,
  });

  return { property, company: resolvedCompany, landlord: resolvedLandlord };
};

export const createTestUnit = async ({ property, company, ...overrides } = {}) => {
  const parent = property ? { property, company, landlord: undefined } : await createTestProperty({ company });
  const resolvedProperty = parent.property;

  const unit = await Unit.create({
    unitNumber: `UNIT-${nextUniqueSuffix()}`,
    property: idOf(resolvedProperty),
    unitType: "1bed",
    rent: 15000,
    deposit: 15000,
    business: resolvedProperty.business || idOf(company),
    ...overrides,
  });

  return { unit, property: resolvedProperty, company: parent.company, landlord: parent.landlord };
};

export const createTestTenant = async ({ unit, property, company, ...overrides } = {}) => {
  const parent = unit ? { unit, property, company, landlord: undefined } : await createTestUnit({ property, company });
  const resolvedUnit = parent.unit;

  const tenant = await Tenant.create({
    name: `Test Tenant ${nextUniqueSuffix()}`,
    unit: idOf(resolvedUnit),
    rent: resolvedUnit.rent ?? 15000,
    moveInDate: new Date(),
    business: resolvedUnit.business || idOf(company),
    ...overrides,
  });

  return {
    tenant,
    unit: resolvedUnit,
    property: parent.property,
    company: parent.company,
    landlord: parent.landlord,
  };
};

export const createTestLease = async ({ tenant, unit, property, company, ...overrides } = {}) => {
  const parent = tenant
    ? { tenant, unit, property, company, landlord: undefined }
    : await createTestTenant({ unit, property, company });
  const resolvedTenant = parent.tenant;
  const resolvedUnit = parent.unit || unit;

  const startDate = overrides.startDate || new Date(new Date().getFullYear(), 0, 1);
  const isAtWill = overrides.leaseType === "at_will";
  const endDate = isAtWill ? null : overrides.endDate || new Date(startDate.getFullYear() + 1, startDate.getMonth(), startDate.getDate());

  const lease = await Lease.create({
    agreementNumber: `AGR-${nextUniqueSuffix()}`,
    tenant: idOf(resolvedTenant),
    unit: idOf(resolvedUnit),
    business: resolvedUnit.business || idOf(company),
    startDate,
    endDate,
    rentAmount: resolvedTenant.rent ?? 15000,
    depositAmount: 15000,
    paymentDueDay: 5,
    status: "active",
    autoInvoice: true,
    ...overrides,
  });

  return {
    lease,
    tenant: resolvedTenant,
    unit: resolvedUnit,
    property: parent.property,
    company: parent.company,
    landlord: parent.landlord,
  };
};

// Builds a plain object matching the shape of req.user used throughout this codebase —
// either the raw decoded JWT payload (verifyToken.js: req.user = decoded) or the
// hand-built systemReq used by background jobs (see autoRentInvoicingService.js).
// Persists a real User document too (so any User.findById(req.user._id) lookup
// inside a controller succeeds) and returns a plain object for req.user, NOT the
// Mongoose doc — controllers never receive a Mongoose doc as req.user in production.
export const createTestUser = async ({ company, isSystemAdmin = false, adminAccess = true, ...overrides } = {}) => {
  const resolvedCompany = company || (await createTestCompany());
  const businessId = idOf(resolvedCompany);

  const userDoc = await User.create({
    surname: "Test",
    otherNames: "User",
    idNumber: `ID-${nextUniqueSuffix()}`,
    phoneNumber: "+254700000000",
    email: `test.user.${nextUniqueSuffix()}@milik.test`,
    profile: "Administrator",
    password: "Test-Password-123",
    company: businessId,
    adminAccess,
    superAdminAccess: false,
    setupAccess: false,
    ...overrides,
  });

  return {
    _id: String(userDoc._id),
    id: String(userDoc._id),
    company: String(businessId),
    isSystemAdmin,
    adminAccess: userDoc.adminAccess,
    superAdminAccess: userDoc.superAdminAccess,
    setupAccess: userDoc.setupAccess,
  };
};

export default {
  createTestCompany,
  createTestChartOfAccounts,
  createTestCompanySettings,
  createTestLandlord,
  createTestProperty,
  createTestUnit,
  createTestTenant,
  createTestLease,
  createTestUser,
};

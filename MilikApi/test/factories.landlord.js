// Composed test-data factories for the Properties/Units/Landlords/Statement-Allocations
// domain. Built on top of test/factories.js (never duplicating its logic) — this file
// adds the pieces base factories.js doesn't cover: tenant invoices, receipts (with FIFO
// allocations against an invoice), and processed landlord statements.
//
// Usage:
//   import { createTestInvoice, createTestReceipt, createTestProcessedStatement } from "../test/factories.landlord.js";
//
//   const { invoice, tenant, unit, property, company, landlord } = await createTestInvoice({});
//   const { receipt } = await createTestReceipt({ invoiceBundle: { invoice, tenant, unit, property, company, landlord } });

import mongoose from "mongoose";
import TenantInvoice from "../models/TenantInvoice.js";
import RentPayment from "../models/RentPayment.js";
import ProcessedStatement from "../models/ProcessedStatement.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import {
  createTestLease,
  createTestChartOfAccounts,
  createTestUser,
} from "./factories.js";

let uniqueCounter = 0;
const nextUniqueSuffix = () => `${Date.now().toString(36)}${(++uniqueCounter).toString(36)}${Math.floor(Math.random() * 1000)}`;

const idOf = (docOrId) => (docOrId && docOrId._id ? docOrId._id : docOrId);

// Resolves the system Rent Income account (4100), creating the chart of accounts first
// if it hasn't been set up for this business yet.
const resolveRentIncomeAccount = async (businessId) => {
  let acct = await ChartOfAccount.findOne({ business: businessId, code: "4100" }).lean();
  if (!acct) {
    await createTestChartOfAccounts(businessId);
    acct = await ChartOfAccount.findOne({ business: businessId, code: "4100" }).lean();
  }
  if (!acct) {
    throw new Error("Rent Income account (4100) could not be resolved for test business.");
  }
  return acct;
};

// Creates a TenantInvoice. Pass `leaseBundle` (the object returned by createTestLease) to
// reuse an existing tenant/unit/property/landlord/company chain, otherwise a full chain is
// created for you.
export const createTestInvoice = async ({
  leaseBundle,
  createdBy,
  invoiceDate,
  dueDate,
  amount,
  status,
  category,
  invoiceNumber,
  outstanding,
  ...rest
} = {}) => {
  const bundle = leaseBundle || (await createTestLease({}));
  const { tenant, unit, property, company, landlord } = bundle;
  const businessId = idOf(company);

  const chartAccount = await resolveRentIncomeAccount(businessId);
  const resolvedCreatedBy = createdBy || (await createTestUser({ company })).id;

  const resolvedInvoiceDate = invoiceDate || new Date();
  const resolvedDueDate =
    dueDate || new Date(resolvedInvoiceDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const resolvedAmount = amount ?? Number(unit.rent || 15000);

  const invoice = await TenantInvoice.create({
    business: businessId,
    property: idOf(property),
    landlord: idOf(landlord),
    tenant: idOf(tenant),
    unit: idOf(unit),
    invoiceNumber: invoiceNumber || `INV-${nextUniqueSuffix()}`,
    category: category || "RENT_CHARGE",
    amount: resolvedAmount,
    invoiceDate: resolvedInvoiceDate,
    dueDate: resolvedDueDate,
    status: status || "pending",
    createdBy: resolvedCreatedBy,
    chartAccount: chartAccount._id,
    outstanding: outstanding ?? resolvedAmount,
    ...rest,
  });

  return { invoice, tenant, unit, property, company, landlord };
};

// Creates a confirmed RentPayment (receipt). If `invoiceBundle` (the object returned by
// createTestInvoice) is supplied and `allocate` isn't false, the receipt is allocated
// against that invoice (mirroring what production FIFO allocation would produce) and the
// invoice's outstanding/status are updated to match — giving tests a realistic, already
// -allocated payment to exercise reallocation / balance logic against.
export const createTestReceipt = async ({
  invoiceBundle,
  amount,
  paymentDate,
  referenceNumber,
  receiptNumber,
  paymentMethod,
  paymentType,
  allocate = true,
  isConfirmed = true,
  ...rest
} = {}) => {
  const bundle = invoiceBundle || (await createTestInvoice({}));
  const { invoice, tenant, unit, property, company, landlord } = bundle;
  const businessId = idOf(company);

  const payAmount = amount ?? Number(invoice.amount);
  const pDate = paymentDate || new Date();
  const ref = referenceNumber || `RCT-${nextUniqueSuffix()}`;

  const allocations = allocate
    ? [
        {
          invoice: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          category: invoice.category,
          priorityGroup: "",
          appliedAmount: payAmount,
          beforeOutstanding: Number(invoice.outstanding ?? invoice.amount),
          afterOutstanding: Math.max(0, Number(invoice.outstanding ?? invoice.amount) - payAmount),
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate,
          description: invoice.description || "",
        },
      ]
    : [];

  const allocationSummary = allocate
    ? { rent: payAmount, deposit: 0, utility: 0, latePenalty: 0, debitNote: 0, other: 0, unapplied: 0 }
    : { rent: 0, deposit: 0, utility: 0, latePenalty: 0, debitNote: 0, other: 0, unapplied: payAmount };

  const receipt = await RentPayment.create({
    tenant: idOf(tenant),
    unit: idOf(unit),
    amount: payAmount,
    paymentType: paymentType || "rent",
    paymentDate: pDate,
    referenceNumber: ref,
    receiptNumber: receiptNumber || ref,
    paymentMethod: paymentMethod || "bank_transfer",
    month: pDate.getMonth() + 1,
    year: pDate.getFullYear(),
    isConfirmed,
    business: businessId,
    allocations,
    allocationSummary,
    ...rest,
  });

  if (allocate) {
    invoice.outstanding = Math.max(0, Number(invoice.outstanding ?? invoice.amount) - payAmount);
    invoice.status = invoice.outstanding <= 0 ? "paid" : "partially_paid";
    await invoice.save();
  }

  return { receipt, invoice, tenant, unit, property, company, landlord };
};

// Creates a ProcessedStatement directly (bypassing the full approve → close workflow,
// which requires a live LandlordStatement snapshot). Good enough for tests that only need
// a valid, already-processed statement to record a payment/recovery against.
export const createTestProcessedStatement = async ({
  property,
  landlord,
  company,
  closedBy,
  periodStart,
  periodEnd,
  netAmountDue,
  ...rest
} = {}) => {
  const businessId = idOf(company);
  const resolvedClosedBy = closedBy || (await createTestUser({ company })).id;
  const resolvedPeriodStart = periodStart || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const resolvedPeriodEnd = periodEnd || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
  const resolvedNetAmountDue = netAmountDue ?? 10000;

  const statement = await ProcessedStatement.create({
    business: businessId,
    landlord: idOf(landlord),
    property: idOf(property),
    periodStart: resolvedPeriodStart,
    periodEnd: resolvedPeriodEnd,
    cutoffAt: resolvedPeriodEnd,
    statementType: "final",
    netAmountDue: resolvedNetAmountDue,
    netAfterExpenses: resolvedNetAmountDue,
    amountPaid: 0,
    balanceDue: resolvedNetAmountDue,
    closedBy: resolvedClosedBy,
    closedAt: new Date(),
    ...rest,
  });

  return { statement };
};

export default {
  createTestInvoice,
  createTestReceipt,
  createTestProcessedStatement,
};

/* eslint-disable no-undef */
// Track C item 3: this file is mid-decomposition into redux/apiCalls/*.js
// domain files, re-exported via the barrel at the bottom.

// Domain files already split out of this God-file (Track C item 3). Barrel
// re-export so none of the 80+ importers of "redux/apiCalls" need to change —
// they all use the extensionless module path with named imports.
export * from "./apiCalls/auth";
export * from "./apiCalls/users";
export * from "./apiCalls/companies";
export * from "./apiCalls/printers";
export * from "./apiCalls/serviceRequests";
export * from "./apiCalls/landlords";
export * from "./apiCalls/utilities";
export * from "./apiCalls/units";
export * from "./apiCalls/tenants";
export * from "./apiCalls/leases";
export * from "./apiCalls/expenseProperties";
export * from "./apiCalls/maintenance";
export * from "./apiCalls/notifications";
export * from "./apiCalls/meterReadings";
export * from "./apiCalls/latePenalties";
export * from "./apiCalls/rentPayments";
export * from "./apiCalls/tenantInvoices";
export * from "./apiCalls/chartOfAccounts";
export * from "./apiCalls/landlordPayments";
export * from "./apiCalls/expenseRequisitions";
export * from "./apiCalls/creditors";
export * from "./apiCalls/landlordStandingOrders";
export * from "./apiCalls/landlordAdvancements";
export * from "./apiCalls/statements";
export * from "./apiCalls/dashboard";
export * from "./apiCalls/journalEntries";
export * from "./apiCalls/financialReports";
export * from "./apiCalls/propertyLedger";
export * from "./apiCalls/bankReconciliation";
export * from "./apiCalls/budgets";
export * from "./apiCalls/fixedAssets";
export * from "./apiCalls/accountingPeriods";
export * from "./apiCalls/glIntegrity";
export * from "./apiCalls/rentalReports";
export * from "./apiCalls/taxRemittance";
export * from "./apiCalls/communications";
export * from "./apiCalls/mpesa";

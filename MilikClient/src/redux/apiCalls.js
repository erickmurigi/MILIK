// Track C item 3: this file used to be a 3,389-line, 281-action-creator
// God-file mixing every domain in the app. It's now a pure barrel — all
// logic lives in redux/apiCalls/*.js, split by domain (auth, tenants,
// landlord payments, financial reports, etc.) plus a shared.js for the
// handful of helpers (the `store` singleton, cache-freshness checks,
// resolveCompanyId, buildQuery, ...) used across more than one domain.
//
// This re-export keeps every one of the 80+ files that import from
// "redux/apiCalls" working unchanged — they all use the extensionless
// module path with named imports, never a deep path into a specific
// domain file, so nothing else needed to move.
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

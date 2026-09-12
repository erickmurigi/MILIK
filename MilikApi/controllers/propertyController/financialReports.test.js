// Financial Reports integration tests. This is the highest-stakes assertion in
// the whole accounting engine: after posting a few different transaction types
// (an invoice, a receipt against it, a paid expense) the Trial Balance and
// Balance Sheet reports must both net to zero across the business's chart of
// accounts. Ledger rows are posted directly via the real postEntry primitive
// (services/ledgerPostingService.js) to simulate an invoice/receipt/expense
// cycle without depending on other domains' invoice/receipt controllers.
import { describe, it, expect } from "vitest";
import { getTrialBalanceReport, getBalanceSheetReport } from "./financialReports.js";
import { postEntry } from "../../services/ledgerPostingService.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts } from "../../test/factories.js";
import { getAccountByCode } from "../../test/factories.financial.js";

const buildStatementPeriod = (date = new Date()) => ({
  start: new Date(date.getFullYear(), date.getMonth(), 1),
  end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999),
});

describe("financialReports controller", () => {
  it("Trial Balance nets to zero after an invoice is raised and fully receipted", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);

    const receivable = await getAccountByCode(company._id, "1200"); // Tenant Receivables (asset)
    const rentIncome = await getAccountByCode(company._id, "4100"); // Rent Income (income)
    const cash = await getAccountByCode(company._id, "1100"); // Cash on Hand (asset)

    const now = new Date();
    const { start, end } = buildStatementPeriod(now);

    // Simulated invoice: Dr Tenant Receivables / Cr Rent Income (15,000)
    await postEntry({
      business: company._id, allowUnscoped: true,
      accountId: receivable._id, direction: "debit", amount: 15000,
      sourceTransactionType: "invoice", sourceTransactionId: "trial-balance-invoice-1",
      transactionDate: now, statementPeriodStart: start, statementPeriodEnd: end,
      category: "RENT_INVOICE",
    });
    await postEntry({
      business: company._id, allowUnscoped: true,
      accountId: rentIncome._id, direction: "credit", amount: 15000,
      sourceTransactionType: "invoice", sourceTransactionId: "trial-balance-invoice-1",
      transactionDate: now, statementPeriodStart: start, statementPeriodEnd: end,
      category: "RENT_INVOICE",
    });

    // Simulated receipt fully settling it: Dr Cash / Cr Tenant Receivables (15,000)
    await postEntry({
      business: company._id, allowUnscoped: true,
      accountId: cash._id, direction: "debit", amount: 15000,
      sourceTransactionType: "rent_payment", sourceTransactionId: "trial-balance-receipt-1",
      transactionDate: now, statementPeriodStart: start, statementPeriodEnd: end,
      category: "RENT_RECEIPT_MANAGER",
    });
    await postEntry({
      business: company._id, allowUnscoped: true,
      accountId: receivable._id, direction: "credit", amount: 15000,
      sourceTransactionType: "rent_payment", sourceTransactionId: "trial-balance-receipt-1",
      transactionDate: now, statementPeriodStart: start, statementPeriodEnd: end,
      category: "RENT_RECEIPT_MANAGER",
    });

    const result = await callController(getTrialBalanceReport, {
      query: { business: String(company._id), asOfDate: now.toISOString() },
      // resolveBusinessId (utils/requestContext.js) now requires the caller to actually
      // be entitled to the requested company — a bare query.business with no
      // authenticated user is correctly rejected as of the cross-tenant BOLA fix, so the
      // test must simulate a real logged-in user scoped to this company.
      user: { company: company._id },
    });

    expect(result.statusCode).toBe(200);
    expect(result.payload.totals.debit).toBe(result.payload.totals.credit);
    expect(result.payload.totals.difference).toBe(0);
    expect(result.payload.totals.balanced).toBe(true);

    // Tenant Receivables was fully settled (debited 15000, credited 15000) so its
    // net balance is zero and it is excluded from the (non-zero-only) row list;
    // Cash on Hand and Rent Income should both still show their movement.
    const cashRow = result.payload.rows.find((r) => r.code === "1100");
    const incomeRow = result.payload.rows.find((r) => r.code === "4100");
    expect(cashRow.netBalance).toBe(15000);
    expect(incomeRow.netBalance).toBe(15000);
    const receivableRow = result.payload.rows.find((r) => r.code === "1200");
    expect(receivableRow).toBeUndefined();
  });

  it("Balance Sheet balances (assets == liabilities + equity) after income and a paid expense", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);

    const cash = await getAccountByCode(company._id, "1100"); // Cash on Hand (asset)
    const rentIncome = await getAccountByCode(company._id, "4100"); // Rent Income (income)
    const maintenanceExpense = await getAccountByCode(company._id, "5100"); // Maintenance Expense

    const now = new Date();
    const { start, end } = buildStatementPeriod(now);

    // Cash rent collected directly (Dr Cash / Cr Rent Income) — 20,000
    await postEntry({
      business: company._id, allowUnscoped: true,
      accountId: cash._id, direction: "debit", amount: 20000,
      sourceTransactionType: "rent_payment", sourceTransactionId: "balance-sheet-income-1",
      transactionDate: now, statementPeriodStart: start, statementPeriodEnd: end,
      category: "RENT_RECEIPT_MANAGER",
    });
    await postEntry({
      business: company._id, allowUnscoped: true,
      accountId: rentIncome._id, direction: "credit", amount: 20000,
      sourceTransactionType: "rent_payment", sourceTransactionId: "balance-sheet-income-1",
      transactionDate: now, statementPeriodStart: start, statementPeriodEnd: end,
      category: "RENT_RECEIPT_MANAGER",
    });

    // Paid maintenance expense directly from cash (Dr Expense / Cr Cash) — 7,000
    await postEntry({
      business: company._id, allowUnscoped: true,
      accountId: maintenanceExpense._id, direction: "debit", amount: 7000,
      sourceTransactionType: "expense", sourceTransactionId: "balance-sheet-expense-1",
      transactionDate: now, statementPeriodStart: start, statementPeriodEnd: end,
      category: "EXPENSE_DEDUCTION",
    });
    await postEntry({
      business: company._id, allowUnscoped: true,
      accountId: cash._id, direction: "credit", amount: 7000,
      sourceTransactionType: "expense", sourceTransactionId: "balance-sheet-expense-1",
      transactionDate: now, statementPeriodStart: start, statementPeriodEnd: end,
      category: "EXPENSE_DEDUCTION",
    });

    const result = await callController(getBalanceSheetReport, {
      query: { business: String(company._id), asOfDate: now.toISOString() },
      // See the matching comment on the Trial Balance test above.
      user: { company: company._id },
    });

    expect(result.statusCode).toBe(200);
    expect(result.payload.summary.totalAssets).toBe(13000); // 20000 cash in - 7000 cash out
    expect(result.payload.equity.currentPeriodEarnings).toBe(13000); // 20000 income - 7000 expense
    expect(result.payload.summary.totalEquity).toBe(13000); // 20000 income - 7000 expense
    expect(result.payload.summary.totalLiabilitiesAndEquity).toBe(13000);
    expect(result.payload.summary.difference).toBe(0);
    expect(result.payload.summary.balanced).toBe(true);
  });
});

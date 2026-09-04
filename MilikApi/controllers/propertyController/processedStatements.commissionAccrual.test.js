// Regression test for the "debitLeg is not defined" 500 reported live in production
// when closing/processing a landlord statement whose commission had VAT/tax applied.
//
// Root cause: postCommissionAccrualForProcessedStatement() declared `debitLeg` with
// `const` inside the `if (!skipCommission) { ... }` block, then referenced it again
// inside a later, separate sibling `if (commissionTaxAmount > 0 ...)` block for the
// VAT leg's metadata.offsetOfEntryId — a block that block-scoped `const` doesn't reach.
// This only threw when a landlord's commission actually carried tax, which is why it
// wasn't a constant/universal failure.
import mongoose from "mongoose";
import { describe, it, expect } from "vitest";
import {
  createTestCompany,
  createTestLandlord,
  createTestProperty,
  createTestUser,
} from "../../test/factories.js";
import { createTestProcessedStatement } from "../../test/factories.landlord.js";
import { postCommissionAccrualForProcessedStatement } from "./processedStatements.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";

describe("postCommissionAccrualForProcessedStatement", () => {
  it("posts the commission + VAT legs without throwing when the commission has tax applied", async () => {
    const company = await createTestCompany();
    const { landlord } = await createTestLandlord({ company });
    const { property } = await createTestProperty({ company, landlord });
    const user = await createTestUser({ company });

    const { statement } = await createTestProcessedStatement({
      company,
      landlord,
      property,
      netAmountDue: 10000,
      commissionAmount: 1000,
      commissionTaxAmount: 160,
      commissionGrossAmount: 1160,
      commissionTaxMode: "exclusive",
      commissionTaxRate: 16,
      commissionTaxCodeKey: "vat_standard",
    });

    const approvedStatement = { _id: new mongoose.Types.ObjectId(), statementNumber: "STMT-TEST-001" };

    // This is the exact call that 500'd in production before the fix.
    const entries = await postCommissionAccrualForProcessedStatement({
      processedStatement: statement,
      approvedStatement,
      userId: user.id,
    });

    expect(Array.isArray(entries)).toBe(true);
    // debit + credit commission legs, VAT credit leg, plus the landlord-payable debit/credit pair.
    expect(entries.length).toBeGreaterThanOrEqual(3);

    const taxLegs = await FinancialLedgerEntry.find({
      business: String(company._id),
      sourceTransactionType: "processed_statement",
      sourceTransactionId: String(statement._id),
      "metadata.postingRole": "commission_output_vat",
    }).lean();

    expect(taxLegs.length).toBe(1);
    expect(taxLegs[0].credit).toBe(160);
    // The bug, if reintroduced, throws before this metadata is ever written — asserting
    // its presence proves the sibling-block reference to debitLeg resolved correctly.
    expect(taxLegs[0].metadata?.offsetOfEntryId).toBeTruthy();
  }, 30000);
});

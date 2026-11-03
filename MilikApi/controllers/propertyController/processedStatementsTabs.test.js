// Regression test for a real reported UI bug: the Processed Statements page has four tabs
// (Outstanding, Recoveries, Paid, Processed) that are supposed to be mutually exclusive buckets,
// but a negative (recovery) statement — whether still owed or already fully recovered — showed up
// under BOTH "Recoveries" and "Processed". Root cause: ProcessedStatement's own pre("save") hook
// unconditionally sets status: "processed" for every negative statement (models/ProcessedStatement.js)
// and recordRecoveryFromLandlord never changes .status either — so a negative statement can only
// ever be "processed" or "reversed", exactly the same status a genuinely net-zero, nothing-ever-owed
// statement gets. The Outstanding and Paid tabs already correctly exclude negative statements from
// their own query; the Processed tab's query was the one missing that same exclusion.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import {
  createTestCompany,
  createTestLandlord,
  createTestProperty,
  createTestUser,
} from "../../test/factories.js";
import { createTestProcessedStatement } from "../../test/factories.landlord.js";
import { getStatementsByBusiness } from "./processedStatements.js";

describe("getStatementsByBusiness — tab filtering", () => {
  it("never shows a negative (recovery) statement under the Processed tab, whether still owed or already recovered", async () => {
    const company = await createTestCompany();
    const { landlord } = await createTestLandlord({ company });
    const { property } = await createTestProperty({ company, landlord });
    const user = await createTestUser({ company });

    // A negative statement still owed by the landlord.
    const { statement: owedStatement } = await createTestProcessedStatement({
      company,
      landlord,
      property,
      netAmountDue: -1000,
      isNegativeStatement: true,
      amountPayableByLandlordToManager: 1000,
    });

    // A negative statement already fully recovered.
    const { statement: recoveredStatement } = await createTestProcessedStatement({
      company,
      landlord,
      property,
      netAmountDue: -2000,
      isNegativeStatement: true,
      amountPayableByLandlordToManager: 2000,
      amountRecovered: 2000,
    });

    // A genuinely net-zero statement — nothing was ever owed, in either direction. This is the one
    // case the Processed tab is actually meant to show.
    const { statement: zeroStatement } = await createTestProcessedStatement({
      company,
      landlord,
      property,
      netAmountDue: 0,
    });

    const callTab = (tab) =>
      callController(getStatementsByBusiness, {
        params: { businessId: String(company._id) },
        query: { tab },
        user,
      });

    const processed = await callTab("processed");
    const processedIds = (processed.payload.statements || []).map((s) => String(s._id));
    expect(processedIds).toContain(String(zeroStatement._id));
    expect(processedIds).not.toContain(String(owedStatement._id));
    expect(processedIds).not.toContain(String(recoveredStatement._id));

    const recoveries = await callTab("recoveries");
    const recoveryIds = (recoveries.payload.statements || []).map((s) => String(s._id));
    expect(recoveryIds).toContain(String(owedStatement._id));
    expect(recoveryIds).toContain(String(recoveredStatement._id));
    expect(recoveryIds).not.toContain(String(zeroStatement._id));
  });
});

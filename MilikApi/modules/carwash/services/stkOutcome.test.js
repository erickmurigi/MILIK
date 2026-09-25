import { describe, it, expect } from "vitest";
import { describeStkOutcome } from "./stkOutcome.js";

describe("describeStkOutcome", () => {
  it("says the credentials are wrong for result 4999, naming the paybill", () => {
    const out = describeStkOutcome({ status: "error", shortCode: "4168143", resultCode: 4999, resultDesc: "Wrong credentials" });
    expect(out.state).toBe("failed");
    expect(out.message).toMatch(/paybill 4168143/);
    expect(out.message).toMatch(/passkey/);
  });
  it("explains the customer-side failures, waits while pending and confirms payment", () => {
    expect(describeStkOutcome({ status: "error", resultCode: 1032 }).message).toMatch(/cancelled/);
    expect(describeStkOutcome({ status: "error", resultCode: 1037 }).message).toMatch(/did not respond/);
    expect(describeStkOutcome({ status: "error", resultCode: 2001 }).message).toMatch(/PIN/);
    expect(describeStkOutcome({ status: "stk_pending" }).state).toBe("pending");
    expect(describeStkOutcome({ status: "matched", resultCode: 0 }).state).toBe("paid");
    expect(describeStkOutcome(null).state).toBe("unknown");
  });
});

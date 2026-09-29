// A Milik admin's token names their own company; the client company they are working in arrives with the request. This
// module used to always trust req.user.company first, so an admin could never record or list expenses for a client
// company here — and, separately, a plain user could never be tricked into another company's expenses by that field.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestUser } from "../../test/factories.js";
import ExpenseProperty from "../../models/ExpenseProperty.js";
import { createExpense, getExpenses } from "./expenseProperty.js";

const expenseBody = (business) => ({
  business, category: "maintenance", amount: 1500, description: "Gutter repair", date: new Date().toISOString(),
});

describe("expense property business scoping", () => {
  it("lets a system admin record and list expenses in the company they are working in", async () => {
    const adminHome = await createTestCompany();
    const client = await createTestCompany();
    const admin = await createTestUser({ company: adminHome, isSystemAdmin: true });

    const created = await callController(createExpense, { user: admin, body: expenseBody(String(client._id)) });
    expect(created.statusCode).toBe(201);
    expect(String(created.payload.business)).toBe(String(client._id));
    expect(await ExpenseProperty.countDocuments({ business: client._id })).toBe(1);

    const listed = await callController(getExpenses, { user: admin, query: { business: String(client._id) } });
    expect(listed.statusCode).toBe(200);
    expect(listed.payload).toHaveLength(1);
  });

  it("never lets a plain user record an expense in a company that is not their own", async () => {
    const own = await createTestCompany();
    const other = await createTestCompany();
    const user = await createTestUser({ company: own });

    const created = await callController(createExpense, { user, body: expenseBody(String(other._id)) });
    expect(created.statusCode).toBe(201);
    expect(String(created.payload.business)).toBe(String(own._id)); // the requested "other" company was ignored
    expect(await ExpenseProperty.countDocuments({ business: other._id })).toBe(0);
  });
});

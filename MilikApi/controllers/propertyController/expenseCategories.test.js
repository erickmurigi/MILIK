// Expense Categories: the admin-configurable list that replaced the old 5-value fixed enum on
// expense items, and the category validation on expense items themselves.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestUser } from "../../test/factories.js";
import {
  addExpenseCategory, updateExpenseCategory, deleteExpenseCategory, getExpenseCategories,
  addExpenseItem, updateExpenseItem,
} from "./companySettings.js";

const setup = async () => {
  const company = await createTestCompany();
  const user = await createTestUser({ company });
  const businessId = String(company._id);
  const call = (fn, opts = {}) => callController(fn, { user, ...opts, params: { businessId, ...(opts.params || {}) } });
  return { company, user, businessId, call };
};

describe("expense categories CRUD", () => {
  it("adds, lists, renames and archives a category", async () => {
    const { call } = await setup();
    const added = await call(addExpenseCategory, { body: { name: "Marketing", description: "Ads and promo" } });
    expect(added.statusCode).toBe(201);
    expect(added.payload.expenseCategory).toMatchObject({ name: "Marketing", isActive: true });

    const listed = await call(getExpenseCategories);
    expect(listed.payload.expenseCategories).toHaveLength(1);

    const updated = await call(updateExpenseCategory, { params: { itemId: added.payload.expenseCategory._id }, body: { name: "Marketing & Promo" } });
    expect(updated.statusCode).toBe(200);
    expect(updated.payload.expenseCategory.name).toBe("Marketing & Promo");

    const archived = await call(deleteExpenseCategory, { params: { itemId: added.payload.expenseCategory._id } });
    expect(archived.statusCode).toBe(200);
    const afterArchive = await call(getExpenseCategories);
    expect(afterArchive.payload.expenseCategories[0].isActive).toBe(false);
  });

  it("rejects a duplicate category name", async () => {
    const { call } = await setup();
    await call(addExpenseCategory, { body: { name: "Legal" } });
    await expect(call(addExpenseCategory, { body: { name: "Legal" } })).rejects.toThrow(/already exists/i);
  });
});

describe("expense item category now validates against the configurable list", () => {
  it("rejects a category id that doesn't belong to this company", async () => {
    const { call } = await setup();
    const otherCompany = await createTestCompany();
    const otherUser = await createTestUser({ company: otherCompany });
    const foreignCategory = await callController(addExpenseCategory, {
      user: otherUser, params: { businessId: String(otherCompany._id) }, body: { name: "Foreign" },
    });

    await expect(
      call(addExpenseItem, { body: { name: "Survey fee", category: foreignCategory.payload.expenseCategory._id } })
    ).rejects.toThrow(/expense category not found/i);
  });

  it("accepts a real category id, and leaving it out means uncategorized (no default 'other' anymore)", async () => {
    const { call } = await setup();
    const category = await call(addExpenseCategory, { body: { name: "Repairs" } });

    const withCategory = await call(addExpenseItem, { body: { name: "Roof repair", category: category.payload.expenseCategory._id } });
    expect(String(withCategory.payload.expenseItem.category)).toBe(String(category.payload.expenseCategory._id));

    const withoutCategory = await call(addExpenseItem, { body: { name: "Misc cost" } });
    expect(withoutCategory.payload.expenseItem.category).toBeNull();
  });

  it("updateExpenseItem can clear a category back to uncategorized", async () => {
    const { call } = await setup();
    const category = await call(addExpenseCategory, { body: { name: "Utilities" } });
    const item = await call(addExpenseItem, { body: { name: "Water bill", category: category.payload.expenseCategory._id } });

    const cleared = await call(updateExpenseItem, { params: { expenseId: item.payload.expenseItem._id }, body: { category: "" } });
    expect(cleared.payload.expenseItem.category).toBeNull();
  });
});

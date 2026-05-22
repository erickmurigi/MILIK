// Canonical account classifiers — single source of truth for both dashboard and financial reports.
// Import these instead of re-defining them per controller.

export const isManagerIncomeAccount = (account = {}) => {
  const code = String(account.code || "").trim();
  const name = String(account.name || "").trim().toLowerCase();
  const subGroup = String(account.subGroup || "").trim().toLowerCase();

  if (["4200", "4210", "4103"].includes(code)) return true;
  if (name.includes("management fee") || name.includes("commission income")) return true;
  if (name.includes("late fee") || name.includes("penalty")) return true;
  if (name.includes("lease agreement fee") || name.includes("letting fee") || name.includes("agreement fee")) return true;
  if (subGroup === "other income" && !name.includes("property income")) return true;

  if (["4100", "4101", "4102", "4300"].includes(code)) return false;
  if (name.includes("rent income")) return false;
  if (name.includes("service charge income")) return false;
  if (name.includes("utility recharge income")) return false;
  if (name.includes("other property income")) return false;

  return false;
};

export const isManagerExpenseAccount = (account = {}) => {
  const code = String(account.code || "").trim();
  const name = String(account.name || "").trim().toLowerCase();
  const subGroup = String(account.subGroup || "").trim().toLowerCase();

  if (["5200", "5201", "5202"].includes(code)) return true;
  if (subGroup === "administrative expenses" || subGroup === "finance costs") return true;
  if (name.includes("management expense") || name.includes("bank charges")) return true;
  if (name.includes("legal") || name.includes("compliance")) return true;
  if (
    name.includes("salary") ||
    name.includes("wage") ||
    name.includes("office") ||
    name.includes("internet") ||
    name.includes("software") ||
    name.includes("subscription") ||
    name.includes("marketing") ||
    name.includes("transport") ||
    name.includes("fuel")
  ) return true;
  if (name.includes("staff welfare") || name.includes("welfare")) return true;
  if (name.includes("miscellaneous")) return true;
  if (name.includes("stationery") || name.includes("stationary")) return true;
  if (name.includes("cleaning supplies")) return true;
  if (name.includes("petty cash")) return true;
  if (name.includes("postage") || name.includes("courier")) return true;
  if (name.includes("staff training") || name.includes("training")) return true;
  if (name.includes("tea") || name.includes("refreshment") || name.includes("catering")) return true;

  if (["5100", "5101", "5102", "5103", "5104"].includes(code)) return false;
  if (subGroup === "property expenses") return false;
  if (name.includes("maintenance expense")) return false;
  if (name.includes("repairs expense")) return false;
  if (name.includes("cleaning expense")) return false;
  if (name.includes("security expense")) return false;
  if (name.includes("utility expense")) return false;

  return false;
};

// Single source of truth for "should this user see/use this module" — company-level
// enablement AND the user's own moduleAccess level, mirroring exactly what the module's
// real route Guard enforces (see App.jsx). Before this file existed, four separate UI
// surfaces (ModulesDashboard, StartMenu, ModuleTabManager, DashboardLayout's workspace
// fallback) each reimplemented this check independently, company-level only — any user
// with "Not allowed" set for a module still saw it listed/opened everywhere except the
// route itself. Route to this function instead of hand-rolling the check again.
import { hasCompanyModule, hasAnyCompanyModule, GL_ACCESS_MODULES } from "./companyModules";
import { checkUserModuleAccess } from "./permissions";

// Modules whose real route is gated by a resource permission, not a moduleAccess level
// (e.g. /clients/dashboard uses <Guard resource="clients"> with no moduleKey at all) —
// there's no equivalent per-user moduleAccess check to apply for these here, so company
// -level enablement is treated as sufficient, same as the route itself.
const RESOURCE_GATED_MODULE_KEYS = new Set(["clients"]);

export const isModuleVisibleToUser = (user, company, moduleKey) => {
  if (!company || !moduleKey) return false;
  // Accounts is reachable company-wide whenever any GL-producing module is enabled, not
  // only when "accounts" itself is — same rule StartMenu already used; ModulesDashboard's
  // own copy used a plainer (and inconsistent) hasCompanyModule(company, "accounts") check.
  const companyEnabled = moduleKey === "accounts"
    ? hasAnyCompanyModule(company, GL_ACCESS_MODULES)
    : hasCompanyModule(company, moduleKey);
  if (!companyEnabled) return false;
  if (RESOURCE_GATED_MODULE_KEYS.has(moduleKey)) return true;
  return checkUserModuleAccess(user, company, moduleKey);
};

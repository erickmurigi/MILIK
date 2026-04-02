import { getUserModuleAccessLevel, hasModuleAccess } from "./companyModules.js";

const ACTION_ALIASES = {
  read: "view",
  list: "view",
  get: "view",
  open: "view",
  create: "create",
  add: "create",
  new: "create",
  import: "create",
  edit: "update",
  update: "update",
  modify: "update",
  status: "update",
  lock: "update",
  unlock: "update",
  remove: "delete",
  delete: "delete",
  void: "delete",
  confirm: "process",
  unconfirm: "reverse",
  process: "process",
  post: "process",
  bill: "process",
  preview: "view",
  approve: "approve",
  send: "send",
  revise: "update",
  validate: "view",
  reverse: "reverse",
  cancelreversal: "reverse",
  pay: "process",
  receipt: "process",
  export: "export",
  pdf: "export",
  print: "export",
  report: "view",
  reclassify: "update",
};

const normalizeKey = (value = "") => String(value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

export const normalizeAction = (action = "view") => ACTION_ALIASES[normalizeKey(action)] || normalizeKey(action) || "view";

export const getCompanyAssignment = (user = {}, companyId) => {
  const target = String(companyId || user?.company?._id || user?.company || "");
  if (!target) return null;
  const assignments = Array.isArray(user?.companyAssignments) ? user.companyAssignments : [];
  return assignments.find((item) => String(item?.company?._id || item?.company || "") === target) || null;
};

export const getAccessibleCompanyIds = (user = {}) => {
  const ids = new Set();
  const push = (value) => {
    const resolved = value?._id || value;
    if (resolved) ids.add(String(resolved));
  };
  push(user?.company);
  push(user?.primaryCompany);
  for (const item of Array.isArray(user?.accessibleCompanies) ? user.accessibleCompanies : []) push(item);
  for (const item of Array.isArray(user?.companyAssignments) ? user.companyAssignments : []) push(item?.company);
  return [...ids];
};

export const getScopedModuleAccess = (user = {}, moduleKey, companyId = null) => {
  const assignment = getCompanyAssignment(user, companyId);
  const registryMap = {
    propertyManagement: "propertyMgmt",
    accounts: "accounts",
    inventory: "inventory",
    procurement: "procurement",
    hr: "humanResource",
    facilityManagement: "facilityManagement",
    hotelManagement: "hotelManagement",
    propertySale: "propertySale",
    telcoDealership: "telcoDealership",
    dms: "dms",
    academics: "academics",
    projectManagement: "projectManagement",
    assetValuation: "assetValuation",
    pos: "inventory",
  };
  const key = registryMap[moduleKey] || moduleKey;
  const scoped = assignment?.moduleAccess?.[key];
  if (typeof scoped === "string" && scoped.trim()) return scoped;
  return getUserModuleAccessLevel(user, moduleKey);
};

const getPermissionValue = (permissions = {}, resource, action) => {
  if (!permissions || typeof permissions !== "object") return undefined;
  const variants = [
    `${resource}.${action}`,
    `${resource}:${action}`,
    `${resource}_${action}`,
    `${action}_${resource}`,
    `${action}:${resource}`,
    `${action}.${resource}`,
    `${resource}${action}`,
  ];
  for (const key of variants) {
    if (Object.prototype.hasOwnProperty.call(permissions, key)) return permissions[key];
  }
  if (
    permissions?.[resource] &&
    typeof permissions[resource] === "object" &&
    Object.prototype.hasOwnProperty.call(permissions[resource], action)
  ) {
    return permissions[resource][action];
  }
  return undefined;
};

export const getScopedPermissions = (user = {}, companyId = null) => {
  const assignment = getCompanyAssignment(user, companyId);
  if (assignment?.permissions && typeof assignment.permissions === "object") return assignment.permissions;
  return user?.permissions && typeof user.permissions === "object" ? user.permissions : {};
};

export const hasCompanyActionPermission = ({ user = {}, company = {}, moduleKey = null, resource = "", action = "view" }) => {
  const normalizedAction = normalizeAction(action);
  const resourceKey = String(resource || "").trim();
  const companyId = String(company?._id || company || user?.company?._id || user?.company || "");

  if (user?.isSystemAdmin || user?.superAdminAccess) return true;
  if (!companyId) return false;
  if (!getAccessibleCompanyIds(user).includes(companyId)) return false;

  if (
    moduleKey &&
    !hasModuleAccess(user, company || { _id: companyId, modules: user?.company?.modules || {} }, moduleKey, {
      requireWrite: normalizedAction !== "view" && normalizedAction !== "export",
    })
  ) {
    return false;
  }

  const permissions = getScopedPermissions(user, companyId);
  const explicit = getPermissionValue(permissions, resourceKey, normalizedAction);
  if (typeof explicit === "boolean") return explicit;

  if (user?.adminAccess) return true;

  const scopedLevel = moduleKey ? String(getScopedModuleAccess(user, moduleKey, companyId) || "") : "";
  const lower = scopedLevel.toLowerCase();
  if (normalizedAction === "view" || normalizedAction === "export") {
    return lower === "view only" || lower === "full access" || !moduleKey;
  }
  if (["create", "update", "delete", "process", "approve", "reverse", "send"].includes(normalizedAction)) {
    return lower === "full access";
  }

  return Boolean(lower === "full access");
};

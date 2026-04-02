export const normalizeAction = (action = "view") => {
  const text = String(action || "view").toLowerCase();
  const aliases = {
    read: "view",
    list: "view",
    add: "create",
    edit: "update",
    remove: "delete",
    confirm: "process",
    reverse: "reverse",
    post: "process",
    pdf: "export",
    print: "export",
  };
  return aliases[text] || text;
};

const resolveCompanyId = (company) => String(company?._id || company || "");

const getAssignment = (user = {}, currentCompany = null) => {
  const companyId = resolveCompanyId(currentCompany || user?.company);
  if (!companyId) return null;
  return (Array.isArray(user?.companyAssignments) ? user.companyAssignments : []).find(
    (item) => resolveCompanyId(item?.company) === companyId
  ) || null;
};

const getPermissionValue = (permissions = {}, resource, action) => {
  if (!permissions || typeof permissions !== "object") return undefined;
  const keys = [
    `${resource}.${action}`,
    `${resource}:${action}`,
    `${resource}_${action}`,
    `${action}_${resource}`,
    `${action}:${resource}`,
  ];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(permissions, key)) return permissions[key];
  }
  if (permissions?.[resource] && typeof permissions[resource] === "object") {
    return permissions[resource][action];
  }
  return undefined;
};

export const hasCompanyPermission = (user = {}, currentCompany = null, resource = "", action = "view", moduleKey = null) => {
  if (user?.isSystemAdmin || user?.superAdminAccess) return true;

  const normalizedAction = normalizeAction(action);
  const assignment = getAssignment(user, currentCompany);
  const permissions = assignment?.permissions || user?.permissions || {};
  const explicit = getPermissionValue(permissions, resource, normalizedAction);
  if (typeof explicit === "boolean") return explicit;

  if (user?.adminAccess) return true;

  const moduleAccess = assignment?.moduleAccess || user?.moduleAccess || {};
  const map = {
    propertyManagement: "propertyMgmt",
    accounts: "accounts",
    hr: "humanResource",
    inventory: "inventory",
    procurement: "procurement",
    propertySale: "propertySale",
    facilityManagement: "facilityManagement",
    hotelManagement: "hotelManagement",
    telcoDealership: "telcoDealership",
    dms: "dms",
    academics: "academics",
    projectManagement: "projectManagement",
    assetValuation: "assetValuation",
  };
  const accessText = String(moduleAccess?.[map[moduleKey] || moduleKey] || "").toLowerCase();

  if (!moduleKey) {
    return normalizedAction === "view" || normalizedAction === "export" ? true : false;
  }
  if (normalizedAction === "view" || normalizedAction === "export") {
    return accessText === "view only" || accessText === "full access";
  }
  return accessText === "full access";
};

export const guardButtonProps = (allowed, titleWhenDenied = "You do not have permission for this action") =>
  allowed
    ? {}
    : {
        disabled: true,
        title: titleWhenDenied,
        classNameSuffix: " opacity-50 cursor-not-allowed",
      };

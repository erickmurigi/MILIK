import { LEGACY_PERMISSION_ALIASES } from './accessMatrix';

// Kept in lockstep with MilikApi/utils/permissionControl.js's ACTION_ALIASES —
// both sides must normalize the same raw action word to the same canonical
// action, or a permission granted on one side can silently fail on the other.
const ACTION_ALIASES = {
  read: 'view',
  list: 'view',
  get: 'view',
  open: 'view',
  create: 'create',
  add: 'create',
  new: 'create',
  import: 'create',
  edit: 'update',
  update: 'update',
  modify: 'update',
  status: 'update',
  lock: 'lock',
  unlock: 'lock',
  remove: 'delete',
  delete: 'delete',
  void: 'delete',
  confirm: 'process',
  unconfirm: 'reverse',
  process: 'process',
  post: 'process',
  bill: 'process',
  preview: 'view',
  approve: 'approve',
  send: 'send',
  revise: 'update',
  validate: 'view',
  reverse: 'reverse',
  cancelreversal: 'reverse',
  pay: 'process',
  receipt: 'process',
  export: 'export',
  pdf: 'export',
  print: 'export',
  report: 'view',
  reclassify: 'update',
};

export const normalizeAction = (action = 'view') => {
  const text = String(action || 'view').toLowerCase();
  return ACTION_ALIASES[text] || text;
};

const resolveCompanyId = (company) => String(company?._id || company || '');

const getAssignment = (user = {}, currentCompany = null) => {
  const companyId = resolveCompanyId(currentCompany || user?.company);
  if (!companyId) return null;
  return (Array.isArray(user?.companyAssignments) ? user.companyAssignments : []).find(
    (item) => resolveCompanyId(item?.company) === companyId
  ) || null;
};

const getPermissionValue = (permissions = {}, resource, action) => {
  if (!permissions || typeof permissions !== 'object') return undefined;
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
  if (permissions?.[resource] && typeof permissions[resource] === 'object') {
    return permissions[resource][action];
  }
  const legacyKeys = LEGACY_PERMISSION_ALIASES?.[resource]?.[action] || [];
  for (const key of legacyKeys) {
    if (Object.prototype.hasOwnProperty.call(permissions, key)) return permissions[key];
  }
  return undefined;
};

const MODULE_ACCESS_MAP = {
  propertyManagement: 'propertyMgmt',
  accounts: 'accounts',
  hr: 'humanResource',
  inventory: 'inventory',
  procurement: 'procurement',
  propertySale: 'propertySale',
  facilityManagement: 'facilityManagement',
  hotelManagement: 'hotelManagement',
  telcoDealership: 'telcoDealership',
  dms: 'dms',
  academics: 'academics',
  projectManagement: 'projectManagement',
  assetValuation: 'assetValuation',
  pos: 'inventory',
  carwash: 'carwash',
};

const checkModuleAccess = (moduleAccess = {}, moduleKey, normalizedAction) => {
  const accessText = String(moduleAccess?.[MODULE_ACCESS_MAP[moduleKey] || moduleKey] || '').toLowerCase();
  if (normalizedAction === 'view' || normalizedAction === 'export') {
    return accessText === 'view only' || accessText === 'full access';
  }
  return accessText === 'full access';
};

export const hasCompanyPermission = (
  user = {},
  currentCompany = null,
  resource = '',
  action = 'view',
  moduleKey = null
) => {
  if (user?.isSystemAdmin || user?.superAdminAccess) return true;

  const normalizedAction = normalizeAction(action);

  if (resource === 'companySettings') {
    if (user?.adminAccess) return true;
    if (normalizedAction === 'view') {
      return Boolean(user?.setupAccess || user?.companySetupAccess);
    }
    return Boolean(user?.companySetupAccess || user?.setupAccess);
  }

  const assignment = getAssignment(user, currentCompany);
  const permissions = assignment?.permissions || user?.permissions || {};
  const explicit = getPermissionValue(permissions, resource, normalizedAction);
  if (explicit === true) return true;

  if (user?.adminAccess) return true;

  const moduleAccess = assignment?.moduleAccess || user?.moduleAccess || {};

  // Full access at module level overrides any explicit false from unset granular permissions
  if (moduleKey && !Array.isArray(moduleKey)) {
    const accessText = String(moduleAccess?.[MODULE_ACCESS_MAP[moduleKey] || moduleKey] || '').toLowerCase();
    if (accessText === 'full access') return true;
  }

  if (explicit === false) return false;

  // Accept moduleKey as string or string[].
  // String[]: user must have access through at least one of the listed modules (OR semantics).
  if (!moduleKey) {
    return normalizedAction === 'view' || normalizedAction === 'export';
  }

  if (Array.isArray(moduleKey)) {
    return moduleKey.some((key) => checkModuleAccess(moduleAccess, key, normalizedAction));
  }

  return checkModuleAccess(moduleAccess, moduleKey, normalizedAction);
};

// Checks ONLY whether the user has module-level access (View Only or Full Access).
// Used by routes that have no granular resource but still need to honor moduleAccess = 'none'.
export const checkUserModuleAccess = (user, company, moduleKey) => {
  if (!moduleKey) return true;
  if (user?.isSystemAdmin || user?.superAdminAccess || user?.adminAccess) return true;
  const assignment = getAssignment(user, company);
  const moduleAccess = assignment?.moduleAccess || user?.moduleAccess || {};
  const key = MODULE_ACCESS_MAP[moduleKey] || moduleKey;
  const accessText = String(moduleAccess?.[key] || '').toLowerCase();
  return accessText === 'view only' || accessText === 'full access';
};

export const guardButtonProps = (
  allowed,
  titleWhenDenied = 'You do not have permission for this action'
) =>
  allowed
    ? {}
    : {
        disabled: true,
        title: titleWhenDenied,
        classNameSuffix: ' opacity-50 cursor-not-allowed',
      };

// Shared with AddUsers.jsx and anywhere else that needs to build a company-module permission
// assignment for a given user profile (e.g. the Advocate "invite from record" flow) — moved out of
// AddUsers.jsx so both places apply the exact same role shape instead of two copies drifting apart.
import { getEnabledCompanyModuleKeys } from "./companyModules";
import { buildEmptyPermissionMap } from "./accessMatrix";
import { applyModuleRole } from "./moduleRolePresets";

export const PROFILE_MODULE_ROLES = {
  'Administrator':  { propertyManagement: 'admin',           accounts: 'admin',         propertySale: 'admin',        hr: 'admin',      inventory: 'admin',           carwash: 'admin'   },
  'Manager':        { propertyManagement: 'propertyManager', accounts: 'financeManager', propertySale: 'salesManager', hr: 'hrManager',  inventory: 'inventoryManager', carwash: 'manager' },
  'Accountant':     { propertyManagement: 'agent',           accounts: 'accountant',    propertySale: null,           hr: null,         inventory: null,              carwash: null      },
  'Property Agent': { propertyManagement: 'agent',           accounts: 'clerk',         propertySale: null,           hr: null,         inventory: null,              carwash: null      },
  'Field Officer':  { propertyManagement: 'fieldOfficer',    accounts: null,            propertySale: null,           hr: null,         inventory: null,              carwash: null      },
  'Sales Agent':    { propertyManagement: null,              accounts: null,            propertySale: 'salesAgent',   hr: null,         inventory: null,              carwash: null      },
  'Advocate':       { propertyManagement: null,              accounts: null,            propertySale: 'advocate',     hr: null,         inventory: null,              carwash: null      },
  'HR Officer':     { propertyManagement: null,              accounts: null,            propertySale: null,           hr: 'hrOfficer',  inventory: null,              carwash: null      },
  'Viewer':         {},
  // Legacy backward-compat
  'Agent':          { propertyManagement: 'agent',           accounts: 'clerk',         propertySale: null,           hr: null,         inventory: null,              carwash: null      },
};

export const MODULE_KEY_MAP = {
  propertyManagement: 'propertyMgmt',
  accounts:           'accounts',
  inventory:          'inventory',
  procurement:        'procurement',
  hr:                 'humanResource',
  propertySale:       'propertySale',
  facilityManagement: 'facilityManagement',
  hotelManagement:    'hotelManagement',
  telcoDealership:    'telcoDealership',
  dms:                'dms',
  academics:          'academics',
  projectManagement:  'projectManagement',
  assetValuation:     'assetValuation',
  revenueRecognition: 'revenueRecognition',
  crm:                'crm',
  incidentManagement: 'incidentManagement',
  sacco:              'sacco',
  billing:            'billing',
  pos:                'inventory',
};

export const makeDefaultAssignment = (company) => {
  const moduleAccess = {};
  getEnabledCompanyModuleKeys(company).forEach((key) => {
    const accessKey = MODULE_KEY_MAP[key] || key;
    moduleAccess[accessKey] = 'View only';
  });
  return {
    company: company?._id,
    moduleAccess,
    permissions: buildEmptyPermissionMap(),
    rights: [],
    carwashBranch: null,
  };
};

// Property Sales' granular permission grants (moduleRolePresets.js / accessMatrix.js) now use
// kebab-case resource keys matching exactly what the API routes check (e.g. "sale-deals"), so an
// explicit grant like the Advocate role's does take effect on its own — hasCompanyActionPermission
// returns true immediately on an explicit match, regardless of moduleAccess level (see
// utils/permissions.js). 'View only' is kept here anyway, deliberately, as defense-in-depth specific
// to the Advocate role: it's meant for an external third party, so anything NOT in its short explicit
// grant list (create/update/delete/approve/pay on the rest of the module) should stay blocked even if
// that grant list is ever extended carelessly — 'Full access' would remove that backstop entirely.
// Other profiles (Sales Agent etc.) don't get this treatment because their explicit grants are already
// the complete, intended scope of what they need; there's no "rest of the module" they should be
// defended against the way an external advocate's account should be.
export const VIEW_ONLY_PROPERTY_SALE_ROLES = new Set(['advocate']);

export const applyProfileToAssignment = (profile, assignment, company) => {
  const roleMap = PROFILE_MODULE_ROLES[profile] || {};
  const enabledModuleKeys = getEnabledCompanyModuleKeys(company);
  let newPermissions = buildEmptyPermissionMap();
  const newModuleAccess = {};
  for (const moduleKey of enabledModuleKeys) {
    const accessKey = MODULE_KEY_MAP[moduleKey] || moduleKey;
    const roleKey = roleMap[moduleKey];
    if (roleKey) {
      const forceViewOnly = moduleKey === 'propertySale' && VIEW_ONLY_PROPERTY_SALE_ROLES.has(roleKey);
      newModuleAccess[accessKey] = forceViewOnly ? 'View only' : 'Full access';
      newPermissions = applyModuleRole(newPermissions, moduleKey, roleKey);
    } else {
      newModuleAccess[accessKey] = 'View only';
    }
  }
  return { ...assignment, permissions: newPermissions, moduleAccess: newModuleAccess };
};

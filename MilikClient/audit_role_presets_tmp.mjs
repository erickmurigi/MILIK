import { ACCESS_SECTIONS } from './src/utils/accessMatrix.js';
import { MODULE_ROLE_PRESETS } from './src/utils/moduleRolePresets.js';

// Full catalogue, keyed by moduleKey -> Set('resource.action')
const catalogueByModule = {};
for (const section of ACCESS_SECTIONS) {
  for (const p of section.permissions) {
    const mk = p.moduleKey || '__none__';
    if (!catalogueByModule[mk]) catalogueByModule[mk] = new Set();
    catalogueByModule[mk].add(`${p.resource}.${p.action}`);
  }
}

let totalIssues = 0;

for (const [moduleKey, preset] of Object.entries(MODULE_ROLE_PRESETS)) {
  console.log(`\n=== ${moduleKey} (${preset.label}) ===`);
  const catalogue = catalogueByModule[moduleKey] || new Set();

  // 1. allPermissions entries that don't exist in the catalogue at all (typo/stale)
  const allPermsKeys = preset.allPermissions.map(p => `${p.resource}.${p.action}`);
  const staleAllPerms = allPermsKeys.filter(k => !catalogue.has(k));
  if (staleAllPerms.length) {
    console.log(`  [STALE in allPermissions, not in catalogue]:`, staleAllPerms);
    totalIssues += staleAllPerms.length;
  }

  // 2. catalogue entries NOT covered by allPermissions (role presets are "blind" to these)
  const allPermsSet = new Set(allPermsKeys);
  const blind = [...catalogue].filter(k => !allPermsSet.has(k));
  if (blind.length) {
    console.log(`  [BLIND - in catalogue but NOT in preset.allPermissions, so no role can grant/clear it]:`, blind);
    totalIssues += blind.length;
  }

  // 3. per-role grants that reference something not in allPermissions (inconsistent)
  for (const [roleKey, role] of Object.entries(preset.roles)) {
    const grantKeys = role.grants.map(g => `${g.resource}.${g.action}`);
    const notInAllPerms = grantKeys.filter(k => !allPermsSet.has(k));
    if (notInAllPerms.length) {
      console.log(`  [role "${roleKey}" grants something outside allPermissions]:`, notInAllPerms);
      totalIssues += notInAllPerms.length;
    }
    const notInCatalogue = grantKeys.filter(k => !catalogue.has(k));
    if (notInCatalogue.length) {
      console.log(`  [role "${roleKey}" grants something NOT in the real catalogue at all]:`, notInCatalogue);
      totalIssues += notInCatalogue.length;
    }
  }
}

console.log(`\n\nTOTAL ISSUES FOUND: ${totalIssues}`);

import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Company from '../models/Company.js';
import { verifyUser } from '../controllers/verifyToken.js';
import { normalizeCompanyModules, serializeCompanyForClient } from '../utils/companyModules.js';
import { buildTemporaryPassword, normalizeBoolean } from '../utils/onboardingAccess.js';
import { sendUserOnboardingEmail } from '../utils/onboardingMailer.js';
import { sanitizePermissionMap } from '../utils/accessMatrix.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { escapeRegex } from '../utils/escapeRegex.js';

const router = express.Router();

const COMPANY_SELECT = 'companyName companyCode baseCurrency logo country town email phoneNo slogan companyMode modules fiscalStartMonth fiscalStartYear operationPeriodType isActive accountStatus';
const isSystemAdmin = (user = {}) => Boolean(user?.isSystemAdmin || user?.superAdminAccess);
const SYSTEM_ACCESS_FIELDS = ['superAdminAccess', 'isSystemAdmin', 'isSystemAuditUser'];
const userId = (user = {}) => String(user?._id || user?.id || '');
const hasSystemAccessPayload = (payload = {}) => SYSTEM_ACCESS_FIELDS.some((field) => payload[field] === true);
const hasRequiredUserFields = (body = {}) => ['surname', 'otherNames', 'idNumber', 'email', 'phoneNumber', 'profile'].every((field) => String(body[field] || '').trim());

const userAccessibleCompanyIds = (user = {}) => {
  if (isSystemAdmin(user)) return [];
  return [...new Set([
    user?.company?._id || user?.company,
    user?.primaryCompany?._id || user?.primaryCompany,
    ...(Array.isArray(user?.accessibleCompanies) ? user.accessibleCompanies.map((item) => item?._id || item) : []),
    ...(Array.isArray(user?.companyAssignments) ? user.companyAssignments.map((item) => item?.company?._id || item?.company) : []),
  ].filter(Boolean).map(String))];
};

const canAccessCompany = (user = {}, companyId) => {
  if (!companyId) return false;
  if (isSystemAdmin(user)) return true;
  return userAccessibleCompanyIds(user).includes(String(companyId));
};

const buildCompanyIds = (payload = {}) => {
  const primary = String(payload.primaryCompany || payload.company || '');
  const accessible = Array.isArray(payload.accessibleCompanies) ? payload.accessibleCompanies.map(String) : [];
  const fromAssignments = Array.isArray(payload.companyAssignments) ? payload.companyAssignments.map((a) => String(a?.company || '')).filter(Boolean) : [];
  return [...new Set([primary, ...accessible, ...fromAssignments].filter(Boolean))];
};

const enabledModuleAccessDefaults = (company = {}) => {
  const modules = normalizeCompanyModules(company?.modules || {});
  const keyMap = {
    propertyManagement: 'propertyMgmt',
    propertySale: 'propertySale',
    facilityManagement: 'facilityManagement',
    hotelManagement: 'hotelManagement',
    accounts: 'accounts',
    revenueRecognition: 'revenueRecognition',
    telcoDealership: 'telcoDealership',
    inventory: 'inventory',
    procurement: 'procurement',
    hr: 'humanResource',
    incidentManagement: 'incidentManagement',
    sacco: 'sacco',
    projectManagement: 'projectManagement',
    assetValuation: 'assetValuation',
    crm: 'crm',
    dms: 'dms',
    academics: 'academics',
    pos: 'inventory',
  };

  return Object.entries(modules).reduce((acc, [moduleKey, enabled]) => {
    if (!enabled) return acc;
    const accessKey = keyMap[moduleKey] || moduleKey;
    if (accessKey === 'retailOutlet') return acc;
    acc[accessKey] = 'View only';
    return acc;
  }, {});
};

const sanitizeModuleAccess = (company = {}, rawAccess = {}) => {
  const defaults = enabledModuleAccessDefaults(company);
  const allowedValues = new Set(['Not allowed', 'View only', 'Full access']);
  const next = { ...defaults };

  Object.keys(defaults).forEach((key) => {
    const candidate = rawAccess?.[key];
    if (allowedValues.has(candidate)) {
      next[key] = candidate;
    }
  });

  if (rawAccess?.hidePayDetails !== undefined) {
    next.hidePayDetails = Boolean(rawAccess.hidePayDetails);
  }

  return next;
};

const sanitizeAssignments = (assignments = [], companyDocs = [], fallbackModuleAccess = {}, fallbackPermissions = {}) => {
  const companyMap = new Map(companyDocs.map((company) => [String(company._id), company]));
  const seen = new Set();

  return (Array.isArray(assignments) ? assignments : [])
    .filter((item) => item?.company && companyMap.has(String(item.company)))
    .map((item) => {
      const companyId = String(item.company);
      const company = companyMap.get(companyId);
      const carwashBranch = item?.carwashBranch
        ? (mongoose.Types.ObjectId.isValid(String(item.carwashBranch)) ? String(item.carwashBranch) : null)
        : null;
      return {
        company: companyId,
        moduleAccess: sanitizeModuleAccess(company, item?.moduleAccess && typeof item.moduleAccess === 'object' ? item.moduleAccess : fallbackModuleAccess),
        permissions: sanitizePermissionMap(item?.permissions && typeof item.permissions === 'object' ? item.permissions : fallbackPermissions),
        rights: Array.isArray(item?.rights) ? item.rights.map(String) : [],
        carwashBranch: carwashBranch || null,
      };
    })
    .filter((item) => {
      if (seen.has(item.company)) return false;
      seen.add(item.company);
      return true;
    });
};

const serializeUser = async (userDoc) => {
  const plain = userDoc?.toObject ? userDoc.toObject() : { ...(userDoc || {}) };
  const ids = [...new Set([
    plain.company?._id || plain.company,
    plain.primaryCompany?._id || plain.primaryCompany,
    ...(Array.isArray(plain.accessibleCompanies) ? plain.accessibleCompanies.map((item) => item?._id || item) : []),
    ...(Array.isArray(plain.companyAssignments) ? plain.companyAssignments.map((item) => item?.company?._id || item?.company) : []),
  ].filter(Boolean).map(String))];

  const companies = await Company.find({ _id: { $in: ids } }).select(COMPANY_SELECT).lean();
  const map = new Map(companies.map((item) => [String(item._id), serializeCompanyForClient(item, plain)]));

  plain.company = map.get(String(plain.company?._id || plain.company || '')) || null;
  plain.primaryCompany = map.get(String(plain.primaryCompany?._id || plain.primaryCompany || '')) || plain.company;
  plain.accessibleCompanies = (Array.isArray(plain.accessibleCompanies) ? plain.accessibleCompanies : []).map((item) => map.get(String(item?._id || item || ''))).filter(Boolean);
  plain.companyAssignments = (Array.isArray(plain.companyAssignments) ? plain.companyAssignments : []).map((item) => ({
    ...item,
    company: map.get(String(item?.company?._id || item?.company || '')) || null,
    permissions: sanitizePermissionMap(item?.permissions || {}),
  }));

  delete plain.password;
  delete plain.resetPasswordToken;
  delete plain.resetPasswordExpire;
  return plain;
};

const buildAccessSummary = (user = {}) => {
  const assignments = Array.isArray(user?.companyAssignments) ? user.companyAssignments : [];
  const enabledModules = new Set();
  const grantedPermissions = [];

  assignments.forEach((assignment) => {
    Object.entries(assignment?.moduleAccess || {}).forEach(([key, value]) => {
      if (value === 'View only' || value === 'Full access') enabledModules.add(key);
    });
    const permissions = sanitizePermissionMap(assignment?.permissions || {});
    Object.entries(permissions).forEach(([resource, actions]) => {
      Object.entries(actions || {}).forEach(([action, allowed]) => {
        if (allowed) grantedPermissions.push(`${resource}.${action}`);
      });
    });
  });

  return {
    assignedCompanies: buildCompanyIds(user).length,
    enabledModules: [...enabledModules],
    permissionCount: grantedPermissions.length,
  };
};

const ensureSharedCompanyAccess = async (requestUser, targetUser) => {
  if (isSystemAdmin(requestUser)) return true;
  const authUser = await User.findById(requestUser.id).select('company primaryCompany accessibleCompanies companyAssignments');
  return buildCompanyIds(targetUser.toObject ? targetUser.toObject() : targetUser).some((id) => canAccessCompany(authUser, id));
};

router.get('/', verifyUser, async (req, res) => {
  try {
    const { companyId, search: rawSearch, status = 'all', moduleKey = '' } = req.query;
    const search = escapeRegex(rawSearch);
    const safePage = Math.max(Number(req.query.page) || 1, 1);
    const maxLimit = isSystemAdmin(req.user) ? 1000 : 200;
    const safeLimit = Math.min(Math.max(Number(req.query.limit) || 100, 1), maxLimit);

    let accessibleIds = [];
    if (!isSystemAdmin(req.user)) {
      const authUser = await User.findById(req.user.id).select('company primaryCompany accessibleCompanies companyAssignments');
      accessibleIds = userAccessibleCompanyIds(authUser);
    }

    const requestedCompanyIds = companyId ? [String(companyId)] : accessibleIds;

    if (!isSystemAdmin(req.user) && requestedCompanyIds.some((id) => !accessibleIds.includes(String(id)))) {
      return res.status(403).json({ message: 'You do not have access to this company' });
    }

    const query = requestedCompanyIds.length > 0
      ? {
          isSystemAuditUser: { $ne: true },
          $or: [
            { company: { $in: requestedCompanyIds } },
            { primaryCompany: { $in: requestedCompanyIds } },
            { accessibleCompanies: { $in: requestedCompanyIds } },
          ],
        }
      : { isSystemAuditUser: { $ne: true } };

    const andFilters = [];

    if (search) {
      andFilters.push({
        $or: [
          { surname: { $regex: search, $options: 'i' } },
          { otherNames: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phoneNumber: { $regex: search, $options: 'i' } },
        ],
      });
    }

    const normalizedStatus = String(status || 'all').toLowerCase();
    if (normalizedStatus === 'active') {
      andFilters.push({ locked: { $ne: true }, isActive: { $ne: false } });
    } else if (normalizedStatus === 'locked') {
      andFilters.push({ locked: true });
    } else if (normalizedStatus === 'inactive') {
      andFilters.push({ isActive: false });
    }

    if (moduleKey) {
      andFilters.push({ [`companyAssignments.moduleAccess.${moduleKey}`]: { $in: ['View only', 'Full access'] } });
    }

    if (andFilters.length) query.$and = andFilters;

    const [users, total] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
      User.countDocuments(query),
    ]);

    // Collect all company IDs referenced across all users in one pass — batch to avoid N+1
    const flatIds = users.flatMap((u) => {
      const ids = [u.company?._id || u.company, u.primaryCompany?._id || u.primaryCompany];
      if (Array.isArray(u.accessibleCompanies)) u.accessibleCompanies.forEach((c) => ids.push(c?._id || c));
      if (Array.isArray(u.companyAssignments)) u.companyAssignments.forEach((a) => ids.push(a?.company?._id || a?.company));
      return ids.filter(Boolean).map(String);
    });
    const allCompanyIds = Array.from(new Set(flatIds));

    const companyDocs = allCompanyIds.length
      ? await Company.find({ _id: { $in: allCompanyIds } }).select(COMPANY_SELECT).lean()
      : [];
    const companyById = new Map(companyDocs.map((c) => [String(c._id), c]));

    const serializedUsers = users.map((plain) => {
      const resolveCompany = (ref) => {
        const id = String(ref?._id || ref || '');
        const doc = companyById.get(id);
        return doc ? serializeCompanyForClient(doc, plain) : null;
      };
      const result = { ...plain };
      result.company = resolveCompany(plain.company);
      result.primaryCompany = resolveCompany(plain.primaryCompany) || result.company;
      result.accessibleCompanies = (Array.isArray(plain.accessibleCompanies) ? plain.accessibleCompanies : []).map(resolveCompany).filter(Boolean);
      result.companyAssignments = (Array.isArray(plain.companyAssignments) ? plain.companyAssignments : []).map((a) => ({
        ...a,
        company: resolveCompany(a?.company),
        permissions: sanitizePermissionMap(a?.permissions || {}),
      }));
      delete result.password;
      delete result.resetPasswordToken;
      delete result.resetPasswordExpire;
      return { ...result, accessSummary: buildAccessSummary(result) };
    });

    res.json({ users: serializedUsers, totalPages: Math.ceil(total / safeLimit), currentPage: safePage, total });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id', verifyUser, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.isSystemAuditUser) return res.status(404).json({ message: 'User not found' });

    const shared = await ensureSharedCompanyAccess(req.user, user);
    if (!shared) return res.status(403).json({ message: 'You do not have access to this user' });

    const serialized = await serializeUser(user);
    res.json({ ...serialized, accessSummary: buildAccessSummary(serialized) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', verifyUser, async (req, res) => {
  try {
    const normalizedEmail = String(req.body.email || '').toLowerCase().trim();
    if (!hasRequiredUserFields(req.body)) {
      return res.status(400).json({ message: 'Surname, other names, email, phone number and profile are required' });
    }
    if (!isSystemAdmin(req.user) && hasSystemAccessPayload(req.body)) {
      return res.status(403).json({ message: 'Only Milik Admin can grant system admin access' });
    }
    const companyIds = buildCompanyIds(req.body);
    const primaryCompany = String(req.body.primaryCompany || req.body.company || companyIds[0] || '');

    if (!primaryCompany) {
      return res.status(400).json({ message: 'At least one company is required' });
    }

    let authUser = req.user;
    if (!isSystemAdmin(req.user)) {
      authUser = await User.findById(req.user.id).select('company primaryCompany accessibleCompanies companyAssignments');
      const currentCompanyId = String(authUser?.company || '');
      const onlyOwnCompany = companyIds.every((id) => id === currentCompanyId);
      if (!onlyOwnCompany || primaryCompany !== currentCompanyId) {
        return res.status(403).json({ message: 'Only Milik Admin can assign users to multiple companies' });
      }
    }

    const companies = await Company.find({ _id: { $in: companyIds } }).select('_id companyName modules');
    if (companies.length !== companyIds.length) {
      return res.status(400).json({ message: 'One or more selected companies were not found' });
    }

    const existingUser = await User.findOne({
      email: normalizedEmail,
      $or: [
        { company: { $in: companyIds } },
        { primaryCompany: { $in: companyIds } },
        { accessibleCompanies: { $in: companyIds } },
      ],
    });
    if (existingUser) return res.status(400).json({ message: 'Email already registered in one of the selected companies' });

    const autoGeneratePassword = normalizeBoolean(req.body.autoGeneratePassword, !req.body.password);
    const resolvedPassword = autoGeneratePassword ? buildTemporaryPassword(normalizedEmail) : String(req.body.password || '').trim();

    if (!resolvedPassword) {
      return res.status(400).json({ message: 'Password is required' });
    }

    const mustChangePassword = normalizeBoolean(req.body.mustChangePassword, autoGeneratePassword);
    const shouldSendOnboardingEmail = normalizeBoolean(req.body.sendOnboardingEmail, autoGeneratePassword);
    const companyAssignments = sanitizeAssignments(req.body.companyAssignments, companies, req.body.moduleAccess || {}, req.body.permissions || {});

    const payload = {
      ...req.body,
      email: normalizedEmail,
      password: resolvedPassword,
      company: primaryCompany,
      primaryCompany,
      accessibleCompanies: companyIds,
      companyAssignments,
      mustChangePassword,
      passwordProvisioningMethod: autoGeneratePassword ? 'emailed_temp_password' : 'manual',
      lastPasswordChangeAt: autoGeneratePassword ? null : new Date(),
    };

    const user = new User(payload);
    await user.save();
    await logAuditEvent({
      req,
      company: primaryCompany,
      action: 'users.create',
      category: 'users',
      severity: 'critical',
      targetType: 'User',
      targetId: user._id,
      targetName: `${user.surname || ''} ${user.otherNames || ''}`.trim() || user.email,
      message: `Created user ${`${user.surname || ''} ${user.otherNames || ''}`.trim() || user.email}`,
      metadata: { email: user.email, profile: user.profile, companyCount: companyIds.length },
    });

    let onboardingEmail = { attempted: false, sent: false, skipped: true, error: null };
    if (shouldSendOnboardingEmail) {
      const companyDoc = companies.find((item) => String(item._id) === String(primaryCompany)) || null;
      // Cap at 12s so a slow SMTP server never stalls the user-creation response
      const emailTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Onboarding email timed out')), 12_000)
      );
      try {
        onboardingEmail = await Promise.race([
          sendUserOnboardingEmail({
            user: { email: normalizedEmail, surname: user.surname, otherNames: user.otherNames },
            company: companyDoc,
            temporaryPassword: resolvedPassword,
          }),
          emailTimeout,
        ]);
        if (onboardingEmail?.sent) {
          User.findByIdAndUpdate(user._id, { $set: { onboardingEmailSentAt: new Date() } }).catch(() => {});
          user.onboardingEmailSentAt = new Date();
        }
      } catch (mailError) {
        onboardingEmail = {
          attempted: true,
          sent: false,
          skipped: false,
          error: mailError?.message || 'Failed to send onboarding email',
        };
      }
    }

    const serialized = await serializeUser(user);
    const emailDelivered = onboardingEmail?.sent === true;
    res.status(201).json({
      success: true,
      user: { ...serialized, accessSummary: buildAccessSummary(serialized) },
      onboardingEmail,
      generatedAccess: autoGeneratePassword
        ? {
            email: normalizedEmail,
            ...(emailDelivered ? {} : { temporaryPassword: resolvedPassword }),
          }
        : null,
    });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'Duplicate field value (email might already exist)' });
    if (error.name === 'ValidationError') {
      const firstMessage = Object.values(error.errors)[0]?.message || error.message;
      return res.status(400).json({ message: firstMessage });
    }
    res.status(400).json({ message: error.message });
  }
});

router.put('/:id', verifyUser, async (req, res) => {
  try {
    const existingUser = await User.findById(req.params.id);
    if (!existingUser) return res.status(404).json({ message: 'User not found' });

    const shared = await ensureSharedCompanyAccess(req.user, existingUser);
    if (!shared) return res.status(403).json({ message: 'You do not have access to this user' });

    let authUser = req.user;
    if (!isSystemAdmin(req.user)) {
      authUser = await User.findById(req.user.id).select('company primaryCompany accessibleCompanies companyAssignments');
    }

    // Block edits on system admin accounts by non-system-admins
    if (!isSystemAdmin(req.user) && isSystemAdmin(existingUser)) {
      return res.status(403).json({ message: 'Normal company users cannot edit Milik/System Admin accounts' });
    }

    // Whitelist the fields that are allowed to be updated — never spread req.body directly
    const body = req.body || {};
    const updatePayload = {
      surname:       body.surname,
      otherNames:    body.otherNames,
      idNumber:      body.idNumber,
      gender:        body.gender,
      postalAddress: body.postalAddress,
      phoneNumber:   body.phoneNumber,
      email:         body.email,
      profile:       body.profile,
      // Privilege flags — strictly guarded by caller role
      adminAccess:        isSystemAdmin(req.user)
                            ? normalizeBoolean(body.adminAccess, existingUser.adminAccess)
                            : existingUser.adminAccess,
      setupAccess:        (isSystemAdmin(req.user) || req.user?.adminAccess)
                            ? normalizeBoolean(body.setupAccess, existingUser.setupAccess)
                            : existingUser.setupAccess,
      companySetupAccess: (isSystemAdmin(req.user) || req.user?.adminAccess)
                            ? normalizeBoolean(body.companySetupAccess, existingUser.companySetupAccess)
                            : existingUser.companySetupAccess,
      // superAdminAccess / isSystemAdmin / isSystemAuditUser are never touched here
      // Company assignment fields (resolved below)
      primaryCompany:      body.primaryCompany,
      accessibleCompanies: body.accessibleCompanies,
      companyAssignments:  body.companyAssignments,
      moduleAccess:        body.moduleAccess,
      permissions:         body.permissions,
      rights:              body.rights,
    };

    // Remove undefined keys so Mongoose doesn't unset existing values
    Object.keys(updatePayload).forEach((key) => updatePayload[key] === undefined && delete updatePayload[key]);

    if (!hasRequiredUserFields({ ...existingUser.toObject(), ...updatePayload })) {
      return res.status(400).json({ message: 'Surname, other names, email, phone number and profile are required' });
    }

    let hashedPassword = null;
    if (body.password && body.password !== '') {
      if (String(body.password).length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters' });
      }
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(body.password, salt);
    }
    if (hashedPassword) updatePayload.password = hashedPassword;

    const companyIds = buildCompanyIds({ ...existingUser.toObject(), ...updatePayload });
    const primaryCompany = String(updatePayload.primaryCompany || existingUser.primaryCompany || existingUser.company || companyIds[0] || '');

    if (!isSystemAdmin(req.user)) {
      const currentCompanyId = String(authUser?.company || '');
      const onlyOwnCompany = companyIds.every((id) => id === currentCompanyId);
      if (!onlyOwnCompany || primaryCompany !== currentCompanyId) {
        return res.status(403).json({ message: 'Only Milik Admin can reassign users across companies' });
      }
    }

    const companies = await Company.find({ _id: { $in: companyIds } }).select('_id companyName modules');
    if (companies.length !== companyIds.length) {
      return res.status(400).json({ message: 'One or more selected companies were not found' });
    }

    updatePayload.company = primaryCompany;
    updatePayload.primaryCompany = primaryCompany;
    updatePayload.accessibleCompanies = companyIds;
    updatePayload.companyAssignments = sanitizeAssignments(
      updatePayload.companyAssignments || existingUser.companyAssignments,
      companies,
      updatePayload.moduleAccess || existingUser.moduleAccess || {},
      updatePayload.permissions || existingUser.permissions || {}
    );

    const user = await User.findByIdAndUpdate(req.params.id, { $set: updatePayload }, { new: true, runValidators: true });
    await logAuditEvent({
      req,
      company: primaryCompany,
      action: 'users.update',
      category: 'users',
      severity: 'critical',
      targetType: 'User',
      targetId: user._id,
      targetName: `${user.surname || ''} ${user.otherNames || ''}`.trim() || user.email,
      message: `Updated user ${`${user.surname || ''} ${user.otherNames || ''}`.trim() || user.email}`,
      metadata: {
        email: user.email,
        profile: user.profile,
        passwordChanged: Boolean(req.body?.password),
        companyCount: companyIds.length,
      },
    });
    const serialized = await serializeUser(user);
    res.json({ ...serialized, accessSummary: buildAccessSummary(serialized) });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'Duplicate field value' });
    if (error.name === 'ValidationError') {
      const firstMessage = Object.values(error.errors)[0]?.message || error.message;
      return res.status(400).json({ message: firstMessage });
    }
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id', verifyUser, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.isSystemAuditUser) return res.status(404).json({ message: 'User not found' });
    if (String(user._id) === userId(req.user)) {
      return res.status(400).json({ message: 'You cannot delete your own account.' });
    }
    if (user.superAdminAccess || user.isSystemAdmin) {
      return res.status(403).json({ message: 'System admin users cannot be deleted from here.' });
    }

    const shared = await ensureSharedCompanyAccess(req.user, user);
    if (!shared) return res.status(403).json({ message: 'You do not have access to this user' });

    await User.findByIdAndDelete(req.params.id);
    const name = `${user.surname || ''} ${user.otherNames || ''}`.trim() || user.email;
    await logAuditEvent({
      req,
      company: user.primaryCompany || user.company,
      action: 'users.delete',
      category: 'users',
      severity: 'critical',
      targetType: 'User',
      targetId: user._id,
      targetName: name,
      message: `Deleted user ${name}`,
      metadata: { email: user.email, profile: user.profile },
    });
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.patch('/:id/toggle-lock', verifyUser, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.isSystemAuditUser) return res.status(404).json({ message: 'User not found' });
    if (String(user._id) === userId(req.user)) {
      return res.status(400).json({ message: 'You cannot lock or unlock your own account.' });
    }
    if (user.superAdminAccess || user.isSystemAdmin) {
      return res.status(403).json({ message: 'System admin users cannot be locked from here.' });
    }

    const shared = await ensureSharedCompanyAccess(req.user, user);
    if (!shared) return res.status(403).json({ message: 'You do not have access to this user' });

    user.locked = !user.locked;
    await user.save();
    await logAuditEvent({
      req,
      company: user.primaryCompany || user.company,
      action: user.locked ? 'users.lock' : 'users.unlock',
      category: 'users',
      severity: 'critical',
      targetType: 'User',
      targetId: user._id,
      targetName: `${user.surname || ''} ${user.otherNames || ''}`.trim() || user.email,
      message: `${user.locked ? 'Locked' : 'Unlocked'} user ${`${user.surname || ''} ${user.otherNames || ''}`.trim() || user.email}`,
      metadata: { email: user.email, locked: user.locked },
    });
    res.json({ locked: user.locked });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/:id/reset-password', verifyUser, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.isSystemAuditUser) return res.status(404).json({ message: 'User not found' });
    if (user.superAdminAccess || user.isSystemAdmin) {
      return res.status(403).json({ message: 'System admin passwords cannot be reset from here.' });
    }

    const shared = await ensureSharedCompanyAccess(req.user, user);
    if (!shared) return res.status(403).json({ message: 'You do not have access to this user' });

    const company = await Company.findById(user.primaryCompany || user.company).select(COMPANY_SELECT).lean();
    const tempPassword = buildTemporaryPassword(user.email);
    user.password = tempPassword; // pre-save hook hashes this
    user.mustChangePassword = true;
    user.passwordProvisioningMethod = 'emailed_temp_password';
    user.onboardingEmailSentAt = new Date();
    await user.save();

    // Fire-and-forget — reset-password result is not needed before responding
    sendUserOnboardingEmail({ user, company, temporaryPassword: tempPassword }).catch(() => {});

    await logAuditEvent({
      req,
      company: user.primaryCompany || user.company,
      action: 'users.reset_password',
      category: 'users',
      severity: 'critical',
      targetType: 'User',
      targetId: user._id,
      targetName: `${user.surname || ''} ${user.otherNames || ''}`.trim() || user.email,
      message: `Reset password for user ${`${user.surname || ''} ${user.otherNames || ''}`.trim() || user.email}`,
      metadata: { email: user.email },
    });

    res.json({ message: 'Password reset and sent to ' + user.email });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

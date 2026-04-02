import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Company from '../models/Company.js';
import { verifyUser } from '../controllers/verifyToken.js';
import { serializeCompanyForClient } from '../utils/companyModules.js';
import { buildTemporaryPassword, normalizeBoolean } from '../utils/onboardingAccess.js';
import { sendUserOnboardingEmail } from '../utils/onboardingMailer.js';

const router = express.Router();

const COMPANY_SELECT = 'companyName companyCode baseCurrency logo country town email phoneNo slogan modules fiscalStartMonth fiscalStartYear operationPeriodType isActive accountStatus';
const isSystemAdmin = (user = {}) => Boolean(user?.isSystemAdmin || user?.superAdminAccess);

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

const sanitizeAssignments = (assignments = [], fallbackModuleAccess = {}, fallbackPermissions = {}) => {
  const seen = new Set();
  return (Array.isArray(assignments) ? assignments : [])
    .filter((item) => item?.company)
    .map((item) => ({
      company: String(item.company),
      moduleAccess: item?.moduleAccess && typeof item.moduleAccess === 'object' ? item.moduleAccess : { ...fallbackModuleAccess },
      permissions: item?.permissions && typeof item.permissions === 'object' ? item.permissions : { ...fallbackPermissions },
      rights: Array.isArray(item?.rights) ? item.rights.map(String) : [],
    }))
    .filter((item) => {
      if (seen.has(item.company)) return false;
      seen.add(item.company);
      return true;
    });
};

const buildCompanyIds = (payload = {}) => {
  const primary = String(payload.primaryCompany || payload.company || '');
  const accessible = Array.isArray(payload.accessibleCompanies) ? payload.accessibleCompanies.map(String) : [];
  const fromAssignments = Array.isArray(payload.companyAssignments) ? payload.companyAssignments.map((a) => String(a?.company || '')).filter(Boolean) : [];
  return [...new Set([primary, ...accessible, ...fromAssignments].filter(Boolean))];
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
  }));

  delete plain.password;
  delete plain.resetPasswordToken;
  delete plain.resetPasswordExpire;
  return plain;
};

router.get('/', verifyUser, async (req, res) => {
  try {
    const { companyId, page = 1, limit = 10, search } = req.query;
    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.max(Number(limit) || 10, 1);

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

    if (search) {
      query.$and = [
        {
          $or: [
            { surname: { $regex: search, $options: 'i' } },
            { otherNames: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { phoneNumber: { $regex: search, $options: 'i' } },
          ],
        },
      ];
    }

    const users = await User.find(query)
      .limit(safeLimit)
      .skip((safePage - 1) * safeLimit)
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(query);
    const serializedUsers = await Promise.all(users.map(serializeUser));

    res.json({ users: serializedUsers, totalPages: Math.ceil(total / safeLimit), currentPage: safePage, total });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id', verifyUser, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.isSystemAuditUser) return res.status(404).json({ message: 'User not found' });

    if (!isSystemAdmin(req.user)) {
      const authUser = await User.findById(req.user.id).select('company primaryCompany accessibleCompanies companyAssignments');
      const shared = buildCompanyIds(user.toObject()).some((id) => canAccessCompany(authUser, id));
      if (!shared) return res.status(403).json({ message: 'You do not have access to this user' });
    }

    res.json(await serializeUser(user));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', verifyUser, async (req, res) => {
  try {
    const normalizedEmail = String(req.body.email || '').toLowerCase().trim();
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

    const payload = {
      ...req.body,
      email: normalizedEmail,
      password: resolvedPassword,
      company: primaryCompany,
      primaryCompany,
      accessibleCompanies: companyIds,
      companyAssignments: sanitizeAssignments(req.body.companyAssignments, req.body.moduleAccess || {}, req.body.permissions || {}),
      mustChangePassword,
      passwordProvisioningMethod: autoGeneratePassword ? 'emailed_temp_password' : 'manual',
      lastPasswordChangeAt: autoGeneratePassword ? null : new Date(),
    };

    const user = new User(payload);
    await user.save();

    let onboardingEmail = { attempted: false, sent: false, skipped: true, error: null };
    if (shouldSendOnboardingEmail) {
      try {
        const companyDoc = companies.find((item) => String(item._id) === String(primaryCompany)) || null;
        onboardingEmail = await sendUserOnboardingEmail({
          user: { email: normalizedEmail, surname: user.surname, otherNames: user.otherNames },
          company: companyDoc,
          temporaryPassword: resolvedPassword,
        });
        if (onboardingEmail?.sent) {
          await User.findByIdAndUpdate(user._id, { $set: { onboardingEmailSentAt: new Date() } });
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
    res.status(201).json({
      success: true,
      user: serialized,
      onboardingEmail,
      generatedAccess: autoGeneratePassword
        ? {
            email: normalizedEmail,
            temporaryPassword: resolvedPassword,
          }
        : null,
    });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'Duplicate field value (email might already exist)' });
    res.status(400).json({ message: error.message });
  }
});

router.put('/:id', verifyUser, async (req, res) => {
  try {
    const existingUser = await User.findById(req.params.id);
    if (!existingUser) return res.status(404).json({ message: 'User not found' });

    let authUser = req.user;
    if (!isSystemAdmin(req.user)) {
      authUser = await User.findById(req.user.id).select('company primaryCompany accessibleCompanies companyAssignments');
      const shared = buildCompanyIds(existingUser.toObject()).some((id) => canAccessCompany(authUser, id));
      if (!shared) return res.status(403).json({ message: 'You do not have access to this user' });
    }

    const updatePayload = { ...req.body };
    if (updatePayload.password === '') delete updatePayload.password;
    if (updatePayload.password) {
      const salt = await bcrypt.genSalt(10);
      updatePayload.password = await bcrypt.hash(updatePayload.password, salt);
    }

    const companyIds = buildCompanyIds({ ...existingUser.toObject(), ...updatePayload });
    const primaryCompany = String(updatePayload.primaryCompany || updatePayload.company || existingUser.primaryCompany || existingUser.company || companyIds[0] || '');

    if (!isSystemAdmin(req.user)) {
      const currentCompanyId = String(authUser?.company || '');
      const onlyOwnCompany = companyIds.every((id) => id === currentCompanyId);
      if (!onlyOwnCompany || primaryCompany !== currentCompanyId) {
        return res.status(403).json({ message: 'Only Milik Admin can reassign users across companies' });
      }
    }

    updatePayload.company = primaryCompany;
    updatePayload.primaryCompany = primaryCompany;
    updatePayload.accessibleCompanies = companyIds;
    updatePayload.companyAssignments = sanitizeAssignments(updatePayload.companyAssignments || existingUser.companyAssignments, updatePayload.moduleAccess || existingUser.moduleAccess || {}, updatePayload.permissions || existingUser.permissions || {});

    const user = await User.findByIdAndUpdate(req.params.id, updatePayload, { new: true, runValidators: true });
    res.json(await serializeUser(user));
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'Duplicate field value' });
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id', verifyUser, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.isSystemAuditUser) return res.status(404).json({ message: 'User not found' });

    if (!isSystemAdmin(req.user)) {
      const authUser = await User.findById(req.user.id).select('company primaryCompany accessibleCompanies companyAssignments');
      const shared = buildCompanyIds(user.toObject()).some((id) => canAccessCompany(authUser, id));
      if (!shared) return res.status(403).json({ message: 'You do not have access to this user' });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.patch('/:id/toggle-lock', verifyUser, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.isSystemAuditUser) return res.status(404).json({ message: 'User not found' });

    if (!isSystemAdmin(req.user)) {
      const authUser = await User.findById(req.user.id).select('company primaryCompany accessibleCompanies companyAssignments');
      const shared = buildCompanyIds(user.toObject()).some((id) => canAccessCompany(authUser, id));
      if (!shared) return res.status(403).json({ message: 'You do not have access to this user' });
    }

    user.locked = !user.locked;
    await user.save();
    res.json({ locked: user.locked });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

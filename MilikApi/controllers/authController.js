import User from "../models/User.js";
import Company from "../models/Company.js";
import { createError } from "../utils/error.js";
import { normalizeCompanyModules, serializeCompanyForClient } from "../utils/companyModules.js";
import jwt from "jsonwebtoken";
import { buildTemporaryPassword, normalizeBoolean } from "../utils/onboardingAccess.js";
import { sendUserOnboardingEmail } from "../utils/onboardingMailer.js";
import { attachAuthCookie, clearAuthCookie } from "../utils/authCookie.js";

const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
};

const getAdminCredentials = () => ({
  email: process.env.MILIK_ADMIN_EMAIL?.toLowerCase(),
  password: process.env.MILIK_ADMIN_PASSWORD,
  name: process.env.MILIK_ADMIN_NAME || "Milik Admin",
});

const companySummarySelect =
  "companyName companyCode baseCurrency logo unitTypes country town email phoneNo slogan modules fiscalStartMonth fiscalStartYear operationPeriodType isActive accountStatus isDemoWorkspace isDemoWorkspace";

const DEMO_COMPANY_EMAIL = "demo.workspace@milik.local";
const DEMO_COMPANY_NAME_REGEX = /^milik\s+demo\s+workspace$/i;

const buildLiveCompanyFilter = () => ({
  isDemoWorkspace: { $ne: true },
});

const isLegacyDemoCompany = (company = {}) =>
  DEMO_COMPANY_NAME_REGEX.test(String(company?.companyName || '')) ||
  String(company?.email || '').toLowerCase() === DEMO_COMPANY_EMAIL;

const filterLiveCompanies = (companies = []) =>
  (Array.isArray(companies) ? companies : []).filter((company) => !isLegacyDemoCompany(company));

const shouldIncludeDemoCompanies = (req = {}) =>
  req?.user?.isDemoUser || String(req?.query?.includeDemo || "").toLowerCase() === "true";


const isSystemAdminUser = (user = {}) =>
  Boolean(user?.isSystemAdmin || user?.superAdminAccess);

const buildSystemAdminUserPayload = (activeCompany = null) => {
  const adminCreds = getAdminCredentials();
  return {
    _id: "milik-admin",
    email: adminCreds.email,
    surname: adminCreds.name,
    otherNames: "",
    profile: "Administrator",
    superAdminAccess: true,
    adminAccess: true,
    isSystemAdmin: true,
    company: activeCompany || null,
    isActive: true,
    mustChangePassword: false,
  };
};

const createAuthToken = (user) => {
  const toId = (value) => (value?._id || value ? String(value?._id || value) : null);
  const accessibleCompanies = Array.isArray(user?.accessibleCompanies)
    ? user.accessibleCompanies.map((item) => toId(item)).filter(Boolean)
    : [];
  const companyAssignments = Array.isArray(user?.companyAssignments)
    ? user.companyAssignments
        .filter((item) => item?.company)
        .map((item) => ({
          company: toId(item.company),
          moduleAccess: item?.moduleAccess && typeof item.moduleAccess === "object" ? item.moduleAccess : {},
          permissions: item?.permissions && typeof item.permissions === "object" ? item.permissions : {},
          rights: Array.isArray(item?.rights) ? item.rights : [],
        }))
    : [];

  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      company: toId(user.company),
      primaryCompany: toId(user.primaryCompany) || toId(user.company),
      accessibleCompanies,
      companyAssignments,
      profile: user.profile,
      superAdminAccess: !!user.superAdminAccess,
      adminAccess: !!user.adminAccess,
      setupAccess: !!user.setupAccess,
      companySetupAccess: !!user.companySetupAccess,
      moduleAccess: user?.moduleAccess || {},
      permissions: user?.permissions || {},
      isSystemAdmin: !!user.isSystemAdmin,
      mustChangePassword: !!user.mustChangePassword,
    },
    getJWTSecret(),
    { expiresIn: "7d" }
  );
};

const normalizeCompanyPayload = async (companyId) => {
  if (!companyId) return null;
  const company = await Company.findById(companyId)
    .select(companySummarySelect)
    .lean();
  return company ? serializeCompanyForClient(company) : null;
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

const buildAccessibleCompanyIds = (payload = {}) => {
  const primary = String(payload.primaryCompany || payload.company || '');
  const explicit = Array.isArray(payload.accessibleCompanies) ? payload.accessibleCompanies.map(String) : [];
  const fromAssignments = Array.isArray(payload.companyAssignments)
    ? payload.companyAssignments.map((item) => String(item?.company || '')).filter(Boolean)
    : [];
  return [...new Set([primary, ...explicit, ...fromAssignments].filter(Boolean))];
};

const sanitizeUserForResponse = (userPayload) => {
  const safeUser = userPayload && typeof userPayload === "object"
    ? JSON.parse(JSON.stringify(userPayload))
    : userPayload;

  if (safeUser && typeof safeUser === "object") {
    delete safeUser.password;
    delete safeUser.resetPasswordToken;
    delete safeUser.resetPasswordExpire;
  }

  return safeUser;
};

const companyReferenceSelect = "companyName companyCode country town modules isActive accountStatus isDemoWorkspace logo unitTypes";

const sanitizeCompanyLogoForList = (logo) => {
  if (typeof logo !== "string") return "";
  const trimmed = logo.trim();
  if (!trimmed) return "";
  return trimmed;
};

const serializeCompanyReferenceForClient = (company = {}) => {
  if (!company) return null;

  const modules = normalizeCompanyModules(company.modules || {});

  return {
    _id: company._id,
    companyName: company.companyName || "",
    companyCode: company.companyCode || "",
    country: company.country || "",
    town: company.town || "",
    logo: sanitizeCompanyLogoForList(company.logo),
    unitTypes: Array.isArray(company.unitTypes) ? company.unitTypes : [],
    isActive: Boolean(company.isActive),
    accountStatus: company.accountStatus || "",
    isDemoWorkspace: Boolean(company.isDemoWorkspace),
    modules,
    enabledModules: Object.keys(modules).filter((key) => modules[key]),
  };
};

const attachCompanyCollections = async (userDoc) => {
  const plain = userDoc?.toObject ? userDoc.toObject() : { ...(userDoc || {}) };

  const activeCompanyId = String(plain.company?._id || plain.company || "");
  const primaryCompanyId = String(plain.primaryCompany?._id || plain.primaryCompany || activeCompanyId || "");
  const accessibleCompanyIds = Array.isArray(plain.accessibleCompanies)
    ? plain.accessibleCompanies.map((item) => String(item?._id || item || "")).filter(Boolean)
    : [];
  const assignmentCompanyIds = Array.isArray(plain.companyAssignments)
    ? plain.companyAssignments.map((item) => String(item?.company?._id || item?.company || "")).filter(Boolean)
    : [];

  const companyIds = [...new Set([activeCompanyId, primaryCompanyId, ...accessibleCompanyIds, ...assignmentCompanyIds].filter(Boolean))];

  if (!companyIds.length) {
    plain.company = null;
    plain.primaryCompany = null;
    plain.accessibleCompanies = [];
    plain.companyAssignments = Array.isArray(plain.companyAssignments) ? plain.companyAssignments : [];
    return plain;
  }

  const companies = await Company.find({ _id: { $in: companyIds } })
    .select(companySummarySelect)
    .lean();

  const fullById = new Map(companies.map((item) => [String(item._id), serializeCompanyForClient(item, plain)]));
  const refById = new Map(companies.map((item) => [String(item._id), serializeCompanyReferenceForClient(item)]));

  plain.company = fullById.get(activeCompanyId) || null;
  plain.primaryCompany = fullById.get(primaryCompanyId) || plain.company || null;
  plain.accessibleCompanies = accessibleCompanyIds
    .map((companyId) => refById.get(String(companyId)))
    .filter(Boolean);
  plain.companyAssignments = (Array.isArray(plain.companyAssignments) ? plain.companyAssignments : []).map((assignment) => ({
    ...assignment,
    company: refById.get(String(assignment?.company?._id || assignment?.company || "")) || null,
  }));

  return plain;
};

const userCanAccessCompany = (userDoc, companyId) => {
  if (!companyId) return false;
  if (userDoc?.isSystemAdmin || userDoc?.superAdminAccess) return true;
  const ids = new Set([
    userDoc?.company?._id || userDoc?.company,
    userDoc?.primaryCompany?._id || userDoc?.primaryCompany,
    ...(Array.isArray(userDoc?.accessibleCompanies) ? userDoc.accessibleCompanies.map((item) => item?._id || item) : []),
    ...(Array.isArray(userDoc?.companyAssignments) ? userDoc.companyAssignments.map((item) => item?.company?._id || item?.company) : []),
  ].filter(Boolean).map(String));
  return ids.has(String(companyId));
};

export const registerUser = async (req, res, next) => {
  try {
    const { email, password, surname, otherNames, phoneNumber, company, profile, idNumber } = req.body;

    if (!req.user?.superAdminAccess && !req.user?.adminAccess) {
      return next(createError(403, 'Only admins can create users'));
    }

    const accessibleCompanyIds = buildAccessibleCompanyIds(req.body);
    const primaryCompany = String(req.body.primaryCompany || company || accessibleCompanyIds[0] || '');

    if (!primaryCompany) {
      return next(createError(400, 'At least one company is required'));
    }

    if (!req.user?.superAdminAccess) {
      const currentCompanyId = String(req.user?.company || '');
      const onlyOwnCompany = accessibleCompanyIds.every((item) => String(item) === currentCompanyId);
      if (!onlyOwnCompany || currentCompanyId !== primaryCompany) {
        return next(createError(403, 'Company admins can only create users in their own company'));
      }
    }

    if (!email || !surname || !otherNames || !phoneNumber) {
      return next(createError(400, 'All required fields must be provided'));
    }

    const companyIdsToCheck = [...new Set([primaryCompany, ...accessibleCompanyIds])];
    const existingCompanies = await Company.find({ _id: { $in: companyIdsToCheck } }).select('_id companyName');
    if (existingCompanies.length !== companyIdsToCheck.length) {
      return next(createError(404, 'One or more selected companies were not found'));
    }

    const normalizedEmail = email.toLowerCase();
    const existingUser = await User.findOne({
      email: normalizedEmail,
      $or: [
        { company: { $in: companyIdsToCheck } },
        { primaryCompany: { $in: companyIdsToCheck } },
        { accessibleCompanies: { $in: companyIdsToCheck } },
      ],
    });
    if (existingUser) {
      return next(createError(400, 'Email already registered in one of the selected companies'));
    }

    const companyAssignments = sanitizeAssignments(req.body.companyAssignments, req.body.moduleAccess || {}, req.body.permissions || {});
    const autoGeneratePassword = normalizeBoolean(req.body.autoGeneratePassword, !password);
    const resolvedPassword = autoGeneratePassword ? buildTemporaryPassword(normalizedEmail) : String(password || '').trim();

    if (!resolvedPassword) {
      return next(createError(400, 'Password is required'));
    }

    const mustChangePassword = normalizeBoolean(req.body.mustChangePassword, autoGeneratePassword);
    const shouldSendOnboardingEmail = normalizeBoolean(req.body.sendOnboardingEmail, autoGeneratePassword);

    const newUser = new User({
      ...req.body,
      email: normalizedEmail,
      password: resolvedPassword,
      surname,
      otherNames,
      phoneNumber,
      company: primaryCompany,
      primaryCompany,
      accessibleCompanies: companyIdsToCheck,
      companyAssignments,
      profile: profile || 'Agent',
      idNumber,
      isActive: true,
      locked: false,
      mustChangePassword,
      passwordProvisioningMethod: autoGeneratePassword ? 'emailed_temp_password' : 'manual',
      lastPasswordChangeAt: autoGeneratePassword ? null : new Date(),
    });

    const savedUser = await newUser.save();
    const companyDoc = existingCompanies.find((item) => String(item._id) === String(primaryCompany)) || null;

    let onboardingEmail = { attempted: false, sent: false, skipped: true, error: null };
    if (shouldSendOnboardingEmail) {
      try {
        onboardingEmail = await sendUserOnboardingEmail({
          user: { email: normalizedEmail, surname, otherNames },
          company: companyDoc,
          temporaryPassword: resolvedPassword,
        });
        if (onboardingEmail?.sent) {
          await User.findByIdAndUpdate(savedUser._id, { $set: { onboardingEmailSentAt: new Date() } });
          savedUser.onboardingEmailSentAt = new Date();
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

    const enrichedUser = sanitizeUserForResponse(await attachCompanyCollections(savedUser));

    res.status(201).json({
      success: true,
      user: enrichedUser,
      onboardingEmail,
      generatedAccess: autoGeneratePassword
        ? {
            email: normalizedEmail,
            temporaryPassword: resolvedPassword,
          }
        : null,
      message: 'User registered successfully',
    });
  } catch (err) {
    if (err.code === 11000) {
      return next(createError(400, 'Email already exists'));
    }
    console.error('Register error:', err);
    next(err);
  }
};

export const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return next(createError(400, "Email and password are required"));
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const adminCreds = getAdminCredentials();

    if (
      adminCreds.email &&
      adminCreds.password &&
      normalizedEmail === adminCreds.email &&
      password === adminCreds.password
    ) {
      const user = buildSystemAdminUserPayload();
      const token = jwt.sign(
        {
          id: "milik-admin",
          email: adminCreds.email,
          profile: "Administrator",
          superAdminAccess: true,
          adminAccess: true,
          isSystemAdmin: true,
          company: null,
        },
        getJWTSecret(),
        { expiresIn: "7d" }
      );

      attachAuthCookie(res, token);

      return res.status(200).json({
        success: true,
        token,
        user,
        company: null,
        message: "Login successful",
      });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user || user.isSystemAuditUser) {
      return next(createError(401, "Invalid email or password"));
    }
    if (!user.isActive) {
      return next(createError(403, "User account is inactive"));
    }
    if (user.locked) {
      return next(createError(403, "User account is locked"));
    }

    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
      return next(createError(401, "Invalid email or password"));
    }

    await User.updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } });

    const token = createAuthToken(user);
    const userDetails = sanitizeUserForResponse(await attachCompanyCollections(user));
    const serializedCompany = userDetails.company || null;

    attachAuthCookie(res, token);

    res.status(200).json({
      success: true,
      token,
      user: userDetails,
      company: serializedCompany,
      message: 'Login successful',
    });
  } catch (err) {
    console.error("Login error:", err);
    next(createError(500, "Failed to complete login"));
  }
};

export const changePasswordFirstLogin = async (req, res, next) => {
  try {
    if (req.user?.isSystemAdmin) {
      return next(createError(400, 'System admin does not use first-time password reset'));
    }

    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (!currentPassword || !newPassword || !confirmPassword) {
      return next(createError(400, 'Current password, new password and confirmation are required'));
    }

    if (String(newPassword).length < 8) {
      return next(createError(400, 'New password must be at least 8 characters'));
    }

    if (newPassword !== confirmPassword) {
      return next(createError(400, 'New password and confirmation do not match'));
    }

    if (currentPassword === newPassword) {
      return next(createError(400, 'New password must be different from the temporary password'));
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return next(createError(404, 'User not found'));
    }

    const isPasswordCorrect = await user.comparePassword(currentPassword);
    if (!isPasswordCorrect) {
      return next(createError(401, 'Temporary password is incorrect'));
    }

    user.password = newPassword;
    user.mustChangePassword = false;
    user.passwordProvisioningMethod = 'manual';
    user.lastPasswordChangeAt = new Date();
    await user.save();

    const token = createAuthToken(user);
    const userDetails = sanitizeUserForResponse(await attachCompanyCollections(user));
    const serializedCompany = userDetails.company || null;

    attachAuthCookie(res, token);

    return res.status(200).json({
      success: true,
      token,
      user: userDetails,
      company: serializedCompany,
      message: 'Password updated successfully',
    });
  } catch (err) {
    next(err);
  }
};

export const getCurrentUser = async (req, res, next) => {
  try {
    if (req.user?.isSystemAdmin) {
      const activeCompany = await normalizeCompanyPayload(req.user?.company);
      return res.status(200).json({
        success: true,
        user: buildSystemAdminUserPayload(activeCompany),
        company: activeCompany,
        message: "User retrieved successfully",
      });
    }

    const user = await User.findById(req.user.id)
      .select('-password -resetPasswordToken -resetPasswordExpire');

    if (!user) {
      return next(createError(404, "User not found"));
    }

    const userDetails = sanitizeUserForResponse(await attachCompanyCollections(user));
    const serializedCompany = userDetails.company || null;

    res.status(200).json({
      success: true,
      user: userDetails,
      company: serializedCompany,
      message: 'User retrieved successfully',
    });
  } catch (err) {
    console.error("Get current user error:", err);
    next(err);
  }
};

export const logoutUser = async (req, res) => {
  try {
    clearAuthCookie(res);

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
};

export const getAccessibleCompanies = async (req, res, next) => {
  try {
    const includeDemoCompanies = shouldIncludeDemoCompanies(req);
    const companyFilter = includeDemoCompanies ? {} : buildLiveCompanyFilter();

    if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
      let companies = await Company.find(companyFilter)
        .select(companyReferenceSelect)
        .sort({ companyName: 1 })
        .lean();

      if (!includeDemoCompanies) {
        companies = filterLiveCompanies(companies);
      }

      return res.status(200).json({
        success: true,
        companies: companies.map((company) => serializeCompanyReferenceForClient(company)),
      });
    }

    const companyIds = Array.from(
      new Set(
        [
          req.user?.company?._id || req.user?.company,
          req.user?.primaryCompany?._id || req.user?.primaryCompany,
          ...(Array.isArray(req.user?.accessibleCompanies)
            ? req.user.accessibleCompanies.map((company) => company?._id || company)
            : []),
          ...(Array.isArray(req.user?.companyAssignments)
            ? req.user.companyAssignments.map((assignment) => assignment?.company?._id || assignment?.company)
            : []),
        ]
          .filter(Boolean)
          .map((item) => String(item))
      )
    );

    if (!companyIds.length) {
      return res.status(200).json({ success: true, companies: [] });
    }

    let companies = await Company.find({
      _id: { $in: companyIds },
      ...companyFilter,
    })
      .select(companyReferenceSelect)
      .sort({ companyName: 1 })
      .lean();

    if (!includeDemoCompanies) {
      companies = filterLiveCompanies(companies);
    }

    return res.status(200).json({
      success: true,
      companies: companies.map((company) => serializeCompanyReferenceForClient(company)),
    });
  } catch (err) {
    next(err);
  }
};

export const switchCompany = async (req, res, next) => {
  try {
    const { companyId } = req.body;
    if (!companyId) {
      return next(createError(400, "companyId is required"));
    }

    const targetCompany = await normalizeCompanyPayload(companyId);
    if (!targetCompany) {
      return next(createError(404, "Company not found"));
    }

    if (targetCompany.isDemoWorkspace && !req.user?.isDemoUser) {
      return next(
        createError(
          403,
          "The dedicated demo workspace cannot be selected from live company switching."
        )
      );
    }

    if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
      const adminUser = buildSystemAdminUserPayload(targetCompany);

      const token = jwt.sign(
        {
          id: "milik-admin",
          email: adminUser.email,
          profile: adminUser.profile,
          superAdminAccess: true,
          adminAccess: true,
          isSystemAdmin: true,
          company: targetCompany._id,
        },
        getJWTSecret(),
        { expiresIn: "7d" }
      );

      attachAuthCookie(res, token);

      return res.status(200).json({
        success: true,
        token,
        user: adminUser,
        company: targetCompany,
        message: "Company switched successfully",
      });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return next(createError(404, "User not found"));
    }

    if (!userCanAccessCompany(user, companyId)) {
      return next(createError(403, "You do not have access to this company"));
    }

    await User.updateOne({ _id: user._id }, { $set: { company: companyId } });

    const nextUserPayload = { ...user.toObject(), company: targetCompany._id };
    const token = createAuthToken(nextUserPayload);
    const userDetails = sanitizeUserForResponse(await attachCompanyCollections(nextUserPayload));
    userDetails.company = targetCompany;

    attachAuthCookie(res, token);

    return res.status(200).json({
      success: true,
      token,
      user: userDetails,
      company: targetCompany,
      message: "Company switched successfully",
    });
  } catch (err) {
    next(err);
  }
};

export const createSuperAdmin = async (req, res, next) => {
  return next(
    createError(
      410,
      "Super admin creation is disabled. Use embedded Milik admin credentials to login."
    )
  );
};

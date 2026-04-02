import crypto from "crypto";
import express from "express";
import jwt from "jsonwebtoken";
import Company from "../models/Company.js";
import TrialRequest from "../models/TrialRequest.js";
import User from "../models/User.js";
import { sendTrialAccessEmail, sendTrialRequestNotification } from "../utils/trialRequestMailer.js";
import { ensureDemoWorkspaceSeed } from "../utils/demoSeedService.js";
import { serializeCompanyForClient } from "../utils/companyModules.js";
import { attachAuthCookie } from "../utils/authCookie.js";

const router = express.Router();
const DEMO_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
const DEMO_COMPANY_NAME = "MILIK DEMO WORKSPACE";
const DEMO_COMPANY_EMAIL = "demo.workspace@milik.local";
const DEMO_COMPANY_NAME_REGEX = /^milik\s+demo\s+workspace$/i;
const DEMO_EXPIRED_MESSAGE = "Your demo period has ended. Contact MILIK for activation.";

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function getJWTSecret() {
  const secret = env("JWT_SECRET");
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function isValidEmail(value = "") {
  return /^\S+@\S+\.\S+$/.test(String(value || "").trim());
}

function toISOStringOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getRemainingDemoMs(expiresAt, now = new Date()) {
  if (!expiresAt) return 0;
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return 0;
  return Math.max(0, expiry.getTime() - now.getTime());
}

function issueDemoToken(user, companyId, role, remainingMs) {
  const expiresInSeconds = Math.max(1, Math.ceil(remainingMs / 1000));

  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      company: companyId,
      profile: user.profile,
      superAdminAccess: false,
      adminAccess: false,
      isSystemAdmin: false,
      isDemoUser: true,
      demoRole: role,
      readOnly: true,
    },
    getJWTSecret(),
    { expiresIn: expiresInSeconds }
  );
}

function issueTrialAccessToken(trialRequest, remainingMs) {
  const expiresInSeconds = Math.max(1, Math.ceil(remainingMs / 1000));

  return jwt.sign(
    {
      trialRequestId: trialRequest?._id,
      email: trialRequest?.email,
      purpose: "trial_demo_access",
    },
    getJWTSecret(),
    { expiresIn: expiresInSeconds }
  );
}

function verifyTrialAccessToken(accessToken) {
  const payload = jwt.verify(String(accessToken || ""), getJWTSecret());
  if (payload?.purpose !== "trial_demo_access") {
    throw new Error("Invalid demo access token");
  }
  return payload;
}

function buildDemoCompanyPayload() {
  const fiscalYear = new Date().getFullYear();
  return {
    companyName: DEMO_COMPANY_NAME,
    companyCode: "MLKDM",
    postalAddress: "Nairobi, Kenya",
    country: "Kenya",
    town: "Nairobi",
    baseCurrency: "KES",
    taxRegime: "VAT",
    fiscalStartMonth: "January",
    fiscalStartYear: fiscalYear,
    operationPeriodType: "Monthly",
    email: DEMO_COMPANY_EMAIL,
    phoneNo: "+254700000999",
    isActive: true,
    accountActive: true,
    accountStatus: "Active",
    isDemoWorkspace: true,
    modules: {
      propertyManagement: true,
      accounts: true,
      billing: true,
    },
  };
}

async function loadCompanyForClient(companyId) {
  const company = await Company.findById(companyId)
    .select(
      "companyName companyCode baseCurrency logo country town email phoneNo slogan modules fiscalStartMonth fiscalStartYear operationPeriodType isActive accountStatus isDemoWorkspace"
    )
    .lean();

  return company ? serializeCompanyForClient(company) : null;
}

function getDemoWorkspaceFilter() {
  return { isDemoWorkspace: true };
}

async function resolveDemoCompany() {
  const configuredId = env("DEMO_COMPANY_ID");
  const demoPayload = buildDemoCompanyPayload();

  if (configuredId) {
    const configuredCompany = await Company.findById(configuredId).lean();

    if (!configuredCompany) {
      throw new Error("Configured DEMO_COMPANY_ID was not found");
    }

    if (!configuredCompany.isDemoWorkspace) {
      throw new Error(
        "Configured DEMO_COMPANY_ID must reference a dedicated demo workspace company with isDemoWorkspace=true"
      );
    }

    await Company.findByIdAndUpdate(
      configuredId,
      { $set: { ...demoPayload, isDemoWorkspace: true } },
      { new: true }
    );

    return Company.findById(configuredId).lean();
  }

  const existingDemoCompany = await Company.findOne(getDemoWorkspaceFilter())
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  if (existingDemoCompany?._id) {
    await Company.findByIdAndUpdate(
      existingDemoCompany._id,
      {
        $set: {
          ...demoPayload,
          isDemoWorkspace: true,
        },
      },
      { new: true }
    );

    return Company.findById(existingDemoCompany._id).lean();
  }

  const createdDemoCompany = await Company.create({ ...demoPayload, isDemoWorkspace: true });
  return Company.findById(createdDemoCompany._id).lean();
}

async function getOrCreateDemoUser(companyId) {
  const demoEmail = `demo.pm.${companyId}@milik.local`;
  let user = await User.findOne({ company: companyId, email: demoEmail }).populate(
    "company",
    "companyName baseCurrency isDemoWorkspace modules"
  );

  if (!user) {
    user = await User.create({
      surname: "Demo",
      otherNames: "Visitor",
      idNumber: `DEMO-${String(companyId).slice(-8).toUpperCase()}`,
      gender: "Other",
      postalAddress: "Demo Workspace",
      phoneNumber: "+254700000000",
      email: demoEmail,
      profile: "Viewer",
      userControl: true,
      superAdminAccess: false,
      adminAccess: false,
      setupAccess: false,
      companySetupAccess: false,
      moduleAccess: {
        propertyMgmt: "View only",
        propertySale: "Not allowed",
        facilityManagement: "Not allowed",
        hotelManagement: "Not allowed",
        accounts: "View only",
        revenueRecognition: "Not allowed",
        telcoDealership: "Not allowed",
        inventory: "Not allowed",
        retailOutlet: "",
        procurement: "Not allowed",
        humanResource: "Not allowed",
        hidePayDetails: false,
        incidentManagement: "Not allowed",
        sacco: "Not allowed",
        projectManagement: "Not allowed",
        assetValuation: "Not allowed",
        crm: "Not allowed",
        dms: "Not allowed",
        academics: "Not allowed",
      },
      rights: [],
      company: companyId,
      password: crypto.randomBytes(16).toString("hex"),
      isActive: true,
      locked: false,
    });
    user = await User.findById(user._id).populate(
      "company",
      "companyName baseCurrency isDemoWorkspace modules"
    );
  }

  return user;
}

function buildDemoResponseUser(user, company, role, demoExpiresAt) {
  return {
    _id: user._id,
    surname: user.surname,
    otherNames: user.otherNames,
    email: user.email,
    profile: user.profile,
    adminAccess: false,
    superAdminAccess: false,
    isSystemAdmin: false,
    isDemoUser: true,
    demoRole: role,
    readOnly: true,
    demoExpiresAt,
    moduleAccess: user.moduleAccess,
    company,
    isActive: true,
  };
}

async function upsertTrialLead({ existingTrial, payload, name, email, phone, company, role, portfolioSize, city, country, notes }) {
  const trial = existingTrial || new TrialRequest({ email });

  trial.name = name;
  trial.email = email;
  trial.phone = phone;
  trial.company = company;
  trial.role = role;
  trial.portfolioSize = portfolioSize;
  trial.city = city;
  trial.country = country;
  trial.notes = notes;
  trial.rawPayload = payload;
  trial.status = trial.status || "pending";

  await trial.save();
  return trial;
}

const buildBaseEmailNotification = () => ({
  attempted: false,
  sent: false,
  skipped: false,
  error: null,
});

async function dispatchTrialRequestNotification(trial, { shouldNotify = true } = {}) {
  if (!shouldNotify) {
    return {
      ...buildBaseEmailNotification(),
      skipped: true,
      error: null,
    };
  }

  try {
    const result = await sendTrialRequestNotification(trial);
    if (result?.sent) {
      await TrialRequest.findByIdAndUpdate(trial._id, {
        $set: { lastAdminNotificationAt: new Date() },
      });
    }
    return result;
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      skipped: false,
      error: error?.message || "Failed to send notification email",
    };
  }
}

async function dispatchDemoAccessEmail(trial, { demoExpiresAt, resumedDemo = false } = {}) {
  const remainingMs = getRemainingDemoMs(demoExpiresAt);
  if (remainingMs <= 0) {
    return {
      attempted: false,
      sent: false,
      skipped: true,
      error: "Demo access window has already expired",
    };
  }

  const accessToken = issueTrialAccessToken(trial, remainingMs);

  try {
    const result = await sendTrialAccessEmail({
      trialRequest: trial,
      accessToken,
      demoExpiresAt,
      resumedDemo,
    });

    if (result?.sent) {
      await TrialRequest.findByIdAndUpdate(trial._id, {
        $set: { lastDemoAccessEmailSentAt: new Date() },
      });
    }

    return result;
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      skipped: false,
      error: error?.message || "Failed to send demo access email",
    };
  }
}

async function buildActiveDemoSession({ trial, now = new Date(), roleOverride = null } = {}) {
  const persistedDemoExpiresAt = trial?.demoExpiresAt ? new Date(trial.demoExpiresAt) : null;
  const hasPersistedDemoWindow =
    persistedDemoExpiresAt instanceof Date && !Number.isNaN(persistedDemoExpiresAt.getTime());

  if (!hasPersistedDemoWindow) {
    return { hasDemoWindow: false, expired: false };
  }

  if (persistedDemoExpiresAt.getTime() <= now.getTime()) {
    await TrialRequest.findByIdAndUpdate(trial._id, {
      $set: {
        status: "demo_expired",
      },
    });

    return {
      hasDemoWindow: true,
      expired: true,
      demoExpiresAt: persistedDemoExpiresAt,
    };
  }

  const demoCompanyId = trial?.demoCompany;
  const demoCompany = demoCompanyId ? await Company.findById(demoCompanyId).lean() : await resolveDemoCompany();
  if (!demoCompany?._id) {
    return {
      hasDemoWindow: true,
      expired: false,
      unavailable: true,
      demoExpiresAt: persistedDemoExpiresAt,
    };
  }

  const demoUser = await getOrCreateDemoUser(demoCompany._id);
  const demoSeed = await ensureDemoWorkspaceSeed({
    companyId: demoCompany._id,
    userId: demoUser._id,
  });
  const serializedCompany = await loadCompanyForClient(demoCompany._id);
  const remainingMs = getRemainingDemoMs(persistedDemoExpiresAt, now);
  const token = issueDemoToken(demoUser, demoCompany._id, roleOverride || trial.role || "property_manager", remainingMs);

  await TrialRequest.findByIdAndUpdate(trial._id, {
    $set: {
      status: "demo_started",
      demoTokenIssued: true,
      demoCompany: demoCompany._id,
    },
  });

  return {
    hasDemoWindow: true,
    expired: false,
    unavailable: false,
    demoExpiresAt: persistedDemoExpiresAt,
    token,
    demoSeed,
    user: buildDemoResponseUser(
      demoUser,
      serializedCompany,
      roleOverride || trial.role || "property_manager",
      persistedDemoExpiresAt.toISOString()
    ),
  };
}


router.post("/", async (req, res) => {
  try {
    const payload = req.body || {};
    const name = normalizeText(payload.name);
    const email = normalizeEmail(payload.email);
    const phone = normalizeText(payload.phone);
    const company =
      normalizeText(payload.company) ||
      normalizeText(payload.companyName) ||
      normalizeText(payload.businessName);
    const role = ["property_manager", "landlord"].includes(normalizeText(payload.role))
      ? normalizeText(payload.role)
      : "property_manager";
    const portfolioSize = normalizeText(payload.portfolioSize);
    const city = normalizeText(payload.city);
    const country = normalizeText(payload.country) || "Kenya";
    const notes = normalizeText(payload.notes);

    if (name.length < 2) {
      return res.status(400).json({ success: false, message: "Please provide your full name" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please provide a valid email address" });
    }

    if (role === "property_manager" && !company) {
      return res.status(400).json({ success: false, message: "Company name is required for demo access" });
    }

    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone number is required" });
    }

    const now = new Date();
    const existingTrial = await TrialRequest.findOne({ email });
    const trial = await upsertTrialLead({
      existingTrial,
      payload,
      name,
      email,
      phone,
      company,
      role,
      portfolioSize,
      city,
      country,
      notes,
    });

    const persistedDemoExpiresAt = trial.demoExpiresAt ? new Date(trial.demoExpiresAt) : null;
    const hasActiveDemoWindow =
      role === "property_manager" &&
      persistedDemoExpiresAt instanceof Date &&
      !Number.isNaN(persistedDemoExpiresAt.getTime()) &&
      persistedDemoExpiresAt.getTime() > now.getTime();

    const emailNotification = await dispatchTrialRequestNotification(trial, {
      shouldNotify: !(role === "property_manager" && hasActiveDemoWindow),
    });

    if (role !== "property_manager") {
      return res.status(201).json({
        success: true,
        demoAvailable: false,
        resumedDemo: false,
        demoExpired: false,
        message:
          "Thanks. Your landlord preview request has been received. We will contact you with the landlord-facing walkthrough shortly.",
        trialRequestId: trial._id,
        emailNotification,
      });
    }

    const activeDemoSession = await buildActiveDemoSession({
      trial,
      now,
      roleOverride: role,
    });

    if (activeDemoSession.hasDemoWindow && activeDemoSession.expired) {
      return res.status(200).json({
        success: true,
        demoAvailable: false,
        resumedDemo: false,
        demoExpired: true,
        message: DEMO_EXPIRED_MESSAGE,
        trialRequestId: trial._id,
        demoExpiresAt: toISOStringOrNull(activeDemoSession.demoExpiresAt),
        emailNotification,
      });
    }

    if (activeDemoSession.hasDemoWindow && activeDemoSession.unavailable) {
      return res.status(201).json({
        success: true,
        demoAvailable: false,
        resumedDemo: false,
        demoExpired: false,
        message:
          "Your request has been received. Demo auto-login is not ready because no dedicated demo workspace company is configured yet.",
        trialRequestId: trial._id,
        emailNotification,
      });
    }

    if (activeDemoSession.hasDemoWindow) {
      attachAuthCookie(res, activeDemoSession.token);

      return res.status(200).json({
        success: true,
        demoAvailable: true,
        resumedDemo: true,
        demoExpired: false,
        message: "Welcome back. Resuming your remaining demo time.",
        redirectTo: "/dashboard",
        token: activeDemoSession.token,
        user: activeDemoSession.user,
        trialRequestId: trial._id,
        demoExpiresAt: activeDemoSession.demoExpiresAt.toISOString(),
        emailNotification,
        demoSeed: activeDemoSession.demoSeed,
      });
    }

    const demoCompany = await resolveDemoCompany();
    if (!demoCompany?._id) {
      return res.status(201).json({
        success: true,
        demoAvailable: false,
        resumedDemo: false,
        demoExpired: false,
        message:
          "Your request has been received. Demo auto-login is not ready because no dedicated demo workspace company is configured yet.",
        trialRequestId: trial._id,
        emailNotification,
      });
    }

    const demoUser = await getOrCreateDemoUser(demoCompany._id);
    const demoSeed = await ensureDemoWorkspaceSeed({
      companyId: demoCompany._id,
      userId: demoUser._id,
    });
    const serializedCompany = await loadCompanyForClient(demoCompany._id);
    const demoExpiresAt = new Date(now.getTime() + DEMO_DURATION_MS);
    const token = issueDemoToken(demoUser, demoCompany._id, role, DEMO_DURATION_MS);

    const trialUpdate = {
      status: "demo_started",
      demoTokenIssued: true,
      demoStartedAt: trial.demoStartedAt || now,
      demoExpiresAt,
      demoCompany: demoCompany._id,
    };

    await TrialRequest.findByIdAndUpdate(trial._id, {
      $set: trialUpdate,
    });

    trial.status = trialUpdate.status;
    trial.demoTokenIssued = trialUpdate.demoTokenIssued;
    trial.demoStartedAt = trialUpdate.demoStartedAt;
    trial.demoExpiresAt = trialUpdate.demoExpiresAt;
    trial.demoCompany = trialUpdate.demoCompany;

    const accessEmailNotification = await dispatchDemoAccessEmail(trial, {
      demoExpiresAt,
      resumedDemo: false,
    });

    attachAuthCookie(res, token);

    return res.status(201).json({
      success: true,
      demoAvailable: true,
      resumedDemo: false,
      demoExpired: false,
      message: "Demo workspace ready",
      redirectTo: "/dashboard",
      token,
      user: buildDemoResponseUser(demoUser, serializedCompany, role, demoExpiresAt.toISOString()),
      trialRequestId: trial._id,
      demoExpiresAt: demoExpiresAt.toISOString(),
      emailNotification,
      accessEmailNotification,
      demoSeed,
    });
  } catch (error) {
    console.error("Trial request error:", error);
    return res.status(400).json({
      success: false,
      message: error?.message || "Failed to submit trial request",
    });
  }
});


router.post("/access", async (req, res) => {
  try {
    const accessToken = normalizeText(req.body?.accessToken);
    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: "Demo access token is required.",
      });
    }

    const payload = verifyTrialAccessToken(accessToken);
    const trial =
      (payload?.trialRequestId && isValidEmail(payload?.email)
        ? await TrialRequest.findOne({ _id: payload.trialRequestId, email: normalizeEmail(payload.email) })
        : null) ||
      (payload?.trialRequestId ? await TrialRequest.findById(payload.trialRequestId) : null);

    if (!trial) {
      return res.status(404).json({
        success: false,
        message: "This demo access link is no longer valid.",
      });
    }

    const now = new Date();
    const activeDemoSession = await buildActiveDemoSession({
      trial,
      now,
      roleOverride: "property_manager",
    });

    if (!activeDemoSession.hasDemoWindow || activeDemoSession.unavailable) {
      return res.status(404).json({
        success: false,
        message: "No active demo workspace was found for this access link.",
      });
    }

    if (activeDemoSession.expired) {
      return res.status(200).json({
        success: true,
        demoAvailable: false,
        resumedDemo: false,
        demoExpired: true,
        message: DEMO_EXPIRED_MESSAGE,
        trialRequestId: trial._id,
        demoExpiresAt: toISOStringOrNull(activeDemoSession.demoExpiresAt),
      });
    }

    attachAuthCookie(res, activeDemoSession.token);

    return res.status(200).json({
      success: true,
      demoAvailable: true,
      resumedDemo: true,
      demoExpired: false,
      message: "Welcome back. Resuming your remaining demo time.",
      redirectTo: "/dashboard",
      token: activeDemoSession.token,
      user: activeDemoSession.user,
      trialRequestId: trial._id,
      demoExpiresAt: activeDemoSession.demoExpiresAt.toISOString(),
      demoSeed: activeDemoSession.demoSeed,
    });
  } catch (error) {
    const tokenError = error?.name === "JsonWebTokenError" || error?.name === "TokenExpiredError";
    return res.status(tokenError ? 400 : 500).json({
      success: false,
      message: tokenError ? "This demo access link is invalid or has expired." : error?.message || "Failed to restore demo access.",
    });
  }
});

export default router;

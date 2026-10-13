import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleSettings from "../models/SaleSettings.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";
import { invalidateAgentVisibilityCache } from "../middleware/agentScope.js";
import { sanitizeTypeConfig } from "../services/listingAttributes.js";
import { WHT_MAX_RATE } from "../../../utils/withholdingTax.js";

const ensureSettings = async (business) => {
  let s = await SaleSettings.findOne({ business });
  if (!s) s = await SaleSettings.create({ business });
  return s;
};

const DEFAULT_SEEDS = {
  pipelineStages: [
    { name: "New", order: 0 }, { name: "Contacted", order: 1 }, { name: "Qualified", order: 2 },
    { name: "Site Visited", order: 3 }, { name: "Proposal Sent", order: 4 },
    { name: "Negotiating", order: 5 }, { name: "Converted", order: 6 }, { name: "Lost", order: 7 },
  ],
  leadSources:   [
    { name: "Walk In" }, { name: "Referral" }, { name: "Online" },
    { name: "Social Media" }, { name: "Agent" }, { name: "Cold Call" }, { name: "Other" },
  ],
  propertyTypes: [
    { name: "Plot" }, { name: "House" }, { name: "Apartment" },
    { name: "Commercial" }, { name: "Land" }, { name: "Other" },
  ],
};

export const getSettings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const settings = await ensureSettings(business);
    res.json({ settings });
  } catch (err) { next(err); }
};

const makeAdd = (collKey) => async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const name = String(req.body?.name || "").trim();
    if (!name) return next(createError(400, "Name is required"));
    const settings = await ensureSettings(business);
    if (settings[collKey].some((i) => i.name.toLowerCase() === name.toLowerCase() && i.isActive !== false)) {
      return next(createError(400, `"${name}" already exists`));
    }
    const order = req.body?.order != null ? Number(req.body.order) : settings[collKey].length;
    settings[collKey].push({ _id: new mongoose.Types.ObjectId(), name, order, isActive: true });
    await settings.save();
    res.status(201).json({ settings });
  } catch (err) { next(err); }
};

const makeUpdate = (collKey) => async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const settings = await SaleSettings.findOne({ business });
    if (!settings) return next(createError(404, "Settings not found"));
    const item = settings[collKey].id(req.params.itemId);
    if (!item) return next(createError(404, "Item not found"));
    if (req.body?.name     !== undefined) item.name     = String(req.body.name || "").trim();
    if (req.body?.order    !== undefined) item.order    = Number(req.body.order);
    if (req.body?.isActive !== undefined) item.isActive = Boolean(req.body.isActive);
    await settings.save();
    res.json({ settings });
  } catch (err) { next(err); }
};

const makeArchive = (collKey) => async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const settings = await SaleSettings.findOne({ business });
    if (!settings) return next(createError(404, "Settings not found"));
    const item = settings[collKey].id(req.params.itemId);
    if (!item) return next(createError(404, "Item not found"));
    item.isActive = false;
    await settings.save();
    res.json({ settings, message: "Item archived" });
  } catch (err) { next(err); }
};

export const addPipelineStage    = makeAdd("pipelineStages");
export const updatePipelineStage = makeUpdate("pipelineStages");
export const archivePipelineStage = makeArchive("pipelineStages");

export const addLeadSource    = makeAdd("leadSources");
export const updateLeadSource = makeUpdate("leadSources");
export const archiveLeadSource = makeArchive("leadSources");

// Property types also carry extra field definitions and hidden standard fields (see services/listingAttributes.js)
export const addPropertyType = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const name = String(req.body?.name || "").trim();
    if (!name) return next(createError(400, "Name is required"));
    const config = sanitizeTypeConfig({ fields: req.body?.fields ?? [], hiddenFields: req.body?.hiddenFields ?? [] });
    if (config.error) return next(createError(400, config.error));
    const settings = await ensureSettings(business);
    if (settings.propertyTypes.some((i) => i.name.toLowerCase() === name.toLowerCase() && i.isActive !== false)) {
      return next(createError(400, `"${name}" already exists`));
    }
    settings.propertyTypes.push({ _id: new mongoose.Types.ObjectId(), name, isActive: true, fields: config.fields, hiddenFields: config.hiddenFields });
    await settings.save();
    res.status(201).json({ settings });
  } catch (err) { next(err); }
};

export const updatePropertyType = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const settings = await SaleSettings.findOne({ business });
    if (!settings) return next(createError(404, "Settings not found"));
    const item = settings.propertyTypes.id(req.params.itemId);
    if (!item) return next(createError(404, "Item not found"));
    const config = sanitizeTypeConfig({ fields: req.body?.fields, hiddenFields: req.body?.hiddenFields });
    if (config.error) return next(createError(400, config.error));
    if (req.body?.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (!name) return next(createError(400, "Name is required"));
      item.name = name;
    }
    if (req.body?.isActive !== undefined) item.isActive = Boolean(req.body.isActive);
    if (config.fields !== undefined) item.fields = config.fields;
    if (config.hiddenFields !== undefined) item.hiddenFields = config.hiddenFields;
    await settings.save();
    res.json({ settings });
  } catch (err) { next(err); }
};
export const archivePropertyType = makeArchive("propertyTypes");

export const updateCommissionDefaults = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const settings = await ensureSettings(business);
    const { rate, commissionType, whtRate } = req.body;
    if (rate           != null) settings.commissionDefaults.rate           = Number(rate);
    if (commissionType != null) settings.commissionDefaults.commissionType = commissionType;
    if (whtRate != null) {
      const rateNumber = Number(whtRate);
      if (whtRate === "" || !Number.isFinite(rateNumber) || rateNumber < 0 || rateNumber > WHT_MAX_RATE) {
        return next(createError(400, `Withholding tax rate must be between 0 and ${WHT_MAX_RATE}%.`));
      }
      settings.commissionDefaults.whtRate = rateNumber;
    }
    await settings.save();
    res.json({ settings });
  } catch (err) { next(err); }
};

// The company's own agency-commission rate (as the owner's selling agent) — independent of commissionDefaults,
// which is the broker/SaleAgent rate. No WHT here: this is the company's own revenue, never paid out.
export const updateOwnerCommissionDefaults = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const settings = await ensureSettings(business);
    const { rate, commissionType } = req.body;
    if (rate           != null) settings.ownerCommissionDefaults.rate           = Number(rate);
    if (commissionType != null) settings.ownerCommissionDefaults.commissionType = commissionType;
    await settings.save();
    res.json({ settings });
  } catch (err) { next(err); }
};

// A schedule's tiers must be ascending by threshold, and each tier's releasePct is a CUMULATIVE target
// (not an incremental share — 30%->25% then 100%->100% means "25% of the commission has been released
// by 30% paid, then the rest by 100% paid", not "25% + 100%"), so releasePct must also be non-decreasing
// as the threshold rises. A schedule that never reaches 100% cumulative is valid on purpose — an
// unreached remainder simply never auto-releases until more tiers are added, so a partial/in-progress
// config is never hard-blocked.
const tiersProblem = (tiers, label) => {
  if (!Array.isArray(tiers)) return `${label} must be a list`;
  let lastThreshold = -1;
  let lastRelease = -1;
  for (const t of tiers) {
    const threshold = Number(t?.thresholdPct);
    const release   = Number(t?.releasePct);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) return `${label}: each threshold must be between 0 and 100`;
    if (!Number.isFinite(release) || release < 0 || release > 100) return `${label}: each release % must be between 0 and 100`;
    if (threshold <= lastThreshold) return `${label}: thresholds must be in ascending order`;
    if (release < lastRelease) return `${label}: cumulative release % can't decrease at a later threshold`;
    lastThreshold = threshold;
    lastRelease = release;
  }
  return null;
};

// Company-wide switch: staged/tiered release of owner commission and broker commission, keyed off the
// buyer's cumulative % of agreedPrice paid on a deal
export const updateCommissionReleaseSchedule = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { enabled, ownerCommissionTiers = [], brokerCommissionTiers = [] } = req.body;
    if (typeof enabled !== "boolean") return next(createError(400, "enabled must be true or false"));
    const ownerError  = tiersProblem(ownerCommissionTiers, "Owner commission tiers");
    if (ownerError) return next(createError(400, ownerError));
    const brokerError = tiersProblem(brokerCommissionTiers, "Broker commission tiers");
    if (brokerError) return next(createError(400, brokerError));

    const settings = await ensureSettings(business);
    settings.commissionReleaseSchedule = {
      enabled,
      ownerCommissionTiers:  ownerCommissionTiers.map((t) => ({ thresholdPct: Number(t.thresholdPct), releasePct: Number(t.releasePct) })),
      brokerCommissionTiers: brokerCommissionTiers.map((t) => ({ thresholdPct: Number(t.thresholdPct), releasePct: Number(t.releasePct) })),
    };
    await settings.save();
    res.json({ settings });
  } catch (err) { next(err); }
};

// Company-wide switch: agent-linked users see only their own records ("own") or the whole business ("all")
export const updateAgentVisibility = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { mode } = req.body;
    if (!["own", "all"].includes(mode)) return next(createError(400, 'mode must be "own" or "all"'));
    const settings = await ensureSettings(business);
    settings.agentVisibility = mode;
    await settings.save();
    invalidateAgentVisibilityCache(business);
    res.json({ settings });
  } catch (err) { next(err); }
};

// Company-wide switch: shows the Projects and Units pages (selling items grouped into projects)
export const updateUseProjects = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    if (typeof req.body?.enabled !== "boolean") return next(createError(400, "enabled must be true or false"));
    const settings = await ensureSettings(business);
    settings.useProjects = req.body.enabled;
    await settings.save();
    res.json({ settings });
  } catch (err) { next(err); }
};

// Company-wide switch: shows the Owners page and the owner-commission/statement features
export const updateUseOwners = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    if (typeof req.body?.enabled !== "boolean") return next(createError(400, "enabled must be true or false"));
    const settings = await ensureSettings(business);
    settings.useOwners = req.body.enabled;
    await settings.save();
    res.json({ settings });
  } catch (err) { next(err); }
};

// Company-wide switch: shows the Advocates page and the advocate-trust/remittance features
export const updateUseAdvocates = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    if (typeof req.body?.enabled !== "boolean") return next(createError(400, "enabled must be true or false"));
    const settings = await ensureSettings(business);
    settings.useAdvocates = req.body.enabled;
    await settings.save();
    res.json({ settings });
  } catch (err) { next(err); }
};

// Communication templates CRUD
export const addCommTemplate = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { name, channel, context, subject = "", body } = req.body;
    if (!name || !channel || !context || !body) return next(createError(400, "name, channel, context and body are required"));
    const settings = await ensureSettings(business);
    settings.commTemplates.push({ name: String(name).trim(), channel, context, subject: String(subject).trim(), body: String(body).trim() });
    await settings.save();
    res.status(201).json({ settings });
  } catch (err) { next(err); }
};

export const updateCommTemplate = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const settings = await SaleSettings.findOne({ business });
    if (!settings) return next(createError(404, "Settings not found"));
    const tpl = settings.commTemplates.id(req.params.itemId);
    if (!tpl) return next(createError(404, "Template not found"));
    const { name, channel, context, subject, body, isActive } = req.body;
    if (name     !== undefined) tpl.name     = String(name).trim();
    if (channel  !== undefined) tpl.channel  = channel;
    if (context  !== undefined) tpl.context  = context;
    if (subject  !== undefined) tpl.subject  = String(subject).trim();
    if (body     !== undefined) tpl.body     = String(body).trim();
    if (isActive !== undefined) tpl.isActive = Boolean(isActive);
    await settings.save();
    res.json({ settings });
  } catch (err) { next(err); }
};

export const deleteCommTemplate = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const settings = await SaleSettings.findOne({ business });
    if (!settings) return next(createError(404, "Settings not found"));
    const tpl = settings.commTemplates.id(req.params.itemId);
    if (!tpl) return next(createError(404, "Template not found"));
    tpl.deleteOne();
    await settings.save();
    res.json({ settings, message: "Template deleted" });
  } catch (err) { next(err); }
};

const ENDPOINT_TO_KEY = {
  "pipeline-stages": "pipelineStages",
  "lead-sources":    "leadSources",
  "property-types":  "propertyTypes",
};

export const loadDefaults = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const collKey = ENDPOINT_TO_KEY[req.params.collection];
    const seed = DEFAULT_SEEDS[collKey];
    if (!seed) return next(createError(400, "Unknown collection"));
    const settings = await ensureSettings(business);
    if (settings[collKey].length > 0) return next(createError(400, "Collection already has entries. Archive existing items first."));
    settings[collKey] = seed.map((s, i) => ({ _id: new mongoose.Types.ObjectId(), isActive: true, ...s, order: i }));
    await settings.save();
    res.json({ settings });
  } catch (err) { next(err); }
};

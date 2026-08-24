import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleSettings from "../models/SaleSettings.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";

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

export const addPropertyType    = makeAdd("propertyTypes");
export const updatePropertyType = makeUpdate("propertyTypes");
export const archivePropertyType = makeArchive("propertyTypes");

export const updateCommissionDefaults = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const settings = await ensureSettings(business);
    const { rate, commissionType, whtRate } = req.body;
    if (rate           != null) settings.commissionDefaults.rate           = Number(rate);
    if (commissionType != null) settings.commissionDefaults.commissionType = commissionType;
    if (whtRate        != null) settings.commissionDefaults.whtRate        = Number(whtRate);
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

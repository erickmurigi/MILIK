import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleProject, { PROJECT_STATUSES } from "../models/SaleProject.js";
import SaleListing from "../models/SaleListing.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleOffer from "../models/SaleOffer.js";
import SalePayment from "../models/SalePayment.js";
import SaleAgent from "../models/SaleAgent.js";
import {
  currentUserId, escapeRegex, generateSequentialNumber, reserveSequentialNumberBlock, resolveActiveBusinessId,
} from "../services/businessScope.js";
import { agentFilter } from "../middleware/agentScope.js";

const MAX_UNITS_PER_REQUEST = 500;
const MAX_UNITS_LISTED = 2000;
const DAY_MS = 86_400_000;
const NUMERIC_ORDER = { locale: "en", numericOrdering: true };
const UNIT_STATUSES = ["available", "reserved", "under_contract", "sold", "withdrawn"];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round1 = (n) => Math.round((Number(n) + Number.EPSILON) * 10) / 10;
const toObjectId = (v) => new mongoose.Types.ObjectId(String(v));
const optionalNumber = (v) => (v === "" || v == null ? null : Number(v));

// Fields an admin can set on a project (status only changes through archive, numbers only through the sequence)
const PROJECT_FIELDS = ["name", "description", "location", "town", "county", "country", "currency", "launchDate", "targetUnits", "targetValue", "notes"];

const pickProjectBody = (body = {}) => {
  const out = {};
  for (const key of PROJECT_FIELDS) if (key in body) out[key] = body[key];
  if ("name" in out) out.name = String(out.name ?? "").trim();
  if ("launchDate" in out) out.launchDate = out.launchDate || null;
  if ("targetUnits" in out) out.targetUnits = optionalNumber(out.targetUnits);
  if ("targetValue" in out) out.targetValue = optionalNumber(out.targetValue);
  return out;
};

const validateTargets = (data) => {
  for (const key of ["targetUnits", "targetValue"]) {
    if (data[key] != null && (!Number.isFinite(data[key]) || data[key] < 0)) return `${key === "targetUnits" ? "Target units" : "Target value"} must be a number of 0 or more`;
  }
  return null;
};

const findProject = (business, id) =>
  mongoose.isValidObjectId(String(id)) ? SaleProject.findOne({ _id: id, business }) : Promise.resolve(null);

const nameTaken = (business, name, exceptId) =>
  SaleProject.exists({
    business,
    name: new RegExp(`^${escapeRegex(name)}$`, "i"),
    ...(exceptId && { _id: { $ne: exceptId } }),
  });

// Unit counts and inventory value by status -> the figures shown on the project list and page
const summarise = (rows) => {
  const units = { total: 0, available: 0, reserved: 0, under_contract: 0, sold: 0, withdrawn: 0 };
  const value = { total: 0, sold: 0 };
  for (const r of rows) {
    units[r.status] = (units[r.status] || 0) + r.count;
    units.total += r.count;
    value.total += r.value;
    if (r.status === "sold") value.sold += r.value;
  }
  const sellable = units.total - units.withdrawn;
  return { units, value, sellThrough: sellable > 0 ? round1((units.sold / sellable) * 100) : 0 };
};

const statusRows = (business, projectIds) =>
  SaleListing.aggregate([
    { $match: { business: toObjectId(business), project: { $in: projectIds } } },
    { $group: { _id: { project: "$project", status: "$status" }, count: { $sum: 1 }, value: { $sum: "$askingPrice" } } },
  ]);

export const listProjects = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { search = "", status = "" } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    const filter = { business };
    if (PROJECT_STATUSES.includes(status)) filter.status = status;
    if (search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ name: rx }, { projectNumber: rx }, { location: rx }, { town: rx }];
    }

    const [projects, total] = await Promise.all([
      SaleProject.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SaleProject.countDocuments(filter),
    ]);

    const rows = projects.length ? await statusRows(business, projects.map((p) => p._id)) : [];
    const byProject = new Map();
    for (const r of rows) {
      const key = String(r._id.project);
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key).push({ status: r._id.status, count: r.count, value: r.value });
    }
    const data = projects.map((p) => ({ ...p, ...summarise(byProject.get(String(p._id)) || []) }));

    res.status(200).json({ data, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    next(err);
  }
};

// Sales performance of one project, derived from its units, deals and payments. In "own" visibility mode an agent's
// deal/payment figures cover only their own deals (unit counts stay shared, like listings).
const projectPerformance = async (req, business, project, units) => {
  const unitById = new Map(units.map((u) => [String(u._id), u]));
  const deals = units.length
    ? await SaleDeal.find({ business, listing: { $in: units.map((u) => u._id) }, status: { $in: ["active", "closed"] }, ...agentFilter(req) })
        .select("listing agent agreedPrice status dealDate actualClosingDate updatedAt")
        .lean()
    : [];

  const collectedRows = deals.length
    ? await SalePayment.aggregate([
        { $match: { business: toObjectId(business), status: "paid", deal: { $in: deals.map((d) => d._id) } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ])
    : [];

  let booked = 0, closedValue = 0, closedCount = 0, askingOfDealt = 0, daysSum = 0, daysCount = 0;
  const monthly = new Map();
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthly.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, { month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, booked: 0, bookedValue: 0, closed: 0, closedValue: 0 });
  }
  const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const agents = new Map();

  for (const d of deals) {
    const unit = unitById.get(String(d.listing));
    booked += d.agreedPrice;
    askingOfDealt += unit?.askingPrice || 0;

    const bookedAt = monthly.get(monthKey(new Date(d.dealDate || d.updatedAt)));
    if (bookedAt) { bookedAt.booked += 1; bookedAt.bookedValue += d.agreedPrice; }

    if (d.status === "closed") {
      closedCount += 1;
      closedValue += d.agreedPrice;
      const closedAt = new Date(d.actualClosingDate || d.updatedAt);
      const bucket = monthly.get(monthKey(closedAt));
      if (bucket) { bucket.closed += 1; bucket.closedValue += d.agreedPrice; }
      const listed = unit?.listedDate ? new Date(unit.listedDate) : null;
      if (listed && closedAt >= listed) { daysSum += (closedAt - listed) / DAY_MS; daysCount += 1; }
    }

    if (d.agent) {
      const key = String(d.agent);
      const row = agents.get(key) || { agent: d.agent, deals: 0, closed: 0, value: 0 };
      row.deals += 1;
      row.value += d.agreedPrice;
      if (d.status === "closed") row.closed += 1;
      agents.set(key, row);
    }
  }

  const agentDocs = agents.size ? await SaleAgent.find({ _id: { $in: [...agents.values()].map((a) => a.agent) } }).select("fullName agentNumber").lean() : [];
  const agentName = new Map(agentDocs.map((a) => [String(a._id), a]));
  const collected = collectedRows[0]?.total || 0;

  return {
    scoped: Boolean(req.saleAgentId),
    booked: round2(booked),
    collected: round2(collected),
    outstanding: round2(Math.max(0, booked - collected)),
    closedDeals: closedCount,
    closedValue: round2(closedValue),
    // agreed price as a share of asking price across the deals: below 100 means discounting
    priceRealisation: askingOfDealt > 0 ? round1((booked / askingOfDealt) * 100) : null,
    avgDaysToSell: daysCount > 0 ? Math.round(daysSum / daysCount) : null,
    monthly: [...monthly.values()].map((m) => ({ ...m, bookedValue: round2(m.bookedValue), closedValue: round2(m.closedValue) })),
    byAgent: [...agents.values()]
      .map((a) => ({ agent: agentName.get(String(a.agent)) || { _id: a.agent, fullName: "Unknown" }, deals: a.deals, closed: a.closed, value: round2(a.value) }))
      .sort((x, y) => y.value - x.value),
  };
};

export const getProject = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const project = await findProject(business, req.params.id);
    if (!project) return next(createError(404, "Project not found"));

    const units = await SaleListing.find({ business, project: project._id }).select("askingPrice listedDate status").lean();
    const rows = await statusRows(business, [project._id]);
    const summary = summarise(rows.map((r) => ({ status: r._id.status, count: r.count, value: r.value })));
    const performance = await projectPerformance(req, business, project, units);

    res.status(200).json({ ...project.toObject(), ...summary, performance });
  } catch (err) {
    next(err);
  }
};

export const createProject = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const data = pickProjectBody(req.body);
    if (!data.name) return next(createError(400, "Project name is required"));
    const targetError = validateTargets(data);
    if (targetError) return next(createError(400, targetError));
    if (await nameTaken(business, data.name)) return next(createError(409, "A project with this name already exists"));

    const projectNumber = await generateSequentialNumber(SaleProject, business, "PRJ");
    const project = await SaleProject.create({ ...data, business, projectNumber, createdBy: userId, updatedBy: userId });
    res.status(201).json({ ...project.toObject(), ...summarise([]) });
  } catch (err) {
    next(err);
  }
};

export const updateProject = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const data = pickProjectBody(req.body);
    if ("name" in data && !data.name) return next(createError(400, "Project name is required"));
    const targetError = validateTargets(data);
    if (targetError) return next(createError(400, targetError));

    const project = await findProject(business, req.params.id);
    if (!project) return next(createError(404, "Project not found"));
    if (data.name && (await nameTaken(business, data.name, project._id))) return next(createError(409, "A project with this name already exists"));

    project.set({ ...data, updatedBy: userId });
    await project.save();
    res.status(200).json(project.toObject());
  } catch (err) {
    next(err);
  }
};

export const setProjectArchived = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    if (typeof req.body?.archived !== "boolean") return next(createError(400, "archived must be true or false"));
    const project = await findProject(business, req.params.id);
    if (!project) return next(createError(404, "Project not found"));
    project.status = req.body.archived ? "archived" : "active";
    project.updatedBy = currentUserId(req);
    await project.save();
    res.status(200).json(project.toObject());
  } catch (err) {
    next(err);
  }
};

// True when any of these listings has an offer or a deal (so it can no longer be removed or moved)
const hasSalesActivity = async (business, listingIds) => {
  if (!listingIds.length) return false;
  const [offer, deal] = await Promise.all([
    SaleOffer.exists({ business, listing: { $in: listingIds } }),
    SaleDeal.exists({ business, listing: { $in: listingIds } }),
  ]);
  return Boolean(offer || deal);
};

export const deleteProject = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const project = await findProject(business, req.params.id);
    if (!project) return next(createError(404, "Project not found"));

    const units = await SaleListing.find({ business, project: project._id }).select("status").lean();
    const ids = units.map((u) => u._id);
    if (units.some((u) => !["available", "withdrawn"].includes(u.status)) || (await hasSalesActivity(business, ids))) {
      return next(createError(409, "This project has units with offers or deals — archive it instead of deleting it"));
    }
    if (ids.length) await SaleListing.deleteMany({ business, project: project._id, _id: { $in: ids } });
    await project.deleteOne();
    res.status(200).json({ message: "Project deleted", unitsDeleted: ids.length });
  } catch (err) {
    next(err);
  }
};

// All units of a project in one response (grid + table), naturally ordered ("2" before "10")
export const listProjectUnits = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const project = await findProject(business, req.params.id);
    if (!project) return next(createError(404, "Project not found"));

    const filter = { business, project: project._id };
    if (UNIT_STATUSES.includes(req.query.status)) filter.status = req.query.status;
    if (req.query.block) filter.block = String(req.query.block);

    const [data, total] = await Promise.all([
      SaleListing.find(filter)
        .select("listingNumber title unitNumber block propertyType size sizeUnit askingPrice status assignedAgent titleDeedAvailable")
        .populate("assignedAgent", "fullName agentNumber")
        .sort({ block: 1, unitNumber: 1 })
        .collation(NUMERIC_ORDER)
        .limit(MAX_UNITS_LISTED)
        .lean(),
      SaleListing.countDocuments(filter),
    ]);
    res.status(200).json({ data, total, truncated: total > data.length });
  } catch (err) {
    next(err);
  }
};

export const generateUnits = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const project = await findProject(business, req.params.id);
    if (!project) return next(createError(404, "Project not found"));
    if (project.status === "archived") return next(createError(400, "This project is archived — restore it before adding units"));

    const b = req.body || {};
    const from = Number(b.from);
    const to = Number(b.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) return next(createError(400, "Enter a valid unit range (from must be a whole number, and to must not be less than from)"));
    const count = to - from + 1;
    if (count > MAX_UNITS_PER_REQUEST) return next(createError(400, `You can generate at most ${MAX_UNITS_PER_REQUEST} units at a time`));
    const price = Number(b.askingPrice);
    if (b.askingPrice === "" || b.askingPrice == null || !Number.isFinite(price) || price < 0) return next(createError(400, "Asking price must be a number of 0 or more"));
    const pad = Math.min(Math.max(parseInt(b.pad, 10) || 0, 0), 6);
    const prefix = String(b.prefix ?? "").trim().slice(0, 20);
    const block = String(b.block ?? "").trim();

    if (b.assignedAgent) {
      const agent = await SaleAgent.findOne({ _id: b.assignedAgent, business, status: "active" }).select("_id").lean();
      if (!agent) return next(createError(400, "Assigned agent not found or inactive"));
    }

    const wanted = [];
    for (let n = from; n <= to; n++) wanted.push(`${prefix}${pad ? String(n).padStart(pad, "0") : n}`);

    // Units that already exist in this project are skipped, so re-running a range is safe
    const existing = await SaleListing.find({ business, project: project._id, unitNumber: { $in: wanted } }).select("unitNumber").lean();
    const taken = new Set(existing.map((e) => e.unitNumber));
    const toCreate = wanted.filter((u) => !taken.has(u));
    if (!toCreate.length) return res.status(200).json({ created: 0, skipped: wanted.length, requested: wanted.length });

    const base = {
      business,
      project: project._id,
      block,
      propertyType: String(b.propertyType || "plot").trim(),
      size: optionalNumber(b.size),
      sizeUnit: b.sizeUnit || "sqm",
      description: String(b.description ?? "").trim(),
      location: project.location,
      town: project.town,
      county: project.county,
      country: project.country,
      currency: project.currency,
      askingPrice: price,
      negotiable: b.negotiable !== false,
      titleDeedAvailable: b.titleDeedAvailable === true,
      assignedAgent: b.assignedAgent || null,
      createdBy: userId,
      updatedBy: userId,
    };
    // One schema check on a sample unit so a bad size unit or type gives a clear 400 instead of a silent skip
    const sample = new SaleListing({ ...base, listingNumber: "SAMPLE", title: "sample", unitNumber: toCreate[0] });
    const invalid = sample.validateSync();
    if (invalid) return next(createError(400, Object.values(invalid.errors)[0]?.message || "Invalid unit details"));

    const numbers = await reserveSequentialNumberBlock(business, "LST", toCreate.length);
    const docs = toCreate.map((unitNumber, i) => ({
      ...base,
      listingNumber: numbers[i],
      unitNumber,
      title: `${project.name} – ${unitNumber}`,
    }));

    let created = 0;
    try {
      created = (await SaleListing.insertMany(docs, { ordered: false })).length;
    } catch (err) {
      // A concurrent request may have created some of the same unit numbers: keep what was inserted
      if (err?.code === 11000 || err?.writeErrors) created = err.insertedDocs?.length ?? err.result?.insertedCount ?? 0;
      else throw err;
    }
    res.status(201).json({ created, skipped: wanted.length - created, requested: wanted.length });
  } catch (err) {
    next(err);
  }
};

// Group existing standalone listings into a project: items = [{ listingId, unitNumber, block? }]
export const assignUnits = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const project = await findProject(business, req.params.id);
    if (!project) return next(createError(404, "Project not found"));
    if (project.status === "archived") return next(createError(400, "This project is archived — restore it before adding units"));

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return next(createError(400, "Choose at least one listing"));
    if (items.length > MAX_UNITS_PER_REQUEST) return next(createError(400, `You can add at most ${MAX_UNITS_PER_REQUEST} listings at a time`));

    const errors = [];
    const numbers = items.map((it) => String(it?.unitNumber ?? "").trim());
    const existing = await SaleListing.find({ business, project: project._id, unitNumber: { $in: numbers.filter(Boolean) } }).select("unitNumber").lean();
    const taken = new Set(existing.map((e) => e.unitNumber));
    const listingIds = items.map((it) => it?.listingId).filter((id) => mongoose.isValidObjectId(String(id)));
    const standalone = new Set(
      (await SaleListing.find({ business, _id: { $in: listingIds }, project: null }).select("_id").lean()).map((l) => String(l._id))
    );

    const seen = new Set();
    const ops = [];
    items.forEach((it, i) => {
      const unitNumber = numbers[i];
      const listingId = String(it?.listingId ?? "");
      if (!standalone.has(listingId)) return errors.push({ listingId, error: "Listing not found or already in a project" });
      if (!unitNumber) return errors.push({ listingId, error: "Unit number is required" });
      if (taken.has(unitNumber) || seen.has(unitNumber)) return errors.push({ listingId, error: `Unit number ${unitNumber} is already used in this project` });
      seen.add(unitNumber);
      ops.push({
        updateOne: {
          filter: { _id: listingId, business, project: null },
          update: { $set: { project: project._id, unitNumber, block: String(it.block ?? "").trim() } },
        },
      });
    });

    let assigned = 0;
    if (ops.length) assigned = (await SaleListing.bulkWrite(ops, { ordered: false })).modifiedCount;
    res.status(200).json({ assigned, failed: errors });
  } catch (err) {
    next(err);
  }
};

// Take a unit out of its project (only while it has no offers or deals)
export const detachUnit = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const project = await findProject(business, req.params.id);
    if (!project) return next(createError(404, "Project not found"));
    const unit = mongoose.isValidObjectId(String(req.params.listingId))
      ? await SaleListing.findOne({ _id: req.params.listingId, business, project: project._id }).select("status").lean()
      : null;
    if (!unit) return next(createError(404, "Unit not found in this project"));
    if (!["available", "withdrawn"].includes(unit.status) || (await hasSalesActivity(business, [unit._id]))) {
      return next(createError(409, "This unit has offers or a deal — it can't be removed from the project"));
    }
    await SaleListing.updateOne({ _id: unit._id, business }, { $set: { project: null, unitNumber: "", block: "" } });
    res.status(200).json({ message: "Unit removed from the project" });
  } catch (err) {
    next(err);
  }
};

// Bulk price change on units that are still available (sold / reserved / under-contract units are never touched).
// mode: "percent" (value +5 or -10), "amount" (add/subtract), "set" (same price for all). Optional block filter.
export const updateUnitPrices = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const project = await findProject(business, req.params.id);
    if (!project) return next(createError(404, "Project not found"));

    const { mode, value, block } = req.body || {};
    const amount = Number(value);
    if (!["percent", "amount", "set"].includes(mode)) return next(createError(400, "mode must be percent, amount or set"));
    if (value === "" || value == null || !Number.isFinite(amount)) return next(createError(400, "Enter a valid number"));
    if (mode === "percent" && amount <= -100) return next(createError(400, "A percentage decrease must be less than 100%"));
    if (mode === "set" && amount < 0) return next(createError(400, "Price must be 0 or more"));

    const filter = { business, project: project._id, status: "available" };
    if (block) filter.block = String(block);
    const units = await SaleListing.find(filter).select("askingPrice").limit(MAX_UNITS_LISTED).lean();
    if (!units.length) return res.status(200).json({ updated: 0 });

    const next$ = (price) => {
      const raw = mode === "percent" ? price * (1 + amount / 100) : mode === "amount" ? price + amount : amount;
      return Math.max(0, round2(raw));
    };
    const ops = units
      .map((u) => ({ id: u._id, price: next$(u.askingPrice || 0), old: u.askingPrice }))
      .filter((u) => u.price !== u.old)
      .map((u) => ({
        // status is re-checked in the filter so a unit sold a moment ago is never re-priced
        updateOne: { filter: { _id: u.id, business, status: "available" }, update: { $set: { askingPrice: u.price, updatedBy: currentUserId(req) } } },
      }));
    const updated = ops.length ? (await SaleListing.bulkWrite(ops, { ordered: false })).modifiedCount : 0;
    res.status(200).json({ updated });
  } catch (err) {
    next(err);
  }
};

// Copy the project's location details onto its unsold units (after the project details were edited)
export const applyProjectDetails = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const project = await findProject(business, req.params.id);
    if (!project) return next(createError(404, "Project not found"));
    const result = await SaleListing.updateMany(
      { business, project: project._id, status: { $in: ["available", "withdrawn"] } },
      { $set: { location: project.location, town: project.town, county: project.county, country: project.country, currency: project.currency, updatedBy: currentUserId(req) } }
    );
    res.status(200).json({ updated: result.modifiedCount });
  } catch (err) {
    next(err);
  }
};

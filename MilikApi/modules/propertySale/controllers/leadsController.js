import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleLead   from "../models/SaleLead.js";
import SaleBuyer   from "../models/SaleBuyer.js";
import SaleOffer   from "../models/SaleOffer.js";
import SaleListing from "../models/SaleListing.js";
import SaleActivity from "../models/SaleActivity.js";
import Company from "../../../models/Company.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import { agentFilter } from "../middleware/agentScope.js";
import { sendAdHocSms, sendAdHocEmail } from "../../../services/communicationService.js";

// A converted lead carries its source onto the buyer as-is (sources are admin-configurable)
const buyerSourceFor = (source) => String(source || "").trim() || "other";

const fillPlaceholders = (text, vars) =>
  String(text || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

// Coerce empty strings to the types Mongoose expects, preventing CastErrors on ObjectId/Date/Number fields.
const sanitizeLeadBody = (body = {}) => ({
  ...body,
  assignedAgent:    body.assignedAgent    || null,
  nextFollowUpDate: body.nextFollowUpDate || null,
  lastContactDate:  body.lastContactDate  || null,
  budgetMin: body.budgetMin !== "" && body.budgetMin != null ? Number(body.budgetMin) || 0 : 0,
  budgetMax: body.budgetMax !== "" && body.budgetMax != null ? Number(body.budgetMax) || 0 : 0,
  interestedListings: Array.isArray(body.interestedListings)
    ? body.interestedListings.filter(Boolean)
    : [],
});

export const listLeads = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { search = "", status = "", source = "", agent = "", overdueOnly = "", createdFrom = "", createdTo = "", page = 1, limit = 50 } = req.query;
    const pageNum  = Math.max(parseInt(page,  10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);

    const filter = { business };
    if (status) filter.status = status;
    if (source) filter.source = source;
    if (req.saleAgentId) filter.assignedAgent = req.saleAgentId;
    else if (agent) filter.assignedAgent = agent;
    if (overdueOnly === "1") {
      filter.nextFollowUpDate = { $lt: new Date() };
      if (!status) filter.status = { $nin: ["converted", "lost"] };
    }
    if (createdFrom || createdTo) {
      filter.createdAt = {};
      if (createdFrom) filter.createdAt.$gte = new Date(createdFrom);
      if (createdTo)   filter.createdAt.$lte = new Date(new Date(createdTo).setHours(23, 59, 59, 999));
    }
    if (search.trim()) filter.$text = { $search: search.trim() };

    const [leads, total] = await Promise.all([
      SaleLead.find(filter)
        .populate("assignedAgent", "fullName")
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      SaleLead.countDocuments(filter),
    ]);

    res.status(200).json({ data: leads, total, page: pageNum, pages: Math.ceil(total / limitNum) || 1 });
  } catch (err) { next(err); }
};

export const getPipeline = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    // aggregate() does not auto-cast — business must be an ObjectId to match stored documents
    const pipeline = await SaleLead.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(business)), ...(req.saleAgentId && { assignedAgent: new mongoose.Types.ObjectId(String(req.saleAgentId)) }) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.status(200).json({ pipeline });
  } catch (err) { next(err); }
};

export const getLead = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const lead = await SaleLead.findOne({ _id: req.params.id, business, ...agentFilter(req, "assignedAgent") })
      .populate("assignedAgent",     "fullName phone")
      .populate("interestedListings","listingNumber title")
      .populate("convertedBuyer",    "buyerNumber fullName")
      .lean();
    if (!lead) return next(createError(404, "Lead not found"));
    res.status(200).json(lead);
  } catch (err) { next(err); }
};

export const createLead = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const leadNumber = await generateSequentialNumber(SaleLead, business, "LDR");
    // Agent-scoped users can only create leads assigned to themselves
    const body = sanitizeLeadBody(req.body);
    if (req.saleAgentId) body.assignedAgent = req.saleAgentId;
    const lead = await SaleLead.create({ ...body, business, leadNumber, createdBy: userId, updatedBy: userId });
    res.status(201).json(lead);
  } catch (err) { next(err); }
};

export const updateLead = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const { business: _b, leadNumber: _n, createdBy: _c, convertedBuyer: _cv, convertedAt: _ca, ...rawUpdates } = req.body;
    // Only touch fields the client actually sent: sanitizeLeadBody fills defaults for absent fields,
    // which would otherwise wipe assignedAgent, budgets, follow-up dates and interested listings on a partial update.
    const sanitized = sanitizeLeadBody(rawUpdates);
    const updates = Object.fromEntries(Object.entries(sanitized).filter(([k]) => k in rawUpdates));
    // Agent-scoped users cannot reassign a lead to another agent
    if (req.saleAgentId) delete updates.assignedAgent;
    // "converted" status must go through /convert (which creates the buyer record)
    if (updates.status === "converted") delete updates.status;
    // A lead that already has a buyer keeps its "converted" status — unlinking happens only via
    // buyersController.deleteBuyer, which resets the lead itself.
    if (updates.status !== undefined) {
      const current = await SaleLead.findOne({ _id: req.params.id, business, ...agentFilter(req, "assignedAgent") }).select("status convertedBuyer").lean();
      if (!current) return next(createError(404, "Lead not found"));
      if (current.convertedBuyer) {
        if (updates.status !== current.status) {
          return next(createError(400, "This lead has already been converted to a buyer — its status can no longer be changed"));
        }
        delete updates.status;
      }
    }
    const lead = await SaleLead.findOneAndUpdate(
      { _id: req.params.id, business, ...agentFilter(req, "assignedAgent") },
      { ...updates, updatedBy: userId },
      { new: true, runValidators: true }
    ).populate("assignedAgent", "fullName").lean();
    if (!lead) return next(createError(404, "Lead not found"));
    res.status(200).json(lead);
  } catch (err) { next(err); }
};

export const deleteLead = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const lead = await SaleLead.findOne({ _id: req.params.id, business, ...agentFilter(req, "assignedAgent") });
    if (!lead) return next(createError(404, "Lead not found"));
    if (lead.status === "converted") return next(createError(400, "Cannot delete a converted lead"));
    await Promise.all([
      lead.deleteOne(),
      SaleActivity.deleteMany({ business, relatedLead: lead._id }),
    ]);
    res.status(200).json({ message: "Lead deleted" });
  } catch (err) { next(err); }
};

// Atomically claims a lead for conversion (compare-and-set on `extraFilter`). Returns the lead's previous
// state (for rollback) or null when another request got there first. Only one concurrent caller can win,
// so only one buyer is ever created per lead.
const claimLeadForConversion = (business, leadId, userId, extraFilter) =>
  SaleLead.findOneAndUpdate(
    { _id: leadId, business, ...extraFilter },
    { $set: { status: "converted", convertedAt: new Date(), convertedBuyer: null, updatedBy: userId } },
    { new: false }
  ).select("status convertedAt convertedBuyer updatedBy").lean();

const revertLeadClaim = (business, previous) =>
  SaleLead.updateOne(
    { _id: previous._id, business },
    {
      $set: {
        status: previous.status,
        convertedAt: previous.convertedAt ?? null,
        convertedBuyer: previous.convertedBuyer ?? null,
        updatedBy: previous.updatedBy ?? null,
      },
    }
  );

export const convertLead = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    // Claim first: only the request that flips the lead to "converted" may create the buyer.
    const previous = await claimLeadForConversion(business, req.params.id, userId, { status: { $ne: "converted" }, ...agentFilter(req, "assignedAgent") });
    if (!previous) {
      const exists = await SaleLead.exists({ _id: req.params.id, business, ...agentFilter(req, "assignedAgent") });
      return next(exists ? createError(400, "Lead is already converted") : createError(404, "Lead not found"));
    }

    let buyer = null;
    try {
      const lead = await SaleLead.findOne({ _id: req.params.id, business, ...agentFilter(req, "assignedAgent") }).lean();
      const { idNumber = "" } = req.body;
      const buyerNumber = await generateSequentialNumber(SaleBuyer, business, "BYR");
      buyer = await SaleBuyer.create({
        business,
        buyerNumber,
        fullName:   lead.fullName,
        phone:      lead.phone,
        email:      lead.email,
        source:     buyerSourceFor(lead.source),
        idNumber,
        notes:      lead.notes,
        kycStatus:  "pending",
        createdBy:  userId,
        updatedBy:  userId,
      });

      await SaleLead.updateOne({ _id: lead._id, business }, { $set: { convertedBuyer: buyer._id } });
    } catch (err) {
      // Roll the claim back so the lead can be converted again
      if (buyer) await SaleBuyer.deleteOne({ _id: buyer._id, business }).catch(() => {});
      await revertLeadClaim(business, previous).catch(() => {});
      throw err;
    }

    res.status(200).json({ message: "Lead converted to buyer", buyer });
  } catch (err) { next(err); }
};

export const sendLeadSms = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const lead = await SaleLead.findOne({ _id: req.params.id, business, ...agentFilter(req, "assignedAgent") }).lean();
    if (!lead) return next(createError(404, "Lead not found"));
    const phone = String(req.body.phone || lead.phone || "").trim();
    const body  = String(req.body.body  || "").trim();
    if (!phone) return next(createError(400, "Lead has no phone number"));
    if (!body)  return next(createError(400, "Message body is required"));
    await sendAdHocSms({ businessId: business, phone, body, templateKey: "sale_lead_manual" });
    res.json({ success: true, message: "SMS sent" });
  } catch (err) { next(err); }
};

export const sendLeadEmail = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const [lead, company] = await Promise.all([
      SaleLead.findOne({ _id: req.params.id, business, ...agentFilter(req, "assignedAgent") }).populate("assignedAgent", "fullName").lean(),
      Company.findById(business).select("companyName name phoneNo email").lean(),
    ]);
    if (!lead) return next(createError(404, "Lead not found"));
    const to      = String(req.body.to      || lead.email || "").trim();
    const subject = String(req.body.subject || "").trim();
    const body    = String(req.body.body    || "").trim();
    if (!to)      return next(createError(400, "Lead has no email address"));
    if (!subject) return next(createError(400, "Email subject is required"));
    if (!body)    return next(createError(400, "Email body is required"));
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "";
    const fmtNum  = (n) => n != null ? Number(n).toLocaleString() : "";
    const vars = {
      leadName:         lead.fullName               || "",
      leadNumber:       lead.leadNumber             || "",
      phone:            lead.phone                  || "",
      email:            lead.email                  || "",
      source:           lead.source                 || "",
      status:           lead.status                 || "",
      budgetMin:        fmtNum(lead.budgetMin),
      budgetMax:        fmtNum(lead.budgetMax),
      nextFollowUpDate: fmtDate(lead.nextFollowUpDate),
      lastContactDate:  fmtDate(lead.lastContactDate),
      assignedAgent:    lead.assignedAgent?.fullName || "",
      notes:            lead.notes                  || "",
      companyName:      company?.companyName || company?.name || "",
      companyPhone:     company?.phoneNo             || "",
      companyEmail:     company?.email               || "",
    };
    await sendAdHocEmail({
      businessId: business,
      to,
      subject: fillPlaceholders(subject, vars),
      bodyText: fillPlaceholders(body, vars),
    });
    res.json({ success: true, message: "Email sent" });
  } catch (err) { next(err); }
};

// Fully convert a lead → buyer + offer in one action
export const convertLeadToOffer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const { listing: listingId, offerAmount, validityDate, agent, notes, idNumber = "" } = req.body;
    if (!listingId)  return next(createError(400, "Listing is required"));
    if (!offerAmount) return next(createError(400, "Offer amount is required"));
    const amount = Number(offerAmount);
    if (!Number.isFinite(amount) || amount < 0) return next(createError(400, "Offer amount must be a valid non-negative number"));

    const [lead, listing] = await Promise.all([
      SaleLead.findOne({ _id: req.params.id, business, ...agentFilter(req, "assignedAgent") }).lean(),
      SaleListing.findOne({ _id: listingId, business }).lean(),
    ]);
    if (!lead) return next(createError(404, "Lead not found"));
    if (!listing) return next(createError(400, "Listing not found"));
    if (!["available", "reserved"].includes(listing.status)) {
      return next(createError(400, `Cannot create an offer on a ${listing.status} listing`));
    }

    // Reuse existing buyer if lead was already converted, otherwise create one
    let buyer = lead.convertedBuyer
      ? await SaleBuyer.findOne({ _id: lead.convertedBuyer, business }).lean()
      : null;

    // Race-safe buyer creation: claim the lead atomically first. If the lead already points at a
    // (now missing) buyer, the claim is a compare-and-set on that stale pointer.
    let previous = null;
    if (!buyer) {
      previous = await claimLeadForConversion(
        business, lead._id, userId,
        lead.convertedBuyer ? { convertedBuyer: lead.convertedBuyer } : { status: { $ne: "converted" }, convertedBuyer: null }
      );
      if (!previous) {
        // Lost the race — another request is (or has finished) converting this lead; reuse its buyer if it's ready
        const fresh = await SaleLead.findOne({ _id: lead._id, business }).select("convertedBuyer").lean();
        buyer = fresh?.convertedBuyer ? await SaleBuyer.findOne({ _id: fresh.convertedBuyer, business }).lean() : null;
        if (!buyer) return next(createError(409, "This lead is being converted by another request — please try again"));
      }
    }

    let createdBuyerId = null;
    let offer = null;
    try {
      if (previous) {
        const buyerNumber = await generateSequentialNumber(SaleBuyer, business, "BYR");
        buyer = await SaleBuyer.create({
          business, buyerNumber,
          fullName: lead.fullName, phone: lead.phone, email: lead.email,
          source: buyerSourceFor(lead.source), idNumber, notes: lead.notes,
          kycStatus: "pending", createdBy: userId, updatedBy: userId,
        });
        createdBuyerId = buyer._id;
        await SaleLead.updateOne({ _id: lead._id, business }, { $set: { convertedBuyer: buyer._id } });
      } else {
        // Existing buyer reused — make sure the lead still reads as converted
        await SaleLead.updateOne({ _id: lead._id, business, status: { $ne: "converted" } }, { $set: { status: "converted", updatedBy: userId } });
      }

      const offerNumber = await generateSequentialNumber(SaleOffer, business, "OFR");
      offer = await SaleOffer.create({
        business, offerNumber,
        listing: listingId,
        buyer:   buyer._id,
        agent:   agent || null,
        offerAmount: amount,
        validityDate: validityDate || null,
        notes: notes || "",
        status: "pending",
        createdBy: userId, updatedBy: userId,
      });

      // Mark listing reserved if still available (conditional so a concurrent status change isn't clobbered)
      if (listing.status === "available") {
        await SaleListing.updateOne({ _id: listingId, business, status: "available" }, { $set: { status: "reserved" } });
      }
    } catch (err) {
      // Undo everything this request created so the lead can be converted again
      if (offer) await SaleOffer.deleteOne({ _id: offer._id, business }).catch(() => {});
      if (createdBuyerId) await SaleBuyer.deleteOne({ _id: createdBuyerId, business }).catch(() => {});
      if (previous) await revertLeadClaim(business, previous).catch(() => {});
      throw err;
    }

    const populated = await SaleOffer.findById(offer._id)
      .populate("listing", "title listingNumber propertyType askingPrice")
      .populate("buyer", "fullName buyerNumber phone")
      .populate("agent", "fullName agentNumber")
      .lean();

    res.status(201).json({ message: "Lead converted to offer", offer: populated, buyer });
  } catch (err) { next(err); }
};

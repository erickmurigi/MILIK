import { createError } from "../../../utils/error.js";
import ClientInteraction from "../models/ClientInteraction.js";
import Client from "../models/Client.js";
import { resolveActiveBusinessId, currentUserId } from "../services/businessScope.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const ALLOWED_TYPES = ["email", "note", "call", "meeting", "sms"];

// ─── Controllers ─────────────────────────────────────────────────────────────

export const listInteractions = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter   = { business };

    if (req.query.clientId) filter.client = String(req.query.clientId).trim();
    if (req.query.type && ALLOWED_TYPES.includes(req.query.type)) {
      filter.type = req.query.type;
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 200);
    const page  = Math.max(Number(req.query.page || 1), 1);
    const skip  = (page - 1) * limit;

    const [interactions, total] = await Promise.all([
      ClientInteraction.find(filter)
        .populate("client", "name clientCode")
        .populate("createdBy", "username name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ClientInteraction.countDocuments(filter),
    ]);

    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { interactions, pagination }, interactions, pagination });
  } catch (error) {
    next(error);
  }
};

export const createInteraction = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const type = String(req.body.type || "").trim();
    if (!ALLOWED_TYPES.includes(type)) {
      return next(createError(400, `Invalid interaction type. Must be one of: ${ALLOWED_TYPES.join(", ")}`));
    }

    const clientId = String(req.body.client || "").trim();
    if (!clientId) return next(createError(400, "Client is required"));

    const clientExists = await Client.exists({ _id: clientId, business });
    if (!clientExists) return next(createError(404, "Client not found"));

    const interaction = await ClientInteraction.create({
      business,
      client:          clientId,
      type,
      subject:         String(req.body.subject || "").trim(),
      body:            String(req.body.body    || "").trim(),
      relatedInvoice:  String(req.body.relatedInvoice  || "").trim() || null,
      relatedContract: String(req.body.relatedContract || "").trim() || null,
      emailStatus:     ["sent", "failed", "pending"].includes(req.body.emailStatus)
        ? req.body.emailStatus
        : "pending",
      createdBy: userId,
    });

    res.status(201).json({
      success: true,
      data:    interaction,
      interaction,
      message: "Interaction logged",
    });
  } catch (error) {
    next(error);
  }
};

export const deleteInteraction = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);

    const interaction = await ClientInteraction.findOne({ _id: req.params.id, business });
    if (!interaction) return next(createError(404, "Interaction not found"));

    await ClientInteraction.deleteOne({ _id: interaction._id, business });
    res.status(200).json({ success: true, message: "Interaction deleted" });
  } catch (error) {
    next(error);
  }
};

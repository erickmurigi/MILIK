// Portal-ready, client-scoped read endpoints.
//
// Scope comes from `req.clientPortal = { business, client }` when a future
// client-portal token middleware has set it (the client id in the URL is
// then ignored, so a portal user can only ever see their own data); for
// staff sessions it comes from the active company + :clientId.
import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import Client from "../models/Client.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";
import {
  getPortalSummary,
  getPortalInvoices,
  getPortalStatement,
  getPortalReceipts,
  getPortalContracts,
} from "../services/clientPortalService.js";

export const resolvePortalScope = async (req) => {
  if (req.clientPortal?.business && req.clientPortal?.client) {
    return { business: String(req.clientPortal.business), clientId: String(req.clientPortal.client) };
  }
  const business = resolveActiveBusinessId(req);
  const clientId = req.params.clientId;
  if (!mongoose.Types.ObjectId.isValid(String(clientId || ""))) throw createError(400, "Invalid client id");
  const exists = await Client.exists({ _id: clientId, business });
  if (!exists) throw createError(404, "Client not found");
  return { business, clientId: String(clientId) };
};

const handler = (load) => async (req, res, next) => {
  try {
    const scope = await resolvePortalScope(req);
    res.status(200).json({ success: true, data: await load(scope, req.query) });
  } catch (error) {
    next(error);
  }
};

export const portalSummary = handler((scope) => getPortalSummary(scope));
export const portalInvoices = handler((scope, q) => getPortalInvoices({ ...scope, status: q.status || null, page: q.page, limit: q.limit }));
export const portalStatement = handler((scope, q) => getPortalStatement({ ...scope, from: q.from || null, to: q.to || null }));
export const portalReceipts = handler((scope, q) => getPortalReceipts({ ...scope, page: q.page, limit: q.limit }));
export const portalContracts = handler((scope) => getPortalContracts(scope));

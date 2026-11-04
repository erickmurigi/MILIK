import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import { logAuditEvent } from "../../../utils/auditLogger.js";
import ClientBillingRun from "../models/ClientBillingRun.js";
import CompanySettings from "../../../models/CompanySettings.js";
import { resolveActiveBusinessId, currentUserId } from "../services/businessScope.js";
import { buildBillingProposal, runBilling } from "../services/clientBillingService.js";
import { CLIENT_BILLING_DEFAULTS, getClientBillingSettings } from "../services/clientContractService.js";
import { listClientTaxCodes, getClientTaxContext } from "../services/clientTaxService.js";

const SCOPES = ["all", "client", "contract"];

const readRunParams = (src = {}) => {
  const scope = SCOPES.includes(src.scope) ? src.scope : "all";
  return {
    period: src.period ? String(src.period) : "",
    asOf: src.asOf || null,
    scope,
    scopeId: scope === "client" ? src.clientId || src.scopeId : scope === "contract" ? src.contractId || src.scopeId : null,
    groupBy: src.groupBy === "contract" ? "contract" : "client",
    issueDate: src.issueDate || null,
  };
};

// GET /api/clients/billing/preview — what a run would raise right now. Read-only.
export const previewBillingRun = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const proposal = await buildBillingProposal({ business, ...readRunParams(req.query) });
    res.status(200).json({ success: true, data: proposal, ...proposal });
  } catch (error) {
    next(error);
  }
};

// POST /api/clients/billing/run
export const executeBillingRun = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const postAsDraft = req.body?.postAsDraft === undefined ? null : req.body.postAsDraft === true || req.body.postAsDraft === "true";
    const run = await runBilling({ business, ...readRunParams(req.body || {}), postAsDraft, userId: currentUserId(req), triggeredBy: "manual", req });
    res.status(201).json({ success: true, data: run, run });
  } catch (error) {
    next(error);
  }
};

export const listBillingRuns = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 200);
    const page = Math.max(Number(req.query.page || 1), 1);
    const [runs, total] = await Promise.all([
      ClientBillingRun.find({ business }).populate("runBy", "surname otherNames").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ClientBillingRun.countDocuments({ business }),
    ]);
    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { runs, pagination }, runs, pagination });
  } catch (error) {
    next(error);
  }
};

export const getBillingRun = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const run = await ClientBillingRun.findOne({ _id: req.params.id, business })
      .populate("runBy", "surname otherNames")
      .populate({ path: "invoices", select: "invoiceNumber client total status", populate: { path: "client", select: "name clientCode" } })
      .lean();
    if (!run) return next(createError(404, "Billing run not found"));
    res.status(200).json({ success: true, data: run, run });
  } catch (error) {
    next(error);
  }
};

// ─── Settings (CompanySettings.clientBilling) ────────────────────────────────

export const getBillingSettings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const [settings, taxCtx] = await Promise.all([getClientBillingSettings(business), getClientTaxContext(business)]);
    res.status(200).json({ success: true, data: { settings, taxCodes: listClientTaxCodes(taxCtx), defaultTaxCodeKey: taxCtx.defaultCodeKey } });
  } catch (error) {
    next(error);
  }
};

const nullableNumber = (v, { min = 0, max = Infinity } = {}) => {
  if (v === null || v === "" || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw createError(400, `Value ${v} is out of range`);
  return n;
};

export const updateBillingSettings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const body = req.body || {};
    const $set = {};
    const put = (key, value) => { $set[`clientBilling.${key}`] = value; };
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

    if (has("approvalThreshold")) put("approvalThreshold", nullableNumber(body.approvalThreshold));
    if (has("maxDiscountWithoutApproval")) put("maxDiscountWithoutApproval", nullableNumber(body.maxDiscountWithoutApproval, { max: 100 }));
    for (const flag of ["escalationRequiresApproval", "billingRunPostsAsDraft"]) if (has(flag)) put(flag, body[flag] === true || body[flag] === "true");
    if (has("defaultPaymentTermsDays")) put("defaultPaymentTermsDays", nullableNumber(body.defaultPaymentTermsDays) ?? 30);
    for (const prefix of ["invoicePrefix", "creditNotePrefix", "debitNotePrefix", "quotePrefix"]) {
      if (has(prefix)) {
        const value = String(body[prefix] || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!value || value.length > 8) throw createError(400, `${prefix} must be 1-8 letters/digits`);
        put(prefix, value);
      }
    }
    for (const text of ["invoiceTerms", "mpesaPaybill"]) if (has(text)) put(text, String(body[text] || "").trim());
    if (has("bankDetails") && body.bankDetails && typeof body.bankDetails === "object") {
      for (const k of ["bankName", "branch", "accountName", "accountNumber", "swiftCode"]) {
        if (Object.prototype.hasOwnProperty.call(body.bankDetails, k)) put(`bankDetails.${k}`, String(body.bankDetails[k] || "").trim());
      }
    }
    if (!Object.keys($set).length) return next(createError(400, "No billing settings to update"));

    await CompanySettings.updateOne({ company: new mongoose.Types.ObjectId(String(business)) }, { $set }, { upsert: true });
    const settings = await getClientBillingSettings(business);
    await logAuditEvent({
      req, company: business, action: "client_billing.settings_updated", category: "finance",
      message: "Contract billing settings updated", metadata: { changes: $set },
    });
    res.status(200).json({ success: true, data: { settings: { ...CLIENT_BILLING_DEFAULTS, ...settings } } });
  } catch (error) {
    next(error);
  }
};

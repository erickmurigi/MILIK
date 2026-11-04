// KRA eTIMS settings, connection test, submit/resubmit and submission log.
import { createError } from "../../../utils/error.js";
import { logAuditEvent } from "../../../utils/auditLogger.js";
import { emitToCompany } from "../../../utils/socketManager.js";
import { resolveActiveBusinessId, currentUserId } from "../services/businessScope.js";
import {
  getEtimsSettings,
  updateEtimsSettings,
  testEtimsConnection,
  submitInvoice,
  submitCreditNote,
  listEtimsSubmissions,
} from "../services/etimsService.js";

const audit = (req, business, action, targetType, targetId, targetName, message, metadata = {}) =>
  logAuditEvent({ req, company: business, action, category: "finance", targetType, targetId, targetName, message, metadata });

export const getSettings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    res.status(200).json({ success: true, data: await getEtimsSettings(business) });
  } catch (error) {
    next(error);
  }
};

export const updateSettings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const settings = await updateEtimsSettings({ business, input: req.body || {}, userId: currentUserId(req) });
    // Never log the device key itself.
    const fields = Object.keys(req.body || {}).filter((k) => k !== "cmcKey");
    audit(req, business, "client.etims.settings_updated", "ClientEtimsSettings", settings._id, "eTIMS settings", `eTIMS settings updated (enabled: ${settings.enabled})`, { fields, cmcKeyChanged: Boolean(req.body?.cmcKey) });
    res.status(200).json({ success: true, data: settings, message: "eTIMS settings saved" });
  } catch (error) {
    next(error);
  }
};

export const testConnection = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    res.status(200).json({ success: true, data: await testEtimsConnection({ business }) });
  } catch (error) {
    next(error);
  }
};

const submitHandler = (kind) => async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const force = req.body?.force === true;
    const result = kind === "invoice"
      ? await submitInvoice({ business, invoiceId: req.params.id, userId, force })
      : await submitCreditNote({ business, noteId: req.params.id, userId, force });
    if (!result.skipped) {
      const number = result.submission?.documentNumber || req.params.id;
      audit(req, business, `client.etims.${kind}_submitted`, "EtimsSubmission", result.submission?._id, number, `eTIMS submission for ${number}: ${result.submitted ? "accepted" : result.alreadySubmitted ? "already accepted" : result.inProgress ? "in progress" : "failed"}`, { resultCode: result.submission?.resultCode || "", error: result.error || "" });
      emitToCompany(business, "clientEtims:updated", { documentType: kind, documentId: req.params.id, status: result.submission?.status });
    }
    if (result.submitted === false && !result.exhausted) return next(createError(502, `eTIMS rejected the document: ${result.error || "unknown error"}`));
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const submitInvoiceToEtims = submitHandler("invoice");
export const submitCreditNoteToEtims = submitHandler("credit_note");

export const listSubmissions = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const status = ["pending", "processing", "submitted", "failed", "skipped"].includes(req.query.status) ? req.query.status : null;
    const documentType = ["invoice", "credit_note"].includes(req.query.documentType) ? req.query.documentType : null;
    const data = await listEtimsSubmissions({ business, status, documentType, page: req.query.page, limit: req.query.limit });
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

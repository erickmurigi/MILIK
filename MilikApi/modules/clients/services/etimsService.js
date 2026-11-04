/**
 * eTIMS submission orchestration: settings, idempotent submit/resubmit of
 * invoices and credit notes, retries with exponential backoff.
 *
 * Disabled (the default) = every call is a no-op returning { skipped: true },
 * so billing never depends on KRA being reachable. One EtimsSubmission per
 * document; a document is claimed (status → processing) before calling KRA so
 * two concurrent submits can't both sign it, and its eTIMS invoice number is
 * fixed on first attempt so retries reuse it.
 */
import { createError } from "../../../utils/error.js";
import { encryptStoredSecret, decryptStoredSecret } from "../../../utils/smtpMailer.js";
import Company from "../../../models/Company.js";
import Client from "../models/Client.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientCreditNote from "../models/ClientCreditNote.js";
import ClientEtimsSettings from "../models/ClientEtimsSettings.js";
import EtimsSubmission from "../models/EtimsSubmission.js";
import { nextEtimsInvoiceNo } from "./clientSequenceService.js";
import { buildEtimsSalesPayload, buildEtimsQrUrl, createOscuProvider } from "./etimsOscuProvider.js";

const STALE_PROCESSING_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MINUTES = 6 * 60;

export const backoffMinutes = (attempts) => Math.min(MAX_BACKOFF_MINUTES, 2 ** Math.max(0, attempts - 1));

const SETTINGS_FIELDS = ["enabled", "environment", "baseUrl", "kraPin", "branchId", "deviceSerial", "defaultItemClassCode", "defaultItemCode", "defaultQtyUnitCode", "defaultPkgUnitCode", "maxAttempts"];

// Never hand the device key back to the browser.
const publicSettings = (doc) => {
  if (!doc) return { enabled: false, environment: "sandbox", cmcKeyConfigured: false };
  const { cmcKeyEncrypted, ...rest } = doc;
  return { ...rest, cmcKeyConfigured: Boolean(cmcKeyEncrypted) };
};

export const getEtimsSettings = async (business) =>
  publicSettings(await ClientEtimsSettings.findOne({ business }).lean());

export const updateEtimsSettings = async ({ business, input = {}, userId = null }) => {
  const $set = { updatedBy: userId };
  for (const field of SETTINGS_FIELDS) {
    if (input[field] === undefined) continue;
    $set[field] = field === "enabled" ? Boolean(input[field]) : field === "maxAttempts" ? Number(input[field]) : String(input[field] ?? "").trim();
  }
  if ($set.environment && !["sandbox", "production"].includes($set.environment)) throw createError(400, "environment must be sandbox or production");
  if ($set.kraPin && !/^[A-Z]\d{9}[A-Z]$/i.test($set.kraPin)) throw createError(400, "Invalid KRA PIN");
  if (typeof input.cmcKey === "string" && input.cmcKey.trim()) $set.cmcKeyEncrypted = encryptStoredSecret(input.cmcKey.trim());
  const doc = await ClientEtimsSettings.findOneAndUpdate({ business }, { $set, $setOnInsert: { business } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }).lean();
  if (doc.enabled && (!doc.kraPin || !doc.deviceSerial)) {
    await ClientEtimsSettings.updateOne({ _id: doc._id }, { $set: { enabled: false } });
    throw createError(400, "KRA PIN and device serial are required before eTIMS can be enabled");
  }
  return publicSettings(doc);
};

const providerFor = (settings, override) =>
  override ||
  createOscuProvider({
    baseUrl: settings.baseUrl,
    environment: settings.environment,
    kraPin: settings.kraPin,
    branchId: settings.branchId,
    deviceSerial: settings.deviceSerial,
    cmcKey: settings.cmcKeyEncrypted ? decryptStoredSecret(settings.cmcKeyEncrypted) : "",
  });

export const testEtimsConnection = async ({ business, provider = null }) => {
  const settings = await ClientEtimsSettings.findOne({ business }).lean();
  if (!settings?.enabled) return { skipped: true, reason: "eTIMS is disabled for this company" };
  const client = providerFor(settings, provider);
  try {
    const init = await client.initialize();
    const info = init?.data?.info || {};
    const $set = { lastInitializedAt: new Date() };
    if (info.sdcId) $set.sdcId = String(info.sdcId);
    if (info.mrcNo) $set.mrcNo = String(info.mrcNo);
    // OSCU hands the device its CMC key on first initialisation.
    if (info.cmcKey && !settings.cmcKeyEncrypted) $set.cmcKeyEncrypted = encryptStoredSecret(String(info.cmcKey));
    await ClientEtimsSettings.updateOne({ _id: settings._id }, { $set });
    return { ok: true, sdcId: $set.sdcId || settings.sdcId || "", mrcNo: $set.mrcNo || settings.mrcNo || "", resultMsg: init?.resultMsg || "" };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), resultCd: err?.resultCd || "" };
  }
};

// ─── Document loaders: invoice / credit note → payload inputs ────────────────

const loadInvoiceDocument = async ({ business, documentId }) => {
  const invoice = await ClientInvoice.findOne({ _id: documentId, business }).lean();
  if (!invoice) throw createError(404, "Invoice not found");
  if (["draft", "cancelled"].includes(invoice.status)) throw createError(400, `A ${invoice.status} invoice cannot be sent to eTIMS`);
  return { document: invoice, number: invoice.invoiceNumber, clientId: invoice.client, receiptType: "S", orgInvcNo: 0, remark: invoice.notes || "" };
};

const loadCreditNoteDocument = async ({ business, documentId }) => {
  const note = await ClientCreditNote.findOne({ _id: documentId, business }).lean();
  if (!note) throw createError(404, "Credit note not found");
  if (note.noteType !== "CREDIT_NOTE") throw createError(400, "Only credit notes are submitted as eTIMS refunds; a debit note is a new sale invoice");
  if (note.status !== "posted") throw createError(400, "Only posted credit notes can be sent to eTIMS");
  const original = await EtimsSubmission.findOne({ business, documentType: "invoice", documentId: note.invoice, status: "submitted" }).select("etimsInvoiceNo").lean();
  if (!original?.etimsInvoiceNo) throw createError(400, "The original invoice has not been accepted by eTIMS yet — submit it first");
  // Note lines carry net/tax/total already; present them as line-tax items.
  const document = {
    noteDate: note.noteDate,
    issueDate: note.noteDate,
    taxCalculation: "line",
    lineItems: (note.lines || []).map((l) => ({
      description: l.description, quantity: l.quantity || 1, amount: l.netAmount, taxAmount: l.taxAmount, totalAmount: l.totalAmount,
      taxType: l.taxType, taxRate: l.taxRate,
    })),
  };
  return { document, number: note.noteNumber, clientId: note.client, receiptType: "R", orgInvcNo: original.etimsInvoiceNo, remark: note.reason || "" };
};

const LOADERS = { invoice: loadInvoiceDocument, credit_note: loadCreditNoteDocument };

const recordOutcomeOnDocument = async ({ documentType, documentId, business, set }) => {
  if (documentType !== "invoice") return;
  // Targeted field update; these are not immutable invoice fields.
  await ClientInvoice.updateOne({ _id: documentId, business }, { $set: set });
};

/**
 * Submits one document. Returns { skipped } when disabled, { alreadySubmitted }
 * when KRA already signed it, { inProgress } when another worker holds it,
 * otherwise { submitted: true|false, submission }.
 */
export const submitDocument = async ({ business, documentType, documentId, userId = null, force = false, provider = null, settings: preloaded = null }) => {
  const settings = preloaded || (await ClientEtimsSettings.findOne({ business }).lean());
  if (!settings?.enabled) return { skipped: true, reason: "eTIMS is disabled for this company" };
  const loader = LOADERS[documentType];
  if (!loader) throw createError(400, "Unsupported eTIMS document type");
  const loaded = await loader({ business, documentId });

  const submission = await EtimsSubmission.findOneAndUpdate(
    { business, documentType, documentId },
    { $setOnInsert: { business, documentType, documentId, documentNumber: loaded.number, client: loaded.clientId, environment: settings.environment, requestedBy: userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  if (submission.status === "submitted") return { alreadySubmitted: true, submission };
  if (!force && submission.attempts >= (settings.maxAttempts || 6) && submission.status === "failed") {
    return { submitted: false, exhausted: true, submission };
  }

  const now = new Date();
  const claimed = await EtimsSubmission.findOneAndUpdate(
    {
      _id: submission._id,
      $or: [
        { status: { $in: ["pending", "failed", "skipped"] } },
        { status: "processing", lastAttemptAt: { $lt: new Date(now.getTime() - STALE_PROCESSING_MS) } },
      ],
    },
    { $set: { status: "processing", lastAttemptAt: now, error: "" }, $inc: { attempts: 1 } },
    { new: true }
  ).lean();
  if (!claimed) return { inProgress: true, submission };

  let invcNo = claimed.etimsInvoiceNo;
  if (!invcNo) {
    invcNo = await nextEtimsInvoiceNo(business);
    await EtimsSubmission.updateOne({ _id: claimed._id }, { $set: { etimsInvoiceNo: invcNo } });
  }

  const [client, company] = await Promise.all([
    Client.findOne({ _id: loaded.clientId, business }).select("name taxPin phone").lean(),
    Company.findById(business).select("companyName").lean(),
  ]);
  const payload = buildEtimsSalesPayload({
    document: loaded.document,
    client: client || {},
    settings,
    invcNo,
    orgInvcNo: loaded.orgInvcNo,
    receiptType: loaded.receiptType,
    remark: loaded.remark,
    companyName: company?.companyName || "",
  });

  try {
    const response = await providerFor(settings, provider).saveSales(payload);
    const data = response?.data || {};
    const sdcId = data.sdcId || settings.sdcId || "";
    const cuInvoiceNumber = data.rcptNo !== undefined ? `${sdcId ? `${sdcId}/` : ""}${data.rcptNo}` : "";
    const qrUrl = buildEtimsQrUrl({ environment: settings.environment, kraPin: settings.kraPin, branchId: settings.branchId, receiptSignature: data.rcptSign });
    const updated = await EtimsSubmission.findOneAndUpdate(
      { _id: claimed._id },
      { $set: { status: "submitted", requestPayload: payload, responsePayload: response, resultCode: String(response?.resultCd || ""), resultMessage: response?.resultMsg || "", cuInvoiceNumber, receiptSignature: data.rcptSign || "", internalData: data.intrlData || "", qrUrl, submittedAt: new Date(), nextRetryAt: null } },
      { new: true }
    ).lean();
    await recordOutcomeOnDocument({ documentType, documentId, business, set: { etimsCuInvoiceNumber: cuInvoiceNumber, etimsQrUrl: qrUrl, etimsStatus: "submitted" } });
    return { submitted: true, submission: updated };
  } catch (err) {
    const attempts = claimed.attempts;
    const finalFailure = attempts >= (settings.maxAttempts || 6);
    const updated = await EtimsSubmission.findOneAndUpdate(
      { _id: claimed._id },
      { $set: { status: "failed", requestPayload: payload, responsePayload: err?.response || null, resultCode: err?.resultCd || "", resultMessage: err?.response?.resultMsg || "", error: String(err?.message || err).slice(0, 500), nextRetryAt: finalFailure ? null : new Date(Date.now() + backoffMinutes(attempts) * 60000) } },
      { new: true }
    ).lean();
    await recordOutcomeOnDocument({ documentType, documentId, business, set: { etimsStatus: "failed" } });
    return { submitted: false, submission: updated, error: updated.error };
  }
};

export const submitInvoice = ({ business, invoiceId, ...rest }) => submitDocument({ business, documentType: "invoice", documentId: invoiceId, ...rest });
export const submitCreditNote = ({ business, noteId, ...rest }) => submitDocument({ business, documentType: "credit_note", documentId: noteId, ...rest });

// Cron entry point: retries failed submissions whose backoff has elapsed.
export const processEtimsRetries = async ({ now = new Date(), limit = 200, provider = null } = {}) => {
  const due = await EtimsSubmission.find({ status: "failed", nextRetryAt: { $ne: null, $lte: now } }).sort({ nextRetryAt: 1 }).limit(limit).lean();
  const settingsByBusiness = new Map();
  let submitted = 0;
  let failed = 0;
  for (const row of due) {
    const key = String(row.business);
    if (!settingsByBusiness.has(key)) settingsByBusiness.set(key, await ClientEtimsSettings.findOne({ business: row.business }).lean());
    const settings = settingsByBusiness.get(key);
    if (!settings?.enabled) continue;
    try {
      const result = await submitDocument({ business: row.business, documentType: row.documentType, documentId: row.documentId, settings, provider });
      if (result.submitted) submitted += 1;
      else if (result.submitted === false) failed += 1;
    } catch (err) {
      failed += 1;
      console.error("[eTIMS] retry failed for %s %s: %s", row.documentType, row.documentNumber, err?.message || err);
    }
  }
  return { checked: due.length, submitted, failed };
};

export const listEtimsSubmissions = async ({ business, status = null, documentType = null, page = 1, limit = 50 }) => {
  const filter = { business };
  if (status) filter.status = status;
  if (documentType) filter.documentType = documentType;
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);
  const [rows, total] = await Promise.all([
    EtimsSubmission.find(filter).select("-requestPayload -responsePayload").populate("client", "name clientCode").sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    EtimsSubmission.countDocuments(filter),
  ]);
  return { rows, pagination: { page: safePage, limit: safeLimit, total, pages: Math.max(Math.ceil(total / safeLimit), 1) } };
};

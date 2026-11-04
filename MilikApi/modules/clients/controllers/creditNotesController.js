import { createError } from "../../../utils/error.js";
import { logAuditEvent } from "../../../utils/auditLogger.js";
import { emitToCompany } from "../../../utils/socketManager.js";
import ClientCreditNote, { CLIENT_NOTE_TYPES } from "../models/ClientCreditNote.js";
import { resolveActiveBusinessId, currentUserId, escapeRegex } from "../services/businessScope.js";
import { createClientNote, reverseClientNote, raiseLateInterestDebitNotes } from "../services/clientNoteService.js";
import { generateClientNotePdf, sendPdf } from "../services/clientDocumentPdfService.js";

const auditNote = (req, note, action, message, metadata = {}) =>
  logAuditEvent({
    req,
    company: note.business,
    action: `client_note.${action}`,
    category: "finance",
    targetType: "ClientCreditNote",
    targetId: note._id,
    targetName: note.noteNumber,
    message,
    metadata,
  });

export const listNotes = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    if (req.query.invoiceId) filter.invoice = String(req.query.invoiceId);
    if (req.query.clientId) filter.client = String(req.query.clientId);
    if (req.query.noteType && CLIENT_NOTE_TYPES.includes(String(req.query.noteType).toUpperCase())) filter.noteType = String(req.query.noteType).toUpperCase();
    // Reversed notes are audit trail — hidden unless asked for.
    if (req.query.status) filter.status = String(req.query.status);
    else if (req.query.includeReversed !== "true") filter.status = "posted";
    if (req.query.search) filter.noteNumber = new RegExp(escapeRegex(String(req.query.search).trim()), "i");

    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 200);
    const page = Math.max(Number(req.query.page || 1), 1);
    const [notes, total] = await Promise.all([
      ClientCreditNote.find(filter).populate("client", "name clientCode").sort({ noteDate: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ClientCreditNote.countDocuments(filter),
    ]);
    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { notes, pagination }, notes, pagination });
  } catch (error) {
    next(error);
  }
};

export const getNote = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const note = await ClientCreditNote.findOne({ _id: req.params.id, business }).populate("client", "name clientCode").lean();
    if (!note) return next(createError(404, "Note not found"));
    res.status(200).json({ success: true, data: note, note });
  } catch (error) {
    next(error);
  }
};

// POST /api/clients/invoices/:id/credit-notes  and  /:id/debit-notes
const createNoteFor = (noteType) => async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { note, invoice } = await createClientNote({
      business,
      invoiceId: req.params.id,
      noteType,
      lines: req.body?.lines,
      full: req.body?.full === true || req.body?.full === "true",
      reason: req.body?.reason,
      noteDate: req.body?.noteDate,
      userId: currentUserId(req),
    });
    await auditNote(req, note, "posted", `${noteType === "CREDIT_NOTE" ? "Credit" : "Debit"} note ${note.noteNumber} (${note.total}) posted against ${note.invoiceNumber}: ${note.reason}`, {
      invoiceId: String(invoice._id), total: note.total, journalGroupId: note.journalGroupId,
    });
    emitToCompany(String(business), "clients:invoice:updated", { invoiceId: String(invoice._id), status: invoice.status });
    res.status(201).json({ success: true, data: { note, invoice }, note, invoice });
  } catch (error) {
    next(error);
  }
};
export const createCreditNote = createNoteFor("CREDIT_NOTE");
export const createDebitNote = createNoteFor("DEBIT_NOTE");

export const reverseNote = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { note, invoice } = await reverseClientNote({ business, noteId: req.params.id, reason: req.body?.reason, userId: currentUserId(req) });
    await auditNote(req, note, "reversed", `${note.noteNumber} reversed: ${note.reversalReason}`, { invoiceId: String(invoice._id) });
    emitToCompany(String(business), "clients:invoice:updated", { invoiceId: String(invoice._id), status: invoice.status });
    res.status(200).json({ success: true, data: { note, invoice }, note, invoice });
  } catch (error) {
    next(error);
  }
};

export const getNotePdf = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const buffer = await generateClientNotePdf(req.params.id, business);
    sendPdf(res, buffer, `Note-${req.params.id}.pdf`, req.query?.preview === "true");
  } catch (error) {
    next(error);
  }
};

// POST /api/clients/notes/late-interest — raise the late-payment interest debit notes that the
// collections preview (GET /api/clients/collections/late-interest) shows.
export const raiseLateInterest = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const asOf = req.body?.asOf ? new Date(req.body.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) return next(createError(400, "Invalid asOf date"));
    const result = await raiseLateInterestDebitNotes({ business, asOf, clientId: req.body?.clientId || null, userId: currentUserId(req) });
    await logAuditEvent({
      req, company: business, action: "client_note.late_interest_run", category: "finance",
      message: `Late payment interest: ${result.raised.length} debit note(s), total ${result.total}`, metadata: result,
    });
    res.status(200).json({ success: true, data: result, ...result });
  } catch (error) {
    next(error);
  }
};

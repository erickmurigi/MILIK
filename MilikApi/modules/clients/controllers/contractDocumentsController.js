// Contract paperwork: generated contract PDF, the signed copy (uploaded by the client app to file
// storage; we keep the URL — same pattern as tenant documents' sanitizeDocuments) and other attachments.
import { createError } from "../../../utils/error.js";
import { logAuditEvent } from "../../../utils/auditLogger.js";
import ClientContract from "../models/ClientContract.js";
import { resolveActiveBusinessId, currentUserId } from "../services/businessScope.js";
import { generateContractPdf, sendPdf } from "../services/clientDocumentPdfService.js";

const DOCUMENT_KINDS = ["signed_contract", "amendment", "other"];

const sanitizeUrl = (value) => {
  const url = String(value || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) throw createError(400, "Document URL must be an http(s) link");
  return url;
};

const dateOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw createError(400, "Invalid date");
  return d;
};

export const getContractPdf = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const buffer = await generateContractPdf(req.params.id, business);
    sendPdf(res, buffer, `Contract-${req.params.id}.pdf`, req.query?.preview === "true");
  } catch (error) {
    next(error);
  }
};

// Records the signed copy and who signed when. Either signature date may be sent on its own.
export const recordSignedContract = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const contract = await ClientContract.findOne({ _id: req.params.id, business });
    if (!contract) return next(createError(404, "Contract not found"));

    const url = sanitizeUrl(req.body?.url);
    const signedByClientAt = dateOrNull(req.body?.signedByClientAt);
    const signedByUsAt = dateOrNull(req.body?.signedByUsAt);
    if (!url && !signedByClientAt && !signedByUsAt) return next(createError(400, "Send the signed document URL and/or signature dates"));

    if (url) {
      contract.signedDocumentUrl = url;
      contract.documentUrl = contract.documentUrl || url;
      contract.documents.push({ name: String(req.body?.name || "Signed contract").trim(), url, kind: "signed_contract", uploadedAt: new Date(), uploadedBy: userId });
    }
    if (signedByClientAt) {
      contract.signedByClientAt = signedByClientAt;
      contract.signedByClientName = String(req.body?.signedByClientName || "").trim();
    }
    if (signedByUsAt) {
      contract.signedByUsAt = signedByUsAt;
      contract.signedByUsUser = userId;
    }
    contract.updatedBy = userId;
    await contract.save();

    await logAuditEvent({
      req, company: business, action: "client_contract.signed_copy", category: "finance",
      targetType: "ClientContract", targetId: contract._id, targetName: contract.contractNumber,
      message: `Signed copy recorded for contract ${contract.contractNumber}`,
      metadata: { url, signedByClientAt, signedByUsAt },
    });
    res.status(200).json({ success: true, data: contract, contract });
  } catch (error) {
    next(error);
  }
};

export const addContractDocument = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const url = sanitizeUrl(req.body?.url);
    if (!url) return next(createError(400, "Document URL is required"));
    const doc = {
      name: String(req.body?.name || "Document").trim(),
      url,
      kind: DOCUMENT_KINDS.includes(req.body?.kind) ? req.body.kind : "other",
      uploadedAt: new Date(),
      uploadedBy: currentUserId(req),
    };
    const contract = await ClientContract.findOneAndUpdate({ _id: req.params.id, business }, { $push: { documents: doc } }, { new: true });
    if (!contract) return next(createError(404, "Contract not found"));
    await logAuditEvent({
      req, company: business, action: "client_contract.document_added", category: "finance",
      targetType: "ClientContract", targetId: contract._id, targetName: contract.contractNumber,
      message: `Document "${doc.name}" attached to contract ${contract.contractNumber}`,
    });
    res.status(201).json({ success: true, data: contract.documents, documents: contract.documents });
  } catch (error) {
    next(error);
  }
};

export const removeContractDocument = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const contract = await ClientContract.findOneAndUpdate(
      { _id: req.params.id, business },
      { $pull: { documents: { _id: req.params.documentId } } },
      { new: true }
    );
    if (!contract) return next(createError(404, "Contract not found"));
    await logAuditEvent({
      req, company: business, action: "client_contract.document_removed", category: "finance",
      targetType: "ClientContract", targetId: contract._id, targetName: contract.contractNumber,
      message: `Document removed from contract ${contract.contractNumber}`, metadata: { documentId: req.params.documentId },
    });
    res.status(200).json({ success: true, data: contract.documents, documents: contract.documents });
  } catch (error) {
    next(error);
  }
};

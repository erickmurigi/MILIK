// Read models for a future client self-service portal. Every function takes
// an explicit { business, clientId } scope and returns only that client's
// documents with a deliberately narrow field list (no internal notes, ledger
// ids or audit fields), so a portal token can be wired straight to them.
import { round2 } from "../../../utils/math.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientReceipt from "../models/ClientReceipt.js";
import ClientPayment from "../models/ClientPayment.js";
import ClientContract from "../models/ClientContract.js";
import { computeClientInvoiceOutstanding } from "./clientInvoiceBalanceService.js";
import { buildClientStatement } from "./clientReportsService.js";
import { getOpenBalancesByClient } from "./clientCreditControlService.js";
import { getClientUnappliedCredit } from "./clientReceiptService.js";

const page = ({ page: p = 1, limit = 25 }) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const safePage = Math.max(Number(p) || 1, 1);
  return { safeLimit, safePage, skip: (safePage - 1) * safeLimit };
};
const pagination = (safePage, safeLimit, total) => ({ page: safePage, limit: safeLimit, total, pages: Math.max(Math.ceil(total / safeLimit), 1) });

export const getPortalSummary = async ({ business, clientId }) => {
  const [balances, unapplied] = await Promise.all([
    getOpenBalancesByClient({ business, clientIds: [clientId] }),
    getClientUnappliedCredit({ business, clientId }),
  ]);
  const open = balances.get(String(clientId)) || { balance: 0, overdue: 0, openInvoices: 0 };
  return { balance: open.balance, overdue: open.overdue, openInvoices: open.openInvoices, unappliedCredit: unapplied, net: round2(open.balance - unapplied) };
};

export const getPortalInvoices = async ({ business, clientId, status = null, ...paging }) => {
  const { safeLimit, safePage, skip } = page(paging);
  const filter = { business, client: clientId, status: { $nin: ["draft", "cancelled"] } };
  if (status === "open") filter.status = { $in: ["posted", "sent", "partial", "partially_paid", "overdue"] };
  else if (status) filter.status = status;
  const [rows, total] = await Promise.all([
    ClientInvoice.find(filter)
      .select("invoiceNumber issueDate dueDate periodStart periodEnd currency subtotal vatAmount total paidAmount creditedAmount debitedAmount status etimsCuInvoiceNumber etimsQrUrl")
      .sort({ issueDate: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    ClientInvoice.countDocuments(filter),
  ]);
  return { rows: rows.map((r) => ({ ...r, outstanding: Math.max(0, computeClientInvoiceOutstanding(r)) })), pagination: pagination(safePage, safeLimit, total) };
};

export const getPortalStatement = ({ business, clientId, from = null, to = null }) =>
  buildClientStatement({ business, clientId, from, to });

export const getPortalReceipts = async ({ business, clientId, ...paging }) => {
  const { safeLimit, safePage, skip } = page(paging);
  const filter = { business, client: clientId, status: "posted" };
  const [rows, total, legacy] = await Promise.all([
    ClientReceipt.find(filter)
      .select("receiptNumber receiptDate amount method reference currency whtIncomeTax.amount whtVat.amount allocations.invoiceNumber allocations.amount allocations.status unappliedAmount")
      .sort({ receiptDate: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    ClientReceipt.countDocuments(filter),
    // Pre-receipts single-invoice payments, so the history is complete.
    safePage === 1 ? ClientPayment.find({ business, client: clientId, status: { $ne: "reversed" } }).select("amount paymentDate paymentMethod paymentReference invoice").sort({ paymentDate: -1 }).limit(100).lean() : [],
  ]);
  return {
    rows: rows.map((r) => ({ ...r, allocations: (r.allocations || []).filter((a) => a.status === "active").map(({ invoiceNumber, amount }) => ({ invoiceNumber, amount })) })),
    legacyPayments: legacy,
    pagination: pagination(safePage, safeLimit, total),
  };
};

export const getPortalContracts = async ({ business, clientId }) => {
  const contracts = await ClientContract.find({ business, client: clientId, status: { $nin: ["draft", "pending_approval", "cancelled"] } })
    .select("contractNumber description contractType status startDate endDate openEnded currency billingCycle lines.itemName lines.description lines.quantity lines.unitPrice lines.billingFrequency documents.name documents.url documents.kind documents.uploadedAt documentUrl signedDocumentUrl signedByClientAt")
    .sort({ startDate: -1 })
    .lean();
  return contracts;
};

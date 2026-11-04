/**
 * Late-payment interest on overdue client invoices, for contracts that carry
 * `latePaymentInterestPercent` (percent per month unless the contract says
 * `latePaymentInterestBasis: "annual"`). Simple interest on the outstanding
 * balance, day-counted from the later of the due date (+ grace days) and the
 * point interest was last charged to, so re-running never double-charges.
 *
 * This module only computes and returns debit-note payloads; raising the
 * debit note (and its GL) belongs to the invoicing side. After a note is
 * raised, call markLateInterestCharged so the next run starts from there.
 */
import mongoose from "mongoose";
import { round2 } from "../../../utils/math.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientContract from "../models/ClientContract.js";
import ClientInvoiceFlag from "../models/ClientInvoiceFlag.js";
import Client from "../models/Client.js";
import { OPEN_INVOICE_STATUSES, OUTSTANDING_FIELDS, invoiceOutstanding } from "./clientReceiptService.js";

const DAY_MS = 86400000;
const startOfDay = (value) => { const d = new Date(value); d.setHours(0, 0, 0, 0); return d; };

export const computeInterestAmount = ({ outstanding, ratePercent, days, basis = "monthly" }) => {
  if (!(outstanding > 0) || !(ratePercent > 0) || !(days > 0)) return 0;
  const periodDays = basis === "annual" ? 365 : 30;
  return round2(outstanding * (ratePercent / 100) * (days / periodDays));
};

export const computeLateInterest = async ({ business, asOf = new Date(), clientId = null, minimumAmount = 1 }) => {
  // server.js runs with strictQuery: guard in case the field is ever removed,
  // or the filter below would be dropped and match every contract.
  if (!ClientContract.schema.path("latePaymentInterestPercent")) return [];
  const cutoff = startOfDay(asOf);
  const contracts = await ClientContract.find({ business, latePaymentInterestPercent: { $gt: 0 }, ...(clientId ? { client: clientId } : {}) })
    .select("client contractNumber latePaymentInterestPercent latePaymentInterestBasis latePaymentGraceDays currency")
    .lean();
  if (!contracts.length) return [];
  const contractById = new Map(contracts.map((c) => [String(c._id), c]));

  const invoices = await ClientInvoice.find({
    business,
    contract: { $in: contracts.map((c) => c._id) },
    status: { $in: OPEN_INVOICE_STATUSES },
    dueDate: { $lt: cutoff },
  }).select(`client contract invoiceNumber ${OUTSTANDING_FIELDS}`).lean();
  if (!invoices.length) return [];

  const [flags, clients] = await Promise.all([
    ClientInvoiceFlag.find({ business, invoice: { $in: invoices.map((i) => i._id) } }).select("invoice disputed interestChargedThrough").lean(),
    Client.find({ business, _id: { $in: [...new Set(invoices.map((i) => String(i.client)))] } }).select("name clientCode").lean(),
  ]);
  const flagByInvoice = new Map(flags.map((f) => [String(f.invoice), f]));
  const clientById = new Map(clients.map((c) => [String(c._id), c]));

  const rows = [];
  for (const invoice of invoices) {
    const contract = contractById.get(String(invoice.contract));
    const flag = flagByInvoice.get(String(invoice._id));
    if (!contract || flag?.disputed) continue; // no interest while a dispute is open
    const graceDays = Number(contract.latePaymentGraceDays || 0);
    const interestStart = new Date(startOfDay(invoice.dueDate).getTime() + graceDays * DAY_MS);
    const from = flag?.interestChargedThrough && flag.interestChargedThrough > interestStart ? startOfDay(flag.interestChargedThrough) : interestStart;
    const days = Math.round((cutoff - from) / DAY_MS);
    const outstanding = invoiceOutstanding(invoice);
    const amount = computeInterestAmount({ outstanding, ratePercent: Number(contract.latePaymentInterestPercent), days, basis: contract.latePaymentInterestBasis === "annual" ? "annual" : "monthly" });
    if (amount < minimumAmount) continue;
    const client = clientById.get(String(invoice.client));
    rows.push({
      invoice: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      client: invoice.client,
      clientName: client?.name || "",
      contract: contract._id,
      contractNumber: contract.contractNumber,
      outstanding,
      ratePercent: Number(contract.latePaymentInterestPercent),
      basis: contract.latePaymentInterestBasis === "annual" ? "annual" : "monthly",
      interestFrom: from,
      interestThrough: cutoff,
      days,
      amount,
    });
  }
  return rows;
};

// Debit-note payloads in ClientInvoice line-item shape. Interest is an exempt
// financial charge in Kenya, so lines are non-taxable (vatRate 0).
export const buildLateInterestDebitNotePayloads = async ({ business, asOf = new Date(), clientId = null }) => {
  const rows = await computeLateInterest({ business, asOf, clientId });
  return rows.map((row) => ({
    business,
    client: row.client,
    contract: row.contract,
    invoice: row.invoice,
    reason: "late_payment_interest",
    issueDate: row.interestThrough,
    vatRate: 0,
    lineItems: [{
      description: `Late payment interest on ${row.invoiceNumber}: ${row.ratePercent}% ${row.basis === "annual" ? "p.a." : "per month"} on ${row.outstanding} for ${row.days} days`,
      quantity: 1,
      unitPrice: row.amount,
      taxable: false,
    }],
    total: row.amount,
    interestFrom: row.interestFrom,
    interestThrough: row.interestThrough,
  }));
};

export const markLateInterestCharged = async ({ business, invoiceId, through, session = null }) => {
  const invoice = await ClientInvoice.findOne({ _id: invoiceId, business }).select("client").lean();
  if (!invoice) return null;
  return ClientInvoiceFlag.findOneAndUpdate(
    { business, invoice: new mongoose.Types.ObjectId(String(invoiceId)) },
    { $set: { interestChargedThrough: startOfDay(through) }, $setOnInsert: { client: invoice.client } },
    { upsert: true, new: true, session }
  ).lean();
};

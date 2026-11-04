// Shared setup for the client collections/reports tests: a company with the
// Clients chart of accounts, a user, a client, and posted (sent) invoices
// created through the real invoice ledger posting.
import mongoose from "mongoose";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import Client from "../models/Client.js";
import ClientInvoice from "../models/ClientInvoice.js";
import { postClientInvoiceLedger } from "../services/clientAccountingService.js";

let seq = 0;

export const setupClientsCompany = async ({ clientOverrides = {} } = {}) => {
  const company = await createTestCompany({ modules: { clients: true } });
  await createTestChartOfAccounts(company._id);
  const user = { _id: (await createTestUser({ company })).id, company: String(company._id) };
  seq += 1;
  const client = await Client.create({ business: company._id, name: `Acme Holdings ${seq}`, clientCode: `CLT-${String(seq).padStart(5, "0")}`, phone: "0712345678", email: `billing${seq}@acme.test`, ...clientOverrides });
  const cashbook = await ChartOfAccount.findOne({ business: company._id, code: "1110" }).lean();
  return { company, business: String(company._id), user, userId: user._id, client, cashbook };
};

// A posted invoice: draft → GL posted → sent, the same path sendInvoice takes.
export const createPostedInvoice = async ({ business, client, userId, amount = 1000, vatRate = 0, issueDate = new Date(), dueDate = null, invoiceNumber = null, contract = null }) => {
  seq += 1;
  const invoice = await ClientInvoice.create({
    business,
    client: client._id || client,
    contract,
    invoiceNumber: invoiceNumber || `CINV-T${String(seq).padStart(5, "0")}`,
    issueDate,
    dueDate: dueDate || new Date(new Date(issueDate).getTime() + 30 * 86400000),
    vatRate,
    lineItems: [{ description: "Retainer", quantity: 1, unitPrice: amount, taxable: vatRate > 0 }],
  });
  const entries = await postClientInvoiceLedger({ invoice, userId });
  invoice.ledgerEntries = entries.map((e) => e._id);
  invoice.status = "sent";
  invoice.sentAt = new Date();
  await invoice.save();
  return invoice;
};

export const accountBalance = async (business, code) => {
  const account = await ChartOfAccount.findOne({ business, code }).lean();
  const [row] = await FinancialLedgerEntry.aggregate([
    { $match: { business: new mongoose.Types.ObjectId(String(business)), accountId: account._id } },
    { $group: { _id: null, debit: { $sum: "$debit" }, credit: { $sum: "$credit" } } },
  ]);
  return Math.round(((row?.debit || 0) - (row?.credit || 0)) * 100) / 100;
};

// Every journal group, and the ledger as a whole, must balance.
export const assertLedgerBalanced = async (business) => {
  const groups = await FinancialLedgerEntry.aggregate([
    { $match: { business: new mongoose.Types.ObjectId(String(business)) } },
    { $group: { _id: "$journalGroupId", debit: { $sum: "$debit" }, credit: { $sum: "$credit" } } },
  ]);
  const unbalanced = groups.filter((g) => Math.abs(g.debit - g.credit) > 0.005);
  return { groups: groups.length, unbalanced };
};

// Read-only diagnostic for client (Contract Management) output VAT. Client invoices post their VAT to
// 2190 (the clients+inventory output VAT account). The VAT return (controllers/propertyController/
// taxRemittance.js) reads 2190 alongside the company's configured output account, but a filing only
// covers what was on the ledger when it was made. This lists, per company and month:
//   - client VAT on 2190 (charged, adjusted by credit notes / reversals, net)
//   - KRA VAT filings for the month and the 2190 amount each one snapshotted
//   - client VAT posted AFTER the month's last filing (back-dated invoices) — missed by that filing
//   - months with client VAT and no filing at all
//   - posted client invoices whose VAT never reached the ledger
// Nothing is written.
//
//   node scripts/diagnoseClientVat.js                    (every company)
//   node scripts/diagnoseClientVat.js --companyCode=GLR
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import TaxRemittance from "../models/TaxRemittance.js";
import ClientInvoice from "../modules/clients/models/ClientInvoice.js";

dotenv.config();

const getArg = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmt = (n) => round2(n).toLocaleString("en-KE", { minimumFractionDigits: 2 });
const monthOf = (d) => {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

// Client-module journals: invoices, credit/debit notes and their reversals all carry a
// client_* source type, or metadata.clientDocumentType on the shared client_invoice type.
const CLIENT_SOURCE_TYPES = ["client_invoice", "client_invoice_note", "client_revenue_recognition"];

async function scanCompany(company) {
  const business = company._id;
  const lines = [];
  const vat2190 = await ChartOfAccount.findOne({ business, code: "2190" }).select("_id").lean();
  if (!vat2190) return lines;

  const entries = await FinancialLedgerEntry.find({
    business,
    accountId: vat2190._id,
    sourceTransactionType: { $in: CLIENT_SOURCE_TYPES },
    status: { $nin: ["void", "draft"] },
  }).select("direction amount transactionDate createdAt sourceTransactionId metadata.invoiceNumber metadata.noteNumber").lean();
  if (!entries.length) return lines;

  // Month the VAT belongs to = transactionDate's month, same rule as the VAT return.
  const months = new Map();
  for (const e of entries) {
    const key = monthOf(e.transactionDate);
    const m = months.get(key) || { charged: 0, adjusted: 0, entries: [] };
    if (e.direction === "credit") m.charged = round2(m.charged + e.amount);
    else m.adjusted = round2(m.adjusted + e.amount);
    m.entries.push(e);
    months.set(key, m);
  }

  const remittances = await TaxRemittance.find({ business, taxType: "vat_output", status: { $ne: "voided" } })
    .select("periodYear periodMonth amountRemitted vatAccount2190Amount createdAt paymentReference")
    .sort({ createdAt: 1 })
    .lean();
  const filingsByMonth = new Map();
  for (const r of remittances) {
    const key = `${r.periodYear}-${String(r.periodMonth).padStart(2, "0")}`;
    if (!filingsByMonth.has(key)) filingsByMonth.set(key, []);
    filingsByMonth.get(key).push(r);
  }

  const currentMonth = monthOf(new Date());
  let missedTotal = 0;
  for (const [month, m] of [...months.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const net = round2(m.charged - m.adjusted);
    const filings = filingsByMonth.get(month) || [];
    const header = `  ${month}: client VAT charged ${fmt(m.charged)}, adjusted ${fmt(m.adjusted)}, net ${fmt(net)}`;
    if (!filings.length) {
      if (month < currentMonth && net > 0) lines.push(`${header} — NO VAT filing recorded for this month`);
      continue;
    }
    const lastFiling = filings[filings.length - 1];
    const late = m.entries.filter((e) => new Date(e.createdAt) > new Date(lastFiling.createdAt));
    const lateNet = round2(late.reduce((s, e) => s + (e.direction === "credit" ? e.amount : -e.amount), 0));
    if (Math.abs(lateNet) > 0.009) {
      missedTotal = round2(missedTotal + lateNet);
      lines.push(`${header} — ${fmt(lateNet)} posted after the last filing (${new Date(lastFiling.createdAt).toISOString().slice(0, 10)}, ref ${lastFiling.paymentReference || "-"}, 2190 snapshot ${fmt(lastFiling.vatAccount2190Amount)})`);
      late.slice(0, 10).forEach((e) => lines.push(`      ${e.metadata?.invoiceNumber || e.metadata?.noteNumber || e.sourceTransactionId}  ${e.direction} ${fmt(e.amount)}  posted ${new Date(e.createdAt).toISOString().slice(0, 10)}`));
      if (late.length > 10) lines.push(`      … ${late.length - 10} more`);
    }
  }
  if (missedTotal) lines.push(`  Client VAT missed by filed returns: ${fmt(missedTotal)} (declare in the next return or amend)`);

  // Posted invoices with VAT but no live VAT leg on 2190.
  const postedWithVat = await ClientInvoice.find({ business, status: { $nin: ["draft", "cancelled"] }, vatAmount: { $gt: 0 } })
    .select("_id invoiceNumber vatAmount issueDate").lean();
  if (postedWithVat.length) {
    const withLeg = new Set((await FinancialLedgerEntry.distinct("sourceTransactionId", {
      business,
      accountId: vat2190._id,
      sourceTransactionType: "client_invoice",
      sourceTransactionId: { $in: postedWithVat.map((i) => String(i._id)) },
      direction: "credit",
    })).map(String));
    const missing = postedWithVat.filter((i) => !withLeg.has(String(i._id)));
    if (missing.length) {
      lines.push(`  Posted client invoices whose VAT is not on 2190: ${missing.length}`);
      missing.slice(0, 20).forEach((i) => lines.push(`      ${i.invoiceNumber}  VAT ${fmt(i.vatAmount)}  issued ${new Date(i.issueDate).toISOString().slice(0, 10)}`));
    }
  }
  return lines;
}

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const companyCode = getArg("companyCode");
  const companies = companyCode
    ? await Company.find({ companyCode }).select("_id companyName companyCode").lean()
    : await Company.find({ "modules.clients": true }).select("_id companyName companyCode").lean();
  if (!companies.length) throw new Error("No company found.");

  let anything = false;
  for (const company of companies) {
    const lines = await scanCompany(company);
    if (!lines.length) continue;
    anything = true;
    console.log(`\n${company.companyName} (${company.companyCode || company._id})`);
    lines.forEach((line) => console.log(line));
  }
  if (!anything) console.log("No client VAT issues found.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

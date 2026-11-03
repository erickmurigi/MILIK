// Read-only diagnostic for deposit refunds posted before the move-out deposit settlement existed.
// Those deposit_refund vouchers carry no tenant and always debited Landlord Payable (2110), which is
// wrong for a manager-held deposit (it should release 2100) and never reached the landlord statement for
// a landlord-held one. Also lists tenants whose refund status was typed in with no refund behind it.
//
//   node scripts/diagnoseDepositRefunds.js                    (every company)
//   node scripts/diagnoseDepositRefunds.js --companyCode=GLR
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import Tenant from "../models/Tenant.js";
import Unit from "../models/Unit.js";
import "../models/Property.js";
import PaymentVoucher from "../models/PaymentVoucher.js";
import TenantInvoiceNote from "../models/TenantInvoiceNote.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import { computeTenantDepositPositions } from "../services/tenantDepositService.js";

dotenv.config();

const getArg = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmt = (n) => round2(n).toLocaleString("en-KE", { minimumFractionDigits: 2 });

// The retired settlement screen referenced refunds as TENANT-DEPOSIT-REFUND-<last 6 of tenant id>
// and narrated them "Deposit refund for <tenant name>".
const inferTenant = ({ voucher, tenants }) => {
  const suffix = String(voucher.reference || "").match(/TENANT-DEPOSIT-REFUND-([0-9a-f]{6})$/i)?.[1]?.toLowerCase();
  if (suffix) {
    const bySuffix = tenants.filter((t) => String(t._id).endsWith(suffix));
    if (bySuffix.length === 1) return { tenant: bySuffix[0], how: "reference" };
  }
  const narration = String(voucher.narration || "").toLowerCase();
  const byName = tenants.filter((t) => t.name && narration.includes(String(t.name).toLowerCase()));
  if (byName.length === 1) return { tenant: byName[0], how: "narration" };
  return { tenant: null, how: byName.length > 1 ? "ambiguous name" : "no match" };
};

async function scanCompany(company) {
  const business = company._id;
  const lines = [];

  const [vouchers, accounts] = await Promise.all([
    PaymentVoucher.find({ business, category: "deposit_refund", tenant: null, status: { $in: ["approved", "paid"] } })
      .select("_id voucherNo amount status paidDate createdAt reference narration property ledgerEntries")
      .populate("property", "propertyName")
      .lean(),
    ChartOfAccount.find({ business, code: { $in: ["2100", "2110"] } }).select("_id code").lean(),
  ]);
  const codeById = new Map(accounts.map((a) => [String(a._id), a.code]));

  if (vouchers.length) {
    const propertyIds = [...new Set(vouchers.map((v) => String(v.property?._id || "")).filter(Boolean))];
    const unitIds = await Unit.find({ business, property: { $in: propertyIds } }).distinct("_id");
    const tenants = await Tenant.find({ business, unit: { $in: unitIds } }).select("_id name tenantCode unit depositHeldBy").lean();
    const unitProperty = new Map((await Unit.find({ _id: { $in: unitIds } }).select("_id property").lean()).map((u) => [String(u._id), String(u.property)]));

    const entries = await FinancialLedgerEntry.find({ _id: { $in: vouchers.flatMap((v) => v.ledgerEntries || []) }, debit: { $gt: 0 } })
      .select("_id accountId debit")
      .lean();
    const debitById = new Map(entries.map((e) => [String(e._id), e]));

    lines.push(`  Untagged deposit refund vouchers: ${vouchers.length}`);
    for (const voucher of vouchers) {
      const debitCodes = [...new Set((voucher.ledgerEntries || []).map((id) => debitById.get(String(id))).filter(Boolean).map((e) => codeById.get(String(e.accountId)) || "other"))];
      const propertyTenants = tenants.filter((t) => unitProperty.get(String(t.unit)) === String(voucher.property?._id || ""));
      const { tenant, how } = inferTenant({ voucher, tenants: propertyTenants });
      const holder = tenant?.depositHeldBy === "Landlord" ? "Landlord" : tenant ? "Management Company" : "?";

      let verdict;
      if (!tenant) verdict = `TENANT UNKNOWN (${how}) — match by hand`;
      else if (holder === "Management Company" && debitCodes.includes("2110")) verdict = `MISPOSTED: debited 2110, should release 2100 — 2110 understated and 2100 overstated by ${fmt(voucher.amount)}`;
      else if (holder === "Landlord" && debitCodes.includes("2110")) verdict = "Landlord-held: 2110 reduced but no landlord statement deduction";
      else verdict = `debited ${debitCodes.join("/") || "nothing"} — review`;

      lines.push(
        `    ${voucher.voucherNo}  ${voucher.status.padEnd(8)} ${fmt(voucher.amount).padStart(14)}  ${voucher.property?.propertyName || "-"}  ` +
        `tenant: ${tenant ? `${tenant.name} (${tenant.tenantCode || tenant._id}, via ${how})` : "-"}  holder: ${holder}\n      -> ${verdict}`
      );
    }
  }

  // Refund status set by hand (the old termination form) with no refund record behind it
  const flagged = await Tenant.find({ business, depositRefundStatus: { $in: ["approved", "paid"] } }).select("_id name tenantCode depositRefundStatus depositRefundAmount").lean();
  if (flagged.length) {
    const positions = await computeTenantDepositPositions(business, flagged.map((t) => t._id));
    const unsupported = flagged.filter((t) => {
      const p = positions.get(String(t._id));
      return !p || p.refunded + p.landlordRefunded <= 0.009;
    });
    if (unsupported.length) {
      lines.push(`  Tenants marked refunded with no refund record: ${unsupported.length}`);
      unsupported.forEach((t) => {
        const p = positions.get(String(t._id));
        lines.push(`    ${t.name} (${t.tenantCode || t._id})  status=${t.depositRefundStatus} amount=${fmt(t.depositRefundAmount)}  still held per records: ${fmt(p?.available)}`);
      });
    }
  }

  const legacyNotes = await TenantInvoiceNote.countDocuments({ business, noteType: "CREDIT_NOTE", "metadata.depositSettlement": true, status: { $nin: ["cancelled", "reversed"] } });
  if (legacyNotes) lines.push(`  Deposit-applied credit notes from the retired settlement screen: ${legacyNotes} (counted as applied)`);

  return lines;
}

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const companyCode = getArg("companyCode");
  const companies = companyCode
    ? await Company.find({ companyCode }).select("_id companyName companyCode").lean()
    : await Company.find({}).select("_id companyName companyCode").lean();
  if (!companies.length) throw new Error("No company found.");

  let anything = false;
  for (const company of companies) {
    const lines = await scanCompany(company);
    if (!lines.length) continue;
    anything = true;
    console.log(`\n${company.companyName} (${company.companyCode || company._id})`);
    lines.forEach((line) => console.log(line));
  }
  if (!anything) console.log("No historical deposit refund issues found.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

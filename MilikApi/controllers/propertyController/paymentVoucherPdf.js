import PaymentVoucher from "../../models/PaymentVoucher.js";
import Company from "../../models/Company.js";
import { htmlToPdf } from "../../services/pdfService.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { createError } from "../../utils/error.js";

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" }) : "—";

const CATEGORY_LABELS = {
  landlord_maintenance: "Accounts Payable – Maintenance",
  deposit_refund: "Deposit Refund (Liability Release)",
  landlord_other: "Accounts Payable – Other",
  manager_property: "Operating Expense (Property)",
  company_operational: "Operating Expense (Company)",
  petty_cash_float: "Petty Cash Float Top-up",
  petty_cash_expense: "Petty Cash Expense",
};

export const downloadPaymentVoucherPdf = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context required"));

    const [voucher, company] = await Promise.all([
      PaymentVoucher.findOne({ _id: req.params.id, business: businessId })
        .populate("liabilityAccount", "code name")
        .populate("debitAccount", "code name")
        .populate("settlementAccount", "code name")
        .populate("serviceProvider", "name providerCode kraPin")
        .populate("property", "propertyName name")
        .lean(),
      Company.findById(businessId).select("companyName name logo address town phone email kraPin").lean(),
    ]);

    if (!voucher) return next(createError(404, "Voucher not found"));

    const coName = company?.companyName || company?.name || "MILIK";
    const coAddr = [company?.address || "", company?.town || ""].filter(Boolean).join(", ");
    const coPhone = company?.phone || "";
    const coEmail = company?.email || "";

    const statusColor = { draft: "#92400e", approved: "#1e40af", paid: "#166534", reversed: "#92400e" }[voucher.status] || "#334155";
    const statusBg = { draft: "#fef3c7", approved: "#dbeafe", paid: "#dcfce7", reversed: "#fce7f3" }[voucher.status] || "#f1f5f9";

    const whtAmt = Number(voucher.whtAmount || 0);
    const netCash = Number(voucher.amount || 0) - whtAmt;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#0f172a;font-size:12px}
  .page{max-width:595px;margin:0 auto;padding:28px 32px}
  .hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid #0B3B2E}
  .logo-box{width:48px;height:48px;background:#0B3B2E;color:#fff;font-size:22px;font-weight:900;display:flex;align-items:center;justify-content:center;border-radius:8px;flex-shrink:0}
  .co-info{flex:1;margin-left:12px}
  .co-name{font-size:16px;font-weight:900;color:#0B3B2E}
  .co-sub{font-size:9px;color:#64748b;line-height:1.5}
  .doc-right{text-align:right}
  .doc-type{font-size:20px;font-weight:900;color:#0B3B2E;letter-spacing:-0.02em}
  .doc-no{font-size:10px;color:#64748b;margin-top:3px}
  .badge{display:inline-block;padding:3px 10px;border-radius:4px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;margin-top:6px;background:${statusBg};color:${statusColor}}
  .amt-box{background:#0B3B2E;color:#fff;border-radius:10px;padding:16px 20px;margin-bottom:16px}
  .amt-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6ee7b7}
  .amt-val{font-size:28px;font-weight:900;font-family:monospace;margin-top:4px}
  .fields-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px}
  .field{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px}
  .field.full{grid-column:1/-1}
  .field-label{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:2px}
  .field-val{font-size:11px;font-weight:700;color:#1e293b;line-height:1.4}
  .section-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:8px;margin-top:14px}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:14px}
  th{background:#f1f5f9;color:#475569;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;border:1px solid #e2e8f0}
  td{padding:6px 8px;border:1px solid #e2e8f0;color:#334155}
  td.dr{color:#1e40af;font-weight:700}
  td.cr{color:#166534;font-weight:700}
  td.wht{color:#92400e;font-weight:700}
  td.amt{text-align:right;font-family:monospace;font-weight:700}
  .wht-box{background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:10px 12px;margin-bottom:12px}
  .wht-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#92400e;margin-bottom:6px}
  .wht-row{display:flex;justify-content:space-between;font-size:11px;color:#78350f;margin-bottom:3px}
  .wht-row.net{font-weight:900;border-top:1px solid #fbbf24;margin-top:6px;padding-top:6px}
  .sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px}
  .sig-box{border-top:2px solid #334155;padding-top:6px}
  .sig-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8}
  .footer{margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0;text-align:center;font-size:9px;color:#94a3b8}
</style>
</head>
<body>
<div class="page">
  <div class="hdr">
    <div style="display:flex;align-items:center">
      <div class="logo-box">${esc(coName.slice(0,1).toUpperCase())}</div>
      <div class="co-info">
        <div class="co-name">${esc(coName)}</div>
        <div class="co-sub">${[coAddr, coPhone, coEmail].filter(Boolean).map(esc).join(" · ")}</div>
        ${company?.kraPin ? `<div class="co-sub">KRA PIN: ${esc(company.kraPin)}</div>` : ""}
      </div>
    </div>
    <div class="doc-right">
      <div class="doc-type">Payment Voucher</div>
      <div class="doc-no">${esc(voucher.voucherNo)}</div>
      <div class="doc-no">Due: ${esc(fmtDate(voucher.dueDate))}</div>
      <span class="badge">${esc(voucher.status || "draft")}</span>
    </div>
  </div>

  <div class="amt-box">
    <div class="amt-label">Payment Amount</div>
    <div class="amt-val">KES ${esc(fmt(voucher.amount))}</div>
  </div>

  <div class="fields-grid">
    <div class="field"><div class="field-label">Category</div><div class="field-val">${esc(CATEGORY_LABELS[voucher.category] || voucher.category || "—")}</div></div>
    <div class="field"><div class="field-label">Due Date</div><div class="field-val">${esc(fmtDate(voucher.dueDate))}</div></div>
    ${voucher.property ? `<div class="field"><div class="field-label">Property</div><div class="field-val">${esc(voucher.property?.propertyName || voucher.property?.name || "—")}</div></div>` : ""}
    ${voucher.reference ? `<div class="field"><div class="field-label">Reference</div><div class="field-val">${esc(voucher.reference)}</div></div>` : ""}
    ${voucher.serviceProvider ? `<div class="field"><div class="field-label">Service Provider</div><div class="field-val">${esc(voucher.serviceProvider?.name || "—")}${voucher.serviceProvider?.kraPin ? `<br/><span style="font-size:9px;color:#64748b">PIN: ${esc(voucher.serviceProvider.kraPin)}</span>` : ""}</div></div>` : ""}
    ${voucher.paidDate ? `<div class="field"><div class="field-label">Paid Date</div><div class="field-val">${esc(fmtDate(voucher.paidDate))}</div></div>` : ""}
    ${voucher.narration ? `<div class="field full"><div class="field-label">Narration</div><div class="field-val" style="font-weight:400">${esc(voucher.narration)}</div></div>` : ""}
  </div>

  ${whtAmt > 0 ? `
  <div class="wht-box">
    <div class="wht-title">Withholding Tax Deduction</div>
    <div class="wht-row"><span>Gross Amount</span><span>KES ${esc(fmt(voucher.amount))}</span></div>
    <div class="wht-row"><span>WHT Withheld</span><span>KES ${esc(fmt(whtAmt))}</span></div>
    <div class="wht-row net"><span>Net Cash Paid</span><span>KES ${esc(fmt(netCash))}</span></div>
  </div>` : ""}

  <div class="section-title">Journal Entries</div>
  <table>
    <thead><tr><th>Type</th><th>Account</th><th class="amt">Amount (KES)</th></tr></thead>
    <tbody>
      ${voucher.debitAccount ? `<tr><td class="dr">DR</td><td>${esc(voucher.debitAccount.code)} – ${esc(voucher.debitAccount.name)}</td><td class="amt">${esc(fmt(voucher.amount))}</td></tr>` : ""}
      ${voucher.liabilityAccount ? `<tr><td class="cr">CR</td><td>${esc(voucher.liabilityAccount.code)} – ${esc(voucher.liabilityAccount.name)}</td><td class="amt">${esc(fmt(voucher.amount))}</td></tr>` : ""}
      ${voucher.status === "paid" && voucher.liabilityAccount ? `<tr><td class="dr">DR</td><td>${esc(voucher.liabilityAccount.code)} – ${esc(voucher.liabilityAccount.name)}</td><td class="amt">${esc(fmt(voucher.amount))}</td></tr>` : ""}
      ${voucher.status === "paid" && voucher.settlementAccount ? `<tr><td class="cr">CR</td><td>${esc(voucher.settlementAccount.code)} – ${esc(voucher.settlementAccount.name)}</td><td class="amt">${esc(fmt(whtAmt > 0 ? netCash : voucher.amount))}</td></tr>` : ""}
      ${voucher.status === "paid" && whtAmt > 0 ? `<tr><td class="wht">CR</td><td>2141 – Withholding Tax Payable</td><td class="amt">${esc(fmt(whtAmt))}</td></tr>` : ""}
    </tbody>
  </table>

  <div class="sig-grid">
    <div class="sig-box"><div class="sig-label">Prepared By</div></div>
    <div class="sig-box"><div class="sig-label">Authorised By</div></div>
  </div>

  <div class="footer">
    ${esc(coName)} · Payment Voucher ${esc(voucher.voucherNo)} · Printed ${esc(fmtDate(new Date()))}
  </div>
</div>
</body>
</html>`;

    const pdf = await htmlToPdf(html);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="voucher-${esc(voucher.voucherNo)}.pdf"`,
      "Content-Length": pdf.length,
    });
    res.send(pdf);
  } catch (error) {
    next(error);
  }
};

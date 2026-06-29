import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import Company from "../../../models/Company.js";
import { htmlToPdf } from "../../../services/pdfService.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export const downloadJobReceiptPdf = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const [job, payments, company] = await Promise.all([
      CarWashJob.findOne({ _id: req.params.id, business })
        .populate("service", "name category vehicleType")
        .populate("serviceLines.service", "name category vehicleType")
        .populate("assignedStaff", "name role")
        .lean(),
      CarWashPayment.find({ job: req.params.id, business }).sort({ createdAt: 1 }).lean(),
      Company.findById(business).select("companyName name logo address town phone email").lean(),
    ]);

    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    const coName = company?.companyName || company?.name || "Car Wash";
    const coAddr = [company?.address || "", company?.town || ""].filter(Boolean).join(", ");
    const coPhone = company?.phone || "";
    const coEmail = company?.email || "";

    const lines = Array.isArray(job.serviceLines) && job.serviceLines.length
      ? job.serviceLines
      : [{ serviceName: job.serviceName || job.service?.name || "—", vehicleType: job.vehicleType, price: job.price, taxAmount: job.taxAmount }];

    const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const balance = Number(job.price || 0) - totalPaid;

    const linesHtml = lines.map((l) => `
      <tr>
        <td>${esc(l.serviceName || l.service?.name || "—")}</td>
        <td>${esc(l.vehicleType || "—")}</td>
        <td class="num">KES ${esc(fmt(l.price))}</td>
        ${Number(l.taxAmount || 0) > 0 ? `<td class="num tax">KES ${esc(fmt(l.taxAmount))}</td>` : `<td class="num">—</td>`}
      </tr>`).join("");

    const taxTotal = lines.reduce((s, l) => s + Number(l.taxAmount || 0), 0);

    const paymentsHtml = payments.map((p) => `
      <tr>
        <td>${esc(fmtDateTime(p.createdAt))}</td>
        <td>${esc(p.paymentMethod || p.method || "Cash")}</td>
        <td class="num">KES ${esc(fmt(p.amount))}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#0f172a;font-size:12px}
  .page{max-width:595px;margin:0 auto;padding:24px 28px}
  .hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #0B3B2E}
  .logo-box{width:48px;height:48px;background:#0B3B2E;color:#fff;font-size:22px;font-weight:900;display:flex;align-items:center;justify-content:center;border-radius:8px}
  .co-info{flex:1;margin-left:12px}
  .co-name{font-size:16px;font-weight:900;color:#0B3B2E}
  .co-sub{font-size:9px;color:#64748b;line-height:1.5}
  .doc-right{text-align:right}
  .doc-type{font-size:20px;font-weight:900;color:#0B3B2E;letter-spacing:-0.02em}
  .doc-no{font-size:10px;color:#64748b;margin-top:3px}
  .badge{display:inline-block;padding:3px 10px;border-radius:4px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;margin-top:6px}
  .badge-pending{background:#fef3c7;color:#92400e}.badge-paid{background:#dcfce7;color:#166534}.badge-done{background:#dbeafe;color:#1e40af}.badge-cancelled{background:#fce7f3;color:#9d174d}
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
  .meta-item{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px}
  .meta-label{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:2px}
  .meta-val{font-size:11px;font-weight:700;color:#1e293b}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px}
  th{background:#0B3B2E;color:#fff;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.06em;font-weight:700}
  td{padding:6px 8px;border-bottom:1px solid #f1f5f9;color:#334155}
  tr:last-child td{border-bottom:none}
  .num{text-align:right}
  .tax{color:#1d4ed8}
  .totals{margin-left:auto;width:220px;margin-bottom:14px}
  .totals-row{display:flex;justify-content:space-between;padding:4px 0;font-size:11px;color:#475569}
  .totals-row.main{font-weight:900;font-size:13px;color:#0B3B2E;border-top:2px solid #0B3B2E;margin-top:4px;padding-top:6px}
  .totals-row.tax-row{color:#1d4ed8;font-size:10px}
  .totals-row.balance{color:#dc2626;font-weight:700}
  .section-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:6px;margin-top:14px}
  .footer{margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0;text-align:center;font-size:9px;color:#94a3b8}
</style>
</head>
<body>
<div class="page">
  <div class="hdr">
    <div style="display:flex;align-items:center">
      <div class="logo-box">${esc(coName.slice(0, 1).toUpperCase())}</div>
      <div class="co-info">
        <div class="co-name">${esc(coName)}</div>
        <div class="co-sub">${[coAddr, coPhone, coEmail].filter(Boolean).map(esc).join(" · ")}</div>
      </div>
    </div>
    <div class="doc-right">
      <div class="doc-type">Receipt</div>
      <div class="doc-no">${esc(job.jobNumber || job._id?.toString().slice(-8).toUpperCase() || "")}</div>
      <div class="doc-no">${esc(fmtDateTime(job.createdAt))}</div>
      <span class="badge badge-${job.status === "paid" ? "paid" : job.status === "done" ? "done" : job.status === "cancelled" ? "cancelled" : "pending"}">${esc(job.status || "pending")}</span>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item"><div class="meta-label">Plate / Item</div><div class="meta-val">${esc(job.plateNumber || job.itemDescription || "—")}</div></div>
    <div class="meta-item"><div class="meta-label">Customer</div><div class="meta-val">${esc(job.customerName || "—")}</div></div>
    <div class="meta-item"><div class="meta-label">Job Type</div><div class="meta-val">${esc(job.jobType || "vehicle")}</div></div>
    <div class="meta-item"><div class="meta-label">Staff</div><div class="meta-val">${esc(Array.isArray(job.assignedStaff) ? job.assignedStaff.map((s) => s.name || "").filter(Boolean).join(", ") : job.assignedStaff?.name || "—")}</div></div>
  </div>

  <div class="section-title">Services</div>
  <table>
    <thead><tr><th>Service</th><th>Type</th><th class="num">Price</th><th class="num">VAT</th></tr></thead>
    <tbody>${linesHtml}</tbody>
  </table>

  <div class="totals">
    <div class="totals-row main"><span>Total</span><span>KES ${esc(fmt(job.price))}</span></div>
    ${taxTotal > 0 ? `<div class="totals-row tax-row"><span>VAT (inclusive)</span><span>KES ${esc(fmt(taxTotal))}</span></div>` : ""}
    <div class="totals-row"><span>Amount Paid</span><span>KES ${esc(fmt(totalPaid))}</span></div>
    ${balance > 0.005 ? `<div class="totals-row balance"><span>Balance Due</span><span>KES ${esc(fmt(balance))}</span></div>` : ""}
  </div>

  ${payments.length > 0 ? `
  <div class="section-title">Payment History</div>
  <table>
    <thead><tr><th>Date</th><th>Method</th><th class="num">Amount</th></tr></thead>
    <tbody>${paymentsHtml}</tbody>
  </table>` : ""}

  ${job.notes ? `<div class="section-title">Notes</div><div style="font-size:11px;color:#475569;padding:8px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0">${esc(job.notes)}</div>` : ""}

  <div class="footer">
    Thank you for your business · ${esc(coName)} · Printed ${esc(fmtDate(new Date()))}
  </div>
</div>
</body>
</html>`;

    const pdf = await htmlToPdf(html);
    const filename = `receipt-${esc(job.plateNumber || job.jobNumber || job._id.toString().slice(-8))}.pdf`;
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": pdf.length,
    });
    res.send(pdf);
  } catch (error) {
    next(error);
  }
};

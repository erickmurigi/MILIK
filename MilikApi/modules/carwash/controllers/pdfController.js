import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import Company from "../../../models/Company.js";
import { htmlToPdf } from "../../../services/pdfService.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";
import { documentPageHtml } from "../../../utils/printKitCore.js";
import { COMPANY_PRINT_FIELDS } from "../../../utils/printCompanyFields.js";

const esc = (v) => String(v ?? "").replace(/[^\w.-]/g, "");
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
      Company.findById(business).select(COMPANY_PRINT_FIELDS).lean(),
    ]);

    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    const lines = Array.isArray(job.serviceLines) && job.serviceLines.length
      ? job.serviceLines
      : [{ serviceName: job.serviceName || job.service?.name || "—", vehicleType: job.vehicleType, price: job.price, taxAmount: job.taxAmount }];

    const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const balance = Number(job.price || 0) - totalPaid;
    const taxTotal = lines.reduce((s, l) => s + Number(l.taxAmount || 0), 0);
    const currency = company?.baseCurrency || "KES";
    const money = (v) => `${currency} ${fmt(v)}`;
    const staff = Array.isArray(job.assignedStaff) ? job.assignedStaff.map((s) => s.name || "").filter(Boolean).join(", ") : "";
    const STATUS = { paid: ["Paid", "success"], done: ["Done", "info"], cancelled: ["Cancelled", "danger"] };
    const [statusLabel, statusTone] = STATUS[job.status] || [job.status || "Pending", "warning"];

    const html = documentPageHtml({
      company,
      docType: "Receipt",
      docNumber: job.jobNumber || job._id?.toString().slice(-8).toUpperCase() || "",
      status: { label: statusLabel, tone: statusTone },
      watermark: job.status === "paid" ? "PAID" : job.status === "cancelled" ? "VOID" : "",
      meta: [["Date", fmtDateTime(job.createdAt)]],
      parties: [
        { heading: "Customer", name: job.customerName || "—", lines: [job.customerPhone || ""] },
        { heading: job.jobType === "carpet" ? "Item" : "Vehicle", name: job.plateNumber || job.itemDescription || "—", lines: [`Job type: ${job.jobType || "vehicle"}`, staff ? `Staff: ${staff}` : ""] },
      ],
      table: {
        columns: [
          { label: "Service", value: (l) => l.serviceName || l.service?.name || "—", sub: (l) => l.vehicleType || "" },
          { label: `Price (${currency})`, align: "right", value: (l) => fmt(l.price) },
          { label: "VAT", align: "right", value: (l) => (Number(l.taxAmount || 0) > 0 ? fmt(l.taxAmount) : "—") },
        ],
        rows: lines,
      },
      totals: [
        ...(taxTotal > 0 ? [{ label: "VAT (inclusive)", value: money(taxTotal) }] : []),
        { label: "Amount paid", value: money(totalPaid) },
        ...(balance > 0.005 ? [{ label: "Balance due", value: money(balance), tone: "neg" }] : []),
        { label: "Total", value: money(job.price), hero: true },
      ],
      amountWords: { amount: Number(job.price || 0), currency },
      notes: [
        ...(payments.length
          ? [{ heading: "Payment history", items: payments.map((p) => `${fmtDateTime(p.createdAt)} — ${p.paymentMethod || p.method || "Cash"} — ${money(p.amount)}`) }]
          : []),
        ...(job.notes ? [{ heading: "Notes", text: job.notes }] : []),
      ],
      footerNote: "Thank you for your business.",
    });

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

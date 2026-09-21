import PaymentVoucher from "../../models/PaymentVoucher.js";
import Company from "../../models/Company.js";
import { htmlToPdf } from "../../services/pdfService.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { createError } from "../../utils/error.js";
import { documentPageHtml } from "../../utils/printKitCore.js";
import { COMPANY_PRINT_FIELDS } from "../../utils/printCompanyFields.js";

// used only for the download file name: keep letters, digits, dot, dash and underscore
const esc = (v) => String(v ?? "").replace(/[^\w.-]/g, "");
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
      Company.findById(businessId).select(`${COMPANY_PRINT_FIELDS} kraPin`).lean(),
    ]);

    if (!voucher) return next(createError(404, "Voucher not found"));

    const whtAmt = Number(voucher.whtAmount || 0);
    const netCash = Number(voucher.amount || 0) - whtAmt;
    const currency = company?.baseCurrency || "KES";
    const money = (v) => `${currency} ${fmt(v)}`;
    const account = (a) => (a ? `${a.code} – ${a.name}` : "");
    const paid = voucher.status === "paid";

    // journal lines: debit / credit columns
    const journal = [
      voucher.debitAccount && { account: account(voucher.debitAccount), debit: voucher.amount },
      voucher.liabilityAccount && { account: account(voucher.liabilityAccount), credit: voucher.amount },
      paid && voucher.liabilityAccount && { account: account(voucher.liabilityAccount), debit: voucher.amount },
      paid && voucher.settlementAccount && { account: account(voucher.settlementAccount), credit: whtAmt > 0 ? netCash : voucher.amount },
      paid && whtAmt > 0 && { account: "2141 – Withholding Tax Payable", credit: whtAmt },
    ].filter(Boolean);

    const STATUS = { draft: "warning", approved: "info", paid: "success", reversed: "danger" };
    const provider = voucher.serviceProvider;

    const html = documentPageHtml({
      company: { ...company, taxPIN: company?.taxPIN || company?.kraPin },
      docType: "Payment Voucher",
      docNumber: voucher.voucherNo,
      status: { label: voucher.status || "draft", tone: STATUS[voucher.status] || "neutral" },
      watermark: paid ? "PAID" : voucher.status === "reversed" ? "VOID" : "",
      meta: [["Due date", fmtDate(voucher.dueDate)], ...(voucher.paidDate ? [["Paid date", fmtDate(voucher.paidDate)]] : [])],
      parties: [
        {
          heading: "Pay to",
          name: provider?.name || "—",
          lines: [provider?.providerCode ? `Code: ${provider.providerCode}` : "", provider?.kraPin ? `KRA PIN: ${provider.kraPin}` : ""],
        },
        {
          heading: "Purpose",
          name: CATEGORY_LABELS[voucher.category] || voucher.category || "—",
          lines: [
            voucher.property ? `Property: ${voucher.property?.propertyName || voucher.property?.name}` : "",
            voucher.reference ? `Reference: ${voucher.reference}` : "",
            voucher.narration || "",
          ],
        },
      ],
      table: {
        columns: [
          { label: "Account", value: (r) => r.account },
          { label: `Debit (${currency})`, align: "right", value: (r) => (r.debit ? fmt(r.debit) : "") },
          { label: `Credit (${currency})`, align: "right", value: (r) => (r.credit ? fmt(r.credit) : "") },
        ],
        rows: journal,
        empty: "No journal lines yet",
      },
      totals: [
        ...(whtAmt > 0 ? [{ label: "Gross amount", value: money(voucher.amount) }, { label: "WHT withheld", value: money(whtAmt) }] : []),
        { label: whtAmt > 0 ? "Net cash paid" : "Payment amount", value: money(netCash), hero: true },
      ],
      amountWords: { amount: netCash, currency },
      signatures: [{ label: "Prepared by" }, { label: "Authorised by" }, { label: "Received by (payee)" }],
      stamp: true,
    });

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

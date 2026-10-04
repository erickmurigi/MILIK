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
        .populate("landlord", "landlordName taxPin")
        .populate("property", "propertyName name")
        .populate("lines.property", "propertyName name")
        .populate("lines.expenseAccount", "code name")
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

        const PAYMENT_METHOD_LABELS = { bank_transfer: "Bank transfer", mobile_money: "M-Pesa", cash: "Cash", cheque: "Cheque", other: "Other" };
    const STATUS = { draft: "warning", approved: "info", paid: "success", reversed: "danger" };
    const provider = voucher.serviceProvider;
    // A landlord payee is paid by name and KRA PIN, the same way a service provider is
    const landlordPayee = !provider && voucher.landlord && typeof voucher.landlord === "object" ? voucher.landlord : null;

    const html = documentPageHtml({
      company: { ...company, taxPIN: company?.taxPIN || company?.kraPin },
      docType: "Payment Voucher",
      docNumber: voucher.voucherNo,
      status: { label: voucher.status || "draft", tone: STATUS[voucher.status] || "neutral" },
      watermark: paid ? "PAID" : voucher.status === "reversed" ? "VOID" : "",
      meta: [
        ["Due date", fmtDate(voucher.dueDate)],
        ["Payment method", PAYMENT_METHOD_LABELS[voucher.paymentMethod] || "Bank transfer"],
        ...(voucher.paidDate ? [["Paid date", fmtDate(voucher.paidDate)]] : []),
      ],
      parties: [
        {
          heading: "Pay to",
          name: provider?.name || landlordPayee?.landlordName || "—",
          lines: [
            ...(provider
              ? [provider.providerCode ? `Code: ${provider.providerCode}` : "", provider.kraPin ? `KRA PIN: ${provider.kraPin}` : ""]
              : [landlordPayee?.taxPin ? `KRA PIN: ${landlordPayee.taxPin}` : ""]),
            // Where the money goes. Blank fields are left off the printout.
            voucher.payeeBank?.bankName ? `Bank: ${voucher.payeeBank.bankName}${voucher.payeeBank.branchName ? ` (${voucher.payeeBank.branchName})` : ""}` : "",
            voucher.payeeBank?.accountName ? `Account name: ${voucher.payeeBank.accountName}` : "",
            voucher.payeeBank?.accountNumber ? `Account no.: ${voucher.payeeBank.accountNumber}` : "",
            voucher.payeeBank?.mobileNumber ? `M-Pesa: ${voucher.payeeBank.mobileNumber}` : "",
          ],
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
      table: voucher.lines?.length
        ? {
            columns: [
              { label: "Description", value: (r) => r.description },
              { label: "Property", value: (r) => r.property },
              { label: "Account", value: (r) => r.account },
              { label: `Amount (${currency})`, align: "right", value: (r) => fmt(r.amount) },
              { label: `WHT (${currency})`, align: "right", value: (r) => (r.wht ? fmt(r.wht) : "") },
            ],
            rows: voucher.lines.map((line) => ({
              description: line.description || line.expenseAccount?.name || "",
              property: line.property?.propertyName || line.property?.name || "",
              account: account(line.expenseAccount) || account(voucher.debitAccount),
              amount: line.amount,
              wht: line.whtAmount,
            })),
            empty: "No lines",
          }
        : {
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

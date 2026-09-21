// Petty cash printouts (voucher and imprest reimbursement form), built with the shared print kit (utils/printKit.js) so they carry
// the same letterhead, footer and "Powered by Milik" stamp as every other document.
import { printDocument, printTabularList } from "./printKit";

const dt = (d) =>
  d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" }) : "—";

const money = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n) => `KES ${money(n)}`;

const CATEGORY_LABELS = {
  maintenance: "Maintenance & Repairs",
  cleaning: "Cleaning Supplies",
  security: "Security",
  transport: "Transport & Fuel",
  office_supplies: "Office Supplies",
  utilities: "Utilities (Common Areas)",
  garden: "Garden & Grounds",
  staff_welfare: "Staff Welfare",
  miscellaneous: "Miscellaneous",
};

const accountLabel = (a) => (a ? `${a.code ? `${a.code} — ` : ""}${a.name || ""}` : "—");
const userName = (user) => [user?.otherNames, user?.surname].filter(Boolean).join(" ") || user?.email || "Milik Admin";

// ─── Petty Cash Voucher ───────────────────────────────────────────────────────

export const printPettyCashVoucher = ({ disbursement, account, company, user }) => {
  if (!disbursement) return null;
  const preparedBy = userName(user);
  const isVoid = disbursement.status === "void";
  const catLabel = CATEGORY_LABELS[disbursement.category] || disbursement.category || "—";
  const currency = company?.baseCurrency || "KES";

  return printDocument({
    company,
    docType: "Petty Cash Voucher",
    docNumber: disbursement.voucherNumber || "",
    status: isVoid ? { label: "Void", tone: "danger" } : { label: String(disbursement.status || "active"), tone: "success" },
    watermark: isVoid ? "VOID" : "",
    meta: [["Date", dt(disbursement.date)]],
    parties: [
      { heading: "Petty cash account", name: account?.name || "—", lines: [account?.custodianName ? `Custodian: ${account.custodianName}` : ""] },
      {
        heading: "Expenditure",
        name: disbursement.description || "—",
        lines: [`Category: ${catLabel}`, disbursement.property?.propertyName ? `Property: ${disbursement.property.propertyName}` : ""],
      },
    ],
    details: {
      heading: "Accounting",
      rows: [
        ["GL expense account", accountLabel(disbursement.expenseAccountId)],
        ["Receipt", disbursement.receiptAttached ? "Attached" : `Not attached${disbursement.receiptNote ? ` — ${disbursement.receiptNote}` : ""}`],
        ...(isVoid && disbursement.voidReason ? [["Void reason", disbursement.voidReason]] : []),
      ],
    },
    totals: [{ label: "Amount", value: fmt(disbursement.amount), hero: true }],
    amountWords: { amount: Number(disbursement.amount || 0), currency },
    notes: [{ heading: "Note", text: "Official petty cash voucher. Retain with the receipt for audit purposes." }],
    signatures: [{ label: "Prepared by", name: preparedBy }, { label: "Approved by" }, { label: "Received by" }],
    stamp: true,
    preparedBy,
  });
};

// ─── Replenishment / Imprest Reimbursement Form ───────────────────────────────

export const printReplenishmentSummary = ({ replenishment, disbursements = [], account, company, user }) => {
  if (!replenishment) return null;
  const requestedBy = userName(user);

  const active = [...disbursements]
    .filter((d) => d.status !== "void")
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const totalSpent = active.reduce((s, d) => s + Number(d.amount || 0), 0);
  const balanceBefore = Number(replenishment.balanceBeforeReplenishment || 0);
  const repAmount = Number(replenishment.amount || 0);
  const floatAmt = Number(account?.floatAmount || 0);

  const STATUS_LABEL = { pending: "Pending approval", approved: "Approved", posted: "Posted to ledger", rejected: "Rejected" };
  const st = replenishment.status || "pending";

  return printTabularList({
    kicker: "Imprest reimbursement",
    title: replenishment.replenishmentNumber || "Imprest reimbursement",
    subtitle: `${STATUS_LABEL[st] || st} · requested ${dt(replenishment.requestDate)}`,
    company,
    summaryItems: [
      ["Petty cash account", account?.name || "—"],
      ["Custodian", account?.custodianName || "—"],
      ["Bank / fund source", accountLabel(replenishment.bankAccountId)],
      ["Float target", fmt(floatAmt)],
      ["Balance before top-up", fmt(balanceBefore)],
      ["Total disbursed", fmt(totalSpent)],
      ["Top-up requested", fmt(repAmount)],
    ],
    columns: [
      { label: "#", width: "32px", value: (d, i) => i + 1 },
      { label: "Voucher No.", bold: true, value: (d) => d.voucherNumber },
      { label: "Date", value: (d) => dt(d.date) },
      { label: "Description", value: (d) => d.description },
      { label: "Category", value: (d) => CATEGORY_LABELS[d.category] || d.category || "—" },
      { label: "Property", value: (d) => d.property?.propertyName || "—" },
      { label: "Amount (KES)", align: "right", value: (d) => money(d.amount) },
    ],
    rows: active,
    totalsRow: ["", "", "", "", "", `Total disbursed (${active.length} active voucher${active.length !== 1 ? "s" : ""})`, money(totalSpent)],
    notes: [
      ...(replenishment.notes ? [`Notes: ${replenishment.notes}`] : []),
      `Amount requested: ${fmt(repAmount)}. Official imprest reimbursement form; retain for audit purposes.`,
    ],
    signatures: [
      { label: "Requested by", name: requestedBy },
      { label: "Verified by" },
      { label: "Approved by" },
      { label: "Finance officer" },
    ],
  });
};

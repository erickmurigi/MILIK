// Shared invoice narration builder used by allocation workspace, tenant
// statement, and rental invoices. Derives the label from category + date —
// never the stored description — so narrations are uniform everywhere.

export const formatStatementLongPeriod = (dateValue) => {
  const dt = new Date(dateValue);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

export const cleanStatementPart = (value = "") =>
  String(value || "").replace(/\s+/g, " ").trim();

export const uniqueStatementParts = (values = []) =>
  Array.from(new Set(values.map((item) => cleanStatementPart(item)).filter(Boolean)));

export const extractUtilityNamesFromInvoice = (invoice = {}) => {
  const metadata = invoice?.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {};
  const values = [];

  if (Array.isArray(metadata.utilityBreakdown)) {
    metadata.utilityBreakdown.forEach((item) => {
      if (item?.label) values.push(item.label);
      if (item?.utilityType) values.push(item.utilityType);
      if (item?.name) values.push(item.name);
    });
  }

  [
    metadata.utilityType,
    metadata.meterUtilityType,
    metadata.statementUtilityType,
    metadata.billItemLabel,
    invoice.utilityType,
    invoice.utilityLabel,
  ].forEach((item) => { if (item) values.push(item); });

  return uniqueStatementParts(values)
    .map((item) => item.replace(/^utility\s*[-:·]?\s*/i, ""))
    .filter((item) => item && !/^combined rent/i.test(item));
};

export const getInvoiceCategoryLabel = (invoice = {}) => {
  const category = String(invoice?.category || "").toUpperCase();
  const metadata = invoice?.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {};
  const sourceType = String(metadata?.sourceTransactionType || metadata?.source || "").trim().toLowerCase();
  const billItemKey = String(metadata?.billItemKey || "").trim().toLowerCase();
  const billItemLabel = String(metadata?.billItemLabel || "").trim();

  // Stored label always wins — covers debit notes of any category
  if (billItemLabel) return billItemLabel;

  if (category === "RENT_CHARGE") return "Rent Charge";
  if (category === "UTILITY_CHARGE") return "Utility Charge";
  if (category === "DEPOSIT_CHARGE") return "Deposit Charge";
  if (category === "LATE_PENALTY_CHARGE") return "Late Penalty";
  if (category === "OTHER_CHARGE") {
    if (sourceType === "lease_agreement_fee" || billItemKey === "lease_agreement_fee" || billItemKey === "lease_fee")
      return "Lease Fee";
    return "Other Charge";
  }
  return "Charge";
};

// Returns "Rent Charge – July 2026", "Water – July 2026", "Security Deposit – July 2026", etc.
// When metadata.billItemLabel is set (always true for debit notes), it is the canonical label
// used across the allocation workspace, tenant statement, and rental invoices list.
// Pass unitLabel (e.g. "B4") to append " · B4" for multi-unit context.
export const buildInvoiceNarration = (invoice = {}, unitLabel = "") => {
  const category = String(invoice?.category || "").toUpperCase();
  const metadata = invoice?.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {};
  const period = formatStatementLongPeriod(invoice?.invoiceDate || invoice?.createdAt);
  const billItemLabel = String(metadata?.billItemLabel || "").trim();

  let baseLabel;

  if (category === "RENT_CHARGE") {
    const utilityBreakdown = Array.isArray(metadata.utilityBreakdown) ? metadata.utilityBreakdown : [];
    if (utilityBreakdown.length > 0) {
      // Combined rent+utility invoice — keep the breakdown label regardless of billItemLabel
      const utilityNames = uniqueStatementParts(
        utilityBreakdown.map((item) => item?.label || item?.utilityType || item?.name)
      );
      baseLabel = utilityNames.length > 0 ? `Rent + ${utilityNames.join(" + ")}` : (billItemLabel || "Rent Charge");
    } else {
      baseLabel = billItemLabel || "Rent Charge";
    }
  } else if (category === "UTILITY_CHARGE") {
    if (billItemLabel) {
      // Debit note or labelled invoice — use the specific label directly
      baseLabel = billItemLabel;
    } else {
      const utilityNames = extractUtilityNamesFromInvoice(invoice);
      baseLabel = utilityNames.length > 0 ? `Utility Charge (${utilityNames.join(" + ")})` : "Utility Charge";
    }
  } else {
    // DEPOSIT_CHARGE, LATE_PENALTY_CHARGE, OTHER_CHARGE, and any other type:
    // getInvoiceCategoryLabel already prioritises billItemLabel so this is consistent.
    baseLabel = getInvoiceCategoryLabel(invoice);
  }

  const description = cleanStatementPart(period ? `${baseLabel} – ${period}` : baseLabel || "Charge");
  return unitLabel ? `${description} · ${unitLabel}` : description;
};

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

  if (
    category === "OTHER_CHARGE" &&
    (
      sourceType === "lease_agreement_fee" ||
      billItemKey === "lease_agreement_fee" ||
      String(billItemLabel || "").toLowerCase() === "lease / agreement fee"
    )
  ) return "Lease / Agreement Fee";

  if (category === "RENT_CHARGE") return "Rent Charge";
  if (category === "UTILITY_CHARGE") return "Utility Charge";
  if (category === "DEPOSIT_CHARGE") return "Deposit Charge";
  if (category === "LATE_PENALTY_CHARGE") return "Late Penalty Charge";
  return invoice?.category || "Charge";
};

// Returns "Rent Charge – July 2026", "Utility Charge (Water) – July 2026", etc.
// Pass unitLabel (e.g. "BAR") to append " · BAR" when the invoice belongs to
// a specific unit that needs to be identified in a multi-unit context.
export const buildInvoiceNarration = (invoice = {}, unitLabel = "") => {
  const category = String(invoice?.category || "").toUpperCase();
  const metadata = invoice?.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {};
  const period = formatStatementLongPeriod(invoice?.invoiceDate || invoice?.createdAt);

  let baseLabel;

  if (category === "RENT_CHARGE") {
    const utilityBreakdown = Array.isArray(metadata.utilityBreakdown) ? metadata.utilityBreakdown : [];
    if (utilityBreakdown.length > 0) {
      const utilityNames = uniqueStatementParts(
        utilityBreakdown.map((item) => item?.label || item?.utilityType || item?.name)
      );
      baseLabel = utilityNames.length > 0 ? `Rent + ${utilityNames.join(" + ")}` : "Rent Charge";
    } else {
      baseLabel = "Rent Charge";
    }
  } else if (category === "UTILITY_CHARGE") {
    const utilityNames = extractUtilityNamesFromInvoice(invoice);
    baseLabel = utilityNames.length > 0 ? `Utility Charge (${utilityNames.join(" + ")})` : "Utility Charge";
  } else if (category === "DEPOSIT_CHARGE") {
    baseLabel = "Deposit Charge";
  } else if (category === "LATE_PENALTY_CHARGE") {
    baseLabel = "Late Penalty";
  } else if (category === "OTHER_CHARGE") {
    baseLabel = getInvoiceCategoryLabel(invoice) || cleanStatementPart(invoice?.description) || "Other Charge";
  } else {
    baseLabel = getInvoiceCategoryLabel(invoice) || "Charge";
  }

  const description = cleanStatementPart(
    period ? `${baseLabel} – ${period}` : baseLabel || invoice?.description || "Charge"
  );
  return unitLabel ? `${description} · ${unitLabel}` : description;
};

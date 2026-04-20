import puppeteer from "puppeteer";
import LandlordStatement from "../models/LandlordStatement.js";
import LandlordStatementLine from "../models/LandlordStatementLine.js";

let globalBrowser = null;
let browserInitializing = false;
const pdfBufferCache = new Map();
const pdfRenderPromises = new Map();
const MAX_PDF_CACHE_ENTRIES = 24;
const MAX_CONCURRENT_PDF_RENDERS = 3;
let activePdfRenderCount = 0;
const pdfRenderWaitQueue = [];

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const formatDepositMemoCurrency = (value) =>
  formatCurrency(Math.abs(Number(value || 0)));

const formatDate = (value) => (value ? new Date(value).toLocaleDateString("en-GB") : "");

const esc = (value = "") =>
  String(value || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));

const safeName = (value = "") => String(value || "").trim().toLowerCase();

const titleCase = (value = "") =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const normalizeUtilityKey = (value = "") => {
  const normalized = safeName(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "other_utility";
};

const resolveUtilityIdentity = (text = "", metadata = {}) => {
  const explicit =
    metadata?.utilityType ||
    metadata?.meterUtilityType ||
    metadata?.statementUtilityType ||
    metadata?.utilityName ||
    metadata?.utility ||
    metadata?.name ||
    "";

  if (safeName(explicit)) {
    return {
      key: normalizeUtilityKey(explicit),
      label: titleCase(explicit) || "Other Utility",
    };
  }

  const combined = safeName(text);
  if (/water/.test(combined)) return { key: "water", label: "Water" };
  if (/garbage|refuse|trash|waste/.test(combined)) {
    return { key: "garbage", label: "Garbage" };
  }

  return { key: "other_utility", label: "Other Utility" };
};

const normalizeRowUtilities = (row = {}) => {
  const map = {};

  if (row?.utilities && typeof row.utilities === "object") {
    Object.values(row.utilities).forEach((item) => {
      const key = normalizeUtilityKey(item?.key || item?.label || "");
      map[key] = {
        key,
        label: item?.label || titleCase(key.replace(/_/g, " ")) || "Other Utility",
        invoiced: Number(item?.invoiced || 0),
        paid: Number(item?.paid || 0),
      };
    });
  }

  const ensureLegacy = (key, label, invoiced, paid) => {
    if (Number(invoiced || 0) === 0 && Number(paid || 0) === 0) return;
    if (map[key]) return;
    map[key] = {
      key,
      label,
      invoiced: Number(invoiced || 0),
      paid: Number(paid || 0),
    };
  };

  ensureLegacy("garbage", "Garbage", row?.invoicedGarbage, row?.paidGarbage);
  ensureLegacy("water", "Water", row?.invoicedWater, row?.paidWater);

  return map;
};

const buildUtilityColumnsFromRows = (rows = []) => {
  const map = new Map();

  rows.forEach((row) => {
    Object.values(normalizeRowUtilities(row)).forEach((item) => {
      const key = normalizeUtilityKey(item?.key || item?.label || "");
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: item?.label || titleCase(key.replace(/_/g, " ")) || "Other Utility",
          invoiced: 0,
          paid: 0,
        });
      }
      const column = map.get(key);
      column.invoiced += Number(item?.invoiced || 0);
      column.paid += Number(item?.paid || 0);
    });
  });

  return Array.from(map.values())
    .filter((item) => Number(item.invoiced || 0) !== 0 || Number(item.paid || 0) !== 0)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
};

const getRowUtilityAmount = (row = {}, key = "", phase = "invoiced") =>
  Number(normalizeRowUtilities(row)?.[key]?.[phase] || 0);

const buildBusinessLocation = (business = {}) =>
  [
    business?.roadStreet,
    business?.Street,
    business?.town,
    business?.City,
    business?.country,
  ]
    .filter(Boolean)
    .join(", ");

const buildBusinessPostalAddress = (business = {}) =>
  business?.postalAddress || business?.POBOX || business?.address || "";

const buildStatementPdfCacheKey = (statement = {}) => {
  const updatedAt = statement?.updatedAt
    ? new Date(statement.updatedAt).getTime()
    : statement?.generatedAt
    ? new Date(statement.generatedAt).getTime()
    : 0;
  return `${String(statement?._id || "")}::${String(statement?.status || "")}::${updatedAt}`;
};

const rememberPdfBuffer = (cacheKey, buffer) => {
  if (!cacheKey || !buffer) return;
  pdfBufferCache.set(cacheKey, Buffer.from(buffer));
  while (pdfBufferCache.size > MAX_PDF_CACHE_ENTRIES) {
    const oldestKey = pdfBufferCache.keys().next().value;
    if (!oldestKey) break;
    pdfBufferCache.delete(oldestKey);
  }
};

const getCachedPdfBuffer = (cacheKey) => {
  if (!cacheKey || !pdfBufferCache.has(cacheKey)) return null;
  const cached = pdfBufferCache.get(cacheKey);
  pdfBufferCache.delete(cacheKey);
  pdfBufferCache.set(cacheKey, cached);
  return Buffer.from(cached);
};

const acquirePdfRenderSlot = async () => {
  if (activePdfRenderCount < MAX_CONCURRENT_PDF_RENDERS) {
    activePdfRenderCount += 1;
    return;
  }

  await new Promise((resolve) => pdfRenderWaitQueue.push(resolve));
  activePdfRenderCount += 1;
};

const releasePdfRenderSlot = () => {
  activePdfRenderCount = Math.max(0, activePdfRenderCount - 1);
  const next = pdfRenderWaitQueue.shift();
  if (next) next();
};

async function getBrowser() {
  if (globalBrowser) return globalBrowser;

  if (browserInitializing) {
    while (!globalBrowser) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return globalBrowser;
  }

  browserInitializing = true;
  globalBrowser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  browserInitializing = false;

  return globalBrowser;
}

const buildRowsFromLines = (lines = []) => {
  const map = new Map();

  for (const line of lines) {
    const tenant = line.tenant || {};
    const unit = line.unit || {};
    const key = `${unit._id || line.unit || ""}:${tenant._id || line.tenant || "vacant"}`;

    if (!map.has(key)) {
      map.set(key, {
        unit: unit.unitNumber || unit.name || line?.metadata?.unit || "-",
        accountNo: tenant.tenantCode || line?.metadata?.tenantCode || "-",
        tenantName: tenant.name || line?.metadata?.tenantName || "VACANT",
        perMonth: Number(line?.metadata?.perMonth || 0),
        openingBalance: 0,
        invoicedRent: 0,
        paidRent: 0,
        utilities: {},
        closingBalance: 0,
      });
    }

    const row = map.get(key);
    const amt = Number(line.amount || 0);
    const cat = String(line.category || "").toUpperCase();
    const hint = `${line.description || ""} ${line?.metadata?.expenseCategory || ""}`.trim();

    if (cat === "RENT_CHARGE") {
      row.invoicedRent += amt;
    } else if (cat === "UTILITY_CHARGE") {
      const utilityIdentity = resolveUtilityIdentity(hint, line?.metadata || {});
      if (!row.utilities[utilityIdentity.key]) {
        row.utilities[utilityIdentity.key] = {
          key: utilityIdentity.key,
          label: utilityIdentity.label,
          invoiced: 0,
          paid: 0,
        };
      }
      row.utilities[utilityIdentity.key].invoiced += amt;
    } else if (["RENT_RECEIPT_MANAGER", "RENT_RECEIPT_LANDLORD"].includes(cat)) {
      row.paidRent += amt;
    } else if (["UTILITY_RECEIPT_MANAGER", "UTILITY_RECEIPT_LANDLORD"].includes(cat)) {
      const utilityIdentity = resolveUtilityIdentity(hint, line?.metadata || {});
      if (!row.utilities[utilityIdentity.key]) {
        row.utilities[utilityIdentity.key] = {
          key: utilityIdentity.key,
          label: utilityIdentity.label,
          invoiced: 0,
          paid: 0,
        };
      }
      row.utilities[utilityIdentity.key].paid += amt;
    }
  }

  return Array.from(map.values()).map((row) => {
    const normalizedUtilities = normalizeRowUtilities(row);
    const totalUtilityInvoiced = Object.values(normalizedUtilities).reduce(
      (sum, item) => sum + Number(item?.invoiced || 0),
      0
    );
    const totalUtilityPaid = Object.values(normalizedUtilities).reduce(
      (sum, item) => sum + Number(item?.paid || 0),
      0
    );

    return {
      ...row,
      utilities: normalizedUtilities,
      invoicedGarbage: Number(normalizedUtilities.garbage?.invoiced || 0),
      invoicedWater: Number(normalizedUtilities.water?.invoiced || 0),
      paidGarbage: Number(normalizedUtilities.garbage?.paid || 0),
      paidWater: Number(normalizedUtilities.water?.paid || 0),
      closingBalance:
        Number(row.openingBalance || 0) +
        Number(row.invoicedRent || 0) +
        totalUtilityInvoiced -
        Number(row.paidRent || 0) -
        totalUtilityPaid,
    };
  });
};

const renderSimpleRows = (items, emptyText) => {
  if (!items.length) {
    return `<tr><td colspan="3" class="center muted">${esc(emptyText)}</td></tr>`;
  }

  return items.map((item) => `
    <tr>
      <td>${formatDate(item.date)}</td>
      <td>${esc(item.description)}</td>
      <td class="num">${formatCurrency(item.amount)}</td>
    </tr>
  `).join("");
};

const normalizePrintableRow = (item = {}) => ({
  date: item.date || item.transactionDate || null,
  description: String(item.description || item.notes || "").trim(),
  amount: Number(item.amount || 0),
  category: String(item.category || "").trim(),
  sourceId: String(item.sourceId || item.sourceTransactionId || item._id || "").trim(),
});

const toSafeDateKey = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value || "").trim().toLowerCase();
  }
  return parsed.toISOString().slice(0, 10);
};

const makeRowFingerprint = (item = {}) => {
  const row = normalizePrintableRow(item);
  return [
    row.sourceId || "",
    toSafeDateKey(row.date),
    row.description.toLowerCase(),
    Number(row.amount || 0).toFixed(2),
  ].join("|");
};

const sanitizePrintableSections = ({
  additionRows = [],
  expenseRows = [],
  directToLandlordRows = [],
}) => ({
  additionRows: additionRows
    .map(normalizePrintableRow)
    .filter((row) => row.amount > 0),
  expenseRows: expenseRows
    .map(normalizePrintableRow)
    .filter((row) => row.amount > 0),
  directToLandlordRows: directToLandlordRows
    .map(normalizePrintableRow)
    .filter((row) => row.amount > 0),
});

const sumPrintableAmounts = (rows = []) =>
  rows.reduce((sum, row) => sum + Number(row?.amount || 0), 0);

const resolveSettlementDisplay = (summary = {}) => {
  const netStatement = Number(summary?.netStatement || 0);
  const explicitRecovery = Math.max(
    Number(summary?.amountPayableByLandlordToManager || 0),
    0
  );
  const isNegative =
    Boolean(summary?.isNegativeStatement) || explicitRecovery > 0 || netStatement < 0;

  if (isNegative) {
    return {
      isNegative: true,
      label: summary?.settlementLabel || "Landlord owes manager",
      amount:
        explicitRecovery > 0 ? explicitRecovery : Math.abs(netStatement),
    };
  }

  const positiveAmount = Number(
    summary?.amountPayableToLandlord ??
      summary?.netPayableToLandlord ??
      (netStatement > 0 ? netStatement : 0)
  );

  return {
    isNegative: false,
    label: summary?.settlementLabel || "Net payable to landlord",
    amount: positiveAmount,
  };
};

export const generateStatementPdf = async (statementId, businessId) => {
  const statement = await LandlordStatement.findOne({
    _id: statementId,
    business: businessId,
  })
    .populate(
      "property",
      "propertyCode propertyName name address city commissionPercentage commissionRecognitionBasis commissionPaymentMode commissionFixedAmount totalUnits"
    )
    .populate(
      "landlord",
      "firstName lastName landlordName email phone phoneNumber"
    )
    .populate("business", "companyName name address phone phoneNo email slogan logo postalAddress roadStreet town country POBOX Street City")
    .lean();

  if (!statement) throw new Error("Statement not found or access denied");

  const cacheKey = buildStatementPdfCacheKey(statement);
  const cachedPdfBuffer = getCachedPdfBuffer(cacheKey);
  if (cachedPdfBuffer) return cachedPdfBuffer;

  if (pdfRenderPromises.has(cacheKey)) {
    return Buffer.from(await pdfRenderPromises.get(cacheKey));
  }

  const renderPromise = (async () => {
    const workspace = statement.metadata?.workspace || {};
    const workspaceHasRows = Array.isArray(workspace.rows) && workspace.rows.length > 0;

    const lines = workspaceHasRows
      ? []
      : await LandlordStatementLine.find({
          statement: statementId,
          business: businessId,
        })
          .populate("tenant", "name tenantCode")
          .populate("unit", "unitNumber name")
          .sort({ lineNumber: 1 })
          .lean();

    const rows = workspaceHasRows
      ? workspace.rows.map((row) => ({ ...row }))
      : buildRowsFromLines(lines);

  const utilityColumns =
    Array.isArray(workspace.utilityColumns) && workspace.utilityColumns.length > 0
      ? workspace.utilityColumns.map((item) => ({
          key: normalizeUtilityKey(item?.key || item?.label || ""),
          label: item?.label || titleCase(String(item?.key || item?.label || "").replace(/_/g, " ")) || "Other Utility",
          invoiced: Number(item?.invoiced || 0),
          paid: Number(item?.paid || 0),
        }))
      : buildUtilityColumnsFromRows(rows);

  const utilityTotalsMap = utilityColumns.reduce((acc, item) => {
    acc[item.key] = item;
    return acc;
  }, {});

  const totals = workspace.totals
    ? {
        ...workspace.totals,
        utilities: Array.isArray(workspace.totals?.utilities)
          ? workspace.totals.utilities.map((item) => ({
              key: normalizeUtilityKey(item?.key || item?.label || ""),
              label: item?.label || titleCase(String(item?.key || item?.label || "").replace(/_/g, " ")) || "Other Utility",
              invoiced: Number(item?.invoiced || 0),
              paid: Number(item?.paid || 0),
            }))
          : utilityColumns,
      }
    : {
    perMonth: rows.reduce((sum, row) => sum + Number(row.perMonth || 0), 0),
    openingBalance: rows.reduce(
      (sum, row) => sum + Number(row.openingBalance || row.balanceBF || 0),
      0
    ),
    invoicedRent: rows.reduce((sum, row) => sum + Number(row.invoicedRent || 0), 0),
    invoicedGarbage: Number(utilityTotalsMap.garbage?.invoiced || 0),
    invoicedWater: Number(utilityTotalsMap.water?.invoiced || 0),
    invoicedTax: rows.reduce((sum, row) => sum + Number(row.invoicedTax || 0), 0),
    paidRent: rows.reduce((sum, row) => sum + Number(row.paidRent || 0), 0),
    paidGarbage: Number(utilityTotalsMap.garbage?.paid || 0),
    paidWater: Number(utilityTotalsMap.water?.paid || 0),
    paidTax: rows.reduce((sum, row) => sum + Number(row.paidTax || 0), 0),
    utilityInvoiced: utilityColumns.reduce(
      (sum, row) => sum + Number(row.invoiced || 0),
      0
    ),
    utilityPaid: utilityColumns.reduce((sum, row) => sum + Number(row.paid || 0), 0),
    utilities: utilityColumns,
    closingBalance: rows.reduce(
      (sum, row) => sum + Number(row.closingBalance || row.balanceCF || 0),
      0
    ),
  };

  const rawExpenseRows = Array.isArray(workspace.expenseRows)
    ? workspace.expenseRows
    : [];
  const rawAdditionRows = Array.isArray(workspace.additionRows)
    ? workspace.additionRows
    : [];
  const rawDirectToLandlordRows = Array.isArray(workspace.directToLandlordRows)
    ? workspace.directToLandlordRows
    : [];

  const { additionRows, expenseRows, directToLandlordRows } =
    sanitizePrintableSections({
      additionRows: rawAdditionRows,
      expenseRows: rawExpenseRows,
      directToLandlordRows: rawDirectToLandlordRows,
    });

  const summary = workspace.summary || {};
  const depositMemo = workspace.depositMemo || {};
  const depositMemoRows = Array.isArray(depositMemo.rows) ? depositMemo.rows : [];
  const depositMemoTotals = depositMemo.totals || {};
  const broughtForwardCreditApplications = workspace.broughtForwardCreditApplications || {};
  const broughtForwardCreditApplicationRows = Array.isArray(broughtForwardCreditApplications.rows)
    ? broughtForwardCreditApplications.rows
    : [];
  const broughtForwardCreditApplicationTotals = broughtForwardCreditApplications.totals || {};
  const printableAdditionsTotal = sumPrintableAmounts(additionRows);
  const printableDeductionsTotal = sumPrintableAmounts(expenseRows);
  const printableDirectToLandlordTotal = sumPrintableAmounts(directToLandlordRows);
  const summaryBasisLabel =
    summary.settlementBasisLabel || summary.basisCollectionsLabel || "Manager-held collections";
  const summaryBasisAmount = Number(
    summary.settlementBasisAmount ?? summary.basisCollections ?? summary.managerCollections ?? 0
  );
  const utilityPassThroughLabel =
    summary.utilityPassThroughLabel || "Utilities (added as billed)";
  const utilityPassThroughAmount = Number(summary.utilityPassThroughAmount ?? 0);
  const invoiceVatPassThroughLabel =
    summary.invoiceVatPassThroughLabel || "Invoice VAT (pass-through)";
  const invoiceVatPassThroughAmount = Number(
    summary.invoiceVatPassThroughAmount ?? summary.totalInvoiceVatInvoiced ?? 0
  );
  const commissionAmount = Number(summary.commissionAmount || 0);
  const commissionTaxAmount = Number(summary.commissionTaxAmount || 0);
  const commissionGrossAmount = Number(
    summary.commissionGrossAmount ?? commissionAmount + commissionTaxAmount
  );
  const totalInvoiceVatReceived = Number(
    summary.totalInvoiceVatReceived ?? totals.paidTax ?? 0
  );
  const hasInvoiceVatColumn =
    Number(summary.totalInvoiceVatInvoiced || 0) > 0 ||
    totalInvoiceVatReceived > 0 ||
    rows.some((row) => Number(row?.invoicedTax || 0) > 0 || Number(row?.paidTax || 0) > 0);
  const nonCommissionDeductions = Number(
    summary.nonCommissionDeductions ??
      summary.totalExpenses ??
      Math.max(printableDeductionsTotal - commissionGrossAmount, 0)
  );
  const directToLandlordAmount = Number(
    summary.directToLandlordCollections ??
      summary.directToLandlordOffsets ??
      summary.totalDirectToLandlordCollections ??
      printableDirectToLandlordTotal
  );
  const additionsAmount = Number(
    summary.additions ?? summary.totalAdditions ?? printableAdditionsTotal
  );
  const openingSettlementBalance = Number(
    summary.openingLandlordSettlementBalance ?? summary.openingSettlementBalance ?? 0
  );
  const commissionBaseLabel = summary.commissionBaseLabel || "Commission base";
  const commissionBaseAmount = Number(summary.commissionBaseAmount || 0);
  const settlement = resolveSettlementDisplay(summary);

  const businessName =
    statement.business?.companyName || statement.business?.name || "Milik";
  const businessSlogan =
    statement.business?.slogan || "Modern Property Management";
  const businessLogo = statement.business?.logo || "";
  const businessPhone = statement.business?.phoneNo || statement.business?.phone || "";
  const businessEmail = statement.business?.email || "";
  const businessPostalAddress = buildBusinessPostalAddress(statement.business || {});
  const businessLocation = buildBusinessLocation(statement.business || {});

  const propertyName =
    statement.property?.propertyName ||
    statement.property?.name ||
    workspace.propertyLabel ||
    "Property";

  const landlordName =
    statement.landlord?.landlordName ||
    `${statement.landlord?.firstName || ""} ${statement.landlord?.lastName || ""}`.trim() ||
    workspace.landlordLabel ||
    "Landlord";

  const scheduleRowsHtml = rows
    .map(
      (row) => `
        <tr>
          <td>${esc(row.unit || row.unitNumber || "-")}</td>
          <td>${esc(row.accountNo || "-")}</td>
          <td>${esc(row.tenantName || "VACANT")}</td>
          <td class="num">${formatCurrency(row.perMonth || 0)}</td>
          <td class="num">${formatCurrency(row.openingBalance ?? row.balanceBF ?? 0)}</td>
          <td class="num">${formatCurrency(row.invoicedRent || 0)}</td>
          ${hasInvoiceVatColumn ? `<td class="num">${formatCurrency(row.invoicedTax || 0)}</td>` : ""}
          ${utilityColumns
            .map(
              (column) =>
                `<td class="num">${formatCurrency(
                  getRowUtilityAmount(row, column.key, "invoiced")
                )}</td>`
            )
            .join("")}
          <td class="num">${formatCurrency(row.paidRent || row.rentPaid || 0)}</td>
          ${hasInvoiceVatColumn ? `<td class="num">${formatCurrency(row.paidTax || 0)}</td>` : ""}
          ${utilityColumns
            .map(
              (column) =>
                `<td class="num">${formatCurrency(
                  getRowUtilityAmount(row, column.key, "paid")
                )}</td>`
            )
            .join("")}
          <td class="num strong">${formatCurrency(row.closingBalance ?? row.balanceCF ?? 0)}</td>
        </tr>
      `
    )
    .join("");

  const settlementSummaryRowsHtml = [
    {
      label: "Opening landlord settlement B/F",
      value: formatCurrency(openingSettlementBalance),
      tone: openingSettlementBalance < 0 ? "negative" : "",
    },
    {
      label: esc(summaryBasisLabel),
      value: formatCurrency(summaryBasisAmount),
      tone: "",
    },
    ...(utilityPassThroughAmount > 0
      ? [
          {
            label: esc(utilityPassThroughLabel),
            value: formatCurrency(utilityPassThroughAmount),
            tone: "",
          },
        ]
      : []),
    ...(invoiceVatPassThroughAmount > 0
      ? [
          {
            label: esc(invoiceVatPassThroughLabel),
            value: formatCurrency(invoiceVatPassThroughAmount),
            tone: "",
          },
        ]
      : []),
    {
      label: "Additions",
      value: formatCurrency(additionsAmount),
      tone: "",
    },
    {
      label: "Expenses & other deductions",
      value: formatCurrency(nonCommissionDeductions),
      tone: "",
    },
    {
      label: esc(commissionBaseLabel),
      value: formatCurrency(commissionBaseAmount),
      tone: "",
    },
    {
      label: "Commission",
      value: formatCurrency(commissionAmount),
      tone: "",
    },
    ...(commissionTaxAmount > 0
      ? [
          {
            label: "VAT on commission",
            value: formatCurrency(commissionTaxAmount),
            tone: "",
          },
        ]
      : []),
    {
      label: "Direct to landlord collections (memo)",
      value: formatCurrency(directToLandlordAmount),
      tone: "",
    },
    {
      label: esc(settlement.label),
      value: formatCurrency(settlement.amount),
      tone: settlement.isNegative ? "settlement-negative" : "settlement-positive",
    },
  ]
    .map(
      (item) => `
        <tr class="${item.tone || ""}">
          <td>${item.label}</td>
          <td class="num">${item.value}</td>
        </tr>
      `
    )
    .join("");

  const html = `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Landlord Statement</title>
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 10mm 8mm;
          font-family: Arial, Helvetica, sans-serif;
          color: #111827;
          background: #ffffff;
          font-size: 9px;
        }
        .sheet {
          width: 100%;
        }
        .header-table,
        .statement-table,
        .simple-table,
        .summary-table {
          width: 100%;
          border-collapse: collapse;
        }
        .header-table td {
          vertical-align: top;
        }
        .brand-cell {
          width: 78px;
          padding-right: 10px;
        }
        .brand-logo {
          width: 62px;
          height: 62px;
          object-fit: contain;
        }
        .brand-fallback {
          width: 62px;
          height: 62px;
          border: 1px solid #111827;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 700;
        }
        .business-name {
          font-size: 20px;
          font-weight: 700;
          margin: 0 0 2px;
        }
        .business-line {
          margin: 1px 0;
          color: #374151;
        }
        .statement-title {
          text-align: center;
          font-size: 13px;
          font-weight: 700;
          margin: 10px 0 4px;
          text-transform: uppercase;
        }
        .statement-subtitle {
          text-align: center;
          margin-bottom: 10px;
          font-size: 9px;
          color: #4b5563;
        }
        .meta-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 8px;
        }
        .meta-table td {
          padding: 2px 4px;
          vertical-align: top;
        }
        .meta-label {
          width: 86px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .meta-value {
          font-weight: 700;
        }
        .period-cell {
          text-align: right;
          font-weight: 700;
          white-space: nowrap;
        }
        .section-title {
          margin: 10px 0 4px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          border-bottom: 1px solid #111827;
          padding-bottom: 2px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th,
        td {
          border: 1px solid #111827;
          padding: 3px 4px;
          vertical-align: middle;
        }
        th {
          background: #f3f4f6;
          font-weight: 700;
        }
        .num {
          text-align: right;
          white-space: nowrap;
        }
        .center {
          text-align: center;
        }
        .muted {
          color: #6b7280;
        }
        .schedule-wrap {
          overflow: hidden;
        }
        .statement-table {
          font-size: 8px;
        }
        .statement-table th,
        .statement-table td {
          padding: 2px 3px;
        }
        .statement-table thead tr:first-child th {
          text-align: center;
        }
        .totals-row td {
          font-weight: 700;
          background: #f9fafb;
        }
        .two-col {
          width: 100%;
          border-collapse: collapse;
          margin-top: 8px;
        }
        .two-col > tbody > tr > td {
          width: 50%;
          vertical-align: top;
          border: none;
          padding: 0;
        }
        .two-col > tbody > tr > td:first-child {
          padding-right: 6px;
        }
        .two-col > tbody > tr > td:last-child {
          padding-left: 6px;
        }
        .summary-head {
          background: #0B3B2E;
          color: #ffffff;
        }
        .summary-head th {
          background: #0B3B2E;
          color: #ffffff;
        }
        .summary-table td,
        .summary-table th {
          padding: 4px 5px;
        }
        .summary-table .label {
          font-weight: 700;
        }
        .summary-table .final-row td {
          font-weight: 700;
          font-size: 10px;
          background: #f3f4f6;
        }
        .negative {
          color: #991b1b;
        }
        .footnote {
          margin-top: 8px;
          font-size: 8px;
          color: #6b7280;
        }
      </style>
    </head>
    <body>
      <div class="sheet">
        <table class="header-table">
          <tr>
            <td class="brand-cell">
              ${businessLogo ? `<img src="${esc(businessLogo)}" alt="logo" class="brand-logo" />` : `<div class="brand-fallback">M</div>`}
            </td>
            <td>
              <div class="business-name">${esc(businessName)}</div>
              ${businessSlogan ? `<div class="business-line">${esc(businessSlogan)}</div>` : ""}
              ${businessPostalAddress ? `<div class="business-line">${esc(businessPostalAddress)}</div>` : ""}
              ${businessLocation ? `<div class="business-line">${esc(businessLocation)}</div>` : ""}
              <div class="business-line">${businessPhone ? `TEL: ${esc(businessPhone)}` : ""}${businessPhone && businessEmail ? " | " : ""}${businessEmail ? `EMAIL: ${esc(businessEmail)}` : ""}</div>
            </td>
            <td class="period-cell">
              <div>Statement No: ${esc(statement.statementNumber || "-")}</div>
              <div>Generated: ${formatDate(statement.generatedAt || statement.updatedAt || new Date())}</div>
            </td>
          </tr>
        </table>

        <div class="statement-title">Property Account Statement - ${esc(String(statement?.metadata?.statementType || statement?.metadata?.workspace?.statementType || statement?.statementType || "Provisional").toUpperCase())}</div>
        <div class="statement-subtitle">Professional landlord schedule and settlement summary</div>

        <table class="meta-table">
          <tr>
            <td class="meta-label">Landlord</td>
            <td class="meta-value">${esc(landlordName)}</td>
            <td class="period-cell">STATEMENT PERIOD ${esc(workspace.periodLabel || `${formatDate(statement.periodStart)} - ${formatDate(statement.periodEnd)}`)}</td>
          </tr>
          <tr>
            <td class="meta-label">Property</td>
            <td class="meta-value">${esc(propertyName)}</td>
            <td></td>
          </tr>
        </table>

        <div class="section-title">Statement Schedule</div>
        <div class="schedule-wrap">
          <table class="statement-table">
            <thead>
              <tr>
                <th rowspan="2">Unit</th>
                <th rowspan="2">A/c No.</th>
                <th rowspan="2">Tenant/Resident</th>
                <th rowspan="2" class="num">Per Month</th>
                <th rowspan="2" class="num">Balance B/F</th>
                <th colspan="${1 + (hasInvoiceVatColumn ? 1 : 0) + utilityColumns.length}">Amount Invoiced</th>
                <th colspan="${1 + (hasInvoiceVatColumn ? 1 : 0) + utilityColumns.length}">Amount Received</th>
                <th rowspan="2" class="num">Balance C/F</th>
              </tr>
              <tr>
                <th class="num">Rent</th>
                ${hasInvoiceVatColumn ? `<th class="num">Rent VAT</th>` : ""}
                ${utilityColumns.map((column) => `<th class="num">${esc(column.label)}</th>`).join("")}
                <th class="num">Rent</th>
                ${hasInvoiceVatColumn ? `<th class="num">Rent VAT</th>` : ""}
                ${utilityColumns.map((column) => `<th class="num">${esc(column.label)}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${scheduleRowsHtml}
              <tr class="totals-row">
                <td colspan="3" class="num">Total</td>
                <td class="num">${formatCurrency(totals.perMonth || 0)}</td>
                <td class="num">${formatCurrency(totals.openingBalance ?? summary.openingBalance ?? 0)}</td>
                <td class="num">${formatCurrency(totals.invoicedRent ?? summary.rentInvoiced ?? 0)}</td>
                ${hasInvoiceVatColumn ? `<td class="num">${formatCurrency(totals.invoicedTax ?? summary.totalInvoiceVatInvoiced ?? 0)}</td>` : ""}
                ${utilityColumns.map((column) => `<td class="num">${formatCurrency(column?.invoiced || 0)}</td>`).join("")}
                <td class="num">${formatCurrency(totals.paidRent ?? summary.totalRentReceived ?? 0)}</td>
                ${hasInvoiceVatColumn ? `<td class="num">${formatCurrency(totals.paidTax ?? totalInvoiceVatReceived ?? 0)}</td>` : ""}
                ${utilityColumns.map((column) => `<td class="num">${formatCurrency(column?.paid || 0)}</td>`).join("")}
                <td class="num">${formatCurrency(totals.closingBalance ?? summary.closingBalance ?? 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <table class="two-col">
          <tr>
            <td>
              <div class="section-title">Additions</div>
              <table class="simple-table">
                <thead>
                  <tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr>
                </thead>
                <tbody>${renderSimpleRows(additionRows, "No additions posted in this period")}</tbody>
                <tfoot>
                  <tr><td colspan="2" class="num">Total</td><td class="num">${formatCurrency(additionsAmount)}</td></tr>
                </tfoot>
              </table>

              <div class="section-title">Expenses & Deductions</div>
              <table class="simple-table">
                <thead>
                  <tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr>
                </thead>
                <tbody>${renderSimpleRows(expenseRows, "No expenses or deductions posted in this period")}</tbody>
                <tfoot>
                  <tr><td colspan="2" class="num">Total</td><td class="num">${formatCurrency(printableDeductionsTotal)}</td></tr>
                </tfoot>
              </table>

              ${broughtForwardCreditApplicationRows.length > 0 ? `
                <div class="section-title">B/F Credits Applied</div>
                <table class="simple-table">
                  <thead>
                    <tr><th>Receipt / Credit</th><th>Applied To</th><th class="num">Amount</th></tr>
                  </thead>
                  <tbody>
                    ${broughtForwardCreditApplicationRows.map((row) => `
                      <tr>
                        <td>${esc(row.receiptReference || row.description || "B/F credit")}</td>
                        <td>${esc(row.chargeReference || row.description || "Applied charge")}</td>
                        <td class="num">${formatCurrency(row.amount || 0)}</td>
                      </tr>`).join("")}
                  </tbody>
                  <tfoot>
                    <tr><td colspan="2" class="num">Total applied</td><td class="num">${formatCurrency(broughtForwardCreditApplicationTotals.totalApplied || 0)}</td></tr>
                  </tfoot>
                </table>` : ""}
            </td>
            <td>
              <div class="section-title">Direct to Landlord Collections</div>
              <table class="simple-table">
                <thead>
                  <tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr>
                </thead>
                <tbody>${renderSimpleRows(directToLandlordRows, "No direct-to-landlord collections posted in this period")}</tbody>
                <tfoot>
                  <tr><td colspan="2" class="num">Total</td><td class="num">${formatCurrency(directToLandlordAmount)}</td></tr>
                </tfoot>
              </table>

              ${depositMemoRows.length > 0 ? `
                <div class="section-title">Deposit Memorandum</div>
                <table class="simple-table">
                  <thead>
                    <tr><th>Holder</th><th class="num">Opening</th><th class="num">Billed / Adj.</th><th class="num">Received</th><th class="num">Closing</th></tr>
                  </thead>
                  <tbody>
                    ${depositMemoRows.map((row) => `
                      <tr>
                        <td>${esc(row.label)}</td>
                        <td class="num">${formatDepositMemoCurrency(row.openingBalance)}</td>
                        <td class="num">${formatDepositMemoCurrency(row.billed)}</td>
                        <td class="num">${formatDepositMemoCurrency(row.received)}</td>
                        <td class="num">${formatDepositMemoCurrency(row.closingBalance)}</td>
                      </tr>`).join("")}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td class="num">Total</td>
                      <td class="num">${formatDepositMemoCurrency(depositMemoTotals.openingBalance || 0)}</td>
                      <td class="num">${formatDepositMemoCurrency(depositMemoTotals.billed || 0)}</td>
                      <td class="num">${formatDepositMemoCurrency(depositMemoTotals.received || 0)}</td>
                      <td class="num">${formatDepositMemoCurrency(depositMemoTotals.closingBalance || 0)}</td>
                    </tr>
                  </tfoot>
                </table>` : ""}

              <div class="section-title">Statement Summary</div>
              <table class="summary-table">
                <thead class="summary-head">
                  <tr><th colspan="2">Settlement Summary</th></tr>
                </thead>
                <tbody>
                  <tr><td class="label">Opening landlord settlement B/F</td><td class="num ${openingSettlementBalance < 0 ? "negative" : ""}">${formatCurrency(openingSettlementBalance)}</td></tr>
                  <tr><td class="label">${esc(summaryBasisLabel)}</td><td class="num">${formatCurrency(summaryBasisAmount)}</td></tr>
                  ${utilityPassThroughAmount > 0 ? `<tr><td class="label">${esc(utilityPassThroughLabel)}</td><td class="num">${formatCurrency(utilityPassThroughAmount)}</td></tr>` : ""}
                  ${invoiceVatPassThroughAmount > 0 ? `<tr><td class="label">${esc(invoiceVatPassThroughLabel)}</td><td class="num">${formatCurrency(invoiceVatPassThroughAmount)}</td></tr>` : ""}
                  <tr><td class="label">Additions</td><td class="num">${formatCurrency(additionsAmount)}</td></tr>
                  <tr><td class="label">Expenses & other deductions</td><td class="num">${formatCurrency(nonCommissionDeductions)}</td></tr>
                  <tr><td class="label">${esc(commissionBaseLabel)}</td><td class="num">${formatCurrency(commissionBaseAmount)}</td></tr>
                  <tr><td class="label">Commission</td><td class="num">${formatCurrency(commissionAmount)}</td></tr>
                  ${commissionTaxAmount > 0 ? `<tr><td class="label">VAT on commission</td><td class="num">${formatCurrency(commissionTaxAmount)}</td></tr>` : ""}
                  <tr><td class="label">Direct to landlord collections (memo)</td><td class="num">${formatCurrency(directToLandlordAmount)}</td></tr>
                  <tr class="final-row"><td class="label">${esc(settlement.label)}</td><td class="num ${settlement.isNegative ? "negative" : ""}">${formatCurrency(settlement.amount)}</td></tr>
                </tbody>
              </table>
            </td>
          </tr>
        </table>

        <div class="footnote">Generated from MILIK statement workspace. This print layout is kept compact and wide so schedule columns fit within the in-system print preview and downloaded PDF.</div>
      </div>
    </body>
  </html>`;
    await acquirePdfRenderSlot();
    try {
      const page = await createPdfPage();

      await page.setViewport({
        width: 1600,
        height: 1000,
        deviceScaleFactor: 1,
      });
      page.setDefaultNavigationTimeout(0);
      page.setDefaultTimeout(0);

      await page.setContent(html, { waitUntil: "domcontentloaded" });

      const pdfBuffer = await page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
        margin: { top: "10mm", right: "8mm", bottom: "10mm", left: "8mm" },
      });

      try {
        await page.close();
      } catch {
        // ignore page close errors for disconnected sessions
      }

      rememberPdfBuffer(cacheKey, pdfBuffer);
      return Buffer.from(pdfBuffer);
    } finally {
      releasePdfRenderSlot();
    }
  })();

  pdfRenderPromises.set(cacheKey, renderPromise);

  try {
    return Buffer.from(await renderPromise);
  } finally {
    pdfRenderPromises.delete(cacheKey);
  }
};

export default { generateStatementPdf };
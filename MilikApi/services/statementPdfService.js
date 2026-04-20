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
          padding: 18px;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 11px;
          color: #0f172a;
          background: #ffffff;
        }
        .sheet {
          width: 100%;
        }
        .hero {
          border: 1px solid #dbe3ea;
          border-radius: 18px;
          overflow: hidden;
          margin-bottom: 14px;
        }
        .hero-top {
          background: linear-gradient(135deg, #0b3b2e 0%, #123f34 52%, #1e4d3f 100%);
          color: white;
          padding: 18px 20px;
        }
        .hero-grid {
          display: table;
          width: 100%;
          border-spacing: 0;
        }
        .hero-left,
        .hero-right {
          display: table-cell;
          vertical-align: top;
        }
        .hero-right {
          width: 225px;
          padding-left: 18px;
        }
        .brand {
          display: table;
          width: 100%;
        }
        .brand-logo-wrap,
        .brand-copy {
          display: table-cell;
          vertical-align: top;
        }
        .brand-logo-wrap {
          width: 84px;
          padding-right: 14px;
        }
        .brand-logo,
        .brand-fallback {
          width: 72px;
          height: 72px;
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.24);
          background: rgba(255,255,255,0.10);
          object-fit: contain;
        }
        .brand-fallback {
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          font-weight: 800;
          letter-spacing: 1px;
        }
        .eyebrow {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 2px;
          opacity: 0.82;
          margin-bottom: 6px;
        }
        .brand-name {
          margin: 0;
          font-size: 24px;
          line-height: 1.15;
        }
        .brand-slogan {
          margin-top: 5px;
          font-size: 12px;
          font-weight: 600;
          color: rgba(255,255,255,0.92);
        }
        .brand-line {
          margin-top: 4px;
          font-size: 11px;
          line-height: 1.5;
          color: rgba(255,255,255,0.90);
        }
        .meta-card {
          border: 1px solid rgba(255,255,255,0.22);
          background: rgba(255,255,255,0.10);
          border-radius: 16px;
          padding: 12px 14px;
        }
        .meta-row {
          margin-top: 8px;
          font-size: 11px;
          line-height: 1.5;
        }
        .hero-bottom {
          background: #f8fafc;
          padding: 14px 16px;
          border-top: 1px solid #dbe3ea;
        }
        .top-cards {
          display: table;
          width: 100%;
          border-spacing: 8px 0;
          table-layout: fixed;
          margin-left: -8px;
          margin-right: -8px;
        }
        .top-card {
          display: table-cell;
          vertical-align: top;
          border: 1px solid #dbe3ea;
          border-radius: 14px;
          background: white;
          padding: 11px 12px;
        }
        .top-card .label {
          font-size: 10px;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 1.8px;
          margin-bottom: 6px;
        }
        .top-card .value {
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          line-height: 1.4;
        }
        .top-card .hint {
          margin-top: 4px;
          font-size: 10px;
          color: #64748b;
          line-height: 1.4;
        }
        .section {
          margin-top: 14px;
          page-break-inside: avoid;
        }
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 10px;
          margin-bottom: 8px;
        }
        .section-title {
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
          margin: 0;
        }
        .section-desc {
          margin: 3px 0 0;
          font-size: 11px;
          color: #64748b;
        }
        .card {
          border: 1px solid #dbe3ea;
          border-radius: 16px;
          overflow: hidden;
          background: #ffffff;
        }
        .card-accent {
          height: 4px;
          background: linear-gradient(90deg, #0b3b2e 0%, #f59e0b 100%);
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th, td {
          border: 1px solid #dbe3ea;
          padding: 6px 7px;
          vertical-align: top;
        }
        thead th {
          background: #0f3f34;
          color: white;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        tbody tr:nth-child(even) td {
          background: #f8fafc;
        }
        tfoot td {
          background: #eef2f7;
          font-weight: 700;
        }
        .num { text-align: right; white-space: nowrap; }
        .center { text-align: center; }
        .strong { font-weight: 700; }
        .muted { color: #64748b; }
        .two-col {
          display: table;
          width: 100%;
          border-spacing: 12px 0;
          table-layout: fixed;
          margin-left: -12px;
          margin-right: -12px;
        }
        .col {
          display: table-cell;
          vertical-align: top;
          width: 50%;
          padding-left: 12px;
          padding-right: 12px;
        }
        .summary-table td:first-child {
          font-weight: 600;
          color: #334155;
        }
        .summary-table td:last-child {
          font-weight: 700;
        }
        .summary-table tr.negative td {
          background: #fef2f2;
          color: #b91c1c;
        }
        .summary-table tr.settlement-positive td {
          background: #0f172a;
          color: white;
          font-size: 12px;
          font-weight: 700;
        }
        .summary-table tr.settlement-negative td {
          background: #fef2f2;
          color: #b91c1c;
          font-size: 12px;
          font-weight: 700;
        }
        .stack {
          padding: 10px 12px 12px;
        }
        .item-list {
          display: grid;
          gap: 8px;
          padding: 10px 12px 12px;
        }
        .item {
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          border-radius: 12px;
          padding: 9px 10px;
        }
        .item-title {
          font-size: 11px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 3px;
        }
        .item-sub {
          font-size: 10px;
          color: #64748b;
          line-height: 1.45;
          margin: 0;
        }
        .item-amount {
          float: right;
          font-size: 11px;
          font-weight: 700;
          color: #0f172a;
          margin-left: 8px;
        }
        .metric-strip {
          display: table;
          width: 100%;
          border-spacing: 8px 0;
          table-layout: fixed;
          margin-top: 10px;
          margin-left: -8px;
          margin-right: -8px;
        }
        .metric {
          display: table-cell;
          vertical-align: top;
          border: 1px solid #dbe3ea;
          border-radius: 14px;
          background: #f8fafc;
          padding: 10px 12px;
        }
        .metric .label {
          font-size: 10px;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          margin-bottom: 4px;
        }
        .metric .value {
          font-size: 13px;
          font-weight: 700;
        }
        .footnote {
          margin-top: 10px;
          font-size: 10px;
          color: #64748b;
        }
      </style>
    </head>
    <body>
      <div class="sheet">
        <div class="hero">
          <div class="hero-top">
            <div class="hero-grid">
              <div class="hero-left">
                <div class="brand">
                  <div class="brand-logo-wrap">
                    ${
                      businessLogo
                        ? `<img src="${esc(businessLogo)}" alt="${esc(businessName)} logo" class="brand-logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />`
                        : ``
                    }
                    <div class="brand-fallback" ${businessLogo ? `style="display:none;"` : ``}>M</div>
                  </div>
                  <div class="brand-copy">
                    <div class="eyebrow">MILIK landlord statement</div>
                    <h1 class="brand-name">${esc(businessName)}</h1>
                    <div class="brand-slogan">${esc(businessSlogan)}</div>
                    ${businessPostalAddress ? `<div class="brand-line">${esc(businessPostalAddress)}</div>` : ""}
                    ${businessLocation ? `<div class="brand-line">${esc(businessLocation)}</div>` : ""}
                    <div class="brand-line">
                      ${businessPhone ? `TEL: ${esc(businessPhone)}` : ""}
                      ${businessPhone && businessEmail ? ` &nbsp;|&nbsp; ` : ""}
                      ${businessEmail ? `EMAIL: ${esc(businessEmail)}` : ""}
                    </div>
                  </div>
                </div>
              </div>
              <div class="hero-right">
                <div class="meta-card">
                  <div class="eyebrow">Statement meta</div>
                  <div class="meta-row"><strong>Statement #</strong><br />${esc(statement.statementNumber || "")}</div>
                  <div class="meta-row"><strong>Period</strong><br />${formatDate(statement.periodStart)} - ${formatDate(statement.periodEnd)}</div>
                  <div class="meta-row"><strong>Generated</strong><br />${formatDate(new Date())}</div>
                </div>
              </div>
            </div>
          </div>
          <div class="hero-bottom">
            <div class="top-cards">
              <div class="top-card">
                <div class="label">Property</div>
                <div class="value">${esc(propertyName)}</div>
                <div class="hint">Property account statement</div>
              </div>
              <div class="top-card">
                <div class="label">Landlord</div>
                <div class="value">${esc(landlordName)}</div>
                <div class="hint">Linked statement beneficiary</div>
              </div>
              <div class="top-card">
                <div class="label">Settlement</div>
                <div class="value">${esc(settlement.label)}</div>
                <div class="hint">${formatCurrency(settlement.amount)}</div>
              </div>
              <div class="top-card">
                <div class="label">Statement type</div>
                <div class="value">${esc(String(statement?.metadata?.statementType || statement?.metadata?.workspace?.statementType || "provisional").toUpperCase())}</div>
                <div class="hint">Preview and PDF parity</div>
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-header">
            <div>
              <h2 class="section-title">Statement schedule</h2>
              <p class="section-desc">Compact tenant schedule showing brought-forward balance, current billing, collections, and closing position.</p>
            </div>
          </div>
          <div class="card">
            <div class="card-accent"></div>
            <table>
              <thead>
                <tr>
                  <th rowspan="2">Unit</th>
                  <th rowspan="2">A/c No.</th>
                  <th rowspan="2">Tenant / Resident</th>
                  <th rowspan="2" class="num">Per Month</th>
                  <th rowspan="2" class="num">Balance B/F</th>
                  <th colspan="${(hasInvoiceVatColumn ? 2 : 1) + utilityColumns.length}" class="center">Amount Invoiced</th>
                  <th colspan="${(hasInvoiceVatColumn ? 2 : 1) + utilityColumns.length}" class="center">Amount Paid</th>
                  <th rowspan="2" class="num">Balance C/F</th>
                </tr>
                <tr>
                  <th class="num">Rent</th>
                  ${hasInvoiceVatColumn ? `<th class="num">VAT</th>` : ""}
                  ${utilityColumns.map((column) => `<th class="num">${esc(column.label)}</th>`).join("")}
                  <th class="num">Rent</th>
                  ${hasInvoiceVatColumn ? `<th class="num">VAT</th>` : ""}
                  ${utilityColumns.map((column) => `<th class="num">${esc(column.label)}</th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${scheduleRowsHtml || `<tr><td colspan="${8 + (hasInvoiceVatColumn ? 2 : 0) + utilityColumns.length * 2}" class="center muted">No tenant or unit rows were generated for this period.</td></tr>`}
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="3" class="num">Total</td>
                  <td class="num">${formatCurrency(totals.perMonth)}</td>
                  <td class="num">${formatCurrency(totals.openingBalance)}</td>
                  <td class="num">${formatCurrency(totals.invoicedRent)}</td>
                  ${hasInvoiceVatColumn ? `<td class="num">${formatCurrency(totals.invoicedTax || summary.totalInvoiceVatInvoiced || 0)}</td>` : ""}
                  ${utilityColumns
                    .map(
                      (column) =>
                        `<td class="num">${formatCurrency(
                          Number(
                            (Array.isArray(totals.utilities) ? totals.utilities : utilityColumns).find(
                              (item) => item.key === column.key
                            )?.invoiced || column.invoiced || 0
                          )
                        )}</td>`
                    )
                    .join("")}
                  <td class="num">${formatCurrency(totals.paidRent)}</td>
                  ${hasInvoiceVatColumn ? `<td class="num">${formatCurrency(totals.paidTax || totalInvoiceVatReceived || 0)}</td>` : ""}
                  ${utilityColumns
                    .map(
                      (column) =>
                        `<td class="num">${formatCurrency(
                          Number(
                            (Array.isArray(totals.utilities) ? totals.utilities : utilityColumns).find(
                              (item) => item.key === column.key
                            )?.paid || column.paid || 0
                          )
                        )}</td>`
                    )
                    .join("")}
                  <td class="num">${formatCurrency(totals.closingBalance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div class="metric-strip">
            <div class="metric">
              <div class="label">Opening balance</div>
              <div class="value">${formatCurrency(summary.openingBalance || totals.openingBalance || 0)}</div>
            </div>
            <div class="metric">
              <div class="label">Closing balance</div>
              <div class="value">${formatCurrency(summary.closingBalance || totals.closingBalance || 0)}</div>
            </div>
            <div class="metric">
              <div class="label">Unapplied tenant credits</div>
              <div class="value">${formatCurrency(summary.unappliedPayments || 0)}</div>
            </div>
            <div class="metric">
              <div class="label">Settlement</div>
              <div class="value">${formatCurrency(settlement.amount)}</div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="two-col">
            <div class="col">
              <div class="card">
                <div class="card-accent"></div>
                <div class="stack">
                  <div class="section-header" style="margin-bottom:10px;">
                    <div>
                      <h2 class="section-title">Settlement waterfall</h2>
                      <p class="section-desc">The same stored summary used by the draft workspace.</p>
                    </div>
                  </div>
                  <table class="summary-table">
                    <tbody>
                      ${settlementSummaryRowsHtml}
                    </tbody>
                  </table>
                </div>
              </div>

              <div class="card" style="margin-top:12px;">
                <div class="card-accent"></div>
                <div class="stack">
                  <div class="section-header" style="margin-bottom:8px;">
                    <div>
                      <h2 class="section-title">Additions</h2>
                      <p class="section-desc">Current-period additions carried into the landlord settlement.</p>
                    </div>
                  </div>
                  <table>
                    <thead>
                      <tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr>
                    </thead>
                    <tbody>${renderSimpleRows(additionRows, "No additions posted in this period")}</tbody>
                    <tfoot>
                      <tr><td colspan="2" class="num">Total</td><td class="num">${formatCurrency(additionsAmount)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div class="card" style="margin-top:12px;">
                <div class="card-accent"></div>
                <div class="stack">
                  <div class="section-header" style="margin-bottom:8px;">
                    <div>
                      <h2 class="section-title">Expenses & deductions</h2>
                      <p class="section-desc">Non-commission deductions plus any commission deductions configured for the statement.</p>
                    </div>
                  </div>
                  <table>
                    <thead>
                      <tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr>
                    </thead>
                    <tbody>${renderSimpleRows(expenseRows, "No expenses or deductions posted in this period")}</tbody>
                    <tfoot>
                      <tr><td colspan="2" class="num">Total</td><td class="num">${formatCurrency(nonCommissionDeductions + commissionGrossAmount)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>

            <div class="col">
              ${broughtForwardCreditApplicationRows.length > 0 ? `
              <div class="card">
                <div class="card-accent"></div>
                <div class="stack">
                  <div class="section-header" style="margin-bottom:8px;">
                    <div>
                      <h2 class="section-title">B/F credits applied</h2>
                      <p class="section-desc">Prior-period credit used on current-period charge positions without duplicate cash recognition.</p>
                    </div>
                  </div>
                  <table>
                    <thead>
                      <tr><th>Receipt</th><th>Applied to</th><th class="num">Amount</th></tr>
                    </thead>
                    <tbody>
                      ${broughtForwardCreditApplicationRows
                        .map(
                          (row) => `
                            <tr>
                              <td>${esc(row.receiptReference || row.description || "B/F credit")}</td>
                              <td>${esc(row.chargeReference || row.description || "Applied charge")}</td>
                              <td class="num">${formatCurrency(row.amount || 0)}</td>
                            </tr>`
                        )
                        .join("")}
                    </tbody>
                    <tfoot>
                      <tr><td colspan="2" class="num">Total applied</td><td class="num">${formatCurrency(broughtForwardCreditApplicationTotals.totalApplied || 0)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              </div>
              ` : ""}

              <div class="card" style="margin-top:${broughtForwardCreditApplicationRows.length > 0 ? "12px" : "0"};">
                <div class="card-accent"></div>
                <div class="stack">
                  <div class="section-header" style="margin-bottom:8px;">
                    <div>
                      <h2 class="section-title">Direct to landlord collections</h2>
                      <p class="section-desc">Memo-only direct receipts that stay visible without distorting manager cash settlement.</p>
                    </div>
                  </div>
                  <table>
                    <thead>
                      <tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr>
                    </thead>
                    <tbody>${renderSimpleRows(directToLandlordRows, "No direct-to-landlord collections posted in this period")}</tbody>
                    <tfoot>
                      <tr><td colspan="2" class="num">Total</td><td class="num">${formatCurrency(directToLandlordAmount)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              ${depositMemoRows.length > 0 ? `
              <div class="card" style="margin-top:12px;">
                <div class="card-accent"></div>
                <div class="stack">
                  <div class="section-header" style="margin-bottom:8px;">
                    <div>
                      <h2 class="section-title">Deposit memorandum</h2>
                      <p class="section-desc">Displayed as positive memorandum balances for readability and excluded from settlement.</p>
                    </div>
                  </div>
                  <table>
                    <thead>
                      <tr><th>Holder</th><th class="num">Opening</th><th class="num">Billed / Adj.</th><th class="num">Received</th><th class="num">Closing</th></tr>
                    </thead>
                    <tbody>
                      ${depositMemoRows
                        .map(
                          (row) => `
                            <tr>
                              <td>${esc(row.label)}</td>
                              <td class="num">${formatDepositMemoCurrency(row.openingBalance)}</td>
                              <td class="num">${formatDepositMemoCurrency(row.billed)}</td>
                              <td class="num">${formatDepositMemoCurrency(row.received)}</td>
                              <td class="num">${formatDepositMemoCurrency(row.closingBalance)}</td>
                            </tr>`
                        )
                        .join("")}
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
                  </table>
                </div>
              </div>
              ` : ""}
            </div>
          </div>
        </div>

        <div class="footnote">Generated from MILIK statement workspace. Preview and PDF are intended to remain visually compact while preserving the same statement totals and traceability sections.</div>
      </div>
    </body>
  </html>`;
    await acquirePdfRenderSlot();
    try {
      const browser = await getBrowser();
      const page = await browser.newPage();

      await page.setContent(html, { waitUntil: "domcontentloaded" });

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "10mm", right: "8mm", bottom: "10mm", left: "8mm" },
      });

      await page.close();

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
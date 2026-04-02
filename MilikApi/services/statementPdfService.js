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
    paidRent: rows.reduce((sum, row) => sum + Number(row.paidRent || 0), 0),
    paidGarbage: Number(utilityTotalsMap.garbage?.paid || 0),
    paidWater: Number(utilityTotalsMap.water?.paid || 0),
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
  const commissionAmount = Number(summary.commissionAmount || 0);
  const nonCommissionDeductions = Number(
    summary.nonCommissionDeductions ??
      summary.totalExpenses ??
      Math.max(printableDeductionsTotal - commissionAmount, 0)
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

  const html = `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Landlord Statement</title>
      <style>
        * { box-sizing: border-box; }
        body {
          font-family: Arial, Helvetica, sans-serif;
          margin: 0;
          padding: 18px;
          color: #0f172a;
          background: #ffffff;
          font-size: 11px;
        }
        .topbar {
          background: linear-gradient(135deg, #0b3b2e 0%, #0f4c3a 100%);
          color: #fff;
          border-radius: 14px;
          padding: 18px 20px;
          margin-bottom: 14px;
        }
        .brand-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 18px;
        }
        .brand-left {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          min-width: 0;
        }
        .brand-logo-wrap {
          width: 64px;
          height: 64px;
          flex: 0 0 64px;
        }
        .brand-logo,
        .brand-fallback {
          width: 64px;
          height: 64px;
          border-radius: 14px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.25);
          object-fit: cover;
        }
        .brand-fallback {
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 26px;
          font-weight: 800;
          letter-spacing: 1px;
        }
        .topbar h1 {
          margin: 0 0 6px;
          font-size: 24px;
          letter-spacing: 0.5px;
        }
        .brand-slogan {
          font-size: 12px;
          font-weight: 600;
          opacity: 0.92;
          margin-bottom: 6px;
        }
        .brand-line {
          line-height: 1.5;
          font-size: 11px;
          opacity: 0.96;
        }
        .statement-badge {
          min-width: 230px;
          border-radius: 12px;
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.22);
          padding: 12px 14px;
        }
        .badge-title {
          font-size: 13px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1.4px;
          margin-bottom: 8px;
        }
        .badge-meta {
          font-size: 11px;
          line-height: 1.5;
        }
        .title-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin: 8px 0 12px;
        }
        .title-row h2 {
          margin: 0;
          font-size: 16px;
        }
        .subtitle {
          color: #64748b;
          margin-top: 2px;
          font-size: 11px;
        }
        .period {
          font-size: 11px;
          color: #475569;
          margin-top: 4px;
        }
        .cards {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-bottom: 14px;
        }
        .card {
          border: 1px solid #cbd5d1;
          border-radius: 10px;
          padding: 10px 12px;
          min-height: 64px;
        }
        .label {
          font-size: 10px;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 2px;
          margin-bottom: 6px;
        }
        .value {
          font-size: 13px;
          font-weight: 700;
        }
        .section {
          margin-top: 14px;
        }
        .section-title {
          background: #0f4c3a;
          color: white;
          font-weight: 700;
          border-radius: 8px 8px 0 0;
          padding: 8px 12px;
          text-transform: uppercase;
          letter-spacing: 2px;
          font-size: 11px;
        }
        .box {
          border: 1px solid #cbd5d1;
          border-top: none;
          border-radius: 0 0 8px 8px;
          overflow: hidden;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th, td {
          border: 1px solid #cbd5d1;
          padding: 4px 6px;
          vertical-align: top;
        }
        thead th {
          background: #0f4c3a;
          color: white;
          font-weight: 700;
          font-size: 10px;
        }
        tfoot td {
          font-weight: 700;
          background: #f8fafc;
        }
        .num {
          text-align: right;
          white-space: nowrap;
        }
        .center {
          text-align: center;
        }
        .muted {
          color: #64748b;
        }
        .summary-wrap {
          width: 340px;
          margin-left: auto;
          margin-top: 14px;
        }
        .summary td:first-child {
          background: #0f4c3a;
          color: white;
          font-weight: 700;
        }
        .summary td:last-child {
          font-weight: 700;
          width: 100px;
        }
      </style>
    </head>
    <body>
      <div class="topbar">
        <div class="brand-row">
          <div class="brand-left">
            <div class="brand-logo-wrap">
              ${
                businessLogo
                  ? `<img src="${esc(businessLogo)}" alt="${esc(businessName)} logo" class="brand-logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />`
                  : ``
              }
              <div class="brand-fallback" ${
                businessLogo ? `style="display:none;"` : ``
              }>M</div>
            </div>
            <div>
              <h1>${esc(businessName)}</h1>
              <div class="brand-slogan">${esc(businessSlogan)}</div>
              ${
                businessPostalAddress
                  ? `<div class="brand-line">${esc(businessPostalAddress)}</div>`
                  : ""
              }
              ${
                businessLocation
                  ? `<div class="brand-line">${esc(businessLocation)}</div>`
                  : ""
              }
              <div class="brand-line">
                ${businessPhone ? `TEL: ${esc(businessPhone)}` : ""}
                ${businessPhone && businessEmail ? ` &nbsp;|&nbsp; ` : ""}
                ${businessEmail ? `EMAIL: ${esc(businessEmail)}` : ""}
              </div>
            </div>
          </div>
          <div class="statement-badge">
            <div class="badge-title">Landlord Statement</div>
            <div class="badge-meta">Statement #: ${esc(statement.statementNumber || "")}</div>
            <div class="badge-meta">Period: ${formatDate(statement.periodStart)} - ${formatDate(statement.periodEnd)}</div>
          </div>
        </div>
      </div>

      <div class="title-row">
        <div>
          <h2>Property Account Statement</h2>
          <div class="subtitle">Professional landlord schedule and settlement summary</div>
        </div>
        <div class="period">Generated: ${formatDate(new Date())}</div>
      </div>

      <div class="cards">
        <div class="card">
          <div class="label">Property</div>
          <div class="value">${esc(propertyName)}</div>
        </div>
        <div class="card">
          <div class="label">Landlord</div>
          <div class="value">${esc(landlordName)}</div>
        </div>
        <div class="card">
          <div class="label">Statement No.</div>
          <div class="value">${esc(statement.statementNumber || "")}</div>
        </div>
        <div class="card">
          <div class="label">Settlement</div>
          <div class="value">${esc(settlement.label)} ${formatCurrency(
            settlement.amount
          )}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Statement Schedule</div>
        <div class="box">
          <table>
            <thead>
              <tr>
                <th rowspan="2">Unit</th>
                <th rowspan="2">A/c No.</th>
                <th rowspan="2">Tenant / Resident</th>
                <th rowspan="2" class="num">Per Month</th>
                <th rowspan="2" class="num">Balance B/F</th>
                <th colspan="${1 + utilityColumns.length}" class="center">Amount Invoiced</th>
                <th colspan="${1 + utilityColumns.length}" class="center">Amount Paid</th>
                <th rowspan="2" class="num">Balance C/F</th>
              </tr>
              <tr>
                <th class="num">Rent</th>
                ${utilityColumns
                  .map((column) => `<th class="num">${esc(column.label)}</th>`)
                  .join("")}
                <th class="num">Rent</th>
                ${utilityColumns
                  .map((column) => `<th class="num">${esc(column.label)}</th>`)
                  .join("")}
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  <td>${esc(row.unit || row.unitNumber || "-")}</td>
                  <td>${esc(row.accountNo || "-")}</td>
                  <td>${esc(row.tenantName || "VACANT")}</td>
                  <td class="num">${formatCurrency(row.perMonth || 0)}</td>
                  <td class="num">${formatCurrency(row.openingBalance ?? row.balanceBF ?? 0)}</td>
                  <td class="num">${formatCurrency(row.invoicedRent || 0)}</td>
                  ${utilityColumns
                    .map(
                      (column) =>
                        `<td class="num">${formatCurrency(
                          getRowUtilityAmount(row, column.key, "invoiced")
                        )}</td>`
                    )
                    .join("")}
                  <td class="num">${formatCurrency(row.paidRent || row.rentPaid || 0)}</td>
                  ${utilityColumns
                    .map(
                      (column) =>
                        `<td class="num">${formatCurrency(
                          getRowUtilityAmount(row, column.key, "paid")
                        )}</td>`
                    )
                    .join("")}
                  <td class="num">${formatCurrency(row.closingBalance ?? row.balanceCF ?? 0)}</td>
                </tr>
              `).join("")}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" class="num">Total</td>
                <td class="num">${formatCurrency(totals.perMonth)}</td>
                <td class="num">${formatCurrency(totals.openingBalance)}</td>
                <td class="num">${formatCurrency(totals.invoicedRent)}</td>
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
      </div>

      <div class="section">
        <div class="section-title">Additions</div>
        <div class="box">
          <table>
            <thead>
              <tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr>
            </thead>
            <tbody>${renderSimpleRows(additionRows, "No additions posted in this period")}</tbody>
            <tfoot>
              <tr>
                <td colspan="2" class="num">Total</td>
                <td class="num">${formatCurrency(additionsAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Expenses & Deductions</div>
        <div class="box">
          <table>
            <thead>
              <tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr>
            </thead>
            <tbody>${renderSimpleRows(expenseRows, "No expenses or deductions posted in this period")}</tbody>
            <tfoot>
              <tr>
                <td colspan="2" class="num">Total</td>
                <td class="num">${formatCurrency(nonCommissionDeductions + commissionAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      ${depositMemoRows.length > 0 ? `
      <div class="section">
        <div class="section-title">Deposit Memorandum (Excluded from Settlement)</div>
        <div class="box">
          <table>
            <thead>
              <tr><th>Holder</th><th class="num">Opening</th><th class="num">Billed / Adj.</th><th class="num">Received</th><th class="num">Closing</th></tr>
            </thead>
            <tbody>
              ${depositMemoRows
                .map((row) => `
                  <tr>
                    <td>${esc(row.label)}</td>
                    <td class="num">${formatCurrency(row.openingBalance)}</td>
                    <td class="num">${formatCurrency(row.billed)}</td>
                    <td class="num">${formatCurrency(row.received)}</td>
                    <td class="num">${formatCurrency(row.closingBalance)}</td>
                  </tr>` )
                .join("")}
            </tbody>
            <tfoot>
              <tr>
                <td class="num">Total</td>
                <td class="num">${formatCurrency(depositMemoTotals.openingBalance || 0)}</td>
                <td class="num">${formatCurrency(depositMemoTotals.billed || 0)}</td>
                <td class="num">${formatCurrency(depositMemoTotals.received || 0)}</td>
                <td class="num">${formatCurrency(depositMemoTotals.closingBalance || 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      ` : ""}

      <div class="section">
        <div class="section-title">Direct to Landlord Collections</div>
        <div class="box">
          <table>
            <thead>
              <tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr>
            </thead>
            <tbody>${renderSimpleRows(
              directToLandlordRows,
              "No direct-to-landlord collections posted in this period"
            )}</tbody>
            <tfoot>
              <tr>
                <td colspan="2" class="num">Total</td>
                <td class="num">${formatCurrency(
                  directToLandlordAmount
                )}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="summary-wrap">
        <table class="summary">
          <tr><td>Opening landlord settlement B/F</td><td class="num">${formatCurrency(openingSettlementBalance)}</td></tr>
          <tr><td>${esc(summaryBasisLabel)}</td><td class="num">${formatCurrency(summaryBasisAmount)}</td></tr>
          ${
            utilityPassThroughAmount > 0
              ? `<tr><td>${esc(utilityPassThroughLabel)}</td><td class="num">${formatCurrency(utilityPassThroughAmount)}</td></tr>`
              : ""
          }
          <tr><td>Additions</td><td class="num">${formatCurrency(additionsAmount)}</td></tr>
          <tr><td>Expenses & other deductions</td><td class="num">${formatCurrency(nonCommissionDeductions)}</td></tr>
          <tr><td>${esc(commissionBaseLabel)}</td><td class="num">${formatCurrency(commissionBaseAmount)}</td></tr>
          <tr><td>Commission</td><td class="num">${formatCurrency(commissionAmount)}</td></tr>
          <tr><td>Direct to landlord collections (memo)</td><td class="num">${formatCurrency(directToLandlordAmount)}</td></tr>
          <tr><td>${esc(settlement.label)}</td><td class="num">${formatCurrency(settlement.amount)}</td></tr>
        </table>
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
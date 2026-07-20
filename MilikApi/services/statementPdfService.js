import { createPage, resetBrowser } from "./browserService.js";
import LandlordStatement from "../models/LandlordStatement.js";
import LandlordStatementLine from "../models/LandlordStatementLine.js";

const pdfBufferCache = new Map();
const pdfRenderPromises = new Map();
const MAX_PDF_CACHE_ENTRIES = 24;
const MAX_CONCURRENT_PDF_RENDERS = 3;
const QUEUE_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 90_000;
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

const buildStatementPeriodLabel = (workspace = {}, statement = {}) => {
  const explicit =
    workspace?.statementPeriodLabel ||
    workspace?.periodLabel ||
    "";

  if (String(explicit || "").trim()) {
    return String(explicit).trim();
  }

  const start = workspace?.statementPeriodStart || statement?.periodStart || null;
  const end = workspace?.statementPeriodEnd || statement?.periodEnd || null;
  const startLabel = formatDate(start);
  const endLabel = formatDate(end);

  if (startLabel && endLabel) return `${startLabel} - ${endLabel}`;
  return startLabel || endLabel || "-";
};

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

const buildStatementColumns = (workspace = {}, utilityColumns = []) => {
  if (Array.isArray(workspace?.statementColumns) && workspace.statementColumns.length > 0) {
    return workspace.statementColumns.map((item) => ({
      key: String(item?.key || ""),
      label: item?.label || titleCase(String(item?.key || "").replace(/_/g, " ")),
      sourceKeys:
        Array.isArray(item?.sourceKeys) && item.sourceKeys.length > 0
          ? item.sourceKeys.map((value) => normalizeUtilityKey(value))
          : [normalizeUtilityKey(item?.key || item?.label || "")],
      invoiced: Number(item?.invoiced || 0),
      paid: Number(item?.paid || 0),
      isGrouped: Boolean(item?.isGrouped),
    }));
  }

  if (utilityColumns.length <= 4) {
    return utilityColumns.map((item) => ({
      key: item.key,
      label: item.label,
      sourceKeys: [item.key],
      invoiced: Number(item?.invoiced || 0),
      paid: Number(item?.paid || 0),
      isGrouped: false,
    }));
  }

  const visible = utilityColumns.slice(0, 3).map((item) => ({
    key: item.key,
    label: item.label,
    sourceKeys: [item.key],
    invoiced: Number(item?.invoiced || 0),
    paid: Number(item?.paid || 0),
    isGrouped: false,
  }));
  const overflow = utilityColumns.slice(3);
  visible.push({
    key: "other_charges",
    label: "Other Charges",
    sourceKeys: overflow.map((item) => item.key),
    invoiced: overflow.reduce((sum, item) => sum + Number(item?.invoiced || 0), 0),
    paid: overflow.reduce((sum, item) => sum + Number(item?.paid || 0), 0),
    isGrouped: true,
  });
  return visible;
};

const buildRowStatementColumnMap = (row = {}, statementColumns = []) => {
  if (row?.statementColumns && typeof row.statementColumns === "object") {
    return row.statementColumns;
  }

  const utilityMap = normalizeRowUtilities(row);
  return (Array.isArray(statementColumns) ? statementColumns : []).reduce((acc, column) => {
    const sourceKeys = Array.isArray(column?.sourceKeys) && column.sourceKeys.length > 0 ? column.sourceKeys : [column?.key];
    acc[column.key] = sourceKeys.reduce(
      (totals, sourceKey) => {
        totals.invoiced += Number(utilityMap?.[sourceKey]?.invoiced || 0);
        totals.paid += Number(utilityMap?.[sourceKey]?.paid || 0);
        return totals;
      },
      { invoiced: 0, paid: 0 }
    );
    return acc;
  }, {});
};

const getRowStatementColumnAmount = (row = {}, key = "", phase = "invoiced") =>
  Number(buildRowStatementColumnMap(row, row?.__statementColumns || [])?.[key]?.[phase] || 0);

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

const withTimeout = (promise, ms, message) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    ),
  ]);

const acquirePdfRenderSlot = async () => {
  if (activePdfRenderCount < MAX_CONCURRENT_PDF_RENDERS) {
    activePdfRenderCount += 1;
    return;
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const idx = pdfRenderWaitQueue.indexOf(doResolve);
      if (idx !== -1) pdfRenderWaitQueue.splice(idx, 1);
      reject(new Error("PDF render queue timeout — server is busy, please retry shortly"));
    }, QUEUE_TIMEOUT_MS);
    const doResolve = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    pdfRenderWaitQueue.push(doResolve);
  });
  activePdfRenderCount += 1;
};

const releasePdfRenderSlot = () => {
  activePdfRenderCount = Math.max(0, activePdfRenderCount - 1);
  const next = pdfRenderWaitQueue.shift();
  if (next) next();
};

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

const sanitizePrintableSections = ({
  additionRows = [],
  expenseRows = [],
  directToLandlordRows = [],
  advanceRecoveryRows = [],
  earlyPayoutRows = [],
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
  advanceRecoveryRows: advanceRecoveryRows
    .map(normalizePrintableRow)
    .filter((row) => row.amount > 0),
  earlyPayoutRows: earlyPayoutRows
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

  if (!statement) { const e = new Error("Statement not found or access denied"); e.status = 404; throw e; }

  const cacheKey = buildStatementPdfCacheKey(statement);
  const cachedPdfBuffer = getCachedPdfBuffer(cacheKey);
  if (cachedPdfBuffer) return cachedPdfBuffer;

  if (pdfRenderPromises.has(cacheKey)) {
    return Buffer.from(await pdfRenderPromises.get(cacheKey));
  }

  const renderPromise = (async () => {
    const workspace = statement.metadata?.workspace || {};
    const statementPeriodLabel = buildStatementPeriodLabel(workspace, statement);
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
    const statementColumns = buildStatementColumns(workspace, utilityColumns);
    rows.forEach((row) => {
      row.__statementColumns = statementColumns;
      row.__statementColumnMap = buildRowStatementColumnMap(row, statementColumns);
    });

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
          statementColumns,
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
          statementColumns,
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
    const rawAdvanceRecoveryRows = Array.isArray(workspace.advanceRecoveryRows)
      ? workspace.advanceRecoveryRows
      : [];
    const rawEarlyPayoutRows = Array.isArray(workspace.earlyPayoutRows)
      ? workspace.earlyPayoutRows
      : [];

    const { additionRows, expenseRows, directToLandlordRows, advanceRecoveryRows, earlyPayoutRows } =
      sanitizePrintableSections({
        additionRows: rawAdditionRows,
        expenseRows: rawExpenseRows,
        directToLandlordRows: rawDirectToLandlordRows,
        advanceRecoveryRows: rawAdvanceRecoveryRows,
        earlyPayoutRows: rawEarlyPayoutRows,
      });
    const totalEarlyPayouts = earlyPayoutRows.reduce((s, r) => s + r.amount, 0);
    const totalAdvanceRecoveries = advanceRecoveryRows.reduce((s, r) => s + r.amount, 0);

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
        Math.max(printableDeductionsTotal - (commissionAmount + commissionTaxAmount), 0)
    );
    const directToLandlordAmount = Number(
      summary.directToLandlordCollections ??
        summary.directToLandlordOffsets ??
        summary.totalDirectToLandlordCollections ??
        printableDirectToLandlordTotal
    );
    const directRentCollections = Number(summary.directRentCollections ?? 0);
    const directUtilityCollections = Number(summary.directUtilityCollections ?? 0);
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
            ${statementColumns
              .map(
                (column) =>
                  `<td class="num">${formatCurrency(
                    getRowStatementColumnAmount(row, column.key, "invoiced")
                  )}</td>`
              )
              .join("")}
            <td class="num">${formatCurrency(row.paidRent || row.rentPaid || 0)}</td>
            ${hasInvoiceVatColumn ? `<td class="num">${formatCurrency(row.paidTax || 0)}</td>` : ""}
            ${statementColumns
              .map(
                (column) =>
                  `<td class="num">${formatCurrency(
                    getRowStatementColumnAmount(row, column.key, "paid")
                  )}</td>`
              )
              .join("")}
            <td class="num strong">${formatCurrency(row.closingBalance ?? row.balanceCF ?? 0)}</td>
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
          @page { size: A4 landscape; margin: 8mm 6mm; }
          * { box-sizing: border-box; }
          body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #111827; background: #ffffff; font-size: 9px; }
          .sheet { width: 100%; max-width: 285mm; margin: 0 auto; }
          .header-table, .statement-table, .simple-table, .summary-table { width: 100%; border-collapse: collapse; }
          .header-table td { vertical-align: top; }
          .brand-cell { width: 78px; padding-right: 10px; }
          .brand-logo { width: 62px; height: 62px; object-fit: contain; }
          .brand-fallback { width: 62px; height: 62px; background: #0B3B2E; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 900; border-radius: 6px; }
          .business-name { font-size: 18px; font-weight: 900; margin: 0 0 2px; color: #0B3B2E; letter-spacing: -0.3px; }
          .business-line { margin: 1px 0; color: #374151; font-size: 8.5px; }
          .accent-bar { height: 2px; background: #0B3B2E; border-radius: 1px; margin: 6px 0 8px; }
          .statement-title { text-align: center; font-size: 12px; font-weight: 900; margin: 6px 0 3px; text-transform: uppercase; color: #0B3B2E; letter-spacing: 0.04em; }
          .statement-subtitle { text-align: center; margin-bottom: 8px; font-size: 8.5px; color: #4b5563; }
          .meta-box { border: 1px solid #e5e7eb; border-radius: 4px; padding: 5px 8px; margin-bottom: 8px; background: #f9fafb; display: flex; justify-content: space-between; align-items: flex-start; }
          .meta-block {}
          .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
          .meta-table td { padding: 1px 4px; vertical-align: top; border: none; }
          .meta-label { width: 70px; font-weight: 800; text-transform: uppercase; font-size: 8px; color: #6b7280; letter-spacing: 0.08em; }
          .meta-value { font-weight: 700; font-size: 9px; color: #111827; }
          .period-cell { text-align: right; font-weight: 700; white-space: nowrap; font-size: 8.5px; color: #374151; }
          .period-badge { display: inline-block; background: #0B3B2E; color: #fff; padding: 2px 8px; border-radius: 3px; font-size: 8px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 3px; }
          .section-title { margin: 8px 0 4px; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.06em; color: #0B3B2E; border-bottom: 2px solid #0B3B2E; padding-bottom: 2px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #d1d5db; padding: 3px 4px; vertical-align: middle; }
          th { background: #f3f4f6; font-weight: 700; }
          .num { text-align: right; white-space: nowrap; }
          .center { text-align: center; }
          .muted { color: #6b7280; }
          .schedule-wrap { overflow: hidden; }
          .statement-table { font-size: 7.5px; table-layout: fixed; }
          .statement-table th, .statement-table td { padding: 2px 3px; word-break: break-word; }
          .statement-table thead tr:first-child th { text-align: center; }
          .totals-row td { font-weight: 700; background: #f9fafb; }
          .two-col { width: 100%; border-collapse: collapse; margin-top: 8px; }
          .two-col > tbody > tr > td { width: 50%; vertical-align: top; border: none; padding: 0; }
          .two-col > tbody > tr > td:first-child { padding-right: 6px; }
          .two-col > tbody > tr > td:last-child { padding-left: 6px; }
          .summary-head { background: #0B3B2E; color: #ffffff; }
          .summary-head th { background: #0B3B2E; color: #ffffff; }
          .summary-table td, .summary-table th { padding: 4px 5px; }
          .summary-table .label { font-weight: 700; }
          .summary-table .final-row td { font-weight: 700; font-size: 10px; background: #f0faf5; }
          .summary-section td { background: #f1f5f9; font-size: 7.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.07em; color: #475569; padding: 5px 5px 3px; border-top: 1px solid #e2e8f0; }
          .summary-subtotal td { border-top: 1px solid #e2e8f0; font-weight: 700; color: #374151; }
          .summary-transfer td { font-weight: 800; font-size: 10.5px; background: #EDF5F1; color: #0B3B2E; border-top: 2px solid #0B3B2E; }
          .summary-total td { font-weight: 900; font-size: 11px; background: #0B3B2E; color: #ffffff; }
          .negative { color: #991b1b; }
          .footnote { margin-top: 8px; font-size: 7.5px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 4px; }
        </style>
      </head>
      <body>
        <div class="sheet">
          <table class="header-table">
            <tr>
              <td class="brand-cell">
                ${businessLogo ? `<img src="${esc(businessLogo)}" alt="logo" class="brand-logo" />` : `<div class="brand-fallback">${esc(String(businessName || "M").charAt(0).toUpperCase())}</div>`}
              </td>
              <td>
                <div class="business-name">${esc(businessName)}</div>
                ${businessSlogan ? `<div class="business-line">${esc(businessSlogan)}</div>` : ""}
                ${businessPostalAddress ? `<div class="business-line">${esc(businessPostalAddress)}</div>` : ""}
                ${businessLocation ? `<div class="business-line">${esc(businessLocation)}</div>` : ""}
                <div class="business-line">${businessPhone ? `Tel: ${esc(businessPhone)}` : ""}${businessPhone && businessEmail ? " &bull; " : ""}${businessEmail ? esc(businessEmail) : ""}</div>
              </td>
              <td class="period-cell">
                <div class="period-badge">LANDLORD STATEMENT</div>
                <div>Ref: ${esc(statement.statementNumber || "-")}</div>
                <div>Generated: ${formatDate(statement.generatedAt || statement.updatedAt || new Date())}</div>
              </td>
            </tr>
          </table>

          <div class="accent-bar"></div>

          <div class="statement-title">${esc(String(statement?.metadata?.statementType || statement?.metadata?.workspace?.statementType || statement?.statementType || "Provisional Statement").toUpperCase())}</div>
          <div class="statement-subtitle">Property management schedule and settlement summary</div>

          <table class="meta-table" style="margin-bottom:8px">
            <tr>
              <td class="meta-label">Landlord / Owner</td>
              <td class="meta-value">${esc(landlordName)}</td>
              <td class="period-cell" style="font-weight:800;color:#0B3B2E">PERIOD: ${esc(statementPeriodLabel)}</td>
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
                  <th colspan="${1 + (hasInvoiceVatColumn ? 1 : 0) + statementColumns.length}">Amount Invoiced</th>
                  <th colspan="${1 + (hasInvoiceVatColumn ? 1 : 0) + statementColumns.length}">Amount Received</th>
                  <th rowspan="2" class="num">Balance C/F</th>
                </tr>
                <tr>
                  <th class="num">Rent</th>
                  ${hasInvoiceVatColumn ? `<th class="num">Rent VAT</th>` : ""}
                  ${statementColumns.map((column) => `<th class="num">${esc(column.label)}</th>`).join("")}
                  <th class="num">Rent</th>
                  ${hasInvoiceVatColumn ? `<th class="num">Rent VAT</th>` : ""}
                  ${statementColumns.map((column) => `<th class="num">${esc(column.label)}</th>`).join("")}
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
                  ${statementColumns.map((column) => `<td class="num">${formatCurrency(column?.invoiced || 0)}</td>`).join("")}
                  <td class="num">${formatCurrency(totals.paidRent ?? summary.totalRentReceived ?? 0)}</td>
                  ${hasInvoiceVatColumn ? `<td class="num">${formatCurrency(totals.paidTax ?? totalInvoiceVatReceived ?? 0)}</td>` : ""}
                  ${statementColumns.map((column) => `<td class="num">${formatCurrency(column?.paid || 0)}</td>`).join("")}
                  <td class="num">${formatCurrency(totals.closingBalance ?? summary.closingBalance ?? 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <table class="two-col"><tbody><tr>
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
              <div class="section-title" style="color:#0B3B2E;border-color:#0B3B2E;">Payments Collected Directly by Landlord</div>
              ${directToLandlordRows.length === 0
                ? `<p style="font-size:9px;color:#64748b;padding:6px 0;">No payments collected directly by landlord this period.</p>`
                : `<table class="simple-table">
                <thead>
                  <tr><th>Date</th><th>Unit</th><th>Tenant</th><th>Type</th><th>Reference</th><th class="num">Amount</th></tr>
                </thead>
                <tbody>
                  ${directToLandlordRows.map((r) => `
                    <tr>
                      <td>${r.date ? formatDate(new Date(r.date)) : "-"}</td>
                      <td>${esc(r.unit || "-")}</td>
                      <td>${esc(r.tenantName || "-")}</td>
                      <td>${esc(r.typeLabel || r.paymentType || "Rent")}</td>
                      <td>${esc(r.receiptRef || "-")}</td>
                      <td class="num">${formatCurrency(r.amount)}</td>
                    </tr>`).join("")}
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="5" class="num" style="font-weight:700;">Total collected directly by landlord</td>
                    <td class="num" style="font-weight:700;">${formatCurrency(directToLandlordAmount)}</td>
                  </tr>
                  ${directRentCollections > 0 ? `<tr><td colspan="5" class="num" style="color:#64748b;">of which: Rent</td><td class="num" style="color:#64748b;">${formatCurrency(directRentCollections)}</td></tr>` : ""}
                  ${directUtilityCollections > 0 ? `<tr><td colspan="5" class="num" style="color:#64748b;">of which: Utilities</td><td class="num" style="color:#64748b;">${formatCurrency(directUtilityCollections)}</td></tr>` : ""}
                </tfoot>
              </table>
              <p style="font-size:8.5px;color:#64748b;margin-top:4px;font-style:italic;">
                These amounts were received directly by you from tenants and are NOT included in the manager's remittance transfer.
              </p>`}

              ${earlyPayoutRows.length > 0 ? `
                <div class="section-title" style="color:#92400e;border-color:#92400e;">Early Payouts to Landlord</div>
                <table class="simple-table">
                  <thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead>
                  <tbody>${renderSimpleRows(earlyPayoutRows, "No early payouts in this period")}</tbody>
                  <tfoot><tr><td colspan="2" class="num">Total</td><td class="num">${formatCurrency(totalEarlyPayouts)}</td></tr></tfoot>
                </table>` : ""}

              ${advanceRecoveryRows.length > 0 ? `
                <div class="section-title" style="color:#991b1b;border-color:#991b1b;">Advance Recoveries</div>
                <table class="simple-table">
                  <thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead>
                  <tbody>${renderSimpleRows(advanceRecoveryRows, "No advance recoveries in this period")}</tbody>
                  <tfoot><tr><td colspan="2" class="num">Total</td><td class="num">${formatCurrency(totalAdvanceRecoveries)}</td></tr></tfoot>
                </table>` : ""}

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

                  <!-- COLLECTIONS -->
                  <tr class="summary-section"><td colspan="2">Collections</td></tr>
                  <tr><td class="label">${esc(summaryBasisLabel)}</td><td class="num">${formatCurrency(summaryBasisAmount)}</td></tr>
                  ${openingSettlementBalance !== 0 ? `<tr><td class="label">Opening balance carried forward</td><td class="num ${openingSettlementBalance < 0 ? "negative" : ""}">${formatCurrency(openingSettlementBalance)}</td></tr>` : ""}
                  ${additionsAmount > 0 ? `<tr><td class="label">Additions</td><td class="num">${formatCurrency(additionsAmount)}</td></tr>` : ""}
                  ${utilityPassThroughAmount > 0 ? `<tr><td class="label">${esc(utilityPassThroughLabel)}</td><td class="num">${formatCurrency(utilityPassThroughAmount)}</td></tr>` : ""}
                  ${invoiceVatPassThroughAmount > 0 ? `<tr><td class="label">${esc(invoiceVatPassThroughLabel)}</td><td class="num">${formatCurrency(invoiceVatPassThroughAmount)}</td></tr>` : ""}

                  <!-- FEES & DEDUCTIONS -->
                  <tr class="summary-section"><td colspan="2">Management Fees &amp; Deductions</td></tr>
                  <tr><td class="label">Management commission</td><td class="num negative">(${formatCurrency(commissionAmount)})</td></tr>
                  ${commissionTaxAmount > 0 ? `<tr><td class="label">VAT on commission</td><td class="num negative">(${formatCurrency(commissionTaxAmount)})</td></tr>` : ""}
                  ${nonCommissionDeductions > 0 ? `<tr><td class="label">Other expenses &amp; deductions</td><td class="num negative">(${formatCurrency(nonCommissionDeductions)})</td></tr>` : ""}

                  <!-- PRE-PAYOUT SUBTOTAL if there are payouts/recoveries -->
                  ${(totalEarlyPayouts > 0 || totalAdvanceRecoveries > 0) ? `
                  <tr class="summary-subtotal"><td class="label">Balance before payouts</td><td class="num">${formatCurrency(settlement.amount + totalEarlyPayouts + totalAdvanceRecoveries)}</td></tr>
                  ${totalEarlyPayouts > 0 ? `<tr><td class="label">Early payout already paid to you</td><td class="num negative">(${formatCurrency(totalEarlyPayouts)})</td></tr>` : ""}
                  ${totalAdvanceRecoveries > 0 ? `<tr><td class="label">Advance recovery deduction</td><td class="num negative">(${formatCurrency(totalAdvanceRecoveries)})</td></tr>` : ""}
                  ` : ""}

                  <!-- MANAGER TRANSFER -->
                  <tr class="summary-transfer">
                    <td class="label">Manager will transfer to you</td>
                    <td class="num ${settlement.isNegative ? "negative" : ""}">${settlement.isNegative ? `(${formatCurrency(settlement.amount)})` : formatCurrency(settlement.amount)}</td>
                  </tr>

                  <!-- TOTAL INCOME if direct collections exist -->
                  ${directToLandlordAmount > 0 ? `
                  <tr class="summary-section"><td colspan="2">Your Total Income This Period</td></tr>
                  <tr><td class="label">Manager transfer to you</td><td class="num">${formatCurrency(Math.max(0, settlement.amount))}</td></tr>
                  <tr><td class="label">Received directly from tenants</td><td class="num">${formatCurrency(directToLandlordAmount)}</td></tr>
                  <tr class="summary-total">
                    <td class="label" style="padding-top:5px;padding-bottom:5px;">Total income this period</td>
                    <td class="num" style="padding-top:5px;padding-bottom:5px;">${formatCurrency(Math.max(0, settlement.amount) + directToLandlordAmount)}</td>
                  </tr>
                  ` : ""}

                </tbody>
              </table>
            </td>
          </tr></tbody></table>

          <div class="footnote">Generated from MILIK statement workspace. This print layout is kept compact and wide so schedule columns fit within the in-system print preview and downloaded PDF.</div>
        </div>
      </body>
    </html>`;

    await acquirePdfRenderSlot();
    let page = null;
    try {
      page = await createPage();

      await page.setViewport({
        width: 1600,
        height: 1000,
        deviceScaleFactor: 1,
      });
      page.setDefaultNavigationTimeout(30_000);
      page.setDefaultTimeout(30_000);

      await page.setContent(html, { waitUntil: "domcontentloaded" });

      const pdfBuffer = await withTimeout(
        page.pdf({
          format: "A4",
          landscape: true,
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: "8mm", right: "6mm", bottom: "8mm", left: "6mm" },
        }),
        RENDER_TIMEOUT_MS,
        "Statement PDF render timed out"
      );

      try {
        await page.close();
      } catch {
        // ignore page close errors for disconnected sessions
      }

      rememberPdfBuffer(cacheKey, pdfBuffer);
      return Buffer.from(pdfBuffer);
    } catch (error) {
      await resetBrowser();
      throw error;
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

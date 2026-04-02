import React from "react";

const MILIK_GREEN = "#0B3B2E";

const toUtilityKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "other_utility";

const titleCase = (value = "") =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const normalizeRowUtilities = (row = {}) => {
  const map = {};

  if (row?.utilities && typeof row.utilities === "object") {
    Object.values(row.utilities).forEach((item) => {
      const key = toUtilityKey(item?.key || item?.label || "");
      map[key] = {
        key,
        label: item?.label || titleCase(key.replace(/_/g, " ")) || "Other Utility",
        invoiced: Number(item?.invoiced || 0),
        paid: Number(item?.paid || 0),
      };
    });
  }

  const addLegacy = (key, label, invoiced, paid) => {
    if (Number(invoiced || 0) === 0 && Number(paid || 0) === 0) return;
    map[key] = {
      key,
      label,
      invoiced: Number(invoiced || 0),
      paid: Number(paid || 0),
    };
  };

  if (!map.garbage) {
    addLegacy("garbage", "Garbage", row?.invoicedGarbage, row?.paidGarbage);
  }

  if (!map.water) {
    addLegacy("water", "Water", row?.invoicedWater, row?.paidWater);
  }

  return map;
};

const buildUtilityColumns = (workspace = {}, rows = []) => {
  if (Array.isArray(workspace?.utilityColumns) && workspace.utilityColumns.length > 0) {
    return workspace.utilityColumns.map((item) => ({
      key: toUtilityKey(item?.key || item?.label || ""),
      label:
        item?.label ||
        titleCase(String(item?.key || item?.label || "").replace(/_/g, " ")) ||
        "Other Utility",
      invoiced: Number(item?.invoiced || 0),
      paid: Number(item?.paid || 0),
    }));
  }

  const map = new Map();

  rows.forEach((row) => {
    Object.values(normalizeRowUtilities(row)).forEach((item) => {
      const key = toUtilityKey(item?.key || item?.label || "");
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: item?.label || titleCase(key.replace(/_/g, " ")) || "Other Utility",
          invoiced: 0,
          paid: 0,
        });
      }
      const entry = map.get(key);
      entry.invoiced += Number(item?.invoiced || 0);
      entry.paid += Number(item?.paid || 0);
    });
  });

  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
};

const getUtilityValue = (row = {}, key = "", phase = "invoiced") =>
  Number(normalizeRowUtilities(row)?.[key]?.[phase] || 0);

const sumPrintRows = (items = []) =>
  items.reduce((sum, item) => sum + Number(item?.amount || 0), 0);

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
      label: summary?.settlementLabel || "LANDLORD OWES MANAGER",
      amount: explicitRecovery > 0 ? explicitRecovery : Math.abs(netStatement),
    };
  }

  return {
    isNegative: false,
    label: summary?.settlementLabel || "NET PAYABLE TO LANDLORD",
    amount: Number(
      summary?.amountPayableToLandlord ??
        summary?.netPayableToLandlord ??
        (netStatement > 0 ? netStatement : 0)
    ),
  };
};

const StatementPrintView = ({ statement, lines = [], company = null, summary = {} }) => {
  const formatCurrency = (value) => {
    if (!value && value !== 0) return "0.00";
    return new Intl.NumberFormat("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(Number(value || 0)));
  };

  const formatDate = (date) => {
    if (!date) return "N/A";
    return new Date(date).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const getSignedAmount = (line) => {
    const amount = Number(line?.amount || 0);
    return line?.direction === "debit" ? -Math.abs(amount) : Math.abs(amount);
  };

  const getCategoryAmount = (category) => {
    const record = statement?.totalsByCategory?.[category];
    if (!record) return 0;
    if (typeof record.totalAmount === "number") return Math.abs(Number(record.totalAmount || 0));
    return Math.abs(Number(record.totalCredit || 0) - Number(record.totalDebit || 0));
  };

  const workspace = statement?.metadata?.workspace || {};

  const tenantRows = React.useMemo(() => {
    if (Array.isArray(workspace.rows) && workspace.rows.length > 0) {
      return workspace.rows.map((row) => {
        const utilities = normalizeRowUtilities(row);
        const totalUtilityInvoiced = Object.values(utilities).reduce(
          (sum, item) => sum + Number(item?.invoiced || 0),
          0
        );
        const totalUtilityPaid = Object.values(utilities).reduce(
          (sum, item) => sum + Number(item?.paid || 0),
          0
        );

        return {
          tenantId: row.tenantId,
          tenantName: row.tenantName || "VACANT",
          unit: row.unit || row.unitNumber || "-",
          perMonth: Number(row.perMonth || 0),
          balanceBF: Number(row.balanceBF ?? row.openingBalance ?? 0),
          invoicedRent: Number(row.invoicedRent || 0),
          paidRent: Number(row.paidRent || 0),
          utilities,
          totalUtilityInvoiced,
          totalUtilityPaid,
          totalPaid: Number(row.totalPaid ?? Number(row.paidRent || 0) + totalUtilityPaid),
          balanceCF: Number(row.balanceCF ?? row.closingBalance ?? row.balance ?? 0),
        };
      });
    }

    const rowsMap = new Map();

    lines.forEach((line) => {
      const metadata = line?.metadata || {};
      const tenantObj = line?.tenant;
      const unitObj = line?.unit;

      const tenantId =
        String(tenantObj?._id || line?.tenant || metadata?.tenantId || metadata?.tenant || "") ||
        `line-${line?._id || Math.random()}`;
      const tenantName = tenantObj?.name || metadata?.tenantName || "Unassigned Tenant";
      const unitLabel = unitObj?.unitNumber || unitObj?.name || metadata?.unit || "-";
      const perMonth = unitObj?.rent || metadata?.rent || 0;

      if (!rowsMap.has(tenantId)) {
        rowsMap.set(tenantId, {
          tenantId,
          tenantName,
          unit: unitLabel,
          perMonth,
          balanceBF: 0,
          invoicedRent: 0,
          paidRent: 0,
          utilities: {},
          balanceCF: 0,
        });
      }

      const row = rowsMap.get(tenantId);
      const absAmount = Math.abs(Number(line?.amount || 0));
      const signedAmount = getSignedAmount(line);
      const category = String(line?.category || "").toUpperCase();
      const utilityType =
        metadata?.utilityType ||
        metadata?.meterUtilityType ||
        metadata?.statementUtilityType ||
        metadata?.utilityName ||
        metadata?.utility ||
        "";

      if (category === "RENT_CHARGE") row.invoicedRent += absAmount;
      if (category === "RENT_RECEIPT_MANAGER" || category === "RENT_RECEIPT_LANDLORD") row.paidRent += absAmount;

      if (category === "UTILITY_CHARGE" || category === "UTILITY_RECEIPT_MANAGER" || category === "UTILITY_RECEIPT_LANDLORD") {
        const key = toUtilityKey(utilityType || "other_utility");
        if (!row.utilities[key]) {
          row.utilities[key] = {
            key,
            label: utilityType ? titleCase(utilityType) : "Other Utility",
            invoiced: 0,
            paid: 0,
          };
        }

        if (category === "UTILITY_CHARGE") row.utilities[key].invoiced += absAmount;
        else row.utilities[key].paid += absAmount;
      }

      if (category === "OPENING_BALANCE_BF") row.balanceBF += signedAmount;
    });

    return Array.from(rowsMap.values()).map((row) => {
      const utilities = normalizeRowUtilities(row);
      const totalUtilityInvoiced = Object.values(utilities).reduce(
        (sum, item) => sum + Number(item?.invoiced || 0),
        0
      );
      const totalUtilityPaid = Object.values(utilities).reduce(
        (sum, item) => sum + Number(item?.paid || 0),
        0
      );
      const balanceCF =
        row.balanceBF +
        row.invoicedRent +
        totalUtilityInvoiced -
        row.paidRent -
        totalUtilityPaid;

      return {
        ...row,
        utilities,
        totalUtilityInvoiced,
        totalUtilityPaid,
        totalPaid: row.paidRent + totalUtilityPaid,
        balanceCF,
      };
    });
  }, [lines, workspace.rows]);

  const utilityColumns = React.useMemo(
    () => buildUtilityColumns(workspace, tenantRows),
    [workspace, tenantRows]
  );

  const totalInvoiced = tenantRows.reduce(
    (sum, r) => sum + r.invoicedRent + r.totalUtilityInvoiced,
    0
  );
  const totalPaid = tenantRows.reduce((sum, r) => sum + r.totalPaid, 0);
  const totalBalanceCF = tenantRows.reduce((sum, r) => sum + r.balanceCF, 0);

  const companySource = company || statement?.business || {};
  const companyName =
    companySource?.companyName ||
    companySource?.name ||
    companySource?.businessName ||
    "Milik Property Management";
  const companyLogo = companySource?.logo || "";
  const companySlogan = companySource?.slogan || "Modern Property Management";
  const companyPhone = companySource?.phoneNo || companySource?.phone || companySource?.telephone || "";
  const companyEmail = companySource?.email || "";
  const companyPostalAddress =
    companySource?.postalAddress ||
    companySource?.POBOX ||
    companySource?.address ||
    companySource?.location ||
    "";
  const companyLocation = [
    companySource?.roadStreet,
    companySource?.Street,
    companySource?.town,
    companySource?.City,
    companySource?.country,
  ]
    .filter(Boolean)
    .join(", ");

  const landlordName =
    [statement?.landlord?.firstName, statement?.landlord?.lastName].filter(Boolean).join(" ") ||
    statement?.landlord?.landlordName ||
    statement?.landlord?.name ||
    "N/A";
  const landlordEmail = statement?.landlord?.email || "";
  const landlordPhone = statement?.landlord?.phone || statement?.landlord?.phoneNumber || "";

  const propertyCode = statement?.property?.propertyCode || "";
  const propertyName = statement?.property?.propertyName || statement?.property?.name || "N/A";
  const propertyAddress = [statement?.property?.address, statement?.property?.city].filter(Boolean).join(", ");

  const parseStatementType = (notes = "") => {
    const lower = String(notes).toLowerCase();
    if (lower.includes("statement type: final")) return "FINAL";
    if (lower.includes("statement type: provisional")) return "PROVISIONAL";
    return "INTERIM";
  };

  const statementType = parseStatementType(statement?.notes);
  const periodLabel = `${formatDate(statement?.periodStart)} - ${formatDate(statement?.periodEnd)}`;

  const workspaceSummary = summary && Object.keys(summary).length > 0 ? summary : workspace.summary || {};
  const totalRentInvoiced = Number(
    workspaceSummary.totalRentInvoiced ??
      workspaceSummary.rentInvoiced ??
      getCategoryAmount("RENT_CHARGE")
  );
  const totalUtilityInvoiced = Number(
    workspaceSummary.totalUtilityInvoiced ??
      workspaceSummary.utilityInvoiced ??
      utilityColumns.reduce((sum, item) => sum + Number(item?.invoiced || 0), 0)
  );
  const totalRentReceived = Number(
    workspaceSummary.totalRentReceived ??
      workspaceSummary.totalCollections ??
      getCategoryAmount("RENT_RECEIPT_MANAGER") + getCategoryAmount("RENT_RECEIPT_LANDLORD")
  );
  const totalUtilityCollected = Number(
    workspaceSummary.totalUtilityCollected ??
      utilityColumns.reduce((sum, item) => sum + Number(item?.paid || 0), 0)
  );
  const totalAdditions = Number(
    workspaceSummary.totalAdditions ??
      workspaceSummary.additions ??
      sumPrintRows(workspace?.additionRows || [])
  );
  const commissionPercentage = Number(
    workspaceSummary.commissionPercentage ?? statement?.property?.commissionPercentage ?? 0
  );
  const commissionAmount = Number(workspaceSummary.commissionAmount || 0);
  const commissionTaxAmount = Number(workspaceSummary.commissionTaxAmount || 0);
  const commissionGrossAmount = Number(workspaceSummary.commissionGrossAmount || (commissionAmount + commissionTaxAmount));
  const totalExpenses = Number(
    workspaceSummary.nonCommissionDeductions ??
      workspaceSummary.totalExpenses ??
      Math.max(sumPrintRows(workspace?.expenseRows || workspace?.deductionRows || []) - commissionGrossAmount, 0)
  );
  const directToLandlordAmount = Number(
    workspaceSummary.directToLandlordCollections ??
      workspaceSummary.directToLandlordOffsets ??
      workspaceSummary.totalDirectToLandlordCollections ??
      sumPrintRows(workspace?.directToLandlordRows || [])
  );
  const basisCollectionsLabel =
    workspaceSummary.settlementBasisLabel ||
    workspaceSummary.basisCollectionsLabel ||
    "Collections";
  const basisCollectionsAmount = Number(
    workspaceSummary.settlementBasisAmount ??
      workspaceSummary.basisCollections ??
      workspaceSummary.managerCollections ??
      workspaceSummary.totalCollections ??
      0
  );
  const utilityPassThroughLabel =
    workspaceSummary.utilityPassThroughLabel || "Utilities (added as billed)";
  const utilityPassThroughAmount = Number(workspaceSummary.utilityPassThroughAmount ?? 0);
  const settlement = resolveSettlementDisplay(workspaceSummary);

  const occupiedUnits = tenantRows.filter((row) => row.tenantName !== "VACANT").length;
  const totalUnits = statement?.property?.totalUnits || occupiedUnits;
  const vacantUnits = Math.max(Number(totalUnits || 0) - Number(occupiedUnits || 0), 0);

  return (
    <div className="print-view">
      <style>{`
        .print-view {
          background: white;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          color: #000;
          max-width: 210mm;
          margin: 0 auto;
          padding: 20px;
        }

        @page {
          size: A4;
          margin: 12mm;
        }

        .print-header {
          border-bottom: 3px solid ${MILIK_GREEN};
          padding-bottom: 16px;
          margin-bottom: 20px;
        }

        .brand-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
        }

        .brand-left {
          display: flex;
          gap: 14px;
          align-items: flex-start;
        }

        .brand-logo-wrap {
          width: 72px;
          height: 72px;
          flex: 0 0 72px;
        }

        .brand-logo,
        .brand-fallback {
          width: 72px;
          height: 72px;
          border-radius: 16px;
          border: 1px solid #d1d5db;
          background: #f8fafc;
          object-fit: cover;
        }

        .brand-fallback {
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          font-weight: 800;
          color: ${MILIK_GREEN};
        }

        .company-name {
          font-size: 24px;
          font-weight: 800;
          color: ${MILIK_GREEN};
          margin: 0 0 4px 0;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }

        .company-slogan {
          font-size: 12px;
          font-weight: 600;
          color: #475569;
          margin-bottom: 6px;
        }

        .company-details {
          font-size: 11px;
          color: #334155;
          line-height: 1.55;
        }

        .statement-badge {
          min-width: 230px;
          border: 1px solid #cbd5d1;
          border-radius: 14px;
          background: #f8fafc;
          padding: 12px 14px;
        }

        .statement-badge .label {
          display: block;
          margin-bottom: 8px;
          color: ${MILIK_GREEN};
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1.2px;
        }

        .statement-badge .value {
          display: block;
          font-size: 11px;
          color: #0f172a;
          line-height: 1.6;
        }

        .statement-title {
          text-align: center;
          font-size: 16px;
          font-weight: 800;
          text-transform: uppercase;
          margin: 20px 0;
          padding: 10px;
          border: 2px solid ${MILIK_GREEN};
          background: #f8fafc;
          letter-spacing: 0.7px;
        }

        .info-section {
          display: flex;
          justify-content: space-between;
          margin-bottom: 20px;
          gap: 20px;
        }

        .info-block {
          flex: 1;
        }

        .info-block h4 {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          color: ${MILIK_GREEN};
          margin: 0 0 8px 0;
          border-bottom: 1px solid #ddd;
          padding-bottom: 3px;
          letter-spacing: 0.8px;
        }

        .info-block p {
          margin: 3px 0;
          font-size: 11px;
          line-height: 1.45;
        }

        .tenant-table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
          font-size: 9.5px;
        }

        .tenant-table th {
          background: ${MILIK_GREEN};
          color: white;
          padding: 7px 4px;
          text-align: left;
          font-weight: 700;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }

        .tenant-table th.text-right,
        .tenant-table td.text-right {
          text-align: right;
        }

        .tenant-table td {
          padding: 6px 4px;
          border-bottom: 1px solid #ddd;
        }

        .tenant-table td.text-right {
          font-family: 'Courier New', monospace;
        }

        .totals-row {
          font-weight: 800;
          background: #f0fdf4 !important;
          border-top: 2px solid ${MILIK_GREEN};
        }

        .summary-section {
          margin-top: 30px;
          page-break-inside: avoid;
        }

        .summary-section h3 {
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          color: ${MILIK_GREEN};
          border-bottom: 2px solid ${MILIK_GREEN};
          padding-bottom: 5px;
          margin-bottom: 15px;
          letter-spacing: 0.8px;
        }

        .summary-table {
          width: 60%;
          margin-left: auto;
          border-collapse: collapse;
          font-size: 11px;
        }

        .summary-table td {
          padding: 8px 12px;
          border: 1px solid #ddd;
        }

        .summary-table td:first-child {
          font-weight: 700;
          background: #f8fafc;
          width: 60%;
        }

        .summary-table td:last-child {
          text-align: right;
          font-family: 'Courier New', monospace;
        }

        .summary-table .net-row {
          background: ${MILIK_GREEN};
          color: white;
          font-weight: 800;
          font-size: 12px;
        }

        .footer-note {
          margin-top: 30px;
          font-size: 10px;
          color: #666;
          text-align: center;
          border-top: 1px solid #ddd;
          padding-top: 15px;
        }
      `}</style>

      <div className="print-header">
        <div className="brand-row">
          <div className="brand-left">
            <div className="brand-logo-wrap">
              {companyLogo ? (
                <>
                  <img
                    src={companyLogo}
                    alt={`${companyName} logo`}
                    className="brand-logo"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                      const fallback = event.currentTarget.nextElementSibling;
                      if (fallback) fallback.style.display = "flex";
                    }}
                  />
                  <div className="brand-fallback" style={{ display: "none" }}>
                    M
                  </div>
                </>
              ) : (
                <div className="brand-fallback">M</div>
              )}
            </div>

            <div>
              <h1 className="company-name">{companyName}</h1>
              <div className="company-slogan">{companySlogan}</div>
              <div className="company-details">
                {companyPostalAddress && <div>{companyPostalAddress}</div>}
                {companyLocation && <div>{companyLocation}</div>}
                <div>
                  {companyPhone && <span>TEL: {companyPhone}</span>}
                  {companyPhone && companyEmail && <span> | </span>}
                  {companyEmail && <span>EMAIL: {companyEmail}</span>}
                </div>
              </div>
            </div>
          </div>

          <div className="statement-badge">
            <span className="label">Landlord Statement</span>
            <span className="value">Statement #: {statement?.statementNumber || "N/A"}</span>
            <span className="value">Period: {periodLabel}</span>
            <span className="value">Generated: {formatDate(new Date())}</span>
          </div>
        </div>
      </div>

      <div className="statement-title">
        Property Account Statement - {statementType}
      </div>

      <div className="info-section">
        <div className="info-block">
          <h4>Landlord</h4>
          <p><strong>{landlordName}</strong></p>
          {landlordEmail && <p>{landlordEmail}</p>}
          {landlordPhone && <p>{landlordPhone}</p>}
        </div>

        <div className="info-block">
          <h4>Property</h4>
          <p><strong>{propertyCode && `[${propertyCode}] `}{propertyName}</strong></p>
          {propertyAddress && <p>{propertyAddress}</p>}
        </div>

        <div className="info-block">
          <h4>Statement Period</h4>
          <p><strong>{periodLabel}</strong></p>
          <p>Statement #: {statement?.statementNumber || "N/A"}</p>
          <p>Date Generated: {formatDate(new Date())}</p>
        </div>
      </div>

      <table className="tenant-table">
        <thead>
          <tr>
            <th rowSpan="2">Unit</th>
            <th rowSpan="2">Tenant/Resident</th>
            <th rowSpan="2" className="text-right">Per Month</th>
            <th rowSpan="2" className="text-right">Balance B/F</th>
            <th colSpan={1 + utilityColumns.length} className="text-right">Amount Invoiced</th>
            <th colSpan={1 + utilityColumns.length} className="text-right">Amount Received</th>
            <th rowSpan="2" className="text-right">Balance C/F</th>
          </tr>
          <tr>
            <th className="text-right">Rent</th>
            {utilityColumns.map((column) => (
              <th key={`inv-${column.key}`} className="text-right">{column.label}</th>
            ))}
            <th className="text-right">Rent</th>
            {utilityColumns.map((column) => (
              <th key={`paid-${column.key}`} className="text-right">{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tenantRows.map((row) => (
            <tr key={row.tenantId}>
              <td>{row.unit}</td>
              <td>{row.tenantName}</td>
              <td className="text-right">{formatCurrency(row.perMonth)}</td>
              <td className="text-right">{formatCurrency(row.balanceBF)}</td>
              <td className="text-right">{formatCurrency(row.invoicedRent)}</td>
              {utilityColumns.map((column) => (
                <td key={`${row.tenantId}-${column.key}-inv`} className="text-right">
                  {formatCurrency(getUtilityValue(row, column.key, "invoiced"))}
                </td>
              ))}
              <td className="text-right">{formatCurrency(row.paidRent)}</td>
              {utilityColumns.map((column) => (
                <td key={`${row.tenantId}-${column.key}-paid`} className="text-right">
                  {formatCurrency(getUtilityValue(row, column.key, "paid"))}
                </td>
              ))}
              <td className="text-right">{formatCurrency(row.balanceCF)}</td>
            </tr>
          ))}
          <tr className="totals-row">
            <td colSpan="2"><strong>TOTALS:</strong></td>
            <td className="text-right">
              <strong>{formatCurrency(tenantRows.reduce((sum, r) => sum + r.perMonth, 0))}</strong>
            </td>
            <td className="text-right">
              <strong>{formatCurrency(tenantRows.reduce((sum, r) => sum + r.balanceBF, 0))}</strong>
            </td>
            <td className="text-right">
              <strong>{formatCurrency(tenantRows.reduce((sum, r) => sum + r.invoicedRent, 0))}</strong>
            </td>
            {utilityColumns.map((column) => (
              <td key={`total-${column.key}-inv`} className="text-right">
                <strong>{formatCurrency(tenantRows.reduce((sum, row) => sum + getUtilityValue(row, column.key, "invoiced"), 0))}</strong>
              </td>
            ))}
            <td className="text-right">
              <strong>{formatCurrency(tenantRows.reduce((sum, r) => sum + r.paidRent, 0))}</strong>
            </td>
            {utilityColumns.map((column) => (
              <td key={`total-${column.key}-paid`} className="text-right">
                <strong>{formatCurrency(tenantRows.reduce((sum, row) => sum + getUtilityValue(row, column.key, "paid"), 0))}</strong>
              </td>
            ))}
            <td className="text-right">
              <strong>{formatCurrency(totalBalanceCF)}</strong>
            </td>
          </tr>
        </tbody>
      </table>

      <p style={{ fontSize: "10px", margin: "10px 0" }}>
        <strong>OCCUPIED UNITS: {occupiedUnits} | VACANT UNITS: {vacantUnits}</strong>
      </p>

      <div className="summary-section">
        <h3>Statement Summary</h3>
        <table className="summary-table">
          <tbody>
            <tr>
              <td>{basisCollectionsLabel.toUpperCase()}</td>
              <td>{formatCurrency(basisCollectionsAmount)}</td>
            </tr>
            {utilityPassThroughAmount > 0 && (
              <tr>
                <td>{utilityPassThroughLabel.toUpperCase()}</td>
                <td>{formatCurrency(utilityPassThroughAmount)}</td>
              </tr>
            )}
            <tr>
              <td>ADDITIONS</td>
              <td>{formatCurrency(totalAdditions)}</td>
            </tr>
            <tr>
              <td>EXPENSES & OTHER DEDUCTIONS</td>
              <td>{formatCurrency(totalExpenses)}</td>
            </tr>
            <tr>
              <td>COMMISSION ({commissionPercentage.toFixed(1)}%)</td>
              <td>{formatCurrency(commissionAmount)}</td>
            </tr>
            {commissionTaxAmount > 0 && (
              <tr>
                <td>VAT ON COMMISSION</td>
                <td>{formatCurrency(commissionTaxAmount)}</td>
              </tr>
            )}
            <tr>
              <td>GROSS COMMISSION DEDUCTION</td>
              <td>{formatCurrency(commissionGrossAmount)}</td>
            </tr>
            <tr>
              <td>DIRECT TO LANDLORD COLLECTIONS</td>
              <td>{formatCurrency(directToLandlordAmount)}</td>
            </tr>
            <tr className="net-row">
              <td>{settlement.label}</td>
              <td>{formatCurrency(settlement.amount)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="footer-note">
        <p>This is a computer-generated statement and does not require a signature.</p>
        <p>Generated by {companyName} Property Management System | Powered by Milik</p>
        <p>Total invoiced: KES {formatCurrency(totalInvoiced)} | Total received: KES {formatCurrency(totalPaid)}</p>
      </div>
    </div>
  );
};

export default StatementPrintView;

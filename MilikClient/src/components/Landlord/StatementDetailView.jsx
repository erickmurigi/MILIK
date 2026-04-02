import React, { useMemo, useState, useRef } from "react";
import { useSelector } from "react-redux";
import { hasCompanyPermission } from "../../utils/permissions";
import html2pdf from "html2pdf.js";
import {
  FaArrowLeft,
  FaCheckCircle,
  FaDownload,
  FaPaperPlane,
  FaEdit,
  FaLock,
  FaShieldAlt,
  FaPrint,
} from "react-icons/fa";
import StatementPrintView from "./StatementPrintView";

const MILIK_GREEN = "#0B3B2E";
const MILIK_ORANGE = "#FF8C00";

const resolveStatementSettlement = (summary = {}) => {
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
      label: summary?.settlementLabel || "Landlord Owes Manager",
      amount: explicitRecovery > 0 ? explicitRecovery : Math.abs(netStatement),
    };
  }

  return {
    isNegative: false,
    label: summary?.settlementLabel || "Net Amount Due",
    amount: Number(
      summary?.amountPayableToLandlord ??
        summary?.netPayableToLandlord ??
        (netStatement > 0 ? netStatement : 0)
    ),
  };
};

const StatementDetailView = ({
  statement,
  lines = [],
  loading = false,
  onBack,
  onApprove,
  onSend,
  onRevise,
  onDownloadPdf,
  onValidate,
  auditInfo = null,
  company = null,
}) => {
  const [showAudit, setShowAudit] = useState(false);
  const printViewRef = useRef(null);
  const pdfExportRef = useRef(null);

  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const allowApprove = hasCompanyPermission(currentUser || {}, currentCompany, "statements", "approve", "propertyManagement");
  const allowSend = hasCompanyPermission(currentUser || {}, currentCompany, "statements", "send", "propertyManagement");
  const allowRevise = hasCompanyPermission(currentUser || {}, currentCompany, "statements", "update", "propertyManagement");
  const allowExport = hasCompanyPermission(currentUser || {}, currentCompany, "statements", "export", "propertyManagement");

  const formatCurrency = (value) => {
    if (!value) return "KES 0.00";
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
    }).format(value);
  };

  const formatDate = (date) => {
    if (!date) return "N/A";
    return new Date(date).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatDateTime = (date) => {
    if (!date) return "N/A";
    return new Date(date).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusColor = (status) => {
    const colors = {
      draft: "text-yellow-600",
      reviewed: "text-blue-600",
      approved: "text-green-600",
      sent: "text-purple-600",
      revised: "text-pink-600",
    };
    return colors[status] || "text-gray-600";
  };

  const canApprove = statement?.status === "draft" || statement?.status === "reviewed";
  const canSend = statement?.status === "approved";
  const canRevise = statement?.status === "approved" || statement?.status === "sent";
  const canValidate = Boolean(statement?._id && onValidate);
  const isImmutable = statement?.status === "approved" || statement?.status === "sent";

  const getSignedAmount = (line) => {
    const amount = Number(line?.amount || 0);
    return line?.direction === "debit" ? -Math.abs(amount) : Math.abs(amount);
  };

  const parseStatementType = (notes = "") => {
    const lower = String(notes).toLowerCase();
    if (lower.includes("statement type: final")) return "Final";
    if (lower.includes("statement type: provisional")) return "Provisional";
    return "Draft";
  };

  const handlePrintAdvice = () => {
    window.print();
  };

  const handleDownloadPdf = async () => {
    if (!pdfExportRef.current) return;
    const opt = {
      margin: [15, 15, 15, 15],
      filename: `Statement_${statement?.statementNumber || statement?._id}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, letterRendering: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    // Temporarily show export node
    pdfExportRef.current.style.display = 'block';
    try {
      await html2pdf().set(opt).from(pdfExportRef.current).save();
    } catch (error) {
      console.error('PDF generation error:', error);
      throw error;
    } finally {
      pdfExportRef.current.style.display = 'none';
    }
  };

  const getCategoryAmount = (category) => {
    const record = statement?.totalsByCategory?.[category];
    if (!record) return 0;
    if (typeof record.totalAmount === "number") return Math.abs(Number(record.totalAmount || 0));
    return Math.abs(Number(record.totalCredit || 0) - Number(record.totalDebit || 0));
  };

  // Merge tenant list with statement lines to ensure all tenants are shown
  const tenants = window.__MILIK_TENANTS_FOR_STATEMENT || [];
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
    const paymentMethod = tenantObj?.paymentMethod || metadata?.paymentMethod || "-";

    if (!rowsMap.has(tenantId)) {
      rowsMap.set(tenantId, {
        tenantId,
        tenantName,
        unit: unitLabel,
        rent: 0,
        invoicedRent: 0,
        utilityCharges: 0,
        paidRent: 0,
        paidUtility: 0,
        balanceForward: 0,
        notes: paymentMethod,
      });
    }

    const row = rowsMap.get(tenantId);
    const absAmount = Math.abs(Number(line?.amount || 0));
    const signedAmount = getSignedAmount(line);
    const category = String(line?.category || "").toUpperCase();

    if (category === "RENT_CHARGE") {
      row.rent += absAmount;
      row.invoicedRent += absAmount;
    }
    if (category === "UTILITY_CHARGE") row.utilityCharges += absAmount;
    if (category === "RENT_RECEIPT_MANAGER" || category === "RENT_RECEIPT_LANDLORD") row.paidRent += absAmount;
    if (category === "UTILITY_RECEIPT_MANAGER" || category === "UTILITY_RECEIPT_LANDLORD") {
      row.paidUtility += absAmount;
    }
    if (category === "OPENING_BALANCE_BF") row.balanceForward += signedAmount;

    if (!row.notes || row.notes === "-") {
      row.notes = paymentMethod;
    }
  });

  // Add missing tenants
  tenants.forEach((tenant) => {
    const tid = String(tenant._id);
    if (!rowsMap.has(tid)) {
      rowsMap.set(tid, {
        tenantId: tid,
        tenantName: tenant.name,
        unit: tenant.unit?.unitNumber || "-",
        rent: tenant.rent || 0,
        invoicedRent: 0,
        utilityCharges: 0,
        paidRent: 0,
        paidUtility: 0,
        balanceForward: 0,
        notes: tenant.paymentMethod || "-",
        balance: 0,
      });
    }
  });

  // Utility receipts must be summed per tenant/unit
  // Use backend-calculated workspace rows and summary for preview
  const workspace = statement?.metadata?.workspace || {};
  const tenantRows = Array.isArray(workspace.rows) ? workspace.rows : [];
  const summary = workspace.summary || {};
  const totals = workspace.totals || {};
  const expenseLines = Array.isArray(workspace.expenseRows) ? workspace.expenseRows : [];
  const additionLines = Array.isArray(workspace.additionRows) ? workspace.additionRows : [];
  const settlement = resolveStatementSettlement(summary);
  const totalRentInvoiced = Number(summary.totalRentInvoiced ?? summary.rentInvoiced ?? 0);
  const totalRentReceived = Number(
    summary.totalRentReceived ?? summary.totalCollections ?? summary.managerCollections ?? 0
  );
  const summaryBasisLabel =
    summary.settlementBasisLabel || summary.basisCollectionsLabel || "Manager-held collections";
  const summaryBasisAmount = Number(
    summary.settlementBasisAmount ?? summary.basisCollections ?? summary.managerCollections ?? 0
  );
  const utilityPassThroughLabel =
    summary.utilityPassThroughLabel || "Utilities (added as billed)";
  const utilityPassThroughAmount = Number(summary.utilityPassThroughAmount ?? 0);
  const totalUtilityCollected = Number(summary.totalUtilityCollected ?? 0);
  const totalExpenses = Number(summary.totalExpenses ?? summary.nonCommissionDeductions ?? 0);
  const totalAdditions = Number(summary.totalAdditions ?? summary.additions ?? 0);
  const totalDirectToLandlord = Number(
    summary.directToLandlordCollections ??
      summary.directToLandlordOffsets ??
      summary.totalDirectToLandlordCollections ??
      0
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-green-800" />
          <p className="mt-2 text-gray-600">Loading statement...</p>
        </div>
      </div>
    );
  }

  if (!statement) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No statement selected</p>
      </div>
    );
  }

  const companyName = company?.name || company?.companyName || company?.businessName || "Milik";
  const companyAddress = company?.address || company?.location || "";
  const companyPhone = company?.phone || company?.telephone || "";
  const companyEmail = company?.email || "";
  const landlordName = statement?.landlord?.landlordName || statement?.landlord?.name || "N/A";
  const landlordEmail = statement?.landlord?.email || "";
  const propertyName = statement?.property?.propertyName || statement?.property?.name || "N/A";
  const propertyAddress = [statement?.property?.address, statement?.property?.city].filter(Boolean).join(", ");
  const statementTypeLabel = parseStatementType(statement?.notes);

  return (
    <>
      {/* Off-screen export node for PDF generation */}
      <div
        ref={pdfExportRef}
        style={{ position: 'absolute', left: '-9999px', top: 0, display: 'none', zIndex: -1 }}
      >
        <StatementPrintView
          statement={statement}
          lines={lines}
          company={company}
          summary={summary}
        />
      </div>

      {/* Hidden Print View - Only visible when printing */}
      <div className="print-only-wrapper" ref={printViewRef}>
        <StatementPrintView
          statement={statement}
          lines={lines}
          company={company}
          summary={summary}
        />
      </div>

      <div className="space-y-6 no-print">
        <div className="flex flex-col lg:flex-row justify-between gap-4">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
          <FaArrowLeft /> Back to Command Center
        </button>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handlePrintAdvice}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-white bg-gray-700 hover:bg-gray-800"
          >
            <FaPrint /> Print Advice
          </button>

          {allowExport && onDownloadPdf && (
            <button
              onClick={handleDownloadPdf}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-white"
              style={{ backgroundColor: MILIK_ORANGE }}
            >
              <FaDownload /> Download PDF
            </button>
          )}

          {allowApprove && canApprove && (
            <button
              onClick={() => onApprove(statement)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-white"
              style={{ backgroundColor: MILIK_GREEN }}
            >
              <FaCheckCircle /> Approve
            </button>
          )}

          {allowSend && canSend && (
            <button
              onClick={() => onSend(statement)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-white bg-purple-600 hover:bg-purple-700"
            >
              <FaPaperPlane /> Send
            </button>
          )}

          {allowRevise && canRevise && (
            <button
              onClick={() => onRevise(statement)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-white bg-yellow-600 hover:bg-yellow-700"
            >
              <FaEdit /> Revise
            </button>
          )}

          {canValidate && (
            <button
              onClick={() => onValidate(statement)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-white bg-blue-600 hover:bg-blue-700"
            >
              <FaShieldAlt /> Validate
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row justify-between gap-6">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">Landlord Statement Advice</h1>
            <p className="text-gray-700 font-semibold mt-1">{companyName}</p>
            <p className="text-sm text-gray-500">{companyAddress}</p>
            <p className="text-sm text-gray-500">{[companyPhone, companyEmail].filter(Boolean).join(" | ")}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <p className="text-gray-700"><span className="font-semibold">Statement #:</span> {statement.statementNumber || "-"}</p>
            <p className="text-gray-700"><span className="font-semibold">Version:</span> v{statement.version || 1}</p>
            <p className="text-gray-700"><span className="font-semibold">Status:</span> {String(statement.status || "draft").toUpperCase()}</p>
            <p className="text-gray-700"><span className="font-semibold">Type:</span> {statementTypeLabel}</p>
            <p className="text-gray-700 col-span-2">
              <span className="font-semibold">Period:</span> {formatDate(statement.periodStart)} to {formatDate(statement.periodEnd)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-gray-200 rounded-lg p-4 bg-white">
          <h3 className="font-semibold text-gray-900 mb-2">Property</h3>
          <p className="text-lg font-bold text-gray-900">{propertyName}</p>
          {propertyAddress && <p className="text-sm text-gray-500">{propertyAddress}</p>}
        </div>
        <div className="border border-gray-200 rounded-lg p-4 bg-white">
          <h3 className="font-semibold text-gray-900 mb-2">Landlord</h3>
          <p className="text-lg font-bold text-gray-900">{landlordName}</p>
          <p className="text-sm text-gray-500">{landlordEmail}</p>
          <p className="text-sm text-gray-500">{statement.landlord?.phoneNumber || ""}</p>
        </div>
        <div className="border border-gray-200 rounded-lg p-4 bg-white">
          <h3 className="font-semibold text-gray-900 mb-2">Workflow Status</h3>
          <p className={`font-bold ${getStatusColor(statement.status)}`}>{String(statement.status || "draft").toUpperCase()}</p>
          <p className="text-sm text-gray-600 mt-1">Currency: {statement.currency || "KES"}</p>
          {isImmutable && (
            <div className="mt-2 flex items-center gap-2 text-xs text-gray-700">
              <FaLock /> Immutable snapshot after approval
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-bold text-gray-900">Tenant Statement Breakdown</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead style={{ backgroundColor: MILIK_GREEN }}>
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-white">Tenant</th>
                <th className="px-4 py-3 text-left font-semibold text-white">Unit</th>
                <th className="px-4 py-3 text-right font-semibold text-white">Rent</th>
                <th className="px-4 py-3 text-right font-semibold text-white">Invoiced Rent</th>
                <th className="px-4 py-3 text-right font-semibold text-white">Utility / Other Charges</th>
                <th className="px-4 py-3 text-right font-semibold text-white">Paid Rent</th>
                <th className="px-4 py-3 text-right font-semibold text-white">Paid Utility</th>
                <th className="px-4 py-3 text-right font-semibold text-white">Balance Forward</th>
                <th className="px-4 py-3 text-right font-semibold text-white">Balance</th>
                <th className="px-4 py-3 text-left font-semibold text-white">Notes / Payment Mode</th>
              </tr>
            </thead>
            <tbody>
              {tenantRows.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-500" colSpan={10}>
                    No tenant-level rows found for this statement snapshot.
                  </td>
                </tr>
              )}
              {tenantRows.map((row, index) => (
                <tr key={row.tenantId} className={index % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="px-4 py-3 text-gray-900">{row.tenantName}</td>
                  <td className="px-4 py-3 text-gray-700">{row.unit}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(row.rent)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(row.invoicedRent)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(row.utilityCharges)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(row.paidRent)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(row.paidUtility)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(row.balanceForward)}</td>
                  <td className="px-4 py-3 text-right font-semibold font-mono">{formatCurrency(row.balance)}</td>
                  <td className="px-4 py-3 text-gray-700">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
            <h3 className="font-bold text-gray-900">Period Expenses</h3>
          </div>
          <div className="divide-y">
            {expenseLines.length === 0 && <p className="p-4 text-sm text-gray-500">No expenses for this period.</p>}
            {expenseLines.map((line) => (
              <div key={line._id} className="p-4 flex justify-between gap-3 text-sm">
                <div>
                  <p className="font-semibold text-gray-900">{line.description || line.category}</p>
                  <p className="text-gray-500">{formatDate(line.transactionDate)}</p>
                </div>
                <p className="font-mono font-semibold text-red-700">{formatCurrency(Math.abs(Number(line.amount || 0)))}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
            <h3 className="font-bold text-gray-900">Additions / Credits</h3>
          </div>
          <div className="divide-y">
            {additionLines.length === 0 && <p className="p-4 text-sm text-gray-500">No additions/credits for this period.</p>}
            {additionLines.map((line) => (
              <div key={line._id} className="p-4 flex justify-between gap-3 text-sm">
                <div>
                  <p className="font-semibold text-gray-900">{line.description || line.category}</p>
                  <p className="text-gray-500">{formatDate(line.transactionDate)}</p>
                </div>
                <p className="font-mono font-semibold text-green-700">{formatCurrency(Math.abs(Number(line.amount || 0)))}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="font-bold text-gray-900 mb-3">Commission Section</h3>
        <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-4">
          <div className="bg-gray-50 border border-gray-200 rounded p-3">
            <p className="text-gray-600">Commission %</p>
            <p className="text-xl font-bold text-gray-900">{Number(summary.commissionPercentage || 0).toFixed(2)}%</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded p-3">
            <p className="text-gray-600">Commission Amount</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(summary.commissionAmount || 0)}</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded p-3">
            <p className="text-gray-600">VAT on Commission</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(commissionTaxAmount)}</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded p-3">
            <p className="text-gray-600">{settlement.label}</p>
            <p className={`text-xl font-bold ${Number(statement.periodNet || 0) < 0 ? "text-red-700" : "text-green-700"}`}>
              {formatCurrency(settlement.amount)}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="font-bold text-gray-900">Statement Summary</h3>
        </div>
        <div className="p-5">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-gray-200">
                <td className="py-3 text-gray-700 font-semibold">Total Rent Invoiced</td>
                <td className="py-3 text-right font-mono text-gray-900">{formatCurrency(totalRentInvoiced)}</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-3 text-gray-700 font-semibold">Total Rent Received</td>
                <td className="py-3 text-right font-mono text-green-700 font-bold">{formatCurrency(totalRentReceived)}</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-3 text-gray-700 font-semibold">{summaryBasisLabel}</td>
                <td className="py-3 text-right font-mono text-gray-900">{formatCurrency(summaryBasisAmount)}</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-3 text-gray-700 font-semibold">
                  {utilityPassThroughAmount > 0 ? utilityPassThroughLabel : "Utility Collected"}
                </td>
                <td className="py-3 text-right font-mono text-gray-900">
                  {formatCurrency(utilityPassThroughAmount > 0 ? utilityPassThroughAmount : totalUtilityCollected)}
                </td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-3 text-gray-700 font-semibold">Total Expenses</td>
                <td className="py-3 text-right font-mono text-red-700">({formatCurrency(totalExpenses)})</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-3 text-gray-700 font-semibold">Additions / Credits</td>
                <td className="py-3 text-right font-mono text-gray-900">{formatCurrency(totalAdditions)}</td>
              </tr>
              {totalDirectToLandlord > 0 && (
                <tr className="border-b border-gray-200">
                  <td className="py-3 text-gray-700 font-semibold">Direct to Landlord Collections</td>
                  <td className="py-3 text-right font-mono text-gray-900">{formatCurrency(totalDirectToLandlord)}</td>
                </tr>
              )}
              <tr className="border-b border-gray-200">
                <td className="py-3 text-gray-700 font-semibold">Commission ({Number(summary.commissionPercentage || 0).toFixed(2)}%)</td>
                <td className="py-3 text-right font-mono text-red-700">({formatCurrency(summary.commissionAmount || 0)})</td>
              </tr>
              {commissionTaxAmount > 0 && (
                <tr className="border-b-2 border-gray-300">
                  <td className="py-3 text-gray-700 font-semibold">VAT on Commission</td>
                  <td className="py-3 text-right font-mono text-red-700">({formatCurrency(commissionTaxAmount)})</td>
                </tr>
              )}
              <tr className={settlement.isNegative ? "bg-red-50" : "bg-green-50"}>
                <td className={`py-4 text-gray-900 font-bold text-lg ${settlement.isNegative ? "text-red-700" : ""}`}>{settlement.label.toUpperCase()}</td>
                <td className={`py-4 text-right font-mono font-extrabold text-xl ${settlement.isNegative ? "text-red-700" : "text-green-700"}`}>{formatCurrency(settlement.amount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
        <button
          onClick={() => setShowAudit(!showAudit)}
          className="flex items-center gap-2 text-blue-700 font-semibold hover:text-blue-900"
        >
          <span className={`transform ${showAudit ? "rotate-90" : ""}`}>›</span>
          Audit Information
        </button>
        {showAudit && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-semibold text-gray-700">Statement ID:</span>
              <p className="text-gray-600 font-mono text-xs">{statement._id}</p>
            </div>
            <div>
              <span className="font-semibold text-gray-700">Line Count:</span>
              <p className="text-gray-600">{statement.lineCount || lines?.length || 0}</p>
            </div>
            <div>
              <span className="font-semibold text-gray-700">Generated:</span>
              <p className="text-gray-600">{formatDateTime(statement.generatedAt || statement.createdAt)}</p>
            </div>
            <div>
              <span className="font-semibold text-gray-700">Ledger Entries:</span>
              <p className="text-gray-600">{statement.ledgerEntryCount || 0}</p>
            </div>
            <div>
              <span className="font-semibold text-gray-700">Created:</span>
              <p className="text-gray-600">{formatDateTime(statement.createdAt)}</p>
            </div>
            {statement.approvedAt && (
              <div>
                <span className="font-semibold text-gray-700">Approved:</span>
                <p className="text-gray-600">{formatDateTime(statement.approvedAt)}</p>
              </div>
            )}
            {statement.sentAt && (
              <div>
                <span className="font-semibold text-gray-700">Sent:</span>
                <p className="text-gray-600">{formatDateTime(statement.sentAt)}</p>
              </div>
            )}
            {auditInfo && (
              <div className="md:col-span-2 mt-2 p-3 rounded border border-blue-300 bg-white">
                <p className={`font-semibold ${auditInfo.valid ? "text-green-700" : "text-red-700"}`}>
                  Audit Result: {auditInfo.valid ? "PASS" : "MISMATCH"}
                </p>
                {auditInfo.message && <p className="text-gray-700 mt-1">{auditInfo.message}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
};

export default StatementDetailView;

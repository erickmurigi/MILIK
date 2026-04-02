import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  FaFileDownload,
  FaMoneyBillWave,
  FaPrint,
  FaRedoAlt,
  FaSearch,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

const formatCurrency = (value = 0) =>
  `KES ${Number(value || 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const toInputMonth = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const toMonthLabel = (monthKey = "") => {
  const [year, month] = String(monthKey || "").split("-");
  if (!year || !month) return "-";
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return monthKey;
  return date.toLocaleDateString("en-KE", { month: "long", year: "numeric" });
};

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const normalizeBasisLabel = (value = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Not set";
  if (raw === "received") return "Received/Cash";
  if (["expected", "invoiced", "accrual"].includes(raw)) return "Expected/Invoiced";
  if (["manager_received", "received_manager_only"].includes(raw)) return "Manager-held receipts";
  return raw
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const getStatementEffectiveDate = (statement = {}) => {
  const candidate =
    statement?.closedAt ||
    statement?.approvedAt ||
    statement?.processedAt ||
    statement?.periodEnd ||
    statement?.createdAt;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getCommissionStructureLabel = (statement = {}) => {
  const property = statement?.property || {};
  const mode = String(property?.commissionPaymentMode || "").trim().toLowerCase();
  const percentage = Number(property?.commissionPercentage || 0);
  const fixedAmount = Number(property?.commissionFixedAmount || 0);

  if (mode === "fixed") {
    return fixedAmount > 0 ? `Fixed ${formatCurrency(fixedAmount)}` : "Fixed amount";
  }

  if (mode === "both") {
    const pieces = [];
    if (percentage > 0) pieces.push(`${percentage}%`);
    if (fixedAmount > 0) pieces.push(formatCurrency(fixedAmount));
    return pieces.length ? pieces.join(" + ") : "Mixed";
  }

  if (mode === "percentage") {
    return percentage > 0 ? `${percentage}%` : "Percentage";
  }

  if (percentage > 0 && fixedAmount > 0) {
    return `${percentage}% + ${formatCurrency(fixedAmount)}`;
  }
  if (percentage > 0) return `${percentage}%`;
  if (fixedAmount > 0) return `Fixed ${formatCurrency(fixedAmount)}`;
  return "Not set";
};

const CommissionReports = () => {
  const currentCompany = useSelector((state) => state.company?.currentCompany);

  const [loading, setLoading] = useState(false);
  const [statementRows, setStatementRows] = useState([]);
  const currentMonth = useMemo(() => toInputMonth(new Date()), []);
  const [draftFilters, setDraftFilters] = useState({
    monthFrom: currentMonth,
    monthTo: currentMonth,
    search: "",
  });
  const [appliedFilters, setAppliedFilters] = useState({
    monthFrom: currentMonth,
    monthTo: currentMonth,
    search: "",
  });

  const loadData = useCallback(async () => {
    if (!currentCompany?._id) {
      setStatementRows([]);
      return;
    }

    setLoading(true);
    try {
      const response = await adminRequests.get(`/processed-statements/business/${currentCompany._id}`);
      const statements = Array.isArray(response?.data?.statements) ? response.data.statements : [];
      setStatementRows(statements);
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to load commission report data.");
      setStatementRows([]);
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredRows = useMemo(() => {
    const search = String(appliedFilters.search || "").trim().toLowerCase();
    const fromMonth = String(appliedFilters.monthFrom || "").trim();
    const toMonth = String(appliedFilters.monthTo || "").trim();

    return (Array.isArray(statementRows) ? statementRows : [])
      .map((statement) => {
        const recognitionDate = getStatementEffectiveDate(statement);
        if (!recognitionDate) return null;

        const monthKey = `${recognitionDate.getFullYear()}-${String(recognitionDate.getMonth() + 1).padStart(2, "0")}`;
        if (fromMonth && monthKey < fromMonth) return null;
        if (toMonth && monthKey > toMonth) return null;

        const propertyName = statement?.property?.propertyName || statement?.property?.name || "Unassigned Property";
        const landlordName =
          statement?.landlord?.landlordName ||
          [statement?.landlord?.firstName, statement?.landlord?.lastName].filter(Boolean).join(" ") ||
          "Unassigned Landlord";
        const statementNumber =
          statement?.statementNumber ||
          statement?.sourceStatementNumber ||
          statement?.sourceStatement?.statementNumber ||
          "-";
        const recognitionBasis = normalizeBasisLabel(
          statement?.commissionBasis || statement?.property?.commissionRecognitionBasis
        );
        const structureLabel = getCommissionStructureLabel(statement);
        const commissionAmount = Number(statement?.commissionAmount || 0);
        const isReversed = String(statement?.status || "").toLowerCase() === "reversed";
        const recognizedAmount = isReversed ? 0 : commissionAmount;
        const reversedAmount = isReversed ? commissionAmount : 0;

        const row = {
          id: String(statement?._id || `${statementNumber}-${monthKey}`),
          monthKey,
          recognitionDate,
          statementNumber,
          propertyName,
          landlordName,
          recognitionBasis,
          structureLabel,
          recognizedAmount,
          reversedAmount,
          status: isReversed ? "Reversed" : "Recognized",
        };

        if (search) {
          const haystack = [
            row.statementNumber,
            row.propertyName,
            row.landlordName,
            row.recognitionBasis,
            row.structureLabel,
            row.status,
            monthKey,
          ]
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(search)) return null;
        }

        return row;
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.recognitionDate.getTime() !== b.recognitionDate.getTime()) {
          return b.recognitionDate.getTime() - a.recognitionDate.getTime();
        }
        return a.propertyName.localeCompare(b.propertyName);
      });
  }, [appliedFilters, statementRows]);

  const totals = useMemo(() => ({
    statements: filteredRows.length,
    months: new Set(filteredRows.map((row) => row.monthKey)).size,
    recognizedCommission: filteredRows.reduce((sum, row) => sum + row.recognizedAmount, 0),
    reversedCommission: filteredRows.reduce((sum, row) => sum + row.reversedAmount, 0),
    reversedStatements: filteredRows.filter((row) => row.status === "Reversed").length,
  }), [filteredRows]);

  const applySearch = () => setAppliedFilters({ ...draftFilters, search: draftFilters.search.trim() });

  const resetFilters = () => {
    const nextFilters = {
      monthFrom: currentMonth,
      monthTo: currentMonth,
      search: "",
    };
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
  };

  const handleExportCSV = () => {
    const lines = [
      [
        "Recognition Date",
        "Month",
        "Statement Number",
        "Property",
        "Landlord",
        "Recognition Basis",
        "Percentage / Amount",
        "Recognized Amount",
        "Reversed Amount",
        "Status",
      ].join(","),
      ...filteredRows.map((row) => [
        formatDate(row.recognitionDate),
        toMonthLabel(row.monthKey),
        `"${row.statementNumber}"`,
        `"${row.propertyName}"`,
        `"${row.landlordName}"`,
        `"${row.recognitionBasis}"`,
        `"${row.structureLabel}"`,
        row.recognizedAmount.toFixed(2),
        row.reversedAmount.toFixed(2),
        row.status,
      ].join(",")),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `milik_commission_report_${draftFilters.monthFrom || "from"}_${draftFilters.monthTo || "to"}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success("Commission report exported.");
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50 p-0">
        <div className="sticky top-0 z-30 bg-gray-50 px-2 pt-2">
          <div className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="month"
                value={draftFilters.monthFrom}
                onChange={(e) => setDraftFilters((prev) => ({ ...prev, monthFrom: e.target.value }))}
                className="rounded border border-gray-300 bg-[#DDEFE1] px-3 py-1 text-xs text-gray-800 shadow-sm transition-colors hover:bg-white focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
              />

              <input
                type="month"
                value={draftFilters.monthTo}
                onChange={(e) => setDraftFilters((prev) => ({ ...prev, monthTo: e.target.value }))}
                className="rounded border border-gray-300 bg-[#DDEFE1] px-3 py-1 text-xs text-gray-800 shadow-sm transition-colors hover:bg-white focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
              />

              <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded border border-gray-300 bg-[#DDEFE1] px-3 py-1 text-xs text-gray-800 shadow-sm transition-colors hover:bg-white focus-within:ring-1 focus-within:ring-[#0B3B2E]">
                <FaSearch className="text-[11px]" />
                <input
                  value={draftFilters.search}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, search: e.target.value }))}
                  placeholder="Search statement, property, landlord or basis"
                  className="w-full bg-transparent text-xs outline-none"
                />
              </div>

              <button
                onClick={applySearch}
                className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}
              >
                <FaSearch className="text-xs" /> Search
              </button>

              <button
                onClick={resetFilters}
                className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
              >
                <FaRedoAlt className="text-xs" /> Reset
              </button>

              <button
                onClick={loadData}
                className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
              >
                <FaRedoAlt className="text-xs" /> Reload
              </button>

              <button
                onClick={handleExportCSV}
                className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}
              >
                <FaFileDownload className="text-xs" /> Export
              </button>

              <button
                onClick={() => window.print()}
                className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
              >
                <FaPrint className="text-xs" /> Print
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Recognized Commission</div>
              <div className="mt-2 text-2xl font-black text-[#0B3B2E]">{formatCurrency(totals.recognizedCommission)}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Reversed Commission</div>
              <div className="mt-2 text-2xl font-black text-red-700">{formatCurrency(totals.reversedCommission)}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Statements / Months</div>
              <div className="mt-2 text-2xl font-black text-gray-900">{totals.statements} / {totals.months}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Reversed Statements</div>
              <div className="mt-2 text-2xl font-black text-[#FF8C00]">{totals.reversedStatements}</div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
              <div>
                <h1 className="flex items-center gap-3 text-xl font-black tracking-tight text-gray-900">
                  <FaMoneyBillWave className="text-[#0B3B2E]" />
                  Commission Reports
                </h1>
                <p className="mt-1 text-sm text-gray-600">
                  {currentCompany?.companyName
                    ? `Commission recognized from processed statements for ${currentCompany.companyName}.`
                    : "Select a company to view commission recognition."}
                </p>
              </div>
              <div className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
                {filteredRows.length} row{filteredRows.length === 1 ? "" : "s"}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
                  <tr>
                    <th className="px-4 py-3 text-left font-bold">Recognition Date</th>
                    <th className="px-4 py-3 text-left font-bold">Statement No.</th>
                    <th className="px-4 py-3 text-left font-bold">Property</th>
                    <th className="px-4 py-3 text-left font-bold">Landlord</th>
                    <th className="px-4 py-3 text-left font-bold">Recognition Basis</th>
                    <th className="px-4 py-3 text-left font-bold">Percentage / Amount</th>
                    <th className="px-4 py-3 text-right font-bold">Recognized</th>
                    <th className="px-4 py-3 text-right font-bold">Reversed</th>
                    <th className="px-4 py-3 text-left font-bold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {!currentCompany?._id ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-500">
                        Select an active company to view the commission report.
                      </td>
                    </tr>
                  ) : loading ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-500">
                        Loading commission report...
                      </td>
                    </tr>
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-500">
                        No recognized commission data found for the selected filter range.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => (
                      <tr key={row.id} className="border-t border-gray-200 hover:bg-gray-50/80">
                        <td className="px-4 py-3 font-semibold text-gray-900">{formatDate(row.recognitionDate)}</td>
                        <td className="px-4 py-3 text-gray-700">{row.statementNumber}</td>
                        <td className="px-4 py-3 text-gray-700">{row.propertyName}</td>
                        <td className="px-4 py-3 text-gray-700">{row.landlordName}</td>
                        <td className="px-4 py-3 text-gray-700">{row.recognitionBasis}</td>
                        <td className="px-4 py-3 text-gray-700">{row.structureLabel}</td>
                        <td className="px-4 py-3 text-right font-bold text-[#0B3B2E]">{formatCurrency(row.recognizedAmount)}</td>
                        <td className="px-4 py-3 text-right font-bold text-red-700">{formatCurrency(row.reversedAmount)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${row.status === "Reversed" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredRows.length > 0 ? (
                  <tfoot className="bg-gray-100 text-sm font-black text-gray-900">
                    <tr>
                      <td colSpan={6} className="px-4 py-3">Totals</td>
                      <td className="px-4 py-3 text-right text-[#0B3B2E]">{formatCurrency(totals.recognizedCommission)}</td>
                      <td className="px-4 py-3 text-right text-red-700">{formatCurrency(totals.reversedCommission)}</td>
                      <td className="px-4 py-3" />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default CommissionReports;

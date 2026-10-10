import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import {
  FaFileDownload,
  FaMoneyBillWave,
  FaPrint,
  FaRedoAlt,
  FaSearch,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import AppSelect from "../../components/common/AppSelect";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import ListToolbar from "../../components/common/ListToolbar";
import MilikTable from "../../components/common/MilikTable";
import { fmtDate } from "../../utils/dates";
import { adminRequests } from "../../utils/requestMethods";
import PaginationBar from "../../components/PaginationBar";
import { useTerms } from "../../hooks/useTerm";
import { formatMoney } from "../../utils/money";
import printTabularList from "../../utils/printList";

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
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "commissionReports", "export", "propertyManagement");

  const [loading, setLoading] = useState(false);
  const [statementRows, setStatementRows] = useState([]);
  const currentMonth = useMemo(() => toInputMonth(new Date()), []);
  const [appliedFilters, setAppliedFilters] = useTabState("/reports/commissions:appliedFilters", { monthFrom: currentMonth, monthTo: currentMonth, search: "", status: "recognized" });
  const setFilter = (key) => (e) => setAppliedFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const [currentPage, setCurrentPage] = useTabState("/reports/commissions:currentPage", 1);
  const [pageSize, setPageSize] = useState(50);

  const { property: termProperty, landlord: termLandlord } = useTerms("property", "landlord");

  const loadData = useCallback(async () => {
    if (!currentCompany?._id) {
      setStatementRows([]);
      return;
    }

    setLoading(true);
    try {
      // Push date range and status filters to the server so only matching records are returned.
      const params = {
        monthFrom: appliedFilters.monthFrom,
        monthTo: appliedFilters.monthTo,
        limit: 500,
      };
      if (appliedFilters.status) {
        params.commissionStatus = appliedFilters.status; // "recognized" | "reversed"
      }

      const response = await adminRequests.get(`/processed-statements/business/${currentCompany._id}`, { params });
      const statements = Array.isArray(response?.data?.statements) ? response.data.statements : [];
      setStatementRows(statements);
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to load commission report data.");
      setStatementRows([]);
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id, appliedFilters.monthFrom, appliedFilters.monthTo, appliedFilters.status]);

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

        if (appliedFilters.status === "recognized" && isReversed) return null;
        if (appliedFilters.status === "reversed" && !isReversed) return null;

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

  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredRows.length / pageSize)), [filteredRows.length, pageSize]);
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedRows = useMemo(() => filteredRows.slice(startIndex, endIndex), [filteredRows, startIndex, endIndex]);

  useEffect(() => {
    setCurrentPage(1);
  }, [appliedFilters]);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

  const totals = useMemo(() => ({
    statements: filteredRows.length,
    months: new Set(filteredRows.map((row) => row.monthKey)).size,
    recognizedCommission: filteredRows.reduce((sum, row) => sum + row.recognizedAmount, 0),
    reversedCommission: filteredRows.reduce((sum, row) => sum + row.reversedAmount, 0),
    reversedStatements: filteredRows.filter((row) => row.status === "Reversed").length,
  }), [filteredRows]);

  const handlePrint = useCallback(() => {
    if (!canExportReports) { toast.warning("You do not have permission to print reports"); return; }
    const printed = printTabularList({
      title: "Commission Report",
      subtitle: `Period: ${toMonthLabel(appliedFilters.monthFrom)} — ${toMonthLabel(appliedFilters.monthTo)}`,
      company: currentCompany,
      columns: [
        { label: "Recognition Date", value: (r) => fmtDate(r.recognitionDate) },
        { label: "Statement No.", value: (r) => r.statementNumber },
        { label: termProperty, value: (r) => r.propertyName },
        { label: termLandlord, value: (r) => r.landlordName },
        { label: "Basis", value: (r) => r.recognitionBasis },
        { label: "Structure", value: (r) => r.structureLabel },
        { label: "Recognized", align: "right", value: (r) => formatMoney(r.recognizedAmount), bold: true },
        { label: "Reversed", align: "right", value: (r) => formatMoney(r.reversedAmount), tone: () => "neg" },
        { label: "Status", value: (r) => r.status, tone: (r) => (r.status === "Reversed" ? "neg" : "pos") },
      ],
      rows: filteredRows,
      summaryItems: [
        ["Recognized Commission", formatCurrency(totals.recognizedCommission)],
        ["Reversed Commission", formatCurrency(totals.reversedCommission)],
        ["Statements / Months", `${totals.statements} / ${totals.months}`],
        ["Reversed Statements", String(totals.reversedStatements)],
      ],
      totalsRow: ["TOTALS", "", "", "", "", "", formatMoney(totals.recognizedCommission), formatMoney(totals.reversedCommission), ""],
    });
    if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
  }, [canExportReports, currentCompany, filteredRows, totals, appliedFilters.monthFrom, appliedFilters.monthTo, termProperty, termLandlord]);

  const resetFilters = () => {
    setAppliedFilters({
      monthFrom: currentMonth,
      monthTo: currentMonth,
      search: "",
      status: "recognized",
    });
  };

  const handleExportCSV = () => {
    if (!canExportReports) {
      toast.warning("You do not have permission to export reports");
      return;
    }
    const lines = [
      [
        "Recognition Date",
        "Month",
        "Statement Number",
        termProperty,
        termLandlord,
        "Recognition Basis",
        "Percentage / Amount",
        "Recognized Amount",
        "Reversed Amount",
        "Status",
      ].join(","),
      ...filteredRows.map((row) => [
        fmtDate(row.recognitionDate),
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
    link.download = `milik_commission_report_${appliedFilters.monthFrom || "from"}_${appliedFilters.monthTo || "to"}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success("Commission report exported.");
  };

  const companyName = currentCompany?.name || currentCompany?.companyName || currentCompany?.businessName || "Milik";
  const preparedBy = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(" ") || currentUser?.email || "Milik Admin";

  return (
    <DashboardLayout lockContentScroll>
      <div className="print-only-wrapper">
        <style>{`
          @page { size: landscape; margin: 10mm; }
          .comm-print-shell { font-family: Arial, sans-serif; color: #0f172a; }
          .comm-print-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
          .comm-print-brand { color: #0B3B2E; font-size: 9px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 900; }
          .comm-print-title { margin: 2px 0 4px; font-size: 18px; font-weight: 900; color: #0f172a; }
          .comm-print-meta { text-align: right; font-size: 9px; color: #475569; line-height: 1.6; }
          .comm-print-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }
          .comm-print-metric { border: 1px solid #dbe2ea; border-radius: 6px; background: #f8fafc; padding: 6px 8px; }
          .comm-print-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; font-weight: 800; }
          .comm-print-value { margin-top: 3px; font-size: 13px; font-weight: 900; color: #0f172a; }
          .comm-print-table { width: 100%; border-collapse: collapse; font-size: 8.5px; }
          .comm-print-table th, .comm-print-table td { border: 1px solid #dbe2ea; padding: 4px 5px; vertical-align: top; }
          .comm-print-table thead th { background: #edf4f0; color: #0B3B2E; font-size: 7.5px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 800; }
          .tr { text-align: right; }
        `}</style>
        <div className="comm-print-shell">
          <div className="comm-print-header">
            <div>
              <div className="comm-print-brand">{companyName}</div>
              <h1 className="comm-print-title">Commission Report</h1>
              <p style={{ margin: 0, fontSize: "10px", color: "#475569" }}>Recognized landlord commission by period.</p>
            </div>
            <div className="comm-print-meta">
              <div><strong>Period:</strong> {appliedFilters.monthFrom || "—"} to {appliedFilters.monthTo || "—"}</div>
              <div><strong>Generated:</strong> {new Date().toLocaleString()}</div>
              <div><strong>Prepared by:</strong> {preparedBy}</div>
            </div>
          </div>
          <div className="comm-print-grid">
            {[
              { label: "Recognized", value: formatCurrency(totals.recognizedCommission) },
              { label: "Reversed", value: formatCurrency(totals.reversedCommission) },
              { label: "Statements", value: String(totals.statements) },
              { label: "Months", value: String(totals.months) },
            ].map((c) => (
              <div key={c.label} className="comm-print-metric">
                <div className="comm-print-label">{c.label}</div>
                <div className="comm-print-value">{c.value}</div>
              </div>
            ))}
          </div>
          <table className="comm-print-table">
            <thead>
              <tr>
                {["Recognition Date", "Statement No.", termProperty, termLandlord, "Basis", "Structure", "Recognized", "Reversed", "Status"].map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: "12px" }}>No commission data found for the selected filters.</td></tr>
              ) : filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>{fmtDate(row.recognitionDate)}</td>
                  <td>{row.statementNumber}</td>
                  <td>{row.propertyName}</td>
                  <td>{row.landlordName}</td>
                  <td>{row.recognitionBasis}</td>
                  <td>{row.structureLabel}</td>
                  <td className="tr"><strong>{formatCurrency(row.recognizedAmount)}</strong></td>
                  <td className="tr" style={{ color: "#b91c1c" }}>{formatCurrency(row.reversedAmount)}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-2">
        <div className="mx-auto flex h-full w-full max-w-none min-h-0 flex-1 flex-col gap-2">

          {/* Filter bar */}
          <ListToolbar>
            <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">{totals.statements} rows</span>
            <ListToolbar.Divider />
            <ListToolbar.Input type="month" width="w-32" value={appliedFilters.monthFrom} onChange={setFilter("monthFrom")} />
            <ListToolbar.Input type="month" width="w-32" value={appliedFilters.monthTo} onChange={setFilter("monthTo")} />
            <AppSelect
              value={appliedFilters.status}
              onChange={(v) => setAppliedFilters((prev) => ({ ...prev, status: v ?? "" }))}
              options={[
                { value: "recognized", label: "Recognized only" },
                { value: "reversed", label: "Reversed only" },
              ]}
              placeholder="All statuses"
              clearable
              compact
            />
            <div className="relative shrink-0 w-56">
              <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400" size={8} />
              <ListToolbar.Input
                width="w-full"
                className="pl-5"
                value={appliedFilters.search}
                onChange={setFilter("search")}
                placeholder={`Search statement, ${termProperty.toLowerCase()}, ${termLandlord.toLowerCase()} or basis…`}
              />
            </div>
            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaRedoAlt} variant="outline" onClick={resetFilters}>Reset</ListToolbar.Button>
            <ListToolbar.Divider />
            {canExportReports && <ListToolbar.Button icon={FaFileDownload} variant="outline" onClick={handleExportCSV}>Export</ListToolbar.Button>}
            {canExportReports && <ListToolbar.Button icon={FaPrint} variant="outline" onClick={handlePrint}>Print</ListToolbar.Button>}
            <ListToolbar.Button icon={FaRedoAlt} variant="outline" onClick={loadData} disabled={loading}>Reload</ListToolbar.Button>
          </ListToolbar>

          {/* Table */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white shadow-lg">
            <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
              <MilikTable
                columns={[
                  { label: "Recognition Date" },
                  { label: "Statement No." },
                  { label: termProperty },
                  { label: termLandlord },
                  { label: "Basis" },
                  { label: "Structure" },
                  { label: "Recognized", align: "right" },
                  { label: "Reversed", align: "right" },
                  { label: "Status" },
                ]}
                rows={paginatedRows}
                rowKey="id"
                loading={loading && paginatedRows.length === 0}
                empty={!currentCompany?._id ? "Select an active company to view the commission report." : "No commission data found for the selected filter range."}
                renderFooter={filteredRows.length > 0 ? () => (
                  <>
                    <td colSpan={6} className="px-3 py-2 text-right font-black text-slate-700">Totals</td>
                    <td className="px-3 py-2 text-right font-black text-[#0B3B2E]">{formatCurrency(totals.recognizedCommission)}</td>
                    <td className="px-3 py-2 text-right font-black text-red-600">{formatCurrency(totals.reversedCommission)}</td>
                    <td />
                  </>
                ) : undefined}
                renderRow={(row) => (
                  <>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-semibold text-slate-900">{fmtDate(row.recognitionDate)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-700">{row.statementNumber}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-700">{row.propertyName}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-700">{row.landlordName}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-700">{row.recognitionBasis}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-700">{row.structureLabel}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-bold text-[#0B3B2E]">{formatCurrency(row.recognizedAmount)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-bold text-red-600">{formatCurrency(row.reversedAmount)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${row.status === 'Reversed' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                        {row.status}
                      </span>
                    </td>
                  </>
                )}
              />
            </div>
            <PaginationBar
              page={safeCurrentPage}
              pages={totalPages}
              total={filteredRows.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={loading}
              label="commission rows"
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default CommissionReports;

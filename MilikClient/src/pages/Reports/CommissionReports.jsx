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
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";
const ITEMS_PER_PAGE = 50;

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
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "commissionReports", "export", "propertyManagement");

  const [loading, setLoading] = useState(false);
  const [statementRows, setStatementRows] = useState([]);
  const currentMonth = useMemo(() => toInputMonth(new Date()), []);
  const [appliedFilters, setAppliedFilters] = useTabState("/reports/commissions:appliedFilters", { monthFrom: currentMonth, monthTo: currentMonth, search: "", status: "recognized" });
  const [draftFilters, setDraftFilters] = useState(appliedFilters);
  const setFilter = (key) => (e) => setDraftFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const [currentPage, setCurrentPage] = useTabState("/reports/commissions:currentPage", 1);

  const loadData = useCallback(async () => {
    if (!currentCompany?._id) {
      setStatementRows([]);
      return;
    }

    setLoading(true);
    try {
      // Pass month param for single-month views so the server can narrow the query.
      // For date ranges the server returns all; client filters by monthKey string comparison.
      const params = {};
      if (appliedFilters.monthFrom === appliedFilters.monthTo) {
        params.month = appliedFilters.monthFrom;
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
  }, [currentCompany?._id, appliedFilters.monthFrom, appliedFilters.monthTo]);

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

  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredRows.length / ITEMS_PER_PAGE)), [filteredRows.length]);
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
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
    const co = currentCompany || {};
    const name = co.companyName || co.name || co.businessName || 'Milik';
    const logo = co.logo || '';
    const by = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(' ') || currentUser?.email || '';
    const win = window.open('', '_blank', 'width=1120,height=800');
    if (!win) { toast.error('Pop-up blocked. Please allow pop-ups to print.'); return; }
    const fmt = (v) => `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    win.document.write(`<!DOCTYPE html><html><head><title>Commission Report</title><style>
      @page{size:A4 landscape;margin:12mm 14mm}body{font-family:Arial,sans-serif;color:#0f172a;font-size:9px;margin:0}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0B3B2E;padding-bottom:8px;margin-bottom:10px}
      .co{font-size:13px;font-weight:900;color:#0B3B2E}.ttl{font-size:16px;font-weight:900;margin:2px 0}
      .sub{font-size:10px;color:#475569;margin-top:2px}.meta{text-align:right;color:#64748b;font-size:8.5px;line-height:1.6}
      .logo{max-height:40px;max-width:110px;object-fit:contain;margin-bottom:4px}
      .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
      .card{border:1px solid #dbe2ea;border-radius:6px;background:#f8fafc;padding:6px 8px}
      .cl{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:800}
      .cv{font-size:13px;font-weight:900;color:#0f172a;margin-top:3px}
      table{width:100%;border-collapse:collapse;font-size:8.5px}
      thead th{background:#0B3B2E;color:#fff;padding:4px 6px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.1em}
      thead th.r{text-align:right}tbody td{border-bottom:1px solid #dbe2ea;padding:3.5px 6px}
      tbody td.r{text-align:right}tbody tr:nth-child(even){background:#f8fafc}
      tfoot td{border-top:2px solid #0B3B2E;padding:4px 6px;font-weight:900;background:#EDF5F1}tfoot td.r{text-align:right}
      .badge-r{display:inline-block;padding:1px 6px;border-radius:99px;font-size:8px;font-weight:800;background:#fee2e2;color:#b91c1c}
      .badge-g{display:inline-block;padding:1px 6px;border-radius:99px;font-size:8px;font-weight:800;background:#d1fae5;color:#065f46}
      *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    </style></head><body>
    <div class="hdr"><div>${logo ? `<img src="${logo}" class="logo" alt="">` : ''}<div class="co">${name}</div><div class="ttl">Commission Report</div><div class="sub">Period: ${toMonthLabel(appliedFilters.monthFrom)} — ${toMonthLabel(appliedFilters.monthTo)}</div></div>
    <div class="meta"><div>Generated: ${new Date().toLocaleString()}</div><div>Prepared by: ${by}</div><div>Records: ${filteredRows.length}</div></div></div>
    <div class="cards">
      <div class="card"><div class="cl">Recognized Commission</div><div class="cv" style="color:#0B3B2E">${fmt(totals.recognizedCommission)}</div></div>
      <div class="card"><div class="cl">Reversed Commission</div><div class="cv" style="color:#b91c1c">${fmt(totals.reversedCommission)}</div></div>
      <div class="card"><div class="cl">Statements / Months</div><div class="cv">${totals.statements} / ${totals.months}</div></div>
      <div class="card"><div class="cl">Reversed Statements</div><div class="cv" style="color:#FF8C00">${totals.reversedStatements}</div></div>
    </div>
    <table><thead><tr><th>Recognition Date</th><th>Statement No.</th><th>Property</th><th>Landlord</th><th>Basis</th><th>Structure</th><th class="r">Recognized</th><th class="r">Reversed</th><th>Status</th></tr></thead>
    <tbody>${filteredRows.map((row) => `<tr><td>${formatDate(row.recognitionDate)}</td><td>${row.statementNumber}</td><td>${row.propertyName}</td><td>${row.landlordName}</td><td>${row.recognitionBasis}</td><td>${row.structureLabel}</td><td class="r"><strong>${fmt(row.recognizedAmount)}</strong></td><td class="r" style="color:#b91c1c">${fmt(row.reversedAmount)}</td><td><span class="${row.status === 'Reversed' ? 'badge-r' : 'badge-g'}">${row.status}</span></td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="6"><strong>TOTALS</strong></td><td class="r"><strong>${fmt(totals.recognizedCommission)}</strong></td><td class="r" style="color:#b91c1c"><strong>${fmt(totals.reversedCommission)}</strong></td><td></td></tr></tfoot>
    </table></body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [canExportReports, currentCompany, currentUser, filteredRows, totals, appliedFilters.monthFrom, appliedFilters.monthTo]);

  const applySearch = () => setAppliedFilters({ ...draftFilters, search: draftFilters.search.trim() });

  const resetFilters = () => {
    const nextFilters = {
      monthFrom: currentMonth,
      monthTo: currentMonth,
      search: "",
      status: "recognized",
    };
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
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
              <div><strong>Period:</strong> {draftFilters.monthFrom || "—"} to {draftFilters.monthTo || "—"}</div>
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
                {["Recognition Date", "Statement No.", "Property", "Landlord", "Basis", "Structure", "Recognized", "Reversed", "Status"].map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: "12px" }}>No commission data found for the selected filters.</td></tr>
              ) : filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.recognitionDate)}</td>
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
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-1.5">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">

          {/* Filter bar */}
          <div className="sticky top-0 z-30 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-1.5 shadow-sm backdrop-blur">
            <div className="flex flex-wrap items-center gap-1.5">
              <input type="month" value={draftFilters.monthFrom} onChange={setFilter("monthFrom")} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 outline-none" />
              <input type="month" value={draftFilters.monthTo} onChange={setFilter("monthTo")} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 outline-none" />
              <select value={draftFilters.status} onChange={setFilter("status")} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 outline-none">
                <option value="recognized">Recognized only</option>
                <option value="reversed">Reversed only</option>
                <option value="all">All statuses</option>
              </select>
              <div className="relative flex min-w-[200px] flex-1">
                <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={9} />
                <input value={draftFilters.search} onChange={setFilter("search")} onKeyDown={(e) => e.key === 'Enter' && applySearch()} placeholder="Search statement, property, landlord or basis…" className="h-7 w-full rounded-md border border-slate-200 bg-white pl-6 pr-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 outline-none" />
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {canExportReports && <button onClick={handleExportCSV} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white"><FaFileDownload size={9} /> Export CSV</button>}
                {canExportReports && <button onClick={handlePrint} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white"><FaPrint size={9} /> Print</button>}
                <button onClick={resetFilters} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white"><FaRedoAlt size={9} /> Reset</button>
                <button onClick={loadData} disabled={loading} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaRedoAlt size={9} className={loading ? 'animate-spin' : ''} /> Reload</button>
                <button onClick={applySearch} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#0B3B2E] bg-[#0B3B2E] px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white transition hover:bg-[#0A3127]"><FaSearch size={9} /> Apply</button>
              </div>
            </div>
          </div>

          {/* Stat strip */}
          <div className="flex-shrink-0 overflow-x-auto border-b border-slate-100 bg-white">
            <div className="flex min-w-max divide-x divide-slate-100">
              {[
                { label: 'Recognized Commission', value: formatCurrency(totals.recognizedCommission), accent: 'text-[#0B3B2E]', sub: null },
                { label: 'Reversed Commission',   value: formatCurrency(totals.reversedCommission),   accent: totals.reversedCommission > 0 ? 'text-red-600' : 'text-slate-400', sub: null },
                { label: 'Net Commission',         value: formatCurrency(totals.recognizedCommission - totals.reversedCommission), accent: 'text-emerald-700', sub: null },
                { label: 'Statements',             value: totals.statements,            accent: 'text-slate-800', sub: null },
                { label: 'Months',                 value: totals.months,                accent: 'text-slate-800', sub: `${toMonthLabel(appliedFilters.monthFrom)} – ${toMonthLabel(appliedFilters.monthTo)}` },
                { label: 'Reversed Statements',    value: totals.reversedStatements,    accent: totals.reversedStatements > 0 ? 'text-amber-600' : 'text-slate-400', sub: null },
              ].map((item) => (
                <div key={item.label} className="min-w-[130px] flex-1 px-3 py-2.5">
                  <p className="whitespace-nowrap text-[9px] font-bold uppercase tracking-widest text-slate-400">{item.label}</p>
                  <p className={`mt-0.5 whitespace-nowrap text-[13px] font-black ${item.accent}`}>{item.value}</p>
                  {item.sub && <p className="mt-0.5 whitespace-nowrap text-[9px] leading-tight text-slate-400">{item.sub}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="min-w-full text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                  <tr>
                    {['Recognition Date', 'Statement No.', 'Property', 'Landlord', 'Basis', 'Structure', 'Recognized', 'Reversed', 'Status'].map((h, i, arr) => (
                      <th key={h} className={`whitespace-nowrap px-3 py-1.5 text-left font-bold ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!currentCompany?._id ? (
                    <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">Select an active company to view the commission report.</td></tr>
                  ) : loading ? (
                    <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">Loading commission report…</td></tr>
                  ) : filteredRows.length === 0 ? (
                    <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">No commission data found for the selected filter range.</td></tr>
                  ) : paginatedRows.map((row, idx) => (
                    <tr key={row.id} className={`border-b border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-emerald-50/30`}>
                      <td className="px-3 py-1.5 border-r border-slate-100 font-semibold text-slate-900">{formatDate(row.recognitionDate)}</td>
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
                    </tr>
                  ))}
                </tbody>
                {filteredRows.length > 0 && (
                  <tfoot className="bg-[#0B3B2E]/5 border-t-2 border-[#0B3B2E]/20 text-[11px]">
                    <tr>
                      <td colSpan={6} className="px-3 py-2 text-right font-black text-slate-700">Totals</td>
                      <td className="px-3 py-2 text-right font-black text-[#0B3B2E]">{formatCurrency(totals.recognizedCommission)}</td>
                      <td className="px-3 py-2 text-right font-black text-red-600">{formatCurrency(totals.reversedCommission)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
              <div>Showing {filteredRows.length ? startIndex + 1 : 0}–{Math.min(endIndex, filteredRows.length)} of {filteredRows.length} commission row(s)</div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">Per page: {ITEMS_PER_PAGE}</span>
                <button type="button" onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={safeCurrentPage === 1} className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
                <span className="font-semibold text-slate-700">Page {safeCurrentPage} of {totalPages}</span>
                <button type="button" onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={safeCurrentPage === totalPages} className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">Next</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default CommissionReports;

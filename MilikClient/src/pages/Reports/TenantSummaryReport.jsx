import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTerms } from "../../hooks/useTerm";
import { FaFileDownload, FaFilter, FaPrint, FaSyncAlt, FaUsers } from "react-icons/fa";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import AppSelect from "../../components/common/AppSelect";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getTenantSummaryReport } from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { selectAllProperties } from "../../redux/selectors";
import { formatMoney } from "../../utils/money";
import useDebounce from "../../hooks/useDebounce";
import PaginationBar from "../../components/PaginationBar";




const TenantSummaryReport = () => {
  const dispatch = useDispatch();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const currentUser = useSelector((s) => s.auth?.currentUser || s.auth?.user || null);
  const { tenant: termTenant, tenants: termTenants, unit: termUnit, property: termProperty, properties: termProperties } = useTerms("tenant", "tenants", "unit", "property", "properties");
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");
  const businessId = currentCompany?._id || "";

  const reduxProperties = useSelector(selectAllProperties);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [properties, setProperties] = useState([]);
  const [filters, setFilters] = useState({ propertyId: "", status: "", search: "" });
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Sync Redux properties into local state for the property filter dropdown
  useEffect(() => { if (reduxProperties.length) setProperties(reduxProperties); }, [reduxProperties]);

  // Stable option array — avoids busting AppSelect's internal useMemo on every render
  const propertyOptions = useMemo(() => properties.map((p) => ({ value: p._id, label: p.propertyName || p.name })), [properties]);

  const loadData = useCallback(async (signal) => {
    if (!businessId) return;
    setLoading(true);
    try {
      dispatch(getProperties({ business: businessId }));
      const params = { business: businessId };
      if (filters.propertyId) params.propertyId = filters.propertyId;
      if (filters.status) params.status = filters.status;
      const data = await getTenantSummaryReport(params, signal);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (err) {
      if (err?.name === "CanceledError" || err?.name === "AbortError") return;
      toast.error(err?.response?.data?.message || "Failed to load tenant summary.");
    } finally {
      setLoading(false);
    }
  }, [businessId, dispatch, filters.propertyId, filters.status]);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  // Debounce search so useMemo doesn't fire on every keystroke
  const debouncedSearch = useDebounce(filters.search, 300);

  // Client-side search filter on returned rows (server already limited to 500)
  const filteredRows = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => {
      const hay = [row.tenantName, row.email, row.phone, row.propertyName, row.unitNumber]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
  }, [rows, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const paginatedRows = useMemo(
    () => filteredRows.slice(startIndex, startIndex + pageSize),
    [filteredRows, startIndex, pageSize]
  );

  useEffect(() => { setCurrentPage(1); }, [filters]);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, r) => {
          acc.invoiced += r.totalInvoiced;
          acc.paid += r.totalPaid;
          acc.balance += r.balance;
          return acc;
        },
        { invoiced: 0, paid: 0, balance: 0 }
      ),
    [filteredRows]
  );

  const exportCsv = () => {
    if (!canExportReports) {
      toast.warning("You do not have permission to export reports");
      return;
    }
    const header = ["Tenant", "Email", "Phone", "Property", "Unit", "Invoiced", "Paid", "Outstanding", "Invoices", "Status"];
    const body = filteredRows.map((r) => [
      r.tenantName, r.email, r.phone, r.propertyName, r.unitNumber,
      r.totalInvoiced, r.totalPaid, r.balance, r.invoiceCount, r.status,
    ]);
    const csv = [header, ...body]
      .map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tenant_summary_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const companyName = currentCompany?.name || currentCompany?.companyName || currentCompany?.businessName || "Milik";
  const preparedBy = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(" ") || currentUser?.email || "Milik Admin";

  const propertyById = useMemo(() => {
    const m = new Map();
    properties.forEach((p) => m.set(String(p._id), p));
    return m;
  }, [properties]);

  const handlePrint = useCallback(() => {
    if (!canExportReports) { toast.warning("You do not have permission to print reports"); return; }
    const co = currentCompany || {};
    const name = co.companyName || co.name || co.businessName || 'Milik';
    const logo = co.logo || '';
    const win = window.open('', '_blank', 'width=1120,height=800');
    if (!win) { toast.error('Pop-up blocked. Please allow pop-ups to print.'); return; }
    const fmt = (v) => `KES ${Number(v || 0).toLocaleString()}`;
    win.document.write(`<!DOCTYPE html><html><head><title>Tenant Summary Report</title><style>
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
      .ba{display:inline-block;padding:1px 6px;border-radius:99px;font-size:8px;font-weight:800}
      .act{background:#d1fae5;color:#065f46}.ina{background:#f1f5f9;color:#475569}
      *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    </style></head><body>
    <div class="hdr"><div>${logo ? `<img src="${logo}" class="logo" alt="">` : ''}<div class="co">${name}</div><div class="ttl">Tenant Summary Report</div><div class="sub">Generated: ${new Date().toLocaleString()}</div></div>
    <div class="meta"><div>Prepared by: ${preparedBy}</div><div>Tenants: ${filteredRows.length}</div></div></div>
    <div class="cards">
      <div class="card"><div class="cl">Tenants</div><div class="cv">${filteredRows.length}</div></div>
      <div class="card"><div class="cl">Total Invoiced</div><div class="cv">${fmt(totals.invoiced)}</div></div>
      <div class="card"><div class="cl">Total Collected</div><div class="cv" style="color:#0B3B2E">${fmt(totals.paid)}</div></div>
      <div class="card"><div class="cl">Outstanding</div><div class="cv" style="color:${totals.balance > 0 ? '#b91c1c' : '#047857'}">${fmt(totals.balance)}</div></div>
    </div>
    <table><thead><tr><th>${termTenant}</th><th>Email</th><th>Phone</th><th>${termProperty}</th><th>${termUnit}</th><th class="r">Invoiced</th><th class="r">Collected</th><th class="r">Outstanding</th><th>Status</th></tr></thead>
    <tbody>${filteredRows.map((row) => `<tr><td><strong>${row.tenantName}</strong></td><td>${row.email}</td><td>${row.phone}</td><td>${row.propertyName}</td><td>${row.unitNumber}</td><td class="r">${fmt(row.totalInvoiced)}</td><td class="r" style="color:#047857"><strong>${fmt(row.totalPaid)}</strong></td><td class="r" style="color:${row.balance > 0 ? '#b91c1c' : row.balance < 0 ? '#047857' : '#64748b'}">${fmt(row.balance)}</td><td><span class="${row.status === 'active' ? 'ba act' : 'ba ina'}">${row.status}</span></td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="5"><strong>TOTALS (${filteredRows.length} tenants)</strong></td><td class="r">${fmt(totals.invoiced)}</td><td class="r">${fmt(totals.paid)}</td><td class="r">${fmt(totals.balance)}</td><td></td></tr></tfoot>
    </table></body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [canExportReports, currentCompany, filteredRows, totals, preparedBy]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="print-only-wrapper">
        <style>{`
          @page { size: portrait; margin: 12mm; }
          .ts-print-shell { font-family: Arial, sans-serif; color: #0f172a; }
          .ts-print-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
          .ts-print-brand { color: #0B3B2E; font-size: 9px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 900; }
          .ts-print-title { margin: 2px 0 4px; font-size: 18px; font-weight: 900; color: #0f172a; }
          .ts-print-meta { text-align: right; font-size: 9px; color: #475569; line-height: 1.6; }
          .ts-print-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }
          .ts-print-metric { border: 1px solid #dbe2ea; border-radius: 6px; background: #f8fafc; padding: 6px 8px; }
          .ts-print-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; font-weight: 800; }
          .ts-print-value { margin-top: 3px; font-size: 13px; font-weight: 900; color: #0f172a; }
          .ts-print-table { width: 100%; border-collapse: collapse; font-size: 8.5px; }
          .ts-print-table th, .ts-print-table td { border: 1px solid #dbe2ea; padding: 4px 5px; vertical-align: top; }
          .ts-print-table thead th { background: #edf4f0; color: #0B3B2E; font-size: 7.5px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 800; }
          .tr { text-align: right; }
        `}</style>
        <div className="ts-print-shell">
          <div className="ts-print-header">
            <div>
              <div className="ts-print-brand">{companyName}</div>
              <h1 className="ts-print-title">Tenant Summary Report</h1>
            </div>
            <div className="ts-print-meta">
              <div><strong>Property:</strong> {filters.propertyId ? (propertyById.get(filters.propertyId)?.propertyName || "Selected") : "All properties"}</div>
              <div><strong>Status:</strong> {filters.status || "All tenants"}</div>
              <div><strong>Generated:</strong> {new Date().toLocaleString()}</div>
              <div><strong>Prepared by:</strong> {preparedBy}</div>
            </div>
          </div>
          <div className="ts-print-grid">
            {[
              { label: "Tenants", value: String(filteredRows.length) },
              { label: "Total Invoiced", value: formatMoney(totals.invoiced) },
              { label: "Total Collected", value: formatMoney(totals.paid) },
              { label: "Outstanding", value: formatMoney(totals.balance) },
            ].map((c) => (
              <div key={c.label} className="ts-print-metric">
                <div className="ts-print-label">{c.label}</div>
                <div className="ts-print-value">{c.value}</div>
              </div>
            ))}
          </div>
          <table className="ts-print-table">
            <thead>
              <tr>
                {[termTenant, "Email", "Phone", termProperty, termUnit, "Invoiced", "Collected", "Outstanding", "Status"].map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: "12px" }}>No tenants found.</td></tr>
              ) : filteredRows.map((row) => (
                <tr key={row.tenantId}>
                  <td><strong>{row.tenantName}</strong></td>
                  <td>{row.email}</td>
                  <td>{row.phone}</td>
                  <td>{row.propertyName}</td>
                  <td>{row.unitNumber}</td>
                  <td className="tr">{formatMoney(row.totalInvoiced)}</td>
                  <td className="tr">{formatMoney(row.totalPaid)}</td>
                  <td className="tr" style={{ color: row.balance > 0 ? "#b91c1c" : row.balance < 0 ? "#047857" : "#64748b" }}><strong>{formatMoney(row.balance)}</strong></td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="mx-auto flex w-full max-w-full min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex-none sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
              <div className="filter-bar flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
                <div className="relative shrink-0">
                  <FaFilter className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                  <input
                    value={filters.search}
                    onChange={setFilter("search")}
                    placeholder={`${termTenant}, ${termProperty.toLowerCase()}, ${termUnit.toLowerCase()}...`}
                    className="h-7 w-44 rounded border border-slate-200 bg-white pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <AppSelect
                  value={filters.propertyId}
                  onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? "" }))}
                  options={propertyOptions}
                  placeholder={`All ${termProperties.toLowerCase()}`}
                  searchable
                  clearable
                  size="sm"
                />
                <AppSelect
                  value={filters.status}
                  onChange={(v) => setFilters((prev) => ({ ...prev, status: v ?? "" }))}
                  options={[
                    { value: "active", label: "Active only" },
                    { value: "inactive", label: "Inactive only" },
                  ]}
                  placeholder={`All ${termTenants.toLowerCase()}`}
                  clearable
                  size="sm"
                />
                <span className="shrink-0 rounded border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700">
                  <FaUsers className="inline mr-1" />{filteredRows.length} {termTenants.toLowerCase()}
                </span>
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                {[
                  { label: "Invoiced", value: formatMoney(totals.invoiced), accent: "text-slate-900" },
                  { label: "Collected", value: formatMoney(totals.paid), accent: "text-[#0B3B2E]" },
                  { label: "Outstanding", value: formatMoney(totals.balance), accent: totals.balance > 0 ? "text-red-700" : "text-green-700" },
                ].map((card) => (
                  <span key={card.label} className="shrink-0 inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                    {card.label} <span className={`normal-case tracking-normal ${card.accent}`}>{card.value}</span>
                  </span>
                ))}
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                <button
                  onClick={exportCsv}
                  disabled={!canExportReports}
                  className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  <FaFileDownload size={9} /> CSV
                </button>
                <button
                  onClick={handlePrint}
                  disabled={!canExportReports}
                  className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  <FaPrint size={9} /> Print
                </button>
                <button
                  onClick={() => loadData()}
                  className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#0B3B2E] px-2.5 text-xs font-semibold text-white hover:bg-[#0A3127]"
                >
                  <FaSyncAlt size={9} className={loading ? "animate-spin" : ""} /> Refresh
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="min-w-full text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className="bg-[#0B3B2E] text-white">
                    {[termTenant, "Email", "Phone", termProperty, termUnit, "Invoiced", "Collected", "Outstanding", "Status"].map((h, i, arr) => (
                      <th key={h} className={`whitespace-nowrap px-3 py-1 text-left font-bold ${i < arr.length - 1 ? "border-r border-white/10" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-500">
                        {loading ? "Loading..." : `No ${termTenants.toLowerCase()} found for the current filter selection.`}
                      </td>
                    </tr>
                  ) : (
                    paginatedRows.map((row, idx) => (
                      <tr key={row.tenantId} className={`border-b border-gray-100 align-top ${idx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                        <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{row.tenantName}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{row.email}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{row.phone}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{row.propertyName}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{row.unitNumber}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right text-slate-700">{formatMoney(row.totalInvoiced)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-[#0B3B2E]">{formatMoney(row.totalPaid)}</td>
                        <td className={`px-3 py-1 border-r border-gray-100 text-right font-bold ${row.balance > 0 ? "text-red-700" : row.balance < 0 ? "text-green-700" : "text-slate-500"}`}>
                          {formatMoney(row.balance)}
                        </td>
                        <td className="px-3 py-1">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${row.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"}`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <PaginationBar
              page={safeCurrentPage}
              pages={totalPages}
              total={filteredRows.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={loading}
              label="tenants"
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TenantSummaryReport;

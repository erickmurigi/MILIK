import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useTerms } from "../../hooks/useTerm";
import { useSelector } from "react-redux";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import { FaClock, FaFileDownload, FaFilter, FaPrint, FaSyncAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import AppSelect from "../../components/common/AppSelect";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getRentalAgedAnalysisReport } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";
import { fmtDate } from "../../utils/dates";
import { formatMoney } from "../../utils/money";
import useDebounce from "../../hooks/useDebounce";
import PaginationBar from "../../components/PaginationBar";

const normalizeArray = (value) => (Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []);

const RentalAgedAnalysisReport = () => {
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const { tenant: termTenant, unit: termUnit, property: termProperty, properties: termProperties } = useTerms("tenant", "unit", "property", "properties");
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", ["accounts", "propertyManagement"]);
  const businessId = currentCompany?._id || "";
  const companyName = currentCompany?.name || currentCompany?.companyName || currentCompany?.businessName || "Milik";

  const [loading, setLoading] = useState(false);
  const [properties, setProperties] = useState([]);
  const [rows, setRows] = useState([]);
  const [zoneOptions, setZoneOptions] = useState([]);
  const [filters, setFilters] = useTabState("/reports/rental-aged-analysis:filters", { propertyId: "", category: "", search: "", zone: "" });
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const [currentPage, setCurrentPage] = useTabState("/reports/rental-aged-analysis:currentPage", 1);
  const [pageSize, setPageSize] = useState(50);

  // Fetch properties once for the filter dropdown
  useEffect(() => {
    if (!businessId) return;
    adminRequests.get(`/properties?business=${businessId}&limit=1000`)
      .then((res) => setProperties(normalizeArray(res?.data || res)))
      .catch(() => {});
  }, [businessId]);

  // Stable option array — avoids busting AppSelect's internal useMemo on every render
  const propertyOptions = useMemo(() => properties.map((p) => ({ value: p._id, label: p.propertyName || p.name })), [properties]);

  // Fetch zone options once on mount
  useEffect(() => {
    adminRequests.get('/zones', { params: { limit: 500, isActive: 'true' } })
      .then((res) => setZoneOptions((res.data?.zones || []).map((z) => ({ value: z.name, label: z.name }))))
      .catch(() => {});
  }, []);

  // Main report data — refetched whenever backend-side filters change
  const loadData = useCallback(async (signal) => {
    if (!businessId) return;
    setLoading(true);
    try {
      const data = await getRentalAgedAnalysisReport(
        {
          business: businessId,
          ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
          ...(filters.category ? { category: filters.category } : {}),
          ...(filters.zone ? { zone: filters.zone } : {}),
        },
        signal
      );
      setRows(data.rows || []);
    } catch (error) {
      if (error?.name === "CanceledError" || error?.name === "AbortError" || error?.code === "ERR_CANCELED") return;
      toast.error(error?.response?.data?.message || "Failed to load rental aged analysis.");
    } finally {
      setLoading(false);
    }
  }, [businessId, filters.propertyId, filters.category, filters.zone]);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  // Debounce search so useMemo doesn't fire on every keystroke
  const debouncedSearch = useDebounce(filters.search, 300);

  // Search filtering is client-side only (operates on already-fetched rows)
  const filteredRows = useMemo(() => {
    if (!debouncedSearch.trim()) return rows;
    const lower = debouncedSearch.trim().toLowerCase();
    return rows.filter((row) => {
      const haystack = `${row.tenantName} ${row.propertyName} ${row.unitNumber}`.toLowerCase();
      return haystack.includes(lower);
    });
  }, [rows, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedRows = filteredRows.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, row) => {
          acc.current += row.current;
          acc.days30 += row.days30;
          acc.days60 += row.days60;
          acc.days90 += row.days90;
          acc.days90Plus += row.days90Plus;
          acc.total += row.total;
          acc.count += 1;
          return acc;
        },
        { current: 0, days30: 0, days60: 0, days90: 0, days90Plus: 0, total: 0, count: 0 }
      ),
    [filteredRows]
  );

  const printGeneratedAt = useMemo(() => new Date().toLocaleString(), []);

  const handlePrint = useCallback(() => {
    if (!canExportReports) { toast.warning("You do not have permission to print reports"); return; }
    const co = currentCompany || {};
    const name = co.companyName || co.name || co.businessName || 'Milik';
    const logo = co.logo || '';
    const by = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(' ') || currentUser?.email || '';
    const win = window.open('', '_blank', 'width=1120,height=800');
    if (!win) { toast.error('Pop-up blocked. Please allow pop-ups to print.'); return; }
    const fmt = (v) => `KES ${Number(v || 0).toLocaleString()}`;
    win.document.write(`<!DOCTYPE html><html><head><title>Rental Aged Analysis</title><style>
      @page{size:A4 landscape;margin:12mm 14mm}body{font-family:Arial,sans-serif;color:#0f172a;font-size:9px;margin:0}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0B3B2E;padding-bottom:8px;margin-bottom:10px}
      .co{font-size:13px;font-weight:900;color:#0B3B2E}.ttl{font-size:16px;font-weight:900;margin:2px 0}
      .sub{font-size:10px;color:#475569;margin-top:2px}.meta{text-align:right;color:#64748b;font-size:8.5px;line-height:1.6}
      .logo{max-height:40px;max-width:110px;object-fit:contain;margin-bottom:4px}
      .cards{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:10px}
      .card{border:1px solid #dbe2ea;border-radius:6px;background:#f8fafc;padding:6px 8px}
      .cl{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:800}
      .cv{font-size:12px;font-weight:900;color:#0f172a;margin-top:3px}
      table{width:100%;border-collapse:collapse;font-size:8.5px}
      thead th{background:#0B3B2E;color:#fff;padding:4px 6px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.1em}
      thead th.r{text-align:right}tbody td{border-bottom:1px solid #dbe2ea;padding:3.5px 6px}
      tbody td.r{text-align:right}tbody tr:nth-child(even){background:#f8fafc}
      tfoot td{border-top:2px solid #0B3B2E;padding:4px 6px;font-weight:900;background:#EDF5F1}tfoot td.r{text-align:right}
      *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    </style></head><body>
    <div class="hdr"><div>${logo ? `<img src="${logo}" class="logo" alt="">` : ''}<div class="co">${name}</div><div class="ttl">Rental Aged Analysis Report</div><div class="sub">As at ${new Date().toLocaleDateString()}</div></div>
    <div class="meta"><div>Generated: ${new Date().toLocaleString()}</div><div>Prepared by: ${by}</div><div>Tenants: ${filteredRows.length}</div></div></div>
    <div class="cards">
      <div class="card"><div class="cl">Current</div><div class="cv">${fmt(totals.current)}</div></div>
      <div class="card"><div class="cl">1-30 Days</div><div class="cv" style="color:#b45309">${fmt(totals.days30)}</div></div>
      <div class="card"><div class="cl">31-60 Days</div><div class="cv" style="color:#c2410c">${fmt(totals.days60)}</div></div>
      <div class="card"><div class="cl">61-90 Days</div><div class="cv" style="color:#b91c1c">${fmt(totals.days90)}</div></div>
      <div class="card"><div class="cl">90+ Days</div><div class="cv" style="color:#7f1d1d">${fmt(totals.days90Plus)}</div></div>
      <div class="card"><div class="cl">Total Outstanding</div><div class="cv" style="color:#b91c1c"><strong>${fmt(totals.total)}</strong></div></div>
    </div>
    <table><thead><tr><th>${termTenant}</th><th>${termProperty}</th><th>${termUnit}</th><th class="r">Current</th><th class="r">1-30d</th><th class="r">31-60d</th><th class="r">61-90d</th><th class="r">90+ d</th><th class="r">Total</th><th>Oldest Due</th></tr></thead>
    <tbody>${filteredRows.map((row) => `<tr><td><strong>${row.tenantName}</strong></td><td>${row.propertyName}</td><td>${row.unitNumber}</td><td class="r">${fmt(row.current)}</td><td class="r">${fmt(row.days30)}</td><td class="r">${fmt(row.days60)}</td><td class="r">${fmt(row.days90)}</td><td class="r" style="color:#b91c1c"><strong>${fmt(row.days90Plus)}</strong></td><td class="r"><strong>${fmt(row.total)}</strong></td><td>${row.oldestDueDate ? new Date(row.oldestDueDate).toLocaleDateString() : '—'}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="3"><strong>TOTALS</strong></td><td class="r">${fmt(totals.current)}</td><td class="r">${fmt(totals.days30)}</td><td class="r">${fmt(totals.days60)}</td><td class="r">${fmt(totals.days90)}</td><td class="r">${fmt(totals.days90Plus)}</td><td class="r"><strong>${fmt(totals.total)}</strong></td><td></td></tr></tfoot>
    </table></body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [canExportReports, currentCompany, currentUser, filteredRows, totals]);

  const exportCsv = () => {
    if (!canExportReports) {
      toast.warning("You do not have permission to export reports");
      return;
    }
    const header = ["Tenant", "Property", "Unit", "Current", "1-30", "31-60", "61-90", "90+", "Total", "Oldest Due Date"];
    const body = filteredRows.map((row) => [
      row.tenantName,
      row.propertyName,
      row.unitNumber,
      row.current,
      row.days30,
      row.days60,
      row.days90,
      row.days90Plus,
      row.total,
      row.oldestDueDate ? new Date(row.oldestDueDate).toLocaleDateString() : "",
    ]);
    const csv = [header, ...body].map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rental_aged_analysis_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="print-only-wrapper">
        <style>{`
          @page { size: landscape; margin: 10mm; }
          .report-print-shell { font-family: 'Nunito Sans', Arial, sans-serif; color: #0f172a; }
          .report-print-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 12px; }
          .report-print-brand { color: #0B3B2E; font-size: 9px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 900; }
          .report-print-title { margin: 2px 0 4px; font-size: 20px; font-weight: 900; color: #0f172a; }
          .report-print-subtitle { margin: 0; font-size: 10px; line-height: 1.45; color: #475569; max-width: 760px; }
          .report-print-meta { text-align: right; font-size: 9px; color: #475569; }
          .report-print-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
          .report-print-metric { border: 1px solid #dbe2ea; border-radius: 9px; background: #f8fafc; padding: 7px 8px; }
          .report-print-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; font-weight: 800; }
          .report-print-value { margin-top: 4px; font-size: 12px; font-weight: 900; color: #0f172a; }
          .report-print-table { width: 100%; border-collapse: collapse; font-size: 9px; }
          .report-print-table th, .report-print-table td { border: 1px solid #dbe2ea; padding: 5px 6px; vertical-align: top; }
          .report-print-table thead th { background: #edf4f0; color: #0B3B2E; font-size: 8px; text-transform: uppercase; letter-spacing: 0.1em; text-align: left; }
          .text-right { text-align: right; }
          .text-red { color: #b91c1c; font-weight: 800; }
          .text-emerald { color: #047857; font-weight: 800; }
          .text-amber { color: #b45309; font-weight: 800; }
        `}</style>
        <div className="report-print-shell">
          <div className="report-print-header">
            <div>
              <div className="report-print-brand">{companyName}</div>
              <h1 className="report-print-title">Tenant Aging Analysis</h1>
              <p className="report-print-subtitle">Aged tenant receivables view grouped by current, 1-30, 31-60, 61-90 and 90+ day buckets for the selected filters.</p>
            </div>
            <div className="report-print-meta">
              <div><strong>Zone:</strong> {filters.zone || "All zones"}</div>
              <div><strong>Property:</strong> {filters.propertyId ? properties.find((property) => String(property._id) === String(filters.propertyId))?.propertyName || "Selected property" : "All properties"}</div>
              <div><strong>Category:</strong> {filters.category || "All charges"}</div>
              <div><strong>Generated:</strong> {printGeneratedAt}</div>
              <div><strong>Prepared by:</strong> {[currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(' ') || currentUser?.email || 'Milik Admin'}</div>
            </div>
          </div>
          <div className="report-print-grid">
            {[
              { label: "Current", value: formatMoney(totals.current) },
              { label: "1-30", value: formatMoney(totals.days30) },
              { label: "31-60", value: formatMoney(totals.days60) },
              { label: "61-90", value: formatMoney(totals.days90) },
              { label: "90+", value: formatMoney(totals.days90Plus) },
              { label: "Total", value: formatMoney(totals.total) },
            ].map((card) => (
              <div key={card.label} className="report-print-metric">
                <div className="report-print-label">{card.label}</div>
                <div className="report-print-value">{card.value}</div>
              </div>
            ))}
          </div>
          <table className="report-print-table">
            <thead>
              <tr>
                {[termTenant, termProperty, termUnit, "Current", "1-30", "31-60", "61-90", "90+", "Total", "Oldest Due"].map((header) => <th key={header}>{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td colSpan={10}>No aged receivables found for the current filters.</td></tr>
              ) : filteredRows.map((row) => (
                <tr key={row.tenantId}>
                  <td>{row.tenantName}</td>
                  <td>{row.propertyName}</td>
                  <td>{row.unitNumber}</td>
                  <td className="text-right text-emerald">{formatMoney(row.current)}</td>
                  <td className="text-right text-amber">{formatMoney(row.days30)}</td>
                  <td className="text-right text-amber">{formatMoney(row.days60)}</td>
                  <td className="text-right text-red">{formatMoney(row.days90)}</td>
                  <td className="text-right text-red">{formatMoney(row.days90Plus)}</td>
                  <td className="text-right"><strong>{formatMoney(row.total)}</strong></td>
                  <td>{fmtDate(row.oldestDueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="no-print milik-report-page flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-1.5">
        <style>{`
          .milik-report-page select:focus, .milik-report-page input:focus { border-color: #f45b0b; box-shadow: 0 0 0 1px rgba(244, 91, 11, 0.45); outline: none; }
          .milik-report-page select option:checked { background: #f45b0b; color: #ffffff; }
          .milik-report-page select option:hover { background: #f45b0b; color: #ffffff; }
        `}</style>

        <div className="mx-auto flex w-full max-w-full min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">

            <div className="flex-none sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm">
              <div className="filter-bar flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
                <div className="relative shrink-0">
                  <FaFilter className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-orange-500" />
                  <input value={filters.search} onChange={setFilter("search")} placeholder={`${termTenant}, ${termProperty.toLowerCase()}, ${termUnit.toLowerCase()}`} className="h-7 w-44 rounded border border-slate-200 bg-white pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20" />
                </div>
                <AppSelect
                  value={filters.zone || null}
                  onChange={(v) => setFilters((prev) => ({ ...prev, zone: v ?? "", propertyId: "" }))}
                  options={zoneOptions}
                  placeholder="All zones"
                  searchable
                  clearable
                  size="sm"
                />
                <AppSelect
                  value={filters.propertyId}
                  onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? "", zone: "" }))}
                  options={propertyOptions}
                  placeholder={`All ${termProperties.toLowerCase()}`}
                  searchable
                  clearable
                  size="sm"
                />
                <AppSelect
                  value={filters.category}
                  onChange={(v) => setFilters((prev) => ({ ...prev, category: v ?? "" }))}
                  options={[
                    { value: "RENT_CHARGE", label: "Rent only" },
                    { value: "UTILITY_CHARGE", label: "Utility only" },
                    { value: "LATE_PENALTY_CHARGE", label: "Late penalties only" },
                  ]}
                  placeholder="All charges"
                  clearable
                  size="sm"
                />
                <span className="shrink-0 inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700"><FaClock className="text-amber-600" /> {totals.count} rows</span>
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                <button onClick={exportCsv} disabled={!canExportReports} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-orange-50 hover:text-orange-700 disabled:opacity-50"><FaFileDownload size={9} /> CSV</button>
                <button onClick={handlePrint} disabled={!canExportReports} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-orange-50 hover:text-orange-700 disabled:opacity-50"><FaPrint size={9} /> Print</button>
                <button onClick={() => loadData()} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-orange-50 hover:text-orange-700"><FaSyncAlt size={9} className={loading ? 'animate-spin' : ''} /> Refresh</button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="min-w-full table-fixed text-[11px] border-collapse">
                <colgroup>
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[10%]" />
                  <col className="w-[9%]" />
                  <col className="w-[9%]" />
                  <col className="w-[9%]" />
                  <col className="w-[9%]" />
                  <col className="w-[9%]" />
                  <col className="w-[10%]" />
                  <col className="w-[9%]" />
                </colgroup>
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className="bg-[#0B3B2E] text-white">
                    {[termTenant, termProperty, termUnit, 'Current', '1-30', '31-60', '61-90', '90+', 'Total', 'Oldest Due'].map((header, i, arr) => {
                      const isNumeric = ['Current', '1-30', '31-60', '61-90', '90+', 'Total'].includes(header);
                      return (
                        <th
                          key={header}
                          className={`whitespace-nowrap px-2 py-1 font-bold ${isNumeric ? 'text-right' : 'text-left'} ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}
                        >
                          {header}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr><td colSpan={10} className="px-2 py-4 text-center text-slate-500">No aged receivables found for the current filters.</td></tr>
                  ) : paginatedRows.map((row, i) => (
                    <tr key={row.tenantId} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                      <td className="px-2 py-1 border-r border-gray-100 font-semibold text-slate-900">{row.tenantName}</td>
                      <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{row.propertyName}</td>
                      <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{row.unitNumber}</td>
                      <td className="px-2 py-1 border-r border-gray-100 text-right font-semibold text-emerald-700">{formatMoney(row.current)}</td>
                      <td className="px-2 py-1 border-r border-gray-100 text-right font-semibold text-amber-600">{formatMoney(row.days30)}</td>
                      <td className="px-2 py-1 border-r border-gray-100 text-right font-semibold text-orange-600">{formatMoney(row.days60)}</td>
                      <td className="px-2 py-1 border-r border-gray-100 text-right font-semibold text-red-500">{formatMoney(row.days90)}</td>
                      <td className="px-2 py-1 border-r border-gray-100 text-right font-semibold text-red-700">{formatMoney(row.days90Plus)}</td>
                      <td className="px-2 py-1 border-r border-gray-100 text-right font-black text-slate-900">{formatMoney(row.total)}</td>
                      <td className="px-2 py-1 text-slate-700">{row.oldestDueDate ? new Date(row.oldestDueDate).toLocaleDateString() : '-'}</td>
                    </tr>
                  ))}
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
              label="tenant ageing rows"
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default RentalAgedAnalysisReport;

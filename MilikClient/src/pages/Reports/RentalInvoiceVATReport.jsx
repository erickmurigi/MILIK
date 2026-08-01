import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import { FaFileDownload, FaFilter, FaPercent, FaPrint, FaSyncAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import AppSelect from "../../components/common/AppSelect";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getTenantInvoices } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";

const formatMoney = (value) => `KES ${Number(value || 0).toLocaleString()}`;
const formatDate = (value) => {
  if (!value) return "-";
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? "-" : dt.toLocaleDateString();
};

const ITEMS_PER_PAGE = 50;

const RentalInvoiceVATReport = () => {
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");
  const businessId = currentCompany?._id || "";

  const [loading, setLoading] = useState(false);
  const [properties, setProperties] = useState([]);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useTabState("/invoices/vat:filters", { propertyId: "all", category: "all", search: "" });
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const [currentPage, setCurrentPage] = useTabState("/invoices/vat:currentPage", 1);

  const loadData = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [invoiceRows, propertyRes] = await Promise.all([
        getTenantInvoices({ business: businessId }),
        adminRequests.get(`/properties?business=${businessId}&limit=1000`),
      ]);
      const normalizedProps = Array.isArray(propertyRes?.data?.data)
        ? propertyRes.data.data
        : Array.isArray(propertyRes?.data)
        ? propertyRes.data
        : [];
      const taxable = (Array.isArray(invoiceRows) ? invoiceRows : []).filter((invoice) => {
        const category = String(invoice?.category || "");
        const taxSnapshot = invoice?.taxSnapshot || {};
        return (
          ["RENT_CHARGE", "UTILITY_CHARGE", "LATE_PENALTY_CHARGE"].includes(category) &&
          (Boolean(taxSnapshot?.isTaxable) || Number(taxSnapshot?.taxAmount || 0) > 0)
        );
      });
      setProperties(normalizedProps);
      setRows(taxable);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load rental invoice VAT report.");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const propertyId = row?.property?._id || row?.property || "";
      if (filters.propertyId !== "all" && String(propertyId) !== String(filters.propertyId)) return false;
      if (filters.category !== "all" && String(row?.category || "") !== filters.category) return false;
      const haystack = [
        row?.invoiceNumber,
        row?.tenant?.tenantName,
        row?.tenant?.name,
        row?.property?.propertyName,
        row?.unit?.unitNumber,
        row?.description,
        row?.taxSnapshot?.taxCodeName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return !filters.search.trim() || haystack.includes(filters.search.trim().toLowerCase());
    });
  }, [rows, filters]);


  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
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
          acc.net += Number(row?.taxSnapshot?.netAmount || row?.amount || 0);
          acc.tax += Number(row?.taxSnapshot?.taxAmount || 0);
          acc.gross += Number(row?.taxSnapshot?.grossAmount || row?.amount || 0);
          acc.count += 1;
          return acc;
        },
        { net: 0, tax: 0, gross: 0, count: 0 }
      ),
    [filteredRows]
  );

  const exportCsv = () => {
    if (!canExportReports) {
      toast.warning("You do not have permission to export reports");
      return;
    }
    const header = ["Invoice No", "Tenant", "Property", "Unit", "Category", "Invoice Date", "Due Date", "Tax Code", "Rate", "Net", "Tax", "Gross", "Status"];
    const body = filteredRows.map((row) => [
      row?.invoiceNumber || "",
      row?.tenant?.tenantName || row?.tenant?.name || "",
      row?.property?.propertyName || "",
      row?.unit?.unitNumber || "",
      row?.category || "",
      formatDate(row?.invoiceDate),
      formatDate(row?.dueDate),
      row?.taxSnapshot?.taxCodeName || "",
      Number(row?.taxSnapshot?.taxRate || 0),
      Number(row?.taxSnapshot?.netAmount || 0),
      Number(row?.taxSnapshot?.taxAmount || 0),
      Number(row?.taxSnapshot?.grossAmount || row?.amount || 0),
      row?.status || "",
    ]);
    const csv = [header, ...body]
      .map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rental_invoice_vat_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const companyName = currentCompany?.name || currentCompany?.companyName || currentCompany?.businessName || "Milik";
  const preparedBy = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(" ") || currentUser?.email || "Milik Admin";

  const handlePrint = useCallback(() => {
    if (!canExportReports) { toast.warning("You do not have permission to print reports"); return; }
    const co = currentCompany || {};
    const name = co.companyName || co.name || co.businessName || 'Milik';
    const logo = co.logo || '';
    const win = window.open('', '_blank', 'width=1120,height=800');
    if (!win) { toast.error('Pop-up blocked. Please allow pop-ups to print.'); return; }
    const fmt = (v) => `KES ${Number(v || 0).toLocaleString()}`;
    win.document.write(`<!DOCTYPE html><html><head><title>Rental Invoice VAT Report</title><style>
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
      *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    </style></head><body>
    <div class="hdr"><div>${logo ? `<img src="${logo}" class="logo" alt="">` : ''}<div class="co">${name}</div><div class="ttl">Rental Invoice VAT Report</div><div class="sub">Generated: ${new Date().toLocaleString()}</div></div>
    <div class="meta"><div>Prepared by: ${preparedBy}</div><div>Records: ${filteredRows.length}</div></div></div>
    <div class="cards">
      <div class="card"><div class="cl">Invoices</div><div class="cv">${totals.count}</div></div>
      <div class="card"><div class="cl">Net Amount</div><div class="cv" style="color:#0B3B2E">${fmt(totals.net)}</div></div>
      <div class="card"><div class="cl">VAT</div><div class="cv" style="color:#b45309">${fmt(totals.tax)}</div></div>
      <div class="card"><div class="cl">Gross</div><div class="cv">${fmt(totals.gross)}</div></div>
    </div>
    <table><thead><tr><th>Invoice</th><th>Tenant</th><th>Property</th><th>Unit</th><th>Category</th><th>Invoice Date</th><th>Tax Code</th><th class="r">Rate</th><th class="r">Net</th><th class="r">VAT</th><th class="r">Gross</th><th>Status</th></tr></thead>
    <tbody>${filteredRows.map((row) => `<tr><td>${row?.invoiceNumber || '—'}</td><td>${row?.tenant?.tenantName || row?.tenant?.name || '—'}</td><td>${row?.property?.propertyName || '—'}</td><td>${row?.unit?.unitNumber || '—'}</td><td>${row?.category || '—'}</td><td>${formatDate(row?.invoiceDate)}</td><td>${row?.taxSnapshot?.taxCodeName || '—'}</td><td class="r">${Number(row?.taxSnapshot?.taxRate || 0)}%</td><td class="r">${fmt(row?.taxSnapshot?.netAmount || row?.amount)}</td><td class="r">${fmt(row?.taxSnapshot?.taxAmount)}</td><td class="r"><strong>${fmt(row?.taxSnapshot?.grossAmount || row?.amount)}</strong></td><td>${row?.status || '—'}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="8"><strong>TOTALS</strong></td><td class="r">${fmt(totals.net)}</td><td class="r">${fmt(totals.tax)}</td><td class="r"><strong>${fmt(totals.gross)}</strong></td><td></td></tr></tfoot>
    </table></body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [canExportReports, currentCompany, filteredRows, totals, preparedBy]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="print-only-wrapper">
        <style>{`
          @page { size: landscape; margin: 10mm; }
          .vat-print-shell { font-family: Arial, sans-serif; color: #0f172a; }
          .vat-print-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
          .vat-print-brand { color: #0B3B2E; font-size: 9px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 900; }
          .vat-print-title { margin: 2px 0 4px; font-size: 18px; font-weight: 900; color: #0f172a; }
          .vat-print-subtitle { margin: 0; font-size: 10px; color: #475569; }
          .vat-print-meta { text-align: right; font-size: 9px; color: #475569; line-height: 1.6; }
          .vat-print-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }
          .vat-print-metric { border: 1px solid #dbe2ea; border-radius: 6px; background: #f8fafc; padding: 6px 8px; }
          .vat-print-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; font-weight: 800; }
          .vat-print-value { margin-top: 3px; font-size: 13px; font-weight: 900; color: #0f172a; }
          .vat-print-table { width: 100%; border-collapse: collapse; font-size: 8.5px; }
          .vat-print-table th, .vat-print-table td { border: 1px solid #dbe2ea; padding: 4px 5px; vertical-align: top; }
          .vat-print-table thead th { background: #edf4f0; color: #0B3B2E; font-size: 7.5px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 800; }
          .tr { text-align: right; }
        `}</style>
        <div className="vat-print-shell">
          <div className="vat-print-header">
            <div>
              <div className="vat-print-brand">{companyName}</div>
              <h1 className="vat-print-title">Rental Invoice VAT Report</h1>
              <p className="vat-print-subtitle">Taxable rental invoices for the selected filters.</p>
            </div>
            <div className="vat-print-meta">
              <div><strong>Property:</strong> {filters.propertyId === "all" ? "All properties" : (properties.find((p) => String(p._id) === filters.propertyId)?.propertyName || "Selected")}</div>
              <div><strong>Category:</strong> {filters.category === "all" ? "All charge types" : filters.category.replace(/_/g, " ")}</div>
              <div><strong>Generated:</strong> {new Date().toLocaleString()}</div>
              <div><strong>Prepared by:</strong> {preparedBy}</div>
            </div>
          </div>
          <div className="vat-print-grid">
            {[
              { label: "Invoices", value: String(totals.count) },
              { label: "Net", value: formatMoney(totals.net) },
              { label: "VAT", value: formatMoney(totals.tax) },
              { label: "Gross", value: formatMoney(totals.gross) },
            ].map((c) => (
              <div key={c.label} className="vat-print-metric">
                <div className="vat-print-label">{c.label}</div>
                <div className="vat-print-value">{c.value}</div>
              </div>
            ))}
          </div>
          <table className="vat-print-table">
            <thead>
              <tr>
                {["Invoice", "Tenant", "Property", "Unit", "Category", "Invoice Date", "Due Date", "Tax Code", "Rate", "Net", "VAT", "Gross", "Status"].map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td colSpan={13} style={{ textAlign: "center", padding: "12px" }}>No taxable invoices found.</td></tr>
              ) : filteredRows.map((row) => (
                <tr key={row._id}>
                  <td>{row?.invoiceNumber || "—"}</td>
                  <td>{row?.tenant?.tenantName || row?.tenant?.name || "—"}</td>
                  <td>{row?.property?.propertyName || "—"}</td>
                  <td>{row?.unit?.unitNumber || "—"}</td>
                  <td>{String(row?.category || "").replace(/_/g, " ")}</td>
                  <td>{formatDate(row?.invoiceDate)}</td>
                  <td>{formatDate(row?.dueDate)}</td>
                  <td>{row?.taxSnapshot?.taxCodeName || "—"}</td>
                  <td className="tr">{Number(row?.taxSnapshot?.taxRate || 0)}%</td>
                  <td className="tr">{formatMoney(row?.taxSnapshot?.netAmount || 0)}</td>
                  <td className="tr">{formatMoney(row?.taxSnapshot?.taxAmount || 0)}</td>
                  <td className="tr"><strong>{formatMoney(row?.taxSnapshot?.grossAmount || row?.amount || 0)}</strong></td>
                  <td>{row?.status || "—"}</td>
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
                    placeholder="Invoice, tenant, property, unit"
                    className="h-7 w-44 rounded border border-slate-200 bg-white pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <AppSelect
                  value={filters.propertyId === "all" ? "" : filters.propertyId}
                  onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? "all" }))}
                  options={properties.map((p) => ({ value: p._id, label: p.propertyName || p.name }))}
                  placeholder="All properties"
                  searchable
                  clearable
                  size="sm"
                />
                <AppSelect
                  value={filters.category === "all" ? "" : filters.category}
                  onChange={(v) => setFilters((prev) => ({ ...prev, category: v ?? "all" }))}
                  options={[
                    { value: "RENT_CHARGE", label: "Rent" },
                    { value: "UTILITY_CHARGE", label: "Utility" },
                    { value: "LATE_PENALTY_CHARGE", label: "Late penalty" },
                  ]}
                  placeholder="All charge types"
                  clearable
                  size="sm"
                />
                <span className="shrink-0 rounded border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700"><FaPercent className="inline mr-1" />{filteredRows.length} rows</span>
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                {[
                  { label: "Invoices", value: totals.count, accent: "text-slate-900" },
                  { label: "Net", value: formatMoney(totals.net), accent: "text-[#0B3B2E]" },
                  { label: "VAT", value: formatMoney(totals.tax), accent: "text-amber-700" },
                  { label: "Gross", value: formatMoney(totals.gross), accent: "text-slate-900" },
                ].map((card) => (
                  <span key={card.label} className="shrink-0 inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                    {card.label} <span className={`normal-case tracking-normal ${card.accent}`}>{card.value}</span>
                  </span>
                ))}
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                <button onClick={exportCsv} disabled={!canExportReports} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><FaFileDownload size={9} /> CSV</button>
                <button onClick={handlePrint} disabled={!canExportReports} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><FaPrint size={9} /> Print</button>
                <button onClick={loadData} className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#0B3B2E] px-2.5 text-xs font-semibold text-white hover:bg-[#0A3127]"><FaSyncAlt size={9} className={loading ? "animate-spin" : ""} /> Refresh</button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="min-w-full text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className="bg-[#0B3B2E] text-white">
                    {['Invoice', 'Tenant', 'Property', 'Unit', 'Category', 'Invoice Date', 'Due Date', 'Tax', 'Net', 'VAT', 'Gross', 'Status'].map((header, i, arr) => (
                      <th key={header} className={`whitespace-nowrap px-3 py-1 text-left font-bold ${i < arr.length - 1 ? "border-r border-white/10" : ""}`}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-3 py-8 text-center text-xs text-slate-500">No taxable rental invoices found for the current filter selection.</td>
                    </tr>
                  ) : (
                    paginatedRows.map((row, idx) => (
                      <tr key={row._id} className={`border-b border-gray-100 align-top ${idx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                        <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{row?.invoiceNumber || '-'}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{row?.tenant?.tenantName || row?.tenant?.name || '-'}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{row?.property?.propertyName || '-'}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{row?.unit?.unitNumber || '-'}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{String(row?.category || '').replace(/_/g, ' ')}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{formatDate(row?.invoiceDate)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{formatDate(row?.dueDate)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{row?.taxSnapshot?.taxCodeName || '-'} ({Number(row?.taxSnapshot?.taxRate || 0)}%)</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-900">{formatMoney(row?.taxSnapshot?.netAmount || 0)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-amber-700">{formatMoney(row?.taxSnapshot?.taxAmount || 0)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-[#0B3B2E]">{formatMoney(row?.taxSnapshot?.grossAmount || row?.amount || 0)}</td>
                        <td className="px-3 py-1 text-slate-700">{row?.status || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="sticky bottom-0 z-20 flex-shrink-0 border-t border-slate-200 bg-white px-3 py-1">
              <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
                <div className="font-semibold">
                  Showing <span className="font-bold text-slate-900">{paginatedRows.length > 0 ? startIndex + 1 : 0}</span> to <span className="font-bold text-slate-900">{Math.min(endIndex, filteredRows.length)}</span> of <span className="font-bold text-slate-900">{filteredRows.length}</span> taxable invoice rows
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Per page: {ITEMS_PER_PAGE}</span>
                  <button onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={safeCurrentPage === 1} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
                  <span className="font-semibold text-slate-700">Page {safeCurrentPage} of {totalPages}</span>
                  <button onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={safeCurrentPage === totalPages} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Next</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default RentalInvoiceVATReport;

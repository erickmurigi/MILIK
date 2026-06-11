import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import { FaClock, FaFileDownload, FaFilter, FaPrint, FaSyncAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getTenantInvoices } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";

const formatMoney = (value) => `KES ${Number(value || 0).toLocaleString()}`;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : "—");
const ITEMS_PER_PAGE = 50;
const normalizeArray = (value) => (Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []);

const resolveInvoiceDueDateForAging = (invoice = {}) => {
  if (invoice?.dueDate) return invoice.dueDate;
  const metadata = invoice?.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {};
  return metadata?.periodEndDate || metadata?.periodToDate || metadata?.periodStartDate || metadata?.periodFromDate || invoice?.invoiceDate || null;
};

const daysBetween = (earlier, later = new Date()) => {
  const start = new Date(earlier);
  const end = new Date(later);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
};

const bucketOutstanding = (dueDate, amount) => {
  if (!dueDate) return { current: 0, days30: 0, days60: 0, days90: 0, days90Plus: amount };
  const overdueDays = daysBetween(dueDate);
  if (overdueDays <= 0) return { current: amount, days30: 0, days60: 0, days90: 0, days90Plus: 0 };
  if (overdueDays <= 30) return { current: 0, days30: amount, days60: 0, days90: 0, days90Plus: 0 };
  if (overdueDays <= 60) return { current: 0, days30: 0, days60: amount, days90: 0, days90Plus: 0 };
  if (overdueDays <= 90) return { current: 0, days30: 0, days60: 0, days90: amount, days90Plus: 0 };
  return { current: 0, days30: 0, days60: 0, days90: 0, days90Plus: amount };
};

const RentalAgedAnalysisReport = () => {
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");
  const businessId = currentCompany?._id || "";
  const companyName = currentCompany?.name || currentCompany?.companyName || currentCompany?.businessName || "Milik";

  const [loading, setLoading] = useState(false);
  const [properties, setProperties] = useState([]);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ propertyId: "all", category: "all", search: "" });
  const [currentPage, setCurrentPage] = useState(1);

  const loadData = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [invoiceRows, paymentRes, propertyRes] = await Promise.all([
        getTenantInvoices({ business: businessId }),
        adminRequests.get(`/rent-payments?business=${businessId}`),
        adminRequests.get(`/properties?business=${businessId}&limit=1000`),
      ]);

      const payments = normalizeArray(paymentRes?.data || paymentRes).filter(
        (payment) => !payment?.isReversed && !payment?.isCancelled
      );
      const allocationMap = new Map();
      payments.forEach((payment) => {
        (payment?.allocations || []).forEach((allocation) => {
          const invoiceId = allocation?.invoice?._id || allocation?.invoice;
          if (!invoiceId) return;
          allocationMap.set(String(invoiceId), (allocationMap.get(String(invoiceId)) || 0) + Number(allocation?.appliedAmount || 0));
        });
      });

      const activeInvoices = (Array.isArray(invoiceRows) ? invoiceRows : []).filter((invoice) => {
        const category = String(invoice?.category || "");
        return ["RENT_CHARGE", "UTILITY_CHARGE", "LATE_PENALTY_CHARGE"].includes(category) && !["cancelled", "reversed"].includes(String(invoice?.status || "").toLowerCase());
      });

      const summaryByTenant = new Map();
      activeInvoices.forEach((invoice) => {
        const invoiceId = String(invoice?._id || "");
        const amount = Number(invoice?.amount || 0);
        const applied = Number(allocationMap.get(invoiceId) || 0);
        const outstanding = Number((amount - applied).toFixed(2));
        if (outstanding <= 0) return;
        const tenantId = String(invoice?.tenant?._id || invoice?.tenant || "unknown");
        const existing = summaryByTenant.get(tenantId) || {
          tenantId,
          tenantName: invoice?.tenant?.tenantName || invoice?.tenant?.name || "Unknown tenant",
          propertyName: invoice?.property?.propertyName || "N/A",
          propertyId: invoice?.property?._id || invoice?.property || "",
          unitNumber: invoice?.unit?.unitNumber || "N/A",
          categoryBreakdown: { RENT_CHARGE: 0, UTILITY_CHARGE: 0, LATE_PENALTY_CHARGE: 0 },
          current: 0,
          days30: 0,
          days60: 0,
          days90: 0,
          days90Plus: 0,
          total: 0,
          oldestDueDate: resolveInvoiceDueDateForAging(invoice) || null,
        };
        const effectiveDueDate = resolveInvoiceDueDateForAging(invoice);
        const bucket = bucketOutstanding(effectiveDueDate, outstanding);
        existing.current += bucket.current;
        existing.days30 += bucket.days30;
        existing.days60 += bucket.days60;
        existing.days90 += bucket.days90;
        existing.days90Plus += bucket.days90Plus;
        existing.total += outstanding;
        existing.categoryBreakdown[invoice?.category] = (existing.categoryBreakdown[invoice?.category] || 0) + outstanding;
        if (effectiveDueDate && (!existing.oldestDueDate || new Date(effectiveDueDate) < new Date(existing.oldestDueDate))) {
          existing.oldestDueDate = effectiveDueDate;
        }
        summaryByTenant.set(tenantId, existing);
      });

      setRows(Array.from(summaryByTenant.values()));
      setProperties(normalizeArray(propertyRes?.data || propertyRes));
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load rental aged analysis.");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (filters.propertyId !== "all" && String(row.propertyId) !== String(filters.propertyId)) return false;
      if (filters.category !== "all" && Number(row.categoryBreakdown?.[filters.category] || 0) <= 0) return false;
      const haystack = `${row.tenantName} ${row.propertyName} ${row.unitNumber}`.toLowerCase();
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
    <table><thead><tr><th>Tenant</th><th>Property</th><th>Unit</th><th class="r">Current</th><th class="r">1-30d</th><th class="r">31-60d</th><th class="r">61-90d</th><th class="r">90+ d</th><th class="r">Total</th><th>Oldest Due</th></tr></thead>
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
              <div><strong>Property:</strong> {filters.propertyId === "all" ? "All properties" : properties.find((property) => String(property._id) === String(filters.propertyId))?.propertyName || "Selected property"}</div>
              <div><strong>Category:</strong> {filters.category === "all" ? "All charges" : filters.category}</div>
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
                {["Tenant", "Property", "Unit", "Current", "1-30", "31-60", "61-90", "90+", "Total", "Oldest Due"].map((header) => <th key={header}>{header}</th>)}
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
                  <td>{formatDate(row.oldestDueDate)}</td>
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
              <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
                <div className="relative shrink-0">
                  <FaFilter className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-orange-500" />
                  <input value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} placeholder="Tenant, property, unit" className="h-7 w-44 rounded border border-slate-200 bg-white pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-orange-500" />
                </div>
                <select value={filters.propertyId} onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-orange-500">
                  <option value="all">All properties</option>
                  {properties.map((property) => <option key={property._id} value={property._id}>{property.propertyName || property.name}</option>)}
                </select>
                <select value={filters.category} onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-orange-500">
                  <option value="all">All charges</option>
                  <option value="RENT_CHARGE">Rent only</option>
                  <option value="UTILITY_CHARGE">Utility only</option>
                  <option value="LATE_PENALTY_CHARGE">Late penalties only</option>
                </select>
                <span className="shrink-0 inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700"><FaClock className="text-amber-600" /> {totals.count} rows</span>
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                <button onClick={exportCsv} disabled={!canExportReports} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-orange-50 hover:text-orange-700 disabled:opacity-50"><FaFileDownload size={9} /> CSV</button>
                <button onClick={handlePrint} disabled={!canExportReports} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-orange-50 hover:text-orange-700 disabled:opacity-50"><FaPrint size={9} /> Print</button>
                <button onClick={loadData} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-orange-50 hover:text-orange-700"><FaSyncAlt size={9} className={loading ? 'animate-spin' : ''} /> Refresh</button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="min-w-full table-fixed text-xs">
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
                    {['Tenant', 'Property', 'Unit', 'Current', '1-30', '31-60', '61-90', '90+', 'Total', 'Oldest Due'].map((header) => {
                      const isNumeric = ['Current', '1-30', '31-60', '61-90', '90+', 'Total'].includes(header);
                      return (
                        <th
                          key={header}
                          className={`whitespace-nowrap px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] ${isNumeric ? 'text-right' : 'text-left'}`}
                        >
                          {header}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr><td colSpan={10} className="px-2 py-4 text-center text-xs text-slate-500">No aged receivables found for the current filters.</td></tr>
                  ) : paginatedRows.map((row) => (
                    <tr key={row.tenantId} className="border-t border-slate-200 hover:bg-slate-50/80">
                      <td className="px-2 py-1.5 font-semibold text-slate-900">{row.tenantName}</td>
                      <td className="px-2 py-1.5 text-slate-700">{row.propertyName}</td>
                      <td className="px-2 py-1.5 text-slate-700">{row.unitNumber}</td>
                      <td className="px-2 py-1.5 text-right font-semibold text-emerald-700">{formatMoney(row.current)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold text-amber-600">{formatMoney(row.days30)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold text-orange-600">{formatMoney(row.days60)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold text-red-500">{formatMoney(row.days90)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold text-red-700">{formatMoney(row.days90Plus)}</td>
                      <td className="px-2 py-1.5 text-right font-black text-slate-900">{formatMoney(row.total)}</td>
                      <td className="px-2 py-1.5 text-slate-700">{row.oldestDueDate ? new Date(row.oldestDueDate).toLocaleDateString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex-shrink-0 border-t border-slate-200 bg-white px-2 py-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                <div className="font-semibold">Showing <span className="font-bold text-slate-900">{paginatedRows.length > 0 ? startIndex + 1 : 0}</span> to <span className="font-bold text-slate-900">{Math.min(endIndex, filteredRows.length)}</span> of <span className="font-bold text-slate-900">{filteredRows.length}</span> tenant ageing rows</div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Per page: {ITEMS_PER_PAGE}</span>
                  <button onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={safeCurrentPage === 1} className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold transition hover:border-orange-500 hover:bg-orange-50 hover:text-orange-700 disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
                  <span className="font-semibold text-slate-700">Page {safeCurrentPage} of {totalPages}</span>
                  <button onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={safeCurrentPage === totalPages} className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold transition hover:border-orange-500 hover:bg-orange-50 hover:text-orange-700 disabled:cursor-not-allowed disabled:opacity-50">Next</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default RentalAgedAnalysisReport;

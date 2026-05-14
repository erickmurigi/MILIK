import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { FaFileDownload, FaFilter, FaPercent, FaPrint, FaSyncAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
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
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser || state.auth?.user || null);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");
  const businessId = currentCompany?._id || "";

  const [loading, setLoading] = useState(false);
  const [properties, setProperties] = useState([]);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ propertyId: "all", category: "all", search: "" });
  const [currentPage, setCurrentPage] = useState(1);

  const loadData = async () => {
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
  };

  useEffect(() => {
    loadData();
  }, [businessId]);

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

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="mx-auto flex w-full max-w-full min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="sticky top-0 z-20 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 px-2 py-2 shadow-sm backdrop-blur">
              <div className="grid gap-2 xl:grid-cols-[1.4fr_1fr_1fr_auto]">
                <div className="relative">
                  <FaFilter className="absolute left-2.5 top-2.5 text-xs text-slate-400" />
                  <input
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Search invoice, tenant, property, unit, tax code"
                    className="h-8 w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-2.5 text-[11px] text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
                <select value={filters.propertyId} onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))} className="h-8 rounded-md border border-orange-200 bg-orange-50/70 px-2.5 text-[11px] font-semibold text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100">
                  <option value="all">All properties</option>
                  {properties.map((property) => (
                    <option key={property._id} value={property._id}>{property.propertyName || property.name}</option>
                  ))}
                </select>
                <select value={filters.category} onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))} className="h-8 rounded-md border border-orange-200 bg-orange-50/70 px-2.5 text-[11px] font-semibold text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100">
                  <option value="all">All charge types</option>
                  <option value="RENT_CHARGE">Rent</option>
                  <option value="UTILITY_CHARGE">Utility</option>
                  <option value="LATE_PENALTY_CHARGE">Late penalty</option>
                </select>
                <div className="inline-flex h-8 items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-3 text-[11px] font-bold text-orange-700">
                  <FaPercent /> {filteredRows.length} row(s)
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { label: "Invoices", value: totals.count, accent: "text-slate-900" },
                    { label: "Net", value: formatMoney(totals.net), accent: "text-[#0B3B2E]" },
                    { label: "VAT", value: formatMoney(totals.tax), accent: "text-amber-700" },
                    { label: "Gross", value: formatMoney(totals.gross), accent: "text-slate-900" },
                  ].map((card) => (
                    <span key={card.label} className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                      {card.label} <span className={`normal-case tracking-normal ${card.accent}`}>{card.value}</span>
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={exportCsv} disabled={!canExportReports} title={canExportReports ? "Export CSV" : "You do not have permission to export reports"} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"><FaFileDownload /> Export CSV</button>
                  <button onClick={() => { if (!canExportReports) { toast.warning("You do not have permission to print reports"); return; } window.print(); }} disabled={!canExportReports} title={canExportReports ? "Print" : "You do not have permission to print reports"} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"><FaPrint /> Print</button>
                  <button onClick={loadData} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0B3B2E] px-3 text-[11px] font-bold text-white shadow-sm transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"><FaSyncAlt className={loading ? "animate-spin" : ""} /> Refresh</button>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                    {['Invoice', 'Tenant', 'Property', 'Unit', 'Category', 'Invoice Date', 'Due Date', 'Tax', 'Net', 'VAT', 'Gross', 'Status'].map((header) => (
                      <th key={header} className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.12em]">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-3 py-8 text-center text-xs text-slate-500">No taxable rental invoices found for the current filter selection.</td>
                    </tr>
                  ) : (
                    paginatedRows.map((row) => (
                      <tr key={row._id} className="border-t border-slate-200 align-top hover:bg-slate-50/80">
                        <td className="px-3 py-2 font-semibold text-slate-900">{row?.invoiceNumber || '-'}</td>
                        <td className="px-3 py-2 text-slate-700">{row?.tenant?.tenantName || row?.tenant?.name || '-'}</td>
                        <td className="px-3 py-2 text-slate-700">{row?.property?.propertyName || '-'}</td>
                        <td className="px-3 py-2 text-slate-700">{row?.unit?.unitNumber || '-'}</td>
                        <td className="px-3 py-2 text-slate-700">{String(row?.category || '').replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2 text-slate-700">{formatDate(row?.invoiceDate)}</td>
                        <td className="px-3 py-2 text-slate-700">{formatDate(row?.dueDate)}</td>
                        <td className="px-3 py-2 text-slate-700">{row?.taxSnapshot?.taxCodeName || '-'} ({Number(row?.taxSnapshot?.taxRate || 0)}%)</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatMoney(row?.taxSnapshot?.netAmount || 0)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-amber-700">{formatMoney(row?.taxSnapshot?.taxAmount || 0)}</td>
                        <td className="px-3 py-2 text-right font-bold text-[#0B3B2E]">{formatMoney(row?.taxSnapshot?.grossAmount || row?.amount || 0)}</td>
                        <td className="px-3 py-2 text-slate-700">{row?.status || '-'}</td>
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

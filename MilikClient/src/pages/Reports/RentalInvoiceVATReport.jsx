import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { FaFileDownload, FaFilter, FaPercent, FaPrint, FaSyncAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getTenantInvoices } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";

const formatMoney = (value) => `KES ${Number(value || 0).toLocaleString()}`;
const formatDate = (value) => {
  if (!value) return "-";
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? "-" : dt.toLocaleDateString();
};

const RentalInvoiceVATReport = () => {
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const businessId = currentCompany?._id || "";

  const [loading, setLoading] = useState(false);
  const [properties, setProperties] = useState([]);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ propertyId: "all", category: "all", search: "" });

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
        const taxAmount = Number(invoice?.taxSnapshot?.taxAmount || 0);
        return ["RENT_CHARGE", "UTILITY_CHARGE", "LATE_PENALTY_CHARGE"].includes(category) && taxAmount > 0;
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
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-3 md:p-5">
        <div className="mx-auto" style={{ maxWidth: "96%" }}>
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 bg-gradient-to-r from-[#0B3B2E] via-[#114b3d] to-slate-900 px-5 py-5 text-white">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-100">Rental invoicing tax workspace</p>
                  <h1 className="mt-1 text-2xl font-black tracking-tight">Rental Invoice VAT</h1>
                  <p className="mt-1 max-w-3xl text-sm text-slate-200">
                    VAT on rental invoices is already supported in the invoice engine. This page isolates taxable invoices and their net, tax, and gross values for review and export.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-white/15">
                    <FaFileDownload /> Export CSV
                  </button>
                  <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-white/15">
                    <FaPrint /> Print
                  </button>
                  <button onClick={loadData} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-white/15">
                    <FaSyncAlt className={loading ? "animate-spin" : ""} /> Refresh
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 border-b border-slate-200 bg-white p-4 md:grid-cols-4">
              {[
                { label: "Taxable invoices", value: totals.count, accent: "text-slate-900" },
                { label: "Net value", value: formatMoney(totals.net), accent: "text-[#0B3B2E]" },
                { label: "VAT amount", value: formatMoney(totals.tax), accent: "text-amber-700" },
                { label: "Gross value", value: formatMoney(totals.gross), accent: "text-slate-900" },
              ].map((card) => (
                <div key={card.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{card.label}</div>
                  <div className={`mt-2 text-2xl font-black ${card.accent}`}>{card.value}</div>
                </div>
              ))}
            </div>

            <div className="border-b border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr_1fr_auto]">
                <div className="relative">
                  <FaFilter className="absolute left-3 top-3 text-slate-400" />
                  <input
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Search invoice, tenant, property, unit, tax code"
                    className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10"
                  />
                </div>
                <select value={filters.propertyId} onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="all">All properties</option>
                  {properties.map((property) => (
                    <option key={property._id} value={property._id}>{property.propertyName || property.name}</option>
                  ))}
                </select>
                <select value={filters.category} onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="all">All charge types</option>
                  <option value="RENT_CHARGE">Rent</option>
                  <option value="UTILITY_CHARGE">Utility</option>
                  <option value="LATE_PENALTY_CHARGE">Late penalty</option>
                </select>
                <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">
                  <FaPercent className="text-amber-600" /> {filteredRows.length} row(s)
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    {['Invoice', 'Tenant', 'Property', 'Unit', 'Category', 'Invoice Date', 'Due Date', 'Tax', 'Net', 'VAT', 'Gross', 'Status'].map((header) => (
                      <th key={header} className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.14em]">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-4 py-10 text-center text-sm text-slate-500">No taxable rental invoices found for the current filter selection.</td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => (
                      <tr key={row._id} className="border-t border-slate-200 align-top hover:bg-slate-50/80">
                        <td className="px-4 py-3 font-semibold text-slate-900">{row?.invoiceNumber || '-'}</td>
                        <td className="px-4 py-3 text-slate-700">{row?.tenant?.tenantName || row?.tenant?.name || '-'}</td>
                        <td className="px-4 py-3 text-slate-700">{row?.property?.propertyName || '-'}</td>
                        <td className="px-4 py-3 text-slate-700">{row?.unit?.unitNumber || '-'}</td>
                        <td className="px-4 py-3 text-slate-700">{String(row?.category || '').replace(/_/g, ' ')}</td>
                        <td className="px-4 py-3 text-slate-700">{formatDate(row?.invoiceDate)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatDate(row?.dueDate)}</td>
                        <td className="px-4 py-3 text-slate-700">{row?.taxSnapshot?.taxCodeName || '-'} ({Number(row?.taxSnapshot?.taxRate || 0)}%)</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatMoney(row?.taxSnapshot?.netAmount || 0)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-700">{formatMoney(row?.taxSnapshot?.taxAmount || 0)}</td>
                        <td className="px-4 py-3 text-right font-bold text-[#0B3B2E]">{formatMoney(row?.taxSnapshot?.grossAmount || row?.amount || 0)}</td>
                        <td className="px-4 py-3 text-slate-700">{row?.status || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default RentalInvoiceVATReport;

import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { FaClock, FaFileDownload, FaFilter, FaPrint, FaSyncAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getTenantInvoices } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";

const formatMoney = (value) => `KES ${Number(value || 0).toLocaleString()}`;
const normalizeArray = (value) => (Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []);

const daysBetween = (earlier, later = new Date()) => {
  const start = new Date(earlier);
  const end = new Date(later);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
};

const bucketOutstanding = (dueDate, amount) => {
  const overdueDays = daysBetween(dueDate);
  if (!dueDate || overdueDays <= 0) return { current: amount, days30: 0, days60: 0, days90: 0, days90Plus: 0 };
  if (overdueDays <= 30) return { current: 0, days30: amount, days60: 0, days90: 0, days90Plus: 0 };
  if (overdueDays <= 60) return { current: 0, days30: 0, days60: amount, days90: 0, days90Plus: 0 };
  if (overdueDays <= 90) return { current: 0, days30: 0, days60: 0, days90: amount, days90Plus: 0 };
  return { current: 0, days30: 0, days60: 0, days90: 0, days90Plus: amount };
};

const RentalAgedAnalysisReport = () => {
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
          oldestDueDate: invoice?.dueDate || null,
        };
        const bucket = bucketOutstanding(invoice?.dueDate, outstanding);
        existing.current += bucket.current;
        existing.days30 += bucket.days30;
        existing.days60 += bucket.days60;
        existing.days90 += bucket.days90;
        existing.days90Plus += bucket.days90Plus;
        existing.total += outstanding;
        existing.categoryBreakdown[invoice?.category] = (existing.categoryBreakdown[invoice?.category] || 0) + outstanding;
        if (invoice?.dueDate && (!existing.oldestDueDate || new Date(invoice.dueDate) < new Date(existing.oldestDueDate))) {
          existing.oldestDueDate = invoice.dueDate;
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
  };

  useEffect(() => {
    loadData();
  }, [businessId]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (filters.propertyId !== "all" && String(row.propertyId) !== String(filters.propertyId)) return false;
      if (filters.category !== "all" && Number(row.categoryBreakdown?.[filters.category] || 0) <= 0) return false;
      const haystack = `${row.tenantName} ${row.propertyName} ${row.unitNumber}`.toLowerCase();
      return !filters.search.trim() || haystack.includes(filters.search.trim().toLowerCase());
    });
  }, [rows, filters]);

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

  const exportCsv = () => {
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
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-3 md:p-5">
        <div className="mx-auto" style={{ maxWidth: "96%" }}>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-gradient-to-r from-[#0B3B2E] via-[#114b3d] to-slate-900 px-5 py-5 text-white">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-100">Tenant receivables ageing</p>
                  <h1 className="mt-1 text-2xl font-black tracking-tight">Rental Aged Analysis</h1>
                  <p className="mt-1 max-w-3xl text-sm text-slate-200">
                    This version uses tenant invoices and receipt allocations instead of lease snapshots, so outstanding balances age from real invoice due dates and real applied receipts.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-white/15"><FaFileDownload /> Export CSV</button>
                  <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-white/15"><FaPrint /> Print</button>
                  <button onClick={loadData} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-white/15"><FaSyncAlt className={loading ? 'animate-spin' : ''} /> Refresh</button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 border-b border-slate-200 bg-white p-4 md:grid-cols-6">
              {[
                { label: 'Current', value: formatMoney(totals.current), accent: 'text-emerald-700' },
                { label: '1-30 Days', value: formatMoney(totals.days30), accent: 'text-amber-600' },
                { label: '31-60 Days', value: formatMoney(totals.days60), accent: 'text-orange-600' },
                { label: '61-90 Days', value: formatMoney(totals.days90), accent: 'text-red-500' },
                { label: '90+ Days', value: formatMoney(totals.days90Plus), accent: 'text-red-700' },
                { label: 'Grand Total', value: formatMoney(totals.total), accent: 'text-slate-900' },
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
                  <input value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} placeholder="Search tenant, property, unit" className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm" />
                </div>
                <select value={filters.propertyId} onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="all">All properties</option>
                  {properties.map((property) => <option key={property._id} value={property._id}>{property.propertyName || property.name}</option>)}
                </select>
                <select value={filters.category} onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="all">All charges</option>
                  <option value="RENT_CHARGE">Rent only</option>
                  <option value="UTILITY_CHARGE">Utility only</option>
                  <option value="LATE_PENALTY_CHARGE">Late penalties only</option>
                </select>
                <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"><FaClock className="text-amber-600" /> {totals.count} tenant row(s)</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    {['Tenant', 'Property', 'Unit', 'Current', '1-30', '31-60', '61-90', '90+', 'Total', 'Oldest Due'].map((header) => <th key={header} className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.14em]">{header}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">No aged receivables found for the current filters.</td></tr>
                  ) : filteredRows.map((row) => (
                    <tr key={row.tenantId} className="border-t border-slate-200 hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-semibold text-slate-900">{row.tenantName}</td>
                      <td className="px-4 py-3 text-slate-700">{row.propertyName}</td>
                      <td className="px-4 py-3 text-slate-700">{row.unitNumber}</td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700">{formatMoney(row.current)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-amber-600">{formatMoney(row.days30)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-orange-600">{formatMoney(row.days60)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-red-500">{formatMoney(row.days90)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-red-700">{formatMoney(row.days90Plus)}</td>
                      <td className="px-4 py-3 text-right font-black text-slate-900">{formatMoney(row.total)}</td>
                      <td className="px-4 py-3 text-slate-700">{row.oldestDueDate ? new Date(row.oldestDueDate).toLocaleDateString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default RentalAgedAnalysisReport;

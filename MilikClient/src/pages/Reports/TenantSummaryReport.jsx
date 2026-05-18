import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { FaFileDownload, FaFilter, FaPrint, FaSyncAlt, FaUsers } from "react-icons/fa";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getTenantInvoices } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";

const formatMoney = (v) => `KES ${Number(v || 0).toLocaleString()}`;

const ITEMS_PER_PAGE = 50;

const normalize = (res) => {
  const d = res?.data;
  if (Array.isArray(d?.data)) return d.data;
  if (Array.isArray(d)) return d;
  return [];
};

const TenantSummaryReport = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const currentUser = useSelector((s) => s.auth?.currentUser || s.auth?.user || null);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");
  const businessId = currentCompany?._id || "";

  const [loading, setLoading] = useState(false);
  const [tenants, setTenants] = useState([]);
  const [properties, setProperties] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [filters, setFilters] = useState({ propertyId: "all", status: "all", search: "" });
  const [currentPage, setCurrentPage] = useState(1);

  const loadData = async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [tenantRes, propRes, invoiceRows, paymentRes] = await Promise.all([
        adminRequests.get(`/tenants?business=${businessId}&limit=1000`),
        adminRequests.get(`/properties?business=${businessId}&limit=1000`),
        getTenantInvoices({ business: businessId }),
        adminRequests.get(`/rent-payments?business=${businessId}&limit=10000`),
      ]);
      setTenants(normalize(tenantRes));
      setProperties(normalize(propRes));
      setInvoices(Array.isArray(invoiceRows) ? invoiceRows : []);
      setPayments(normalize(paymentRes));
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load tenant summary.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessId]);

  const rows = useMemo(() => {
    return tenants.map((tenant) => {
      // Property comes through unit (tenant.unit is populated with unit.property)
      const unitProp = tenant.unit?.property;
      const propertyId = unitProp?._id || (typeof unitProp === "string" ? unitProp : "");
      const propFallback = properties.find((p) => String(p._id) === String(propertyId));
      const propertyName = unitProp?.propertyName || propFallback?.propertyName || "—";

      const tenantId = String(tenant._id);

      const tenantInvoices = invoices.filter((inv) => {
        const id = inv?.tenant?._id || inv?.tenant;
        return String(id) === tenantId;
      });
      const tenantPayments = payments.filter((pay) => {
        const id = pay?.tenant?._id || pay?.tenant;
        return String(id) === tenantId;
      });

      const totalInvoiced = tenantInvoices.reduce((sum, inv) => sum + Number(inv?.amount || 0), 0);
      const totalPaid = tenantPayments.reduce((sum, p) => sum + Number(p?.amount || 0), 0);
      const balance = totalInvoiced - totalPaid; // positive = tenant owes money

      return {
        tenantId,
        tenantName: tenant.tenantName || tenant.name || "—",
        email: tenant.email || "—",
        phone: tenant.phone || "—",
        property: propertyName,
        propertyId,
        unitNumber: tenant.unit?.unitNumber || "—",
        totalInvoiced,
        totalPaid,
        balance,
        invoiceCount: tenantInvoices.length,
        paymentCount: tenantPayments.length,
        status: String(tenant.status || "").toLowerCase() === "active" ? "active" : "inactive",
      };
    });
  }, [tenants, properties, invoices, payments]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (filters.propertyId !== "all" && String(row.propertyId) !== String(filters.propertyId)) return false;
      if (filters.status !== "all" && row.status !== filters.status) return false;
      const hay = [row.tenantName, row.email, row.phone, row.property, row.unitNumber].filter(Boolean).join(" ").toLowerCase();
      return !filters.search.trim() || hay.includes(filters.search.trim().toLowerCase());
    });
  }, [rows, filters]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const paginatedRows = filteredRows.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

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
    const header = ["Tenant", "Email", "Phone", "Property", "Unit", "Invoiced", "Paid", "Outstanding", "Invoices", "Payments", "Status"];
    const body = filteredRows.map((r) => [
      r.tenantName, r.email, r.phone, r.property, r.unitNumber,
      r.totalInvoiced, r.totalPaid, r.balance, r.invoiceCount, r.paymentCount, r.status,
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
              <div><strong>Property:</strong> {filters.propertyId === "all" ? "All properties" : (properties.find((p) => String(p._id) === filters.propertyId)?.propertyName || "Selected")}</div>
              <div><strong>Status:</strong> {filters.status === "all" ? "All tenants" : filters.status}</div>
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
                {["Tenant", "Email", "Phone", "Property", "Unit", "Invoiced", "Collected", "Outstanding", "Status"].map((h) => <th key={h}>{h}</th>)}
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
                  <td>{row.property}</td>
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
              <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
                <div className="relative shrink-0">
                  <FaFilter className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                  <input
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Tenant, property, unit..."
                    className="h-7 w-44 rounded border border-slate-200 bg-white pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                  />
                </div>
                <select
                  value={filters.propertyId}
                  onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))}
                  className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-orange-400"
                >
                  <option value="all">All properties</option>
                  {properties.map((p) => (
                    <option key={p._id} value={p._id}>{p.propertyName || p.name}</option>
                  ))}
                </select>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                  className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-orange-400"
                >
                  <option value="all">All tenants</option>
                  <option value="active">Active only</option>
                  <option value="inactive">Inactive only</option>
                </select>
                <span className="shrink-0 rounded border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700">
                  <FaUsers className="inline mr-1" />{filteredRows.length} tenants
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
                  onClick={() => { if (!canExportReports) { toast.warning("You do not have permission to print reports"); return; } window.print(); }}
                  disabled={!canExportReports}
                  className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  <FaPrint size={9} /> Print
                </button>
                <button
                  onClick={loadData}
                  className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#0B3B2E] px-2.5 text-xs font-semibold text-white hover:bg-[#0A3127]"
                >
                  <FaSyncAlt size={9} className={loading ? "animate-spin" : ""} /> Refresh
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className="bg-[#0B3B2E] text-white">
                    {["Tenant", "Email", "Phone", "Property", "Unit", "Invoiced", "Collected", "Outstanding", "Status"].map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.12em]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-500">
                        {loading ? "Loading..." : "No tenants found for the current filter selection."}
                      </td>
                    </tr>
                  ) : (
                    paginatedRows.map((row) => (
                      <tr key={row.tenantId} className="border-t border-slate-200 align-top hover:bg-slate-50/80">
                        <td className="px-3 py-2 font-semibold text-slate-900">{row.tenantName}</td>
                        <td className="px-3 py-2 text-slate-600">{row.email}</td>
                        <td className="px-3 py-2 text-slate-600">{row.phone}</td>
                        <td className="px-3 py-2 text-slate-700">{row.property}</td>
                        <td className="px-3 py-2 text-slate-700">{row.unitNumber}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{formatMoney(row.totalInvoiced)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-[#0B3B2E]">{formatMoney(row.totalPaid)}</td>
                        <td className={`px-3 py-2 text-right font-bold ${row.balance > 0 ? "text-red-700" : row.balance < 0 ? "text-green-700" : "text-slate-500"}`}>
                          {formatMoney(row.balance)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.status === "active" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="sticky bottom-0 z-20 flex-shrink-0 border-t border-slate-200 bg-white px-3 py-1">
              <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
                <div className="font-semibold">
                  Showing{" "}
                  <span className="font-bold text-slate-900">{paginatedRows.length > 0 ? startIndex + 1 : 0}</span> to{" "}
                  <span className="font-bold text-slate-900">{Math.min(startIndex + ITEMS_PER_PAGE, filteredRows.length)}</span> of{" "}
                  <span className="font-bold text-slate-900">{filteredRows.length}</span> tenants
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Per page: {ITEMS_PER_PAGE}</span>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={safeCurrentPage === 1}
                    className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="font-semibold text-slate-700">Page {safeCurrentPage} of {totalPages}</span>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={safeCurrentPage === totalPages}
                    className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TenantSummaryReport;

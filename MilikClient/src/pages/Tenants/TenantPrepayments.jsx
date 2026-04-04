
import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { FaArrowRight, FaCoins, FaReceipt, FaSearch } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getRentPayments } from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { getTenants } from "../../redux/tenantsRedux";

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.tenants)) return value.tenants;
  if (Array.isArray(value?.properties)) return value.properties;
  if (Array.isArray(value?.rentPayments)) return value.rentPayments;
  return [];
};

const safeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const formatMoney = (value) => `KES ${Math.abs(Number(value || 0)).toLocaleString()}`;
const formatDate = (value) => {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString();
};

const getTenantName = (tenant) =>
  tenant?.name ||
  tenant?.tenantName ||
  [tenant?.firstName, tenant?.lastName].filter(Boolean).join(" ") ||
  "Unnamed Tenant";

const getPropertyIdFromTenant = (tenant) =>
  String(tenant?.property?._id || tenant?.property || tenant?.unit?.property?._id || tenant?.unit?.property || "");

const TenantPrepayments = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { currentCompany } = useSelector((state) => state.company || {});
  const tenants = useSelector((state) => ensureArray(state.tenant?.tenants));
  const properties = useSelector((state) => ensureArray(state.property?.properties));
  const receipts = useSelector((state) => ensureArray(state.rentPayment?.rentPayments));

  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getTenants({ business: currentCompany._id }));
    dispatch(getProperties({ business: currentCompany._id }));
    getRentPayments(dispatch, currentCompany._id);
  }, [currentCompany?._id, dispatch]);

  const propertyMap = useMemo(
    () => new Map(properties.map((item) => [String(item?._id || ""), item])),
    [properties]
  );

  const rows = useMemo(() => {
    return receipts
      .filter((payment) => {
        if (payment?.ledgerType !== "receipts") return false;
        if (payment?.isCancelled === true || payment?.isReversed === true || payment?.reversalOf) return false;
        if (String(payment?.postingStatus || "").toLowerCase() === "reversed") return false;
        return Number(payment?.allocationSummary?.unapplied || 0) > 0;
      })
      .map((payment) => {
        const tenantId = safeId(payment?.tenant);
        const tenant = tenants.find((item) => safeId(item) === tenantId) || payment?.tenant || null;
        const propertyId = getPropertyIdFromTenant(tenant);
        const property = propertyMap.get(propertyId);
        const allocatedAmount = Math.max(
          0,
          Math.abs(Number(payment?.amount || 0)) - Math.abs(Number(payment?.allocationSummary?.unapplied || 0))
        );

        return {
          _id: payment?._id,
          receipt: payment,
          tenantId,
          tenantName: getTenantName(tenant),
          propertyId,
          propertyName: property?.propertyName || tenant?.property?.propertyName || tenant?.unit?.property?.propertyName || "-",
          unitName: tenant?.unit?.unitNumber || payment?.unit?.unitNumber || "-",
          amount: Math.abs(Number(payment?.amount || 0)),
          unappliedAmount: Math.abs(Number(payment?.allocationSummary?.unapplied || 0)),
          allocatedAmount,
          isConfirmed: payment?.isConfirmed === true,
          paymentDate: payment?.paymentDate,
          referenceNumber: payment?.referenceNumber || payment?.receiptNumber || "-",
        };
      })
      .filter((row) => {
        if (propertyFilter !== "all" && row.propertyId !== propertyFilter) return false;
        if (statusFilter === "confirmed" && !row.isConfirmed) return false;
        if (statusFilter === "unconfirmed" && row.isConfirmed) return false;
        if (!search.trim()) return true;
        const haystack = `${row.tenantName} ${row.propertyName} ${row.unitName} ${row.referenceNumber}`.toLowerCase();
        return haystack.includes(search.trim().toLowerCase());
      })
      .sort((a, b) => new Date(b.paymentDate || 0).getTime() - new Date(a.paymentDate || 0).getTime());
  }, [propertyFilter, propertyMap, receipts, search, statusFilter, tenants]);

  const totals = useMemo(() => {
    const confirmedRows = rows.filter((row) => row.isConfirmed);
    return {
      rowCount: rows.length,
      totalUnapplied: rows.reduce((sum, row) => sum + Number(row.unappliedAmount || 0), 0),
      totalAllocated: rows.reduce((sum, row) => sum + Number(row.allocatedAmount || 0), 0),
      lockedRows: confirmedRows.length,
    };
  }, [rows]);

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-white p-4 md:p-6">
        <div className="mx-auto max-w-7xl space-y-4">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
            <div className="border-b border-slate-200 bg-gradient-to-r from-[#0B3B2E] via-[#114b3d] to-slate-900 px-5 py-5 text-white">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-100">Receipting operations</p>
                  <h1 className="mt-1 text-2xl font-black tracking-tight">Tenant Prepayments</h1>
                  <p className="mt-1 max-w-3xl text-sm text-slate-200">
                    Review receipts with unapplied balance and open the allocation workspace to manually apply them to invoices without breaking posted ledger entries.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-slate-100">
                  Confirmed receipts keep their unapplied balance locked unless you reallocate only the already-allocated portion. This page follows the existing allocation safety rules.
                </div>
              </div>
            </div>

            <div className="grid gap-4 p-4 md:grid-cols-4 md:p-5">
              {[
                { label: "Open prepayments", value: totals.rowCount, accent: "text-slate-900" },
                { label: "Unapplied balance", value: formatMoney(totals.totalUnapplied), accent: "text-amber-700" },
                { label: "Already allocated", value: formatMoney(totals.totalAllocated), accent: "text-emerald-700" },
                { label: "Confirmed rows", value: totals.lockedRows, accent: "text-[#0B3B2E]" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                  <p className={`mt-2 text-2xl font-black ${item.accent}`}>{item.value}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-200 p-4 md:p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-1 flex-col gap-3 md:flex-row">
                  <div className="relative md:w-80">
                    <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search tenant, property, unit, reference"
                      className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10"
                    />
                  </div>
                  <select
                    value={propertyFilter}
                    onChange={(e) => setPropertyFilter(e.target.value)}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10"
                  >
                    <option value="all">All properties</option>
                    {properties.map((property) => (
                      <option key={property._id} value={property._id}>
                        {property.propertyName || property.name || "Unnamed Property"}
                      </option>
                    ))}
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10"
                  >
                    <option value="all">All statuses</option>
                    <option value="confirmed">Confirmed only</option>
                    <option value="unconfirmed">Unconfirmed only</option>
                  </select>
                </div>
                <button
                  onClick={() => navigate("/receipts/new")}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-[#0A3127]"
                >
                  <FaReceipt /> New receipt
                </button>
              </div>

              <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                      <th className="px-4 py-3">Receipt</th>
                      <th className="px-4 py-3">Tenant</th>
                      <th className="px-4 py-3">Property</th>
                      <th className="px-4 py-3">Amounts</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                          No unapplied receipt balances matched the current filters.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr key={row._id}>
                          <td className="px-4 py-3">
                            <p className="font-bold text-slate-900">{row.referenceNumber}</p>
                            <p className="mt-1 text-xs text-slate-500">{formatDate(row.paymentDate)}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-900">{row.tenantName}</p>
                            <p className="mt-1 text-xs text-slate-500">Unit {row.unitName}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{row.propertyName}</td>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-900">Receipt {formatMoney(row.amount)}</p>
                            <p className="mt-1 text-xs text-emerald-700">Allocated {formatMoney(row.allocatedAmount)}</p>
                            <p className="mt-1 text-xs font-bold text-amber-700">Unapplied {formatMoney(row.unappliedAmount)}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${row.isConfirmed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                              {row.isConfirmed ? "Confirmed" : "Unconfirmed"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => navigate(`/receipts?receipt=${row._id}`)}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-700 hover:bg-slate-50"
                            >
                              <FaArrowRight /> Manage allocation
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-bold text-slate-900">How this stays accounting-safe</p>
                <p className="mt-1">
                  This page does not invent a second prepayment ledger. It surfaces existing receipt records whose unapplied balance already sits in the current receipt allocation logic, then routes users back to the supported allocation workflow.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TenantPrepayments;

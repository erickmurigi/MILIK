import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { FaArrowRight, FaCoins, FaReceipt, FaSearch } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getRentPayments } from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { getTenants } from "../../redux/tenantsRedux";

const ITEMS_PER_PAGE = 50;
const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";

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
  const [currentPage, setCurrentPage] = useState(1);

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

  useEffect(() => {
    setCurrentPage(1);
  }, [search, propertyFilter, statusFilter]);

  const totals = useMemo(() => {
    const confirmedRows = rows.filter((row) => row.isConfirmed);
    return {
      rowCount: rows.length,
      totalUnapplied: rows.reduce((sum, row) => sum + Number(row.unappliedAmount || 0), 0),
      totalAllocated: rows.reduce((sum, row) => sum + Number(row.allocatedAmount || 0), 0),
      lockedRows: confirmedRows.length,
    };
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = rows.length === 0 ? 0 : (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentPageRows = rows.slice(startIndex, endIndex);

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-[96%] space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0B3B2E]">Receipting Workspace</p>
                <h1 className="mt-1 text-2xl font-black text-slate-900">Tenant Prepayments</h1>
                <p className="mt-1 text-sm text-slate-500">
                  Review receipts with unapplied balance and route users into the supported allocation workflow without creating duplicate ledgers.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => navigate("/receipts/new")}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-black text-white ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                >
                  <FaReceipt /> New Receipt
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Open Prepayments</p>
              <p className="mt-2 text-2xl font-black text-slate-900">{totals.rowCount}</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-600">Unapplied Balance</p>
              <p className="mt-2 text-2xl font-black text-amber-700">{formatMoney(totals.totalUnapplied)}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">Already Allocated</p>
              <p className="mt-2 text-2xl font-black text-emerald-700">{formatMoney(totals.totalAllocated)}</p>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Confirmed Rows</p>
              <p className="mt-2 text-2xl font-black text-blue-700">{totals.lockedRows}</p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50">
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <div className="relative lg:col-span-2">
                  <FaSearch className="absolute left-3 top-3.5 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search tenant, property, unit, reference"
                    className="w-full px-3 py-3 pl-10 border border-slate-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <select
                    value={propertyFilter}
                    onChange={(e) => setPropertyFilter(e.target.value)}
                    className="w-full px-3 py-3 border border-slate-300 rounded-md text-sm"
                  >
                    <option value="all">All Properties</option>
                    {properties.map((property) => (
                      <option key={property._id} value={property._id}>
                        {property.propertyName || property.name || "Unnamed Property"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full px-3 py-3 border border-slate-300 rounded-md text-sm"
                  >
                    <option value="all">All Statuses</option>
                    <option value="confirmed">Confirmed Only</option>
                    <option value="unconfirmed">Unconfirmed Only</option>
                  </select>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => navigate("/receipts/new")}
                  className={`px-3 py-1.5 text-xs rounded-md text-white font-semibold flex items-center gap-2 ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                >
                  <FaReceipt /> New Receipt
                </button>
                <button
                  onClick={() => {
                    setSearch("");
                    setPropertyFilter("all");
                    setStatusFilter("all");
                  }}
                  className="px-3 py-1.5 text-xs rounded-md bg-slate-500 hover:bg-slate-600 text-white font-semibold flex items-center gap-2"
                >
                  <FaCoins /> Reset Filters
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-xs">
                <thead>
                  <tr className={`${MILIK_GREEN} text-white`}>
                    <th className="px-3 py-2 text-left">Receipt #</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Tenant</th>
                    <th className="px-3 py-2 text-left">Property</th>
                    <th className="px-3 py-2 text-left">Unit</th>
                    <th className="px-3 py-2 text-right">Receipt</th>
                    <th className="px-3 py-2 text-right">Allocated</th>
                    <th className="px-3 py-2 text-right">Unapplied</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPageRows.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="px-3 py-10 text-center text-slate-500">
                        No unapplied receipt balances matched the current filters.
                      </td>
                    </tr>
                  ) : (
                    currentPageRows.map((row, index) => (
                      <tr
                        key={row._id}
                        className={`border-b border-slate-200 ${index % 2 === 0 ? "bg-white" : "bg-slate-50"}`}
                      >
                        <td className="px-3 py-2 font-bold text-slate-900">{row.referenceNumber}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900">{formatDate(row.paymentDate)}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900">{row.tenantName}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900">{row.propertyName}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900">{row.unitName}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-900">{formatMoney(row.amount)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-700">{formatMoney(row.allocatedAmount)}</td>
                        <td className="px-3 py-2 text-right font-bold text-amber-700">{formatMoney(row.unappliedAmount)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex px-2 py-1 rounded text-[10px] font-semibold ${
                              row.isConfirmed ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {row.isConfirmed ? "Confirmed" : "Pending"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => navigate(`/receipts?receipt=${row._id}`)}
                            className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white inline-flex items-center gap-1"
                          >
                            <FaArrowRight size={11} /> Manage Allocation
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">
              <p>
                <span className="font-semibold">Showing:</span> {rows.length === 0 ? 0 : startIndex + 1}
                {" - "}
                {Math.min(endIndex, rows.length)} of {rows.length} prepayment row(s)
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={safeCurrentPage === 1}
                  className="rounded-md border border-slate-300 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1 font-semibold text-slate-700">
                  Page {safeCurrentPage} of {totalPages} · {ITEMS_PER_PAGE} per page
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={safeCurrentPage === totalPages}
                  className="rounded-md border border-slate-300 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TenantPrepayments;

import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { FaArrowRight, FaCoins, FaReceipt, FaSearch } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { listRentPaymentsPage } from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";

const ITEMS_PER_PAGE = 50;
const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.properties)) return value.properties;
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

const getPropertyName = (payment) =>
  payment?.unit?.property?.propertyName ||
  payment?.tenant?.unit?.property?.propertyName ||
  payment?.property?.propertyName ||
  "-";

const getPropertyId = (payment) =>
  safeId(payment?.unit?.property || payment?.tenant?.unit?.property || payment?.property || "");

const getUnitName = (payment) =>
  payment?.unit?.unitNumber ||
  payment?.tenant?.unit?.unitNumber ||
  "-";

const buildStatusParam = (statusFilter) => {
  if (statusFilter === "confirmed") return "confirmed";
  if (statusFilter === "unconfirmed") return "pending";
  return "active";
};

const TenantPrepayments = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { currentCompany } = useSelector((state) => state.company || {});
  const properties = useSelector((state) => ensureArray(state.property?.properties));

  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: ITEMS_PER_PAGE,
    totalItems: 0,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false,
  });
  const [totals, setTotals] = useState({
    rowCount: 0,
    totalReceiptAmount: 0,
    totalUnapplied: 0,
    totalAllocated: 0,
    confirmedRows: 0,
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getProperties({ business: currentCompany._id }));
  }, [currentCompany?._id, dispatch]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, propertyFilter, statusFilter]);

  useEffect(() => {
    let isMounted = true;

    const loadRows = async () => {
      if (!currentCompany?._id) {
        if (!isMounted) return;
        setRows([]);
        setPagination({
          page: 1,
          limit: ITEMS_PER_PAGE,
          totalItems: 0,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        });
        setTotals({
          rowCount: 0,
          totalReceiptAmount: 0,
          totalUnapplied: 0,
          totalAllocated: 0,
          confirmedRows: 0,
        });
        return;
      }

      setIsLoading(true);
      try {
        const response = await listRentPaymentsPage({
          business: currentCompany._id,
          page: currentPage,
          limit: ITEMS_PER_PAGE,
          hasUnapplied: true,
          includeTotals: true,
          status: buildStatusParam(statusFilter),
          property: propertyFilter !== "all" ? propertyFilter : undefined,
          search: search.trim() || undefined,
          tenantSearch: search.trim() || undefined,
        });

        if (!isMounted) return;

        const items = Array.isArray(response?.items) ? response.items : [];
        const summary = response?.raw?.summary || response?.summary || null;

        const nextRows = items.map((payment) => {
          const allocatedAmount = Math.max(
            0,
            Math.abs(Number(payment?.amount || 0)) - Math.abs(Number(payment?.allocationSummary?.unapplied || 0))
          );

          return {
            _id: payment?._id,
            receipt: payment,
            tenantId: safeId(payment?.tenant),
            tenantName: getTenantName(payment?.tenant),
            propertyId: getPropertyId(payment),
            propertyName: getPropertyName(payment),
            unitName: getUnitName(payment),
            amount: Math.abs(Number(payment?.amount || 0)),
            unappliedAmount: Math.abs(Number(payment?.allocationSummary?.unapplied || 0)),
            allocatedAmount,
            isConfirmed: payment?.isConfirmed === true,
            paymentDate: payment?.paymentDate,
            referenceNumber: payment?.referenceNumber || payment?.receiptNumber || "-",
          };
        });

        setRows(nextRows);
        setPagination(
          response?.pagination || {
            page: currentPage,
            limit: ITEMS_PER_PAGE,
            totalItems: nextRows.length,
            totalPages: Math.max(1, Math.ceil(nextRows.length / ITEMS_PER_PAGE)),
            hasPreviousPage: currentPage > 1,
            hasNextPage: false,
          }
        );
        setTotals({
          rowCount: Number(summary?.rowCount || response?.pagination?.totalItems || nextRows.length || 0),
          totalReceiptAmount: Number(summary?.totalReceiptAmount || 0),
          totalUnapplied: Number(summary?.totalUnapplied || 0),
          totalAllocated: Number(summary?.totalAllocated || 0),
          confirmedRows: Number(summary?.confirmedRows || nextRows.filter((row) => row.isConfirmed).length || 0),
        });
      } catch (error) {
        if (!isMounted) return;
        setRows([]);
        setPagination({
          page: 1,
          limit: ITEMS_PER_PAGE,
          totalItems: 0,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        });
        setTotals({
          rowCount: 0,
          totalReceiptAmount: 0,
          totalUnapplied: 0,
          totalAllocated: 0,
          confirmedRows: 0,
        });
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadRows();

    return () => {
      isMounted = false;
    };
  }, [currentCompany?._id, currentPage, propertyFilter, search, statusFilter]);

  const propertyOptions = useMemo(
    () =>
      properties
        .map((property) => ({
          _id: safeId(property),
          propertyName: property?.propertyName || property?.name || "Unnamed Property",
        }))
        .filter((property) => property._id),
    [properties]
  );

  const totalPages = Math.max(1, Number(pagination?.totalPages || 1));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const showingStart = rows.length === 0 ? 0 : (safeCurrentPage - 1) * ITEMS_PER_PAGE + 1;
  const showingEnd = rows.length === 0 ? 0 : showingStart + rows.length - 1;

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2 pb-10">
        <div className="mx-auto flex h-full w-full max-w-full min-h-0 flex-1 flex-col gap-2">
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="sticky top-0 z-20 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 px-2 py-2 shadow-sm backdrop-blur">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3 lg:grid-cols-4">
                <div className="relative lg:col-span-2">
                  <FaSearch className="absolute left-3 top-3.5 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search tenant, property, unit, reference"
                    className="h-8 w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-2.5 text-[11px] text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
                <div>
                  <select
                    value={propertyFilter}
                    onChange={(e) => setPropertyFilter(e.target.value)}
                    className="h-8 w-full rounded-md border border-orange-200 bg-orange-50/70 px-2.5 text-[11px] font-semibold text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100"
                  >
                    <option value="all">All Properties</option>
                    {propertyOptions.map((property) => (
                      <option key={property._id} value={property._id}>
                        {property.propertyName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="h-8 w-full rounded-md border border-orange-200 bg-orange-50/70 px-2.5 text-[11px] font-semibold text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100"
                  >
                    <option value="all">All Active Prepayments</option>
                    <option value="confirmed">Confirmed Only</option>
                    <option value="unconfirmed">Unconfirmed Only</option>
                  </select>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { label: "Open", value: totals.rowCount, accent: "text-slate-900" },
                    { label: "Unapplied", value: formatMoney(totals.totalUnapplied), accent: "text-amber-700" },
                    { label: "Allocated", value: formatMoney(totals.totalAllocated), accent: "text-emerald-700" },
                    { label: "Confirmed", value: totals.confirmedRows, accent: "text-blue-700" },
                    { label: "Receipt Value", value: formatMoney(totals.totalReceiptAmount), accent: "text-slate-900" },
                  ].map((card) => (
                    <span key={card.label} className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                      {card.label} <span className={`normal-case tracking-normal ${card.accent}`}>{card.value}</span>
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => navigate("/receipts/new")}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0B3B2E] px-3 text-[11px] font-bold text-white shadow-sm transition hover:bg-[#0A3127]"
                  >
                    <FaReceipt /> New Receipt
                  </button>
                  <button
                    onClick={() => {
                      setSearch("");
                      setPropertyFilter("all");
                      setStatusFilter("all");
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  >
                    <FaCoins /> Reset Filters
                  </button>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[1100px] text-xs">
                <thead>
                  <tr className={`${MILIK_GREEN} sticky top-0 z-10 text-white`}>
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
                  {isLoading ? (
                    <tr>
                      <td colSpan="10" className="px-3 py-10 text-center text-slate-500">
                        Loading prepayments...
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="px-3 py-10 text-center text-slate-500">
                        No unapplied receipt balances matched the current filters.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, index) => (
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
                            className={`inline-flex rounded px-2 py-1 text-[10px] font-semibold ${
                              row.isConfirmed ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {row.isConfirmed ? "Confirmed" : "Pending"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => navigate(`/receipts?receipt=${row._id}`)}
                            className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-white hover:bg-indigo-700"
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

            <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
              <p>
                <span className="font-semibold">Showing:</span> {showingStart}
                {" - "}
                {showingEnd} of {pagination.totalItems || 0} prepayment row(s)
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={!pagination.hasPreviousPage}
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
                  disabled={!pagination.hasNextPage}
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

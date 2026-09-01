import React, { useEffect, useMemo, useState } from "react";
import PaginationBar from '../../components/PaginationBar';
import { formatMoney } from "../../utils/money";
import { fmtDate } from "../../utils/dates";
import { useDispatch, useSelector } from "react-redux";
import {
  selectCurrentCompany,
  selectAllProperties,
} from "../../redux/selectors";
import { useNavigate } from "react-router-dom";
import { FaArrowRight, FaCoins, FaReceipt, FaSearch } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { listRentPaymentsPage } from "../../redux/apiCalls";
import { useTerms } from "../../hooks/useTerm";
import { useTabState } from "../../hooks/useTabState";
import useDebounce from "../../hooks/useDebounce";
import { getProperties } from "../../redux/propertyRedux";
import AppSelect from "../../components/common/AppSelect";
import { getTenantName } from "../../utils/tenantUtils";
import { safeId } from "../../utils/idUtils";
import MilikTable from "../../components/common/MilikTable";

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
  const [pageSize, setPageSize] = useState(50);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { tenant: termTenant, tenants: termTenants, unit: termUnit, units: termUnits, property: termProperty, properties: termProperties } = useTerms("tenant", "tenants", "unit", "units", "property", "properties");
  const currentCompany = useSelector(selectCurrentCompany);
  const properties = useSelector(selectAllProperties);

  const [search, setSearch] = useTabState("/receipts/prepayments:search", "");
  const debouncedSearch = useDebounce(search, 400);
  const [propertyFilter, setPropertyFilter] = useTabState("/receipts/prepayments:propertyFilter", "all");
  const [statusFilter, setStatusFilter] = useTabState("/receipts/prepayments:statusFilter", "all");
  const [currentPage, setCurrentPage] = useTabState("/receipts/prepayments:currentPage", 1);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: pageSize,
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
  }, [debouncedSearch, propertyFilter, statusFilter]);

  useEffect(() => {
    let isMounted = true;

    const loadRows = async () => {
      if (!currentCompany?._id) {
        if (!isMounted) return;
        setRows([]);
        setPagination({
          page: 1,
          limit: pageSize,
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
          limit: pageSize,
          hasUnapplied: true,
          includeTotals: true,
          status: buildStatusParam(statusFilter),
          property: propertyFilter !== "all" ? propertyFilter : undefined,
          search: debouncedSearch.trim() || undefined,
          tenantSearch: debouncedSearch.trim() || undefined,
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
            limit: pageSize,
            totalItems: nextRows.length,
            totalPages: Math.max(1, Math.ceil(nextRows.length / pageSize)),
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
          limit: pageSize,
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
  }, [currentCompany?._id, currentPage, propertyFilter, debouncedSearch, statusFilter, pageSize]);

  const propertyOptions = useMemo(
    () =>
      properties
        .map((property) => ({
          value: safeId(property),
          label: property?.propertyName || property?.name || "Unnamed Property",
        }))
        .filter((property) => property.value),
    [properties]
  );

  const totalPages = Math.max(1, Number(pagination?.totalPages || 1));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const showingStart = rows.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const showingEnd = rows.length === 0 ? 0 : showingStart + rows.length - 1;

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2 pb-10">
        <div className="mx-auto flex h-full w-full max-w-full min-h-0 flex-1 flex-col gap-2">
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex-none sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
              <div className="filter-bar flex items-center gap-0.5 overflow-x-auto px-2 py-1">
                {[
                  { label: "Open", value: totals.rowCount, accent: "text-slate-900" },
                  { label: "Unapplied", value: formatMoney(totals.totalUnapplied), accent: "text-amber-700" },
                  { label: "Allocated", value: formatMoney(totals.totalAllocated), accent: "text-emerald-700" },
                  { label: "Confirmed", value: totals.confirmedRows, accent: "text-blue-700" },
                  { label: "Receipt Value", value: formatMoney(totals.totalReceiptAmount), accent: "text-slate-900" },
                ].map((card) => (
                  <span key={card.label} className="shrink-0 inline-flex h-[20px] items-center gap-1 border border-slate-200 bg-white px-1 text-[8px] font-bold uppercase tracking-[0.08em] text-slate-500">
                    {card.label} <span className={`normal-case tracking-normal ${card.accent}`}>{card.value}</span>
                  </span>
                ))}
                <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="h-[20px] w-32 shrink-0 border border-slate-200 bg-white px-1.5 text-[9px] outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                <AppSelect
                  value={propertyFilter}
                  onChange={(v) => setPropertyFilter(v ?? "all")}
                  options={propertyOptions}
                  placeholder={termProperty}
                  clearable
                  searchable
                  compact
                />
                <AppSelect
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v ?? "all")}
                  options={[
                    { value: "confirmed", label: "Confirmed" },
                    { value: "unconfirmed", label: "Unconfirmed" },
                  ]}
                  placeholder="All Active"
                  clearable
                  compact
                />
                <button onClick={() => navigate("/receipts/new")} className="h-[20px] shrink-0 flex items-center gap-0.5 bg-[#0B3B2E] px-1.5 text-[9px] font-bold text-white shadow-sm hover:bg-[#0A3127]"><FaReceipt size={7} /> New Receipt</button>
                <button onClick={() => { setSearch(""); setPropertyFilter("all"); setStatusFilter("all"); }} className="h-[20px] shrink-0 flex items-center gap-0.5 border border-slate-200 bg-white px-1.5 text-[9px] font-bold text-slate-700 shadow-sm hover:bg-slate-50"><FaCoins size={7} /> Reset</button>
              </div>
            </div>

            <MilikTable
              columns={[
                { label: "Receipt #" },
                { label: "Date" },
                { label: termTenant },
                { label: termProperty },
                { label: termUnit },
                { label: "Receipt", align: "right" },
                { label: "Allocated", align: "right" },
                { label: "Unapplied", align: "right" },
                { label: "Status" },
              ]}
              rows={rows}
              rowKey="_id"
              loading={isLoading}
              empty="No unapplied receipt balances matched the current filters."
              minWidth={1100}
              renderRow={(row) => (
                <>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-bold text-slate-900">{row.referenceNumber}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900">{fmtDate(row.paymentDate)}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900">{row.tenantName}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900">{row.propertyName}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900">{row.unitName}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-bold text-slate-900">{formatMoney(row.amount)}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-semibold text-emerald-700">{formatMoney(row.allocatedAmount)}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-bold text-amber-700">{formatMoney(row.unappliedAmount)}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                      row.isConfirmed ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}>
                      {row.isConfirmed ? "Confirmed" : "Pending"}
                    </span>
                  </td>
                </>
              )}
              renderActions={(row) => (
                <button
                  onClick={() => navigate(`/receipts?receipt=${row._id}`)}
                  className="inline-flex items-center gap-1 rounded-full bg-[#0B3B2E] px-2.5 py-0.5 text-[10px] font-bold text-white hover:bg-[#0A3127]"
                >
                  <FaArrowRight size={9} /> Manage
                </button>
              )}
            />

            <PaginationBar
              page={safeCurrentPage}
              pages={totalPages}
              total={pagination.totalItems || 0}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={isLoading}
              label="prepayments"
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TenantPrepayments;

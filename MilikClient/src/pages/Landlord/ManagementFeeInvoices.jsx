import { LISTING_UI } from "../../utils/listingPageUtils";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { FaEnvelope, FaFileInvoiceDollar, FaPrint, FaSearch, FaRedoAlt, FaSms } from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { adminRequests } from "../../utils/requestMethods";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties } from "../../redux/selectors";
import { useEntityCache } from "../../hooks/useEntityCache";
import { getProperties } from "../../redux/propertyRedux";
import { hasCompanyPermission } from "../../utils/permissions";
import { useTabState } from "../../hooks/useTabState";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const ITEMS_PER_PAGE = 50;

const fmtMoney = (v) =>
  `KSh ${Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("en-GB") : "—");
const fmtPeriod = (s, e) => `${fmtDate(s)} – ${fmtDate(e)}`;

const MONTH_OPTIONS = [
  { v: "", l: "All Months" },
  { v: "01", l: "January" }, { v: "02", l: "February" }, { v: "03", l: "March" },
  { v: "04", l: "April" },   { v: "05", l: "May" },       { v: "06", l: "June" },
  { v: "07", l: "July" },    { v: "08", l: "August" },    { v: "09", l: "September" },
  { v: "10", l: "October" }, { v: "11", l: "November" },  { v: "12", l: "December" },
];

const thisYear = new Date().getFullYear();
const YEAR_OPTIONS = [
  { v: "", l: "All Years" },
  ...Array.from({ length: 5 }, (_, i) => ({ v: String(thisYear - i), l: String(thisYear - i) })),
];

const emptyFilters = { search: "", propertyId: "", month: "", year: String(thisYear) };

const ManagementFeeInvoices = () => {
  const dispatch = useDispatch();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const propertiesFromStore = useSelector(selectAllProperties);
  const { propertiesLoaded } = useEntityCache(currentCompany?._id);

  const businessId = useMemo(
    () => currentCompany?._id || currentUser?.company?._id || currentUser?.company || "",
    [currentCompany, currentUser]
  );

  const canEmail = hasCompanyPermission(currentUser || {}, currentCompany, "processedStatements", "read", "propertyManagement");

  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useTabState("/landlord/management-fee-invoices:filters", emptyFilters);
  const [currentPage, setCurrentPage] = useTabState("/landlord/management-fee-invoices:page", 1);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 1 });
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [commModal, setCommModal] = useState(null);
  const [printingId, setPrintingId] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!propertiesLoaded && businessId) dispatch(getProperties({ business: businessId }));
  }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDraftFilters(appliedFilters);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const propertyOptions = useMemo(() => {
    const opts = [{ v: "", l: "All Properties" }];
    (Array.isArray(propertiesFromStore) ? propertiesFromStore : [])
      .slice()
      .sort((a, b) => String(a.propertyName || "").localeCompare(String(b.propertyName || "")))
      .forEach((p) => opts.push({ v: String(p._id), l: p.propertyName || p.name || "" }));
    return opts;
  }, [propertiesFromStore]);

  const setFilter = (key) => (e) => setDraftFilters((prev) => ({ ...prev, [key]: e.target.value }));

  const applyFilters = useCallback(() => {
    setAppliedFilters(draftFilters);
    setCurrentPage(1);
  }, [draftFilters, setAppliedFilters, setCurrentPage]);

  const resetFilters = useCallback(() => {
    const next = emptyFilters;
    setDraftFilters(next);
    setAppliedFilters(next);
    setCurrentPage(1);
  }, [setAppliedFilters, setCurrentPage]);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          tab: "management_fees",
          page: String(currentPage),
          limit: String(ITEMS_PER_PAGE),
        });
        const search = String(appliedFilters.search || "").trim();
        if (search) params.set("search", search);
        if (appliedFilters.propertyId) params.set("propertyId", appliedFilters.propertyId);
        if (appliedFilters.month) params.set("month", appliedFilters.month);
        if (appliedFilters.year) params.set("year", appliedFilters.year);

        const res = await adminRequests.get(
          `/processed-statements/business/${businessId}?${params.toString()}`
        );
        if (cancelled) return;
        const data = res?.data || {};
        setRows(Array.isArray(data.statements) ? data.statements : []);
        setPagination({
          page: Number(data.page || data.pagination?.page || currentPage),
          limit: Number(data.limit || data.pagination?.limit || ITEMS_PER_PAGE),
          total: Number(data.total || data.pagination?.total || 0),
          pages: Number(data.pages || data.pagination?.pages || 1),
        });
        setSelectedIds([]);
      } catch (err) {
        if (!cancelled) {
          toast.error(String(err?.response?.data?.message || "Failed to load management fee invoices."));
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [businessId, currentPage, appliedFilters, refreshTick]);

  const handlePrintPdf = useCallback(async (statementId, invoiceNo) => {
    setPrintingId(statementId);
    try {
      const res = await adminRequests.get(
        `/processed-statements/${statementId}/management-fee-invoice-pdf`,
        { responseType: "blob" }
      );
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (win) win.focus();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      toast.error(String(err?.response?.data?.message || `Failed to generate PDF for ${invoiceNo || statementId}.`));
    } finally {
      setPrintingId(null);
    }
  }, []);

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.length === rows.length ? [] : rows.map((r) => String(r._id))
    );
  }, [rows]);

  const allSelected = rows.length > 0 && selectedIds.length === rows.length;

  return (
    <>
      <DashboardLayout lockContentScroll>
        <div className="flex h-full flex-col overflow-hidden">
          {/* Filter toolbar */}
          <div className="shrink-0 border-b border-slate-200 bg-white px-4 pt-3 pb-2 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h1 className="flex items-center gap-2 text-base font-bold text-[#0B3B2E]">
                <FaFileInvoiceDollar className="text-[#FF8C00]" />
                Management Fee Invoices
              </h1>
              {selectedIds.length > 0 && canEmail && (
                <button
                  onClick={() => setCommModal({ ids: selectedIds })}
                  className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs text-white ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
                >
                  <FaEnvelope size={11} />
                  Email Selected ({selectedIds.length})
                </button>
              )}
            </div>

            <div className={LISTING_UI.filterRow}>
              <input
                type="text"
                placeholder="Search landlord / invoice no..."
                value={draftFilters.search}
                onChange={setFilter("search")}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                className={`${LISTING_UI.filterInput} w-52`}
              />
              <select
                value={draftFilters.propertyId}
                onChange={setFilter("propertyId")}
                className={LISTING_UI.filterSelect}
              >
                {propertyOptions.map((o) => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </select>
              <select
                value={draftFilters.month}
                onChange={setFilter("month")}
                className={LISTING_UI.filterSelect}
              >
                {MONTH_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </select>
              <select
                value={draftFilters.year}
                onChange={setFilter("year")}
                className={LISTING_UI.filterSelect}
              >
                {YEAR_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </select>
              <button onClick={applyFilters} className={LISTING_UI.searchButton}>
                <FaSearch size={11} /> Search
              </button>
              <button onClick={resetFilters} className={LISTING_UI.resetButton}>
                <FaRedoAlt size={11} /> Reset
              </button>
              <span className="ml-auto text-xs text-slate-500">
                {pagination.total} invoice{pagination.total !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Table */}
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[900px] border-collapse text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="w-8 px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="accent-[#FF8C00]"
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">FEE INV #</th>
                  <th className="px-3 py-2 text-left font-semibold">STMT REF</th>
                  <th className="px-3 py-2 text-left font-semibold">LANDLORD</th>
                  <th className="px-3 py-2 text-left font-semibold">PROPERTY</th>
                  <th className="px-3 py-2 text-left font-semibold">PERIOD</th>
                  <th className="px-3 py-2 text-right font-semibold">COMMISSION</th>
                  <th className="px-3 py-2 text-right font-semibold">VAT</th>
                  <th className="px-3 py-2 text-right font-semibold">TOTAL</th>
                  <th className="px-3 py-2 text-center font-semibold">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-sm text-slate-400">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-sm text-slate-400">
                      No management fee invoices found.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => {
                    const id = String(row._id);
                    const isSelected = selectedIds.includes(id);
                    const commissionNet = Number(row.commissionAmount || 0);
                    const commissionTax = Number(row.commissionTaxAmount || 0);
                    const commissionGross = Number(row.commissionGrossAmount || commissionNet + commissionTax);
                    const landlordName =
                      String(row.landlord?.landlordName || "").trim() ||
                      `${row.landlord?.firstName || ""} ${row.landlord?.lastName || ""}`.trim() ||
                      "—";
                    const propertyName = row.property?.propertyName || row.property?.name || "—";
                    const invoiceNo = row.managementFeeInvoiceNumber || "—";
                    const stmtRef = row.sourceStatementNumber || "—";

                    return (
                      <tr
                        key={id}
                        onClick={() => toggleSelect(id)}
                        className={`cursor-pointer border-b border-gray-100 transition-colors ${
                          isSelected
                            ? "bg-emerald-50 shadow-[inset_4px_0_0_0_#0B3B2E]"
                            : idx % 2 === 0
                            ? "bg-white hover:bg-blue-50/40"
                            : "bg-slate-50/60 hover:bg-blue-50/40"
                        }`}
                      >
                        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(id)}
                            className="accent-[#FF8C00]"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono font-bold text-[#FF8C00]">{invoiceNo}</td>
                        <td className="px-3 py-2 text-slate-600">{stmtRef}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">{landlordName}</td>
                        <td className="px-3 py-2 text-slate-700">{propertyName}</td>
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                          {fmtPeriod(row.periodStart, row.periodEnd)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800">
                          {fmtMoney(commissionNet)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600">
                          {commissionTax > 0 ? fmtMoney(commissionTax) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-[#0B3B2E]">
                          {fmtMoney(commissionGross)}
                        </td>
                        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              title="Print PDF"
                              disabled={printingId === id}
                              onClick={() => handlePrintPdf(id, invoiceNo)}
                              className="rounded p-1.5 text-purple-600 hover:bg-purple-50 hover:text-purple-800 disabled:opacity-40"
                            >
                              <FaPrint size={12} />
                            </button>
                            {canEmail && (
                              <button
                                title="Send Email"
                                onClick={() => setCommModal({ ids: [id] })}
                                className="rounded p-1.5 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-900"
                              >
                                <FaEnvelope size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination — always visible */}
          <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
              <div className="font-semibold">
                Showing{" "}
                <span className="font-bold text-slate-900">
                  {pagination.total === 0 ? 0 : (pagination.page - 1) * ITEMS_PER_PAGE + 1}
                </span>{" "}
                to{" "}
                <span className="font-bold text-slate-900">
                  {Math.min(pagination.page * ITEMS_PER_PAGE, pagination.total)}
                </span>{" "}
                of{" "}
                <span className="font-bold text-slate-900">{pagination.total}</span>{" "}
                management fee invoices
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">Per page: {ITEMS_PER_PAGE}</span>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={pagination.page <= 1}
                  className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="font-semibold text-slate-700">
                  Page {pagination.page} of {Math.max(1, pagination.pages)}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, pagination.pages))}
                  disabled={pagination.page >= pagination.pages}
                  className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </DashboardLayout>

      {commModal && (
        <CommunicationComposerModal
          open={Boolean(commModal)}
          onClose={() => setCommModal(null)}
          onSent={() => {
            setCommModal(null);
            setRefreshTick((t) => t + 1);
          }}
          businessId={businessId}
          contextType="management_fee_invoice"
          recordIds={commModal.ids || []}
          defaultChannel="email"
          allowedChannels={["sms", "email"]}
          title="Send Management Fee Invoice"
        />
      )}
    </>
  );
};

export default ManagementFeeInvoices;

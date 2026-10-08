import { fmtDate } from "../../utils/dates";
import AppSelect from "../../components/common/AppSelect";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { FaEnvelope, FaPrint, FaSearch, FaRedoAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { adminRequests } from "../../utils/requestMethods";
import { printPdfBlob } from "../../utils/printKit";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties } from "../../redux/selectors";
import { useEntityCache } from "../../hooks/useEntityCache";
import { getProperties } from "../../redux/propertyRedux";
import { hasCompanyPermission } from "../../utils/permissions";
import { useTabState } from "../../hooks/useTabState";
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';
import ListToolbar from '../../components/common/ListToolbar';

const fmtMoney = (v) =>
  `KSh ${Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

const MONTH_SELECT_OPTIONS = MONTH_OPTIONS.map((o) => ({ value: o.v, label: o.l }));
const YEAR_SELECT_OPTIONS = YEAR_OPTIONS.map((o) => ({ value: o.v, label: o.l }));

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

  const canEmail = hasCompanyPermission(currentUser || {}, currentCompany, "processedStatements", "read", "accounts");

  const [pageSize, setPageSize] = useState(50);
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useTabState("/landlord/management-fee-invoices:filters", emptyFilters);
  const [currentPage, setCurrentPage] = useTabState("/landlord/management-fee-invoices:page", 1);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 1 });
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
    const opts = [{ value: "", label: "All Properties" }];
    (Array.isArray(propertiesFromStore) ? propertiesFromStore : [])
      .slice()
      .sort((a, b) => String(a.propertyName || "").localeCompare(String(b.propertyName || "")))
      .forEach((p) => opts.push({ value: String(p._id), label: p.propertyName || p.name || "" }));
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
          limit: String(pageSize),
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
          limit: Number(data.limit || data.pagination?.limit || pageSize),
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
  }, [businessId, currentPage, appliedFilters, refreshTick, pageSize]);

  const handlePrintPdf = useCallback(async (statementId, invoiceNo) => {
    setPrintingId(statementId);
    try {
      const res = await adminRequests.get(
        `/processed-statements/${statementId}/management-fee-invoice-pdf`,
        { responseType: "blob" }
      );
      await printPdfBlob(new Blob([res.data], { type: "application/pdf" }));
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
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
          <div className="mx-auto flex w-full max-w-full min-h-0 flex-1 flex-col gap-2">
            <ListToolbar>
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                {pagination.total} invoice{pagination.total !== 1 ? "s" : ""}
              </span>
              <ListToolbar.Divider />
              <ListToolbar.Input
                type="text"
                placeholder="Search landlord / invoice no..."
                value={draftFilters.search}
                onChange={setFilter("search")}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                width="w-40"
              />
              <AppSelect
                value={draftFilters.propertyId || null}
                onChange={(v) => setDraftFilters((prev) => ({ ...prev, propertyId: v ?? "" }))}
                options={propertyOptions}
                placeholder="All Properties"
                searchable
                clearable
                compact
              />
              <AppSelect
                value={draftFilters.month || null}
                onChange={(v) => setDraftFilters((prev) => ({ ...prev, month: v ?? "" }))}
                options={MONTH_SELECT_OPTIONS}
                placeholder="All Months"
                clearable
                compact
              />
              <AppSelect
                value={draftFilters.year || null}
                onChange={(v) => setDraftFilters((prev) => ({ ...prev, year: v ?? "" }))}
                options={YEAR_SELECT_OPTIONS}
                placeholder="All Years"
                clearable
                compact
              />
              <ListToolbar.Button icon={FaSearch} onClick={applyFilters}>Search</ListToolbar.Button>
              <ListToolbar.Button icon={FaRedoAlt} variant="outline" onClick={resetFilters}>Reset</ListToolbar.Button>
              {canEmail && (
                <>
                  <ListToolbar.Divider />
                  <ListToolbar.Button
                    icon={FaEnvelope}
                    variant="outline"
                    disabled={selectedIds.length === 0}
                    onClick={() => setCommModal({ ids: selectedIds })}
                  >
                    Email Selected{selectedIds.length ? ` (${selectedIds.length})` : ""}
                  </ListToolbar.Button>
                </>
              )}
            </ListToolbar>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
              <MilikTable
                columns={[
                  { label: "Fee Inv #" },
                  { label: "Stmt Ref" },
                  { label: "Landlord" },
                  { label: "Property" },
                  { label: "Period" },
                  { label: "Commission", align: "right" },
                  { label: "VAT", align: "right" },
                  { label: "Total", align: "right" },
                ]}
                rows={rows}
                rowKey="_id"
                loading={loading && rows.length === 0}
                empty="No management fee invoices found."
                minWidth="900px"
                checkboxes
                allChecked={allSelected}
                someChecked={selectedIds.length > 0 && !allSelected}
                onCheckAll={toggleSelectAll}
                isChecked={(row) => selectedIds.includes(String(row._id))}
                isSelected={(row) => selectedIds.includes(String(row._id))}
                onCheckRow={(row) => toggleSelect(String(row._id))}
                onRowClick={(row) => toggleSelect(String(row._id))}
                renderRow={(row) => {
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
                    <>
                      <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-bold text-slate-900 whitespace-nowrap">{invoiceNo}</td>
                      <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600 whitespace-nowrap">{stmtRef}</td>
                      <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900">{landlordName}</td>
                      <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700">{propertyName}</td>
                      <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600 whitespace-nowrap">
                        {fmtPeriod(row.periodStart, row.periodEnd)}
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-100 text-right font-semibold text-slate-800">
                        {fmtMoney(commissionNet)}
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-100 text-right text-slate-600">
                        {commissionTax > 0 ? fmtMoney(commissionTax) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right font-bold text-slate-900">
                        {fmtMoney(commissionGross)}
                      </td>
                    </>
                  );
                }}
                renderActions={(row) => {
                  const id = String(row._id);
                  const invoiceNo = row.managementFeeInvoiceNumber || "—";
                  return (
                    <div className="inline-flex items-center justify-end gap-1.5">
                      <button
                        title="Print PDF"
                        disabled={printingId === id}
                        onClick={(e) => { e.stopPropagation(); handlePrintPdf(id, invoiceNo); }}
                        className="inline-flex h-6 items-center gap-1 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <FaPrint size={10} /> Print
                      </button>
                      {canEmail && (
                        <button
                          title="Send Email"
                          onClick={(e) => { e.stopPropagation(); setCommModal({ ids: [id] }); }}
                          className="inline-flex h-6 items-center gap-1 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                        >
                          <FaEnvelope size={10} /> Email
                        </button>
                      )}
                    </div>
                  );
                }}
              />
            </div>

            <PaginationBar
              page={pagination.page}
              pages={pagination.pages}
              total={pagination.total}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={loading}
              label="invoices"
            />
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

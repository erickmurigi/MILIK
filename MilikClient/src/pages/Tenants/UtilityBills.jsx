import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useEntityCache } from "../../hooks/useEntityCache";
import PaginationBar from '../../components/PaginationBar';
import AppSelect from "../../components/common/AppSelect";
import { useTerms } from "../../hooks/useTerm";
import {
  selectCurrentCompany,
  selectAllTenants,
  selectAllUnits,
  selectAllProperties,
} from "../../redux/selectors";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaArrowRight,
  FaEnvelope,
  FaEye,
  FaMoneyBillWave,
  FaPrint,
  FaRedoAlt,
  FaSms,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import ListToolbar from "../../components/common/ListToolbar";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { getTenants } from "../../redux/tenantsRedux";
import { getUnits } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import { getTenantInvoices, getTenantInvoiceNotes } from "../../redux/invoiceApi";
import { useTabState } from "../../hooks/useTabState";
import { printTabularList } from "../../utils/printKit";
import { safeId } from "../../utils/idUtils";
import MilikTable from "../../components/common/MilikTable";
import { buildInvoiceNarration } from "../../utils/invoiceNarrationUtils";
import { INV_STATUS_BADGE, INV_STATUS_BADGE_DEFAULT, fmtAmountKE } from "../../utils/invoiceStatus";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";

const STATUS_FILTERS = [
  { val: "ACTIVE", label: "All" },
  { val: "Unpaid", label: "Unpaid" },
  { val: "Partially Paid", label: "Partially Paid" },
  { val: "Paid", label: "Paid" },
];

const emptyFilters = {
  status: "ACTIVE",
  invoiceNo: "",
  tenantName: "",
  propertyId: "any",
  unitId: "any",
  utilityType: "any",
  fromDate: "",
  toDate: "",
};

const formatCurrency = (value = 0) => `KES ${Number(value || 0).toLocaleString()}`;

const formatDateDisplay = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const normalizeStatus = (value = "") => String(value || "").trim().toLowerCase();

// Sort helpers. monthKey() buckets a date into year*12+month for the primary
// "newest month first" ordering (all September rows before all August rows);
// tsValue() is the raw timestamp for the within-unit "newest bill first" tiebreak.
// Missing/unparsable dates get the smallest possible value so they sort LAST under
// the descending comparisons below.
const monthKey = (value) => {
  if (!value) return -Infinity;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? -Infinity : d.getFullYear() * 12 + d.getMonth();
};
const tsValue = (value) => {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
};

const mapStatusLabel = ({ rawStatus = "", outstanding = 0, appliedAmount = 0 }) => {
  const s = normalizeStatus(rawStatus);
  if (s === "paid") return "Paid";
  if (s === "partially_paid") return "Partially Paid";
  if (s === "cancelled") return "Cancelled";
  if (s === "reversed") return "Reversed";
  if (outstanding <= 0) return "Paid";
  return appliedAmount > 0 ? "Partially Paid" : "Unpaid";
};


const resolveUtilityTypeLabel = (record) => {
  const meta = record?.metadata && typeof record.metadata === "object" ? record.metadata : {};
  if (meta.billItemLabel) return meta.billItemLabel;
  if (Array.isArray(meta.utilityBreakdown) && meta.utilityBreakdown.length > 0) {
    return meta.utilityBreakdown.map((u) => u?.label || u?.utilityType || u?.name).filter(Boolean).join(" + ");
  }
  const utilType = meta.statementUtilityType || meta.meterUtilityType || meta.utilityType || record.utilityType;
  if (utilType) return String(utilType);
  return buildInvoiceNarration(record) || "Utility";
};

const UtilityBills = () => {
  const [pageSize, setPageSize] = useState(50);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { tenant: termTenant, unit: termUnit, property: termProperty } = useTerms("tenant", "unit", "property");
  const currentCompany = useSelector(selectCurrentCompany);
  const tenants = useSelector(selectAllTenants);
  const units = useSelector(selectAllUnits);
  const properties = useSelector(selectAllProperties);
  const { propertiesLoaded, unitsLoaded, tenantsLoaded } = useEntityCache(currentCompany?._id);

  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  // A single live filter state — every field (text, dropdown, date, status) takes effect
  // immediately on change. Previously this was split into draftFilters/appliedFilters with
  // a "Search" button required to commit the draft, but every field except the status
  // quick-buttons wrote only to the draft — so picking a property, unit, utility type, or
  // date range appeared to do nothing until Search was clicked, which read as "the filter
  // doesn't work." One live state removes that trap entirely.
  const [filters, setFilters] = useState(emptyFilters);
  const [selectedRows, setSelectedRows] = useState([]);
  const selectedRowsSet = useMemo(() => new Set(selectedRows), [selectedRows]);
  const [selectAll, setSelectAll] = useState(false);
  const [communicationModal, setCommunicationModal] = useState(null);
  const [currentPage, setCurrentPage] = useTabState("/invoices/utility-bills:currentPage", 1);

  const tenantLookup = useMemo(() => new Map((tenants || []).map((t) => [safeId(t), t])), [tenants]);
  const unitLookup = useMemo(() => new Map((units || []).map((u) => [safeId(u), u])), [units]);
  const propertyLookup = useMemo(() => new Map((properties || []).map((p) => [safeId(p), p])), [properties]);

  // useCallback: prevents a new function identity on every render so filter inputs don't re-render
  const setFilter = useCallback(
    (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value })),
    []
  );

  const loadData = useCallback(async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const [utilityInvoices, allNotes] = await Promise.all([
        getTenantInvoices({ business: currentCompany._id, category: "UTILITY_CHARGE", includeSnapshots: true }),
        getTenantInvoiceNotes({ business: currentCompany._id }),
      ]);

      // Include every utility-related credit/debit note alongside utility invoices — any
      // note posted with category UTILITY_CHARGE (garbage, water, electricity, etc, however
      // the bill item is tagged via metadata.billItemKey), plus the "service_charge" bill
      // item which historically posts under a different category but has always been
      // shown here too.
      const utilityNotes = (Array.isArray(allNotes) ? allNotes : [])
        .filter((note) => {
          const category = String(note?.category || "").toUpperCase();
          const key = String(note?.metadata?.billItemKey || "").trim();
          const status = String(note?.status || "").toLowerCase();
          if (status === "reversed" || status === "cancelled") return false;
          return category === "UTILITY_CHARGE" || key === "service_charge";
        })
        .map((note) => ({
          ...note,
          _isNote: true,
          invoiceNumber: note.noteNumber || note.invoiceNumber,
        }));

      // getTenantInvoices(..., includeSnapshots: true) separately re-surfaces standalone
      // outstanding debit notes as synthetic pseudo-invoice entries (tagged noteType:
      // "DEBIT_NOTE" — see getTenantInvoicesList's "Append outstanding debit notes as
      // separate selectable items" block; plain TenantInvoice records never carry a
      // noteType field). That's needed elsewhere (e.g. Add Receipt) but here it means the
      // SAME TenantInvoiceNote document (like a standalone garbage debit note) lands in
      // this array a second time on top of utilityNotes above. Strip those synthetic
      // entries out so every note is represented exactly once, sourced only from
      // getTenantInvoiceNotes.
      const dedupedUtilityInvoices = (Array.isArray(utilityInvoices) ? utilityInvoices : [])
        .filter((invoice) => !invoice?.noteType);

      setInvoices([...dedupedUtilityInvoices, ...utilityNotes]);
    } catch (err) {
      console.error("Failed to load utility bills:", err);
      toast.error("Failed to load utility bills.");
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id]);

  useEffect(() => {
    if (!currentCompany?._id) return;
    if (!tenantsLoaded) dispatch(getTenants({ business: currentCompany._id }));
    if (!unitsLoaded) dispatch(getUnits({ business: currentCompany._id }));
    if (!propertiesLoaded) dispatch(getProperties({ business: currentCompany._id }));
    loadData();
  }, [currentCompany?._id, loadData, dispatch]);

  useEffect(() => {
    const refresh = () => loadData();
    window.addEventListener("invoicesUpdated", refresh);
    return () => window.removeEventListener("invoicesUpdated", refresh);
  }, [loadData]);

  const rows = useMemo(() => {
    return invoices.map((invoice, index) => {
      const tenantId = safeId(invoice?.tenant);
      const tenant = tenantLookup.get(tenantId) || (typeof invoice?.tenant === "object" ? invoice.tenant : {});
      const unitId = safeId(invoice?.unit) || safeId(tenant?.unit);
      const unit = unitLookup.get(unitId) || (typeof invoice?.unit === "object" ? invoice.unit : {});
      const propertyId = safeId(invoice?.property) || safeId(tenant?.property) || safeId(unit?.property);
      const property = propertyLookup.get(propertyId) || (typeof invoice?.property === "object" ? invoice.property : {});
      const amount = Number(invoice?.adjustedAmount ?? invoice?.amount ?? 0);
      const appliedAmount = Math.max(0, Number(invoice?.appliedAmount ?? invoice?.amountPaid ?? 0));
      const outstanding = Math.max(0, Number(invoice?.outstanding ?? Math.max(0, amount - appliedAmount)));
      const rawStatus = invoice?.computedStatus || invoice?.status || "";
      const status = mapStatusLabel({ rawStatus, outstanding, appliedAmount });
      const invoiceDate = invoice?.bookingDate || invoice?.invoiceDate || invoice?.noteDate || invoice?.createdAt || null;

      return {
        key: safeId(invoice) || `util-${index}`,
        id: invoice?.invoiceNumber || invoice?.noteNumber || safeId(invoice) || "-",
        invoiceId: safeId(invoice),
        tenantId,
        tenantName: invoice?.tenant?.name || tenant?.name || [tenant?.firstName, tenant?.lastName].filter(Boolean).join(" ") || "Unnamed",
        propertyId,
        propertyName: invoice?.property?.propertyName || property?.propertyName || property?.name || "-",
        unitId,
        unitName: invoice?.unit?.unitNumber || unit?.unitNumber || unit?.name || "-",
        utilityTypeLabel: resolveUtilityTypeLabel(invoice),
        amount,
        appliedAmount,
        outstanding,
        status,
        rawStatus: normalizeStatus(rawStatus),
        invoiceDate,
        invoiceDateLabel: formatDateDisplay(invoiceDate),
        dueDateLabel: formatDateDisplay(invoice?.dueDate),
        createdDate: formatDateDisplay(invoice?.createdAt || invoiceDate),
      };
    }).sort((a, b) => {
      // 1. Newest month first — every September bill before every August bill, matching
      //    how the Rental Invoices page orders by period.
      const mk = monthKey(b.invoiceDate) - monthKey(a.invoiceDate);
      if (mk) return mk;
      // 2. Within a month, units in ascending natural order (K1, K2, S1, S2, … S10).
      const unitCmp = String(a.unitName || "").localeCompare(
        String(b.unitName || ""), undefined, { numeric: true, sensitivity: "base" }
      );
      if (unitCmp) return unitCmp;
      // 3. Within a unit, newest bill first.
      const td = tsValue(b.invoiceDate) - tsValue(a.invoiceDate);
      if (td) return td;
      // 4-5. Deterministic tiebreak so identical (month, unit, date) rows never fall
      //      back to incoming array order.
      return String(a.id || "").localeCompare(String(b.id || ""), undefined, { numeric: true, sensitivity: "base" })
        || String(a.key || "").localeCompare(String(b.key || ""));
    });
  }, [invoices, tenantLookup, unitLookup, propertyLookup]);

  const utilityTypeOptions = useMemo(
    () => [...new Set(rows.map((r) => r.utilityTypeLabel).filter(Boolean))].sort().map((t) => ({ value: t, label: t })),
    [rows]
  );

  const activePropertyOptions = useMemo(
    () => (properties || []).map((p) => ({ value: safeId(p), label: p?.propertyName || p?.name || "-" })),
    [properties]
  );

  const unitFilterOptions = useMemo(() => {
    const scoped = filters.propertyId !== "any"
      ? (units || []).filter((u) => safeId(u?.property) === String(filters.propertyId))
      : units || [];
    return scoped.map((u) => ({ value: safeId(u), label: u?.unitNumber || u?.name || "-" }));
  }, [units, filters.propertyId]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const { status, invoiceNo, tenantName, propertyId, unitId, utilityType, fromDate, toDate } = filters;
      if (status === "ACTIVE" && ["cancelled", "reversed"].includes(row.rawStatus)) return false;
      if (status === "Unpaid" && !["Unpaid", "Partially Paid"].includes(row.status)) return false;
      if (status === "Partially Paid" && row.status !== "Partially Paid") return false;
      if (status === "Paid" && row.status !== "Paid") return false;
      if (invoiceNo && !row.id.toLowerCase().includes(invoiceNo.toLowerCase())) return false;
      if (tenantName && !row.tenantName.toLowerCase().includes(tenantName.toLowerCase())) return false;
      if (propertyId !== "any" && String(row.propertyId) !== String(propertyId)) return false;
      if (unitId !== "any" && String(row.unitId) !== String(unitId)) return false;
      if (utilityType !== "any" && row.utilityTypeLabel !== utilityType) return false;
      const t = row.invoiceDate ? new Date(row.invoiceDate).getTime() : 0;
      if (fromDate && t < new Date(`${fromDate}T00:00:00`).getTime()) return false;
      if (toDate && t > new Date(`${toDate}T23:59:59`).getTime()) return false;
      return true;
    });
  }, [filters, rows]);

  const totals = useMemo(
    () => filteredRows.reduce(
      (acc, r) => ({ count: acc.count + 1, amount: acc.amount + r.amount, paid: acc.paid + r.appliedAmount, outstanding: acc.outstanding + r.outstanding }),
      { count: 0, amount: 0, paid: 0, outstanding: 0 }
    ),
    [filteredRows]
  );

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  // useMemo: stable array identity so the selectAll useEffect only fires when page content truly changes
  const currentPageRows = useMemo(
    () => filteredRows.slice(startIndex, startIndex + pageSize),
    [filteredRows, startIndex, pageSize]
  );
  const selectedCount = selectedRows.length;

  useEffect(() => { setCurrentPage(1); setSelectedRows([]); setSelectAll(false); }, [filters]);
  useEffect(() => { if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage); }, [currentPage, safeCurrentPage]);
  useEffect(() => {
    const keys = currentPageRows.map((r) => r.key);
    setSelectAll(keys.length > 0 && keys.every((k) => selectedRowsSet.has(k)));
  }, [currentPageRows, selectedRows]);

  // useCallback: stable references prevent re-renders of table rows and toolbar buttons
  const toggleRow = useCallback(
    (key) => setSelectedRows((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]),
    []
  );
  const toggleAll = useCallback(() => {
    const keys = currentPageRows.map((r) => r.key);
    if (selectAll) setSelectedRows((prev) => prev.filter((k) => !keys.includes(k)));
    else setSelectedRows((prev) => [...new Set([...prev, ...keys])]);
  }, [currentPageRows, selectAll]);

  const resetFilters = useCallback(() => setFilters(emptyFilters), []);

  // Reuses the exact print pattern from MeterReadings.jsx's "Register" print (buildRegisterPrintHtml
  // / handlePrintList): flat table (no grouping), a <tfoot> total row instead of a
  // grand-total row buried inside <tbody> — a <tfoot> prints once, right after the last
  // data row, never repeated at the bottom of every page — with the same header/summary-bar
  // styling. Prints exactly what's currently filtered on screen.
  const handlePrint = useCallback(() => {
    if (filteredRows.length === 0) {
      toast.info("There are no utility bills to print.");
      return;
    }
    const dash = (v) => (Number(v || 0) === 0 ? "—" : formatCurrency(v));
    const printed = printTabularList({
      title: "Utility Bills",
      subtitle: `${filteredRows.length.toLocaleString()} bill${filteredRows.length !== 1 ? "s" : ""}`,
      company: currentCompany,
      summaryItems: [
        ["Total Records", filteredRows.length.toLocaleString()],
        ["Total Amount", formatCurrency(totals.amount)],
        ["Paid", formatCurrency(totals.paid)],
        ["Outstanding", formatCurrency(totals.outstanding)],
      ],
      columns: [
        { label: "Invoice #", value: (row) => row.id, bold: true },
        { label: termTenant, value: (row) => row.tenantName },
        { label: termProperty, value: (row) => row.propertyName },
        { label: termUnit, value: (row) => row.unitName },
        { label: "Utility Type", value: (row) => row.utilityTypeLabel },
        { label: "Invoice Date", value: (row) => row.invoiceDateLabel },
        { label: "Due Date", value: (row) => row.dueDateLabel },
        { label: "Amount", align: "right", bold: true, value: (row) => formatCurrency(row.amount) },
        { label: "Paid", align: "right", tone: (row) => (row.appliedAmount > 0.005 ? "pos" : "muted"), value: (row) => dash(row.appliedAmount) },
        { label: "Balance", align: "right", tone: (row) => (row.outstanding > 0.005 ? "neg" : "muted"), value: (row) => dash(row.outstanding) },
        { label: "Status", value: (row) => row.status },
      ],
      rows: filteredRows,
      totalsRow: [`Total (${filteredRows.length.toLocaleString()} records)`, "", "", "", "", "", "", formatCurrency(totals.amount), formatCurrency(totals.paid), formatCurrency(totals.outstanding), ""],
    });
    if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
  }, [filteredRows, totals, currentCompany, termTenant, termUnit, termProperty]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="h-[calc(100dvh-152px)] max-h-[calc(100dvh-152px)] overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-1 sm:p-2">
        <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">

            {/* FILTER BAR */}
            <ListToolbar>
              <span className="shrink-0 border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-bold text-blue-700">Bills: {totals.count}</span>
              <span className="shrink-0 border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700">O/S: {formatCurrency(totals.outstanding)}</span>
              {selectedCount > 0 && <span className="shrink-0 border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-800">{selectedCount} selected</span>}
              <ListToolbar.Divider />
              {STATUS_FILTERS.map(({ val, label }) => (
                <ListToolbar.Button
                  key={val}
                  variant={filters.status === val ? "primary" : "outline"}
                  onClick={() => setFilters((prev) => ({ ...prev, status: val }))}
                >{label}</ListToolbar.Button>
              ))}
              <ListToolbar.Divider />
              <ListToolbar.Input width="w-20" type="text" value={filters.invoiceNo} onChange={(e) => setFilters((prev) => ({ ...prev, invoiceNo: e.target.value.toUpperCase() }))} placeholder="Invoice #" />
              <ListToolbar.Input width="w-20" type="text" value={filters.tenantName} onChange={setFilter("tenantName")} placeholder={termTenant} />
              <AppSelect compact clearable searchable placeholder={termProperty} value={filters.propertyId} onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? "any", unitId: "any" }))} options={activePropertyOptions} />
              <AppSelect compact clearable placeholder={termUnit} value={filters.unitId} onChange={(v) => setFilters((prev) => ({ ...prev, unitId: v ?? "any" }))} options={unitFilterOptions} />
              <AppSelect compact clearable placeholder="Utility Type" value={filters.utilityType} onChange={(v) => setFilters((prev) => ({ ...prev, utilityType: v ?? "any" }))} options={utilityTypeOptions} />
              <ListToolbar.Input width="w-[5.5rem]" type="date" value={filters.fromDate} onChange={setFilter("fromDate")} />
              <ListToolbar.Input width="w-[5.5rem]" type="date" value={filters.toDate} onChange={setFilter("toDate")} />
              <ListToolbar.Button icon={FaRedoAlt} onClick={resetFilters}>Reset</ListToolbar.Button>
              <ListToolbar.Button icon={FaRedoAlt} variant="outline" onClick={loadData} disabled={loading}>Refresh</ListToolbar.Button>
              <ListToolbar.Button icon={FaPrint} variant="outline" onClick={handlePrint} disabled={filteredRows.length === 0}>Print</ListToolbar.Button>
              <ListToolbar.Button
                className="!bg-teal-600 hover:!bg-teal-700"
                onClick={() => setCommunicationModal({ contextType: "invoice", recordIds: selectedRows, title: `SMS ${selectedCount} Tenant${selectedCount !== 1 ? "s" : ""}`, allowedChannels: ["sms"], defaultChannel: "sms" })}
                disabled={selectedCount === 0}
              ><FaSms size={7} /> SMS</ListToolbar.Button>
              <ListToolbar.Button
                onClick={() => setCommunicationModal({ contextType: "invoice", recordIds: selectedRows, title: `Email ${selectedCount} Tenant${selectedCount !== 1 ? "s" : ""}`, allowedChannels: ["email"], defaultChannel: "email" })}
                disabled={selectedCount === 0}
              ><FaEnvelope size={7} /> Email</ListToolbar.Button>
            </ListToolbar>

            {/* TABLE */}
            <MilikTable
              columns={[
                { label: "Invoice #" },
                { label: termTenant },
                { label: termProperty },
                { label: termUnit },
                { label: "Utility Type" },
                { label: "Invoice Date", align: "center" },
                { label: "Due Date", align: "center" },
                { label: "Amount", align: "right" },
                { label: "Paid", align: "right" },
                { label: "Balance", align: "right" },
                { label: "Status", align: "center" },
              ]}
              rows={currentPageRows}
              rowKey="key"
              loading={loading && currentPageRows.length === 0}
              empty="No utility bills found. Utility invoices and service charges will appear here."
              minWidth={1380}
              checkboxes
              allChecked={currentPageRows.length > 0 && selectAll}
              someChecked={selectedRows.length > 0 && !selectAll}
              onCheckAll={toggleAll}
              isChecked={(row) => selectedRowsSet.has(row.key)}
              onCheckRow={(row) => toggleRow(row.key)}
              onRowClick={(row) => toggleRow(row.key)}
              isSelected={(row) => selectedRowsSet.has(row.key)}
              renderRow={(row) => (
                <>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-bold text-blue-700">{row.id}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-bold text-slate-900">{row.tenantName}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900">{row.propertyName}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900">{row.unitName}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100">
                    <span className="rounded bg-sky-50 px-1.5 py-px text-[10px] font-semibold text-sky-700">{row.utilityTypeLabel}</span>
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-center text-slate-600">{row.invoiceDateLabel}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-center text-slate-600">{row.dueDateLabel}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-semibold text-slate-900 tabular-nums">{fmtAmountKE(row.amount)}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-semibold tabular-nums">
                    {row.appliedAmount > 0.005 ? <span className="text-emerald-700">{fmtAmountKE(row.appliedAmount)}</span> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-bold tabular-nums">
                    {row.outstanding > 0.005 ? <span className="text-red-600">{fmtAmountKE(row.outstanding)}</span> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-center">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${INV_STATUS_BADGE[row.status] || INV_STATUS_BADGE_DEFAULT}`}>{row.status}</span>
                  </td>
                </>
              )}
              renderActions={(row) => (
                <>
                  <button onClick={() => navigate(`/tenant/${row.tenantId}/statement`)} className="rounded p-1 text-slate-500 hover:bg-slate-50 hover:text-slate-700" title="View Statement"><FaEye size={12} /></button>
                  {row.tenantId && (
                    <button onClick={() => navigate(`/receipts/new?tenantId=${row.tenantId}&invoiceId=${row.invoiceId}`)} className="rounded p-1 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800" title="Create Receipt"><FaMoneyBillWave size={12} /></button>
                  )}
                  <button onClick={() => navigate(`/tenant/${row.tenantId}/statement`)} className="rounded p-1 text-slate-400 hover:bg-slate-50" title="Open Statement"><FaArrowRight size={12} /></button>
                </>
              )}
            />

            <PaginationBar
              page={safeCurrentPage}
              pages={totalPages}
              total={filteredRows.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={loading}
              label="bills"
            />

          </div>
        </div>
      </div>

      {communicationModal && (
        <CommunicationComposerModal
          open={Boolean(communicationModal)}
          onClose={() => setCommunicationModal(null)}
          contextType={communicationModal.contextType}
          recordIds={communicationModal.recordIds}
          title={communicationModal.title}
          subtitle={communicationModal.subtitle}
          allowedChannels={communicationModal.allowedChannels}
          defaultChannel={communicationModal.defaultChannel}
        />
      )}
    </DashboardLayout>
  );
};

export default UtilityBills;

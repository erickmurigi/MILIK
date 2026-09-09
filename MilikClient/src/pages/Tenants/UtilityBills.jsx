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
  FaSearch,
  FaSms,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { getTenants } from "../../redux/tenantsRedux";
import { getUnits } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import { getTenantInvoices, getTenantInvoiceNotes } from "../../redux/invoiceApi";
import { useTabState } from "../../hooks/useTabState";
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
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
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
    (key) => (e) => setDraftFilters((prev) => ({ ...prev, [key]: e.target.value })),
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

      // Include service charge debit notes alongside utility invoices
      const serviceChargeNotes = (Array.isArray(allNotes) ? allNotes : [])
        .filter((note) => {
          const key = String(note?.metadata?.billItemKey || "").trim();
          const status = String(note?.status || "").toLowerCase();
          return key === "service_charge" && status !== "reversed" && status !== "cancelled";
        })
        .map((note) => ({
          ...note,
          _isNote: true,
          invoiceNumber: note.noteNumber || note.invoiceNumber,
        }));

      setInvoices([...(Array.isArray(utilityInvoices) ? utilityInvoices : []), ...serviceChargeNotes]);
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
    }).sort((a, b) => new Date(b.invoiceDate || 0) - new Date(a.invoiceDate || 0));
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
    const scoped = appliedFilters.propertyId !== "any"
      ? (units || []).filter((u) => safeId(u?.property) === String(appliedFilters.propertyId))
      : units || [];
    return scoped.map((u) => ({ value: safeId(u), label: u?.unitNumber || u?.name || "-" }));
  }, [units, appliedFilters.propertyId]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const { status, invoiceNo, tenantName, propertyId, unitId, utilityType, fromDate, toDate } = appliedFilters;
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
  }, [appliedFilters, rows]);

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

  useEffect(() => { setCurrentPage(1); setSelectedRows([]); setSelectAll(false); }, [appliedFilters]);
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

  const applySearch = useCallback(() => setAppliedFilters({ ...draftFilters }), [draftFilters]);
  const resetFilters = useCallback(() => { setDraftFilters(emptyFilters); setAppliedFilters(emptyFilters); }, []);

  // Reuses the print pattern from PaidBalanceReport.jsx: build a self-contained HTML
  // document (own header/company block/table styling) in a new window and trigger the
  // browser's print dialog — prints exactly what's currently filtered on screen, grouped
  // by property, with a grand-total row.
  const handlePrint = useCallback(() => {
    const GRN = "#0B3B2E";
    const allRows = filteredRows;
    const companyName = currentCompany?.name || currentCompany?.companyName || currentCompany?.businessName || "Milik";
    const co = {
      name: companyName,
      logo: currentCompany?.logo || "",
      phone: currentCompany?.phone || currentCompany?.phoneNo || currentCompany?.phoneNumber || "",
      email: currentCompany?.email || currentCompany?.companyEmail || "",
      address: [currentCompany?.address || currentCompany?.postalAddress || "", currentCompany?.town || currentCompany?.city || ""].filter(Boolean).join(", "),
    };
    const infoLine = [co.address, co.phone, co.email].filter(Boolean).join(" · ");
    const dateRange = [appliedFilters.fromDate && formatDateDisplay(appliedFilters.fromDate), appliedFilters.toDate && formatDateDisplay(appliedFilters.toDate)].filter(Boolean).join(" – ");

    const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const mon = (v) => esc(formatCurrency(v));
    const dash = (v) => Number(v || 0) === 0 ? "—" : mon(v);
    const statusColor = (s) => s === "Unpaid" ? "#dc2626" : s === "Partially Paid" ? "#d97706" : s === "Paid" ? "#059669" : "#64748b";

    const groups = (() => {
      const map = new Map();
      for (const row of allRows) {
        const key = String(row.propertyId || row.propertyName || "Unknown");
        if (!map.has(key)) map.set(key, { name: row.propertyName || "Unknown Property", rows: [] });
        map.get(key).rows.push(row);
      }
      return [...map.values()];
    })();

    let rowsHtml = "";
    let grandAmount = 0, grandPaid = 0, grandBalance = 0;

    groups.forEach((group) => {
      const gr = group.rows;
      const gAmount = gr.reduce((s, r) => s + r.amount, 0);
      const gPaid = gr.reduce((s, r) => s + r.appliedAmount, 0);
      const gBalance = gr.reduce((s, r) => s + r.outstanding, 0);
      grandAmount += gAmount; grandPaid += gPaid; grandBalance += gBalance;

      rowsHtml += `<tr class="prop-hdr">
        <td colspan="5"><span class="prop-name">${esc(group.name)}</span> <span class="prop-meta">${gr.length} bill${gr.length !== 1 ? "s" : ""}</span></td>
        <td style="text-align:right">${mon(gAmount)}</td>
        <td style="text-align:right;color:#059669;font-weight:700">${dash(gPaid)}</td>
        <td style="text-align:right;${gBalance > 0 ? "color:#dc2626;font-weight:700" : "color:#94a3b8"}">${dash(gBalance)}</td>
        <td></td>
      </tr>`;

      gr.forEach((row, i) => {
        rowsHtml += `<tr class="${i % 2 === 1 ? "alt" : ""}">
          <td>${esc(row.id)}</td>
          <td>${esc(row.tenantName)}</td>
          <td>${esc(row.unitName)}</td>
          <td>${esc(row.utilityTypeLabel)}</td>
          <td>${esc(row.invoiceDateLabel)}</td>
          <td style="text-align:right">${mon(row.amount)}</td>
          <td style="text-align:right;${row.appliedAmount > 0.005 ? "color:#059669;font-weight:600" : "color:#cbd5e1"}">${dash(row.appliedAmount)}</td>
          <td style="text-align:right;${row.outstanding > 0.005 ? "color:#dc2626;font-weight:700" : "color:#cbd5e1"}">${dash(row.outstanding)}</td>
          <td style="color:${statusColor(row.status)};font-weight:700">${esc(row.status)}</td>
        </tr>`;
      });
    });

    rowsHtml += `<tr class="grand-total">
      <td>GRAND TOTAL</td>
      <td colspan="4" style="color:rgba(255,255,255,.6)">${allRows.length} bill${allRows.length !== 1 ? "s" : ""}</td>
      <td style="text-align:right">${mon(grandAmount)}</td>
      <td style="text-align:right">${mon(grandPaid)}</td>
      <td style="text-align:right">${mon(grandBalance)}</td>
      <td></td>
    </tr>`;

    const css = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; background: #fff; padding: 22px 26px; font-size: 11px; }
      .hdr { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding-bottom: 14px; gap: 16px; }
      .hdr-center { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
      .logo-fallback { width: 52px; height: 52px; background: ${GRN}; color: #fff; font-size: 20px; font-weight: 900; display: flex; align-items: center; justify-content: center; border-radius: 8px; }
      .logo-img { max-height: 52px; max-width: 140px; object-fit: contain; border-radius: 6px; }
      .co-name { font-size: 16px; font-weight: 900; color: #0f172a; margin-top: 5px; }
      .co-sub { font-size: 9px; color: #64748b; }
      .rpt-title { font-size: 13px; font-weight: 800; color: #1e293b; margin-top: 5px; }
      .rpt-sub { font-size: 10px; color: #475569; margin-top: 2px; }
      .hdr-right { text-align: right; align-self: flex-start; }
      .print-date { font-size: 9px; color: #64748b; line-height: 1.7; }
      .divider { height: 2px; background: ${GRN}; margin: 12px 0; }
      .summary-bar { display: flex; flex-wrap: wrap; gap: 6px 20px; font-size: 10px; color: #334155; background: #f8fafc; border-left: 3px solid ${GRN}; padding: 7px 10px; margin-bottom: 12px; border-radius: 0 4px 4px 0; }
      table { width: 100%; border-collapse: collapse; font-size: 10px; }
      thead tr { background: ${GRN}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      thead th { color: #fff; padding: 7px 8px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; border-right: 1px solid rgba(255,255,255,.15); white-space: nowrap; }
      tbody td { padding: 6px 8px; border: 1px solid #e2e8f0; vertical-align: middle; white-space: nowrap; }
      tbody tr.alt td { background: #f8fafc; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      tr.prop-hdr td { background: #f0faf5; border-top: 2px solid ${GRN}; border-bottom: 1px solid #b7c9c0; padding: 6px 8px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .prop-name { font-weight: 900; color: ${GRN}; text-transform: uppercase; letter-spacing: .06em; font-size: 9px; }
      .prop-meta { font-size: 8.5px; color: #64748b; margin-left: 8px; }
      tr.grand-total td { background: ${GRN}; color: #fff; font-weight: 700; font-size: 10px; padding: 7px 8px; border: 1px solid rgba(255,255,255,.15); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @media print { body { padding: 10px 12px; } @page { size: A4 landscape; margin: 8mm; } }
    `;

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>Utility Bills</title><style>${css}</style></head>
<body>
<div class="hdr">
  <div></div>
  <div class="hdr-center">
    ${co.logo ? `<img src="${esc(co.logo)}" class="logo-img" alt="logo"/>` : `<div class="logo-fallback">${esc(co.name.slice(0,1).toUpperCase())}</div>`}
    <div class="co-name">${esc(co.name)}</div>
    ${infoLine ? `<div class="co-sub">${esc(infoLine)}</div>` : ""}
    <div class="rpt-title">Utility Bills</div>
    <div class="rpt-sub">${dateRange ? esc(dateRange) : "All dates"}</div>
  </div>
  <div class="hdr-right"><div class="print-date">Printed: ${new Date().toLocaleDateString("en-KE", { day:"2-digit", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit" })}<br/>${groups.length} ${groups.length === 1 ? "property" : "properties"} &middot; ${allRows.length} bills</div></div>
</div>
<div class="divider"></div>
<div class="summary-bar">
  <span>Bills: <b>${totals.count}</b></span>
  <span>Total Amount: <b>${mon(totals.amount)}</b></span>
  <span>Paid: <b style="color:#059669">${mon(totals.paid)}</b></span>
  <span>Outstanding: <b style="color:#dc2626">${mon(totals.outstanding)}</b></span>
</div>
<table>
  <thead><tr>
    <th style="text-align:left">Invoice #</th>
    <th style="text-align:left">${termTenant}</th>
    <th style="text-align:left">${termUnit}</th>
    <th style="text-align:left">Utility Type</th>
    <th style="text-align:left">Invoice Date</th>
    <th style="text-align:right">Amount</th>
    <th style="text-align:right">Paid</th>
    <th style="text-align:right">Balance</th>
    <th style="text-align:left">Status</th>
  </tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>
</body></html>`;

    const win = window.open("", "_blank", "width=1200,height=800");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 450);
  }, [filteredRows, totals, currentCompany, appliedFilters, termTenant, termUnit]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="h-[calc(100dvh-152px)] max-h-[calc(100dvh-152px)] overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-1 sm:p-2">
        <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">

            {/* FILTER BAR */}
            <div className="flex-none sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-1 overflow-x-auto px-2 py-1.5">
                <span className="shrink-0 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">Bills: {totals.count}</span>
                <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">O/S: {formatCurrency(totals.outstanding)}</span>
                {selectedCount > 0 && <span className="shrink-0 rounded border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">{selectedCount} selected</span>}
                <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
                {STATUS_FILTERS.map(({ val, label }) => (
                  <button
                    key={val}
                    onClick={() => {
                      setDraftFilters((prev) => ({ ...prev, status: val }));
                      setAppliedFilters((prev) => ({ ...prev, status: val }));
                    }}
                    className={`h-[20px] shrink-0 px-1.5 text-[9px] font-semibold ${draftFilters.status === val ? `${MILIK_GREEN} text-white` : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"}`}
                  >{label}</button>
                ))}
                <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
                <input type="text" value={draftFilters.invoiceNo} onChange={(e) => setDraftFilters((prev) => ({ ...prev, invoiceNo: e.target.value.toUpperCase() }))} placeholder="Invoice #" className="h-[20px] w-20 shrink-0 border border-gray-300 px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                <input type="text" value={draftFilters.tenantName} onChange={setFilter("tenantName")} placeholder={termTenant} className="h-[20px] w-20 shrink-0 border border-gray-300 px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                <AppSelect compact clearable searchable placeholder={termProperty} value={draftFilters.propertyId} onChange={(v) => setDraftFilters((prev) => ({ ...prev, propertyId: v ?? "any", unitId: "any" }))} options={activePropertyOptions} />
                <AppSelect compact clearable placeholder={termUnit} value={draftFilters.unitId} onChange={(v) => setDraftFilters((prev) => ({ ...prev, unitId: v ?? "any" }))} options={unitFilterOptions} />
                <AppSelect compact clearable placeholder="Utility Type" value={draftFilters.utilityType} onChange={(v) => setDraftFilters((prev) => ({ ...prev, utilityType: v ?? "any" }))} options={utilityTypeOptions} />
                <input type="date" value={draftFilters.fromDate} onChange={setFilter("fromDate")} className="h-[20px] w-[5.5rem] shrink-0 border border-slate-200 bg-white px-1 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                <input type="date" value={draftFilters.toDate} onChange={setFilter("toDate")} className="h-[20px] w-[5.5rem] shrink-0 border border-slate-200 bg-white px-1 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                <button onClick={applySearch} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-white ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaSearch size={7} /> Search</button>
                <button onClick={resetFilters} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-white ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaRedoAlt size={7} /> Reset</button>
                <button onClick={loadData} disabled={loading} className="h-[20px] shrink-0 flex items-center gap-0.5 border border-gray-300 bg-white px-1.5 text-[9px] text-gray-700 hover:bg-gray-50 disabled:opacity-60"><FaRedoAlt size={7} /> Refresh</button>
                <button onClick={handlePrint} disabled={filteredRows.length === 0} className="h-[20px] shrink-0 flex items-center gap-0.5 border border-gray-300 bg-white px-1.5 text-[9px] text-gray-700 hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaPrint size={7} /> Print</button>
                <button onClick={() => setCommunicationModal({ contextType: "invoice", recordIds: selectedRows, title: `SMS ${selectedCount} Tenant${selectedCount !== 1 ? "s" : ""}`, allowedChannels: ["sms"], defaultChannel: "sms" })} disabled={selectedCount === 0} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-white ${selectedCount > 0 ? "bg-teal-600 hover:bg-teal-700" : "cursor-not-allowed bg-gray-400"}`}><FaSms size={7} /> SMS</button>
                <button onClick={() => setCommunicationModal({ contextType: "invoice", recordIds: selectedRows, title: `Email ${selectedCount} Tenant${selectedCount !== 1 ? "s" : ""}`, allowedChannels: ["email"], defaultChannel: "email" })} disabled={selectedCount === 0} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-white ${selectedCount > 0 ? "bg-blue-600 hover:bg-blue-700" : "cursor-not-allowed bg-gray-400"}`}><FaEnvelope size={7} /> Email</button>
              </div>
            </div>

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

import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import {
  FaBell, FaClipboardList, FaEdit, FaEnvelope, FaHandshake, FaHome,
  FaPhone, FaPlus, FaStickyNote, FaTrash, FaWhatsapp,
} from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import MilikTable from "../../components/common/MilikTable";
import ListToolbar from "../../components/common/ListToolbar";
import PaginationBar from "../../components/PaginationBar";
import { saleApi } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import SaleFilterBar, { FilterDateRange, FilterSearch } from "./SaleFilterBar";
import { useTerms } from "../../hooks/useTerm";
import SaleActivityFormModal, { ACTIVITY_TYPE_OPTIONS, OUTCOME_OPTIONS, blankActivityForm } from "./SaleActivityFormModal";
import SalePrintButton from "./SalePrintButton";
import SaleExportButton from "./SaleExportButton";
import { exportAfterFetch, fetchAllPages, printAfterFetch } from "./salePrint";

// One icon per type for scannability — but a single neutral badge color, not a per-type palette; the
// type itself isn't a status, so giving it decorative color would violate the house rule that color is
// reserved for things that actually mean something (outcome below is the real status here).
const ACT_ICONS = { call: FaPhone, email: FaEnvelope, meeting: FaHandshake, site_visit: FaHome, whatsapp: FaWhatsapp, note: FaStickyNote, follow_up: FaBell };
const OUTCOME_COLORS = { positive: "text-emerald-600", neutral: "text-slate-500", negative: "text-rose-600", no_answer: "text-amber-600", not_applicable: "text-slate-400" };

const fmt    = (v) => v ? new Date(v).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDay = (v) => v ? new Date(v).toLocaleDateString("en-KE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }) : "Other";
const fmtShort = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short" }) : "";
const LIMIT  = 50;

const activityTableCols = [
  { label: "Activity #", width: "8%" },
  { label: "Date & Time", width: "12%" },
  { label: "Type", width: "9%" },
  { label: "Subject", width: "18%" },
  { label: "Related To", width: "16%" },
  { label: "Outcome", width: "9%" },
  { label: "Duration", align: "right", width: "7%" },
  { label: "Logged By", width: "10%" },
];

export default function SaleActivities() {
  const T       = useTerms("saleLead", "saleLeads", "saleBuyer", "saleBuyers", "saleDeal", "saleListing");
  const confirm = useConfirm();
  const qc      = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz     = currentCompany?._id;

  const [search,        setSearch]    = useTabState("/sale/crm/activities:search", "");
  const debSearch                     = useDebounce(search, 400);
  const [typeFilter,    setType]      = useTabState("/sale/crm/activities:typeFilter", "");
  const [outcomeFilter, setOutcome]   = useTabState("/sale/crm/activities:outcomeFilter", "");
  const [leadFilter,    setLead]      = useTabState("/sale/crm/activities:leadFilter", "");
  const [buyerFilter,   setBuyer]     = useTabState("/sale/crm/activities:buyerFilter", "");
  const [from,          setFrom]      = useTabState("/sale/crm/activities:from", "");
  const [to,            setTo]        = useTabState("/sale/crm/activities:to", "");
  const [page,          setPage]      = useTabState("/sale/crm/activities:page", 1);
  const [pageSize,      setPageSize]  = useTabState("/sale/crm/activities:pageSize", LIMIT);

  const [actModal, setActModal] = useState(null); // { editingAct, initial } while the log/edit modal is open
  const [saving,   setSaving]   = useState(false);

  const { data: activitiesData, isLoading, isFetching } = useQuery({
    queryKey: ["sale-activities-all", biz, debSearch, typeFilter, outcomeFilter, leadFilter, buyerFilter, from, to, page, pageSize],
    queryFn:  () => saleApi.listActivities({ business: biz, search: debSearch, type: typeFilter, outcome: outcomeFilter, relatedLead: leadFilter, relatedBuyer: buyerFilter, from, to, page, limit: pageSize }),
    enabled:  !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });

  // Leads/buyers feed the always-visible filter dropdowns; deals are only needed by the log/edit modal.
  const { data: leadsData }  = useQuery({ queryKey: ["sale-leads-ref",  biz], queryFn: () => saleApi.listLeads({ business: biz, limit: 200 }),  enabled: !!biz, staleTime: 5 * 60_000 });
  const { data: buyersData } = useQuery({ queryKey: ["sale-buyers-ref", biz], queryFn: () => saleApi.listBuyers({ business: biz, limit: 200 }), enabled: !!biz, staleTime: 5 * 60_000 });
  const { data: dealsData }  = useQuery({ queryKey: ["sale-deals-ref",  biz], queryFn: () => saleApi.listDeals({ business: biz, limit: 200 }),  enabled: !!biz && !!actModal, staleTime: 5 * 60_000 });

  const activities = useMemo(() => activitiesData?.data ?? [], [activitiesData]);
  const total      = activitiesData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const leadOptions  = useMemo(() => (leadsData?.data  ?? []).map((l) => ({ value: l._id, label: `${l.fullName} (${l.leadNumber})` })), [leadsData]);
  const buyerOptions = useMemo(() => (buyersData?.data ?? []).map((b) => ({ value: b._id, label: `${b.fullName} (${b.buyerNumber})` })), [buyersData]);
  const dealOptions  = useMemo(() => (dealsData?.data  ?? []).map((d) => ({ value: d._id, label: `${d.dealNumber}${d.buyer?.fullName ? ` — ${d.buyer.fullName}` : ""}` })), [dealsData]);
  const linkOptions  = useMemo(() => ({ leadOptions, buyerOptions, dealOptions }), [leadOptions, buyerOptions, dealOptions]);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["sale-activities-all", biz] });
    qc.invalidateQueries({ queryKey: ["sale-activities-lead", biz] });
    qc.invalidateQueries({ queryKey: ["sale-leads", biz] });
  }, [qc, biz]);

  const openCreate = () => setActModal({ editingAct: null, initial: { ...blankActivityForm, date: new Date().toISOString().slice(0, 16) } });
  const openEdit = (act) => setActModal({
    editingAct: act,
    initial: {
      type: act.type, subject: act.subject || "", notes: act.notes || "",
      date: new Date(act.date).toISOString().slice(0, 16),
      durationMinutes: act.durationMinutes || "",
      outcome: act.outcome || "not_applicable",
      nextAction: act.nextAction || "",
      nextActionDate: act.nextActionDate ? new Date(act.nextActionDate).toISOString().slice(0, 10) : "",
      relatedLead:  act.relatedLead?._id  || act.relatedLead  || "",
      relatedBuyer: act.relatedBuyer?._id || act.relatedBuyer || "",
      relatedDeal:  act.relatedDeal?._id  || act.relatedDeal  || "",
    },
  });

  const handleSave = async (form) => {
    if (!form.type) return toast.warning("Activity type is required");
    if (!form.date) return toast.warning("Date is required");
    const editingId = actModal?.editingAct?._id;
    setSaving(true);
    try {
      const payload = { ...form, business: biz };
      if (editingId) await saleApi.updateActivity(editingId, payload);
      else await saleApi.createActivity(payload);
      invalidate();
      setActModal(null);
      toast.success(`Activity ${editingId ? "updated" : "logged"}`);
    } catch (err) { toast.error(err?.response?.data?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (act) => {
    if (!await confirm({ title: "Delete Activity", message: "Remove this activity record?", confirmText: "Remove", isDangerous: true })) return;
    try {
      await saleApi.deleteActivity(act._id);
      invalidate();
      toast.success("Activity removed");
    } catch { toast.error("Delete failed"); }
  };

  const entityLabel = (act) => {
    if (act.relatedLead)    return `${T.saleLead}: ${act.relatedLead.fullName || act.relatedLead.leadNumber}`;
    if (act.relatedBuyer)   return `${T.saleBuyer}: ${act.relatedBuyer.fullName || act.relatedBuyer.buyerNumber}`;
    if (act.relatedDeal)    return `${T.saleDeal}: ${act.relatedDeal.dealNumber}`;
    if (act.relatedListing) return `${T.saleListing}: ${act.relatedListing.title || act.relatedListing.listingNumber}`;
    return null;
  };

  const renderActivityRow = useCallback((act) => {
    const Icon = ACT_ICONS[act.type] || FaClipboardList;
    const entity = entityLabel(act);
    return (
      <>
        <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap font-mono font-bold text-[#0B3B2E]">{act.activityNumber || "—"}</td>
        <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap text-slate-700">{fmt(act.date)}</td>
        <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap">
          <span className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-[#F1F6F3] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#0B3B2E]">
            <Icon size={8} />{(act.type || "").replace(/_/g, " ")}
          </span>
        </td>
        <td className="px-3 py-1.5 border-r border-gray-100 max-w-[220px] truncate text-slate-700">{act.subject || "—"}</td>
        <td className="px-3 py-1.5 border-r border-gray-100 max-w-[180px] truncate">
          {entity ? <span className="font-semibold text-[#0B3B2E]">{entity}</span> : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap">
          {act.outcome && act.outcome !== "not_applicable"
            ? <span className={`capitalize ${OUTCOME_COLORS[act.outcome]}`}>{act.outcome.replace(/_/g, " ")}</span>
            : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-3 py-1.5 border-r border-gray-100 text-right tabular-nums text-slate-600">
          {act.durationMinutes > 0 ? `${act.durationMinutes} min` : "—"}
        </td>
        <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{act.createdBy?.name || act.createdBy?.fullName || "—"}</td>
      </>
    );
  }, [T]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderActivityActions = useCallback((act) => (
    <div className="inline-flex items-center gap-1">
      <button onClick={() => openEdit(act)} title="Edit" className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
        <FaEdit size={9} />
      </button>
      <button onClick={() => handleDelete(act)} title="Delete" className="border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-50">
        <FaTrash size={9} />
      </button>
    </div>
  ), [openEdit, handleDelete]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderActivityExpanded = useCallback((act) => {
    if (!act.notes && !act.nextAction) {
      return <div className="text-[10px] text-slate-400">No notes or next action logged for this activity.</div>;
    }
    return (
      <div className="max-w-xl space-y-1.5 text-[11px]">
        {act.notes && <p className="text-slate-600">{act.notes}</p>}
        {act.nextAction && (
          <p className="font-semibold text-[#0B3B2E]">
            → {act.nextAction}{act.nextActionDate ? ` · ${fmtShort(act.nextActionDate)}` : ""}
          </p>
        )}
      </div>
    );
  }, []);

  const buildReportFilters = () => ({
    business: biz, search: debSearch, type: typeFilter, outcome: outcomeFilter,
    relatedLead: leadFilter, relatedBuyer: buyerFilter, from, to,
  });
  const reportColumns = [
    { label: "Activity #", value: (a) => a.activityNumber || "—" },
    { label: "Date & Time", value: (a) => fmt(a.date) },
    { label: "Type", value: (a) => (a.type || "").replace(/_/g, " ") },
    { label: "Subject", value: (a) => a.subject || "—" },
    { label: "Related To", value: (a) => entityLabel(a) || "—" },
    { label: "Outcome", value: (a) => (a.outcome && a.outcome !== "not_applicable" ? a.outcome.replace(/_/g, " ") : "—") },
    { label: "Duration (min)", value: (a) => (a.durationMinutes > 0 ? a.durationMinutes : "—") },
    { label: "Logged By", value: (a) => a.createdBy?.name || a.createdBy?.fullName || "—" },
  ];

  const [printing, setPrinting] = useState(false);
  const printReport = async () => {
    setPrinting(true);
    const described = [
      typeFilter && `Type: ${typeFilter.replace(/_/g, " ")}`,
      outcomeFilter && `Outcome: ${outcomeFilter.replace(/_/g, " ")}`,
      (from || to) && `${from || "…"} – ${to || "…"}`,
      debSearch && `Search: ${debSearch}`,
    ].filter(Boolean);
    await printAfterFetch(() => fetchAllPages(saleApi.listActivities, buildReportFilters()), ({ rows }) => ({
      title: "Activities",
      subtitle: described.join(" · ") || "All activities",
      company: currentCompany,
      columns: reportColumns,
      rows,
    }));
    setPrinting(false);
  };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    await exportAfterFetch(() => fetchAllPages(saleApi.listActivities, buildReportFilters()), ({ rows }) => ({
      filename: "activities",
      columns: reportColumns,
      rows,
    }));
    setExporting(false);
  };

  return (
    <PropertySaleShell>
      <div className="flex flex-col h-full">

        {/* Filter bar */}
        <SaleFilterBar
          onReset={() => { setSearch(""); setType(""); setOutcome(""); setLead(""); setBuyer(""); setFrom(""); setTo(""); setPage(1); }}
          activeCount={[search, typeFilter, outcomeFilter, leadFilter, buyerFilter, from, to].filter(Boolean).length}
          trailing={
            <>
              <SalePrintButton onClick={printReport} busy={printing} disabled={isLoading || total === 0} />
              <SaleExportButton onClick={exportReport} busy={exporting} disabled={isLoading || total === 0} />
              <ListToolbar.Button icon={FaPlus} onClick={openCreate}>
                Log Activity
              </ListToolbar.Button>
            </>
          }
        >
          <FilterSearch value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search activities…" />
          <AppSelect value={typeFilter} onChange={(v) => { setType(v ?? ""); setPage(1); }} options={ACTIVITY_TYPE_OPTIONS} placeholder="All Types" clearable compact />
          <AppSelect value={outcomeFilter} onChange={(v) => { setOutcome(v ?? ""); setPage(1); }} options={OUTCOME_OPTIONS} placeholder="All Outcomes" clearable compact />
          <AppSelect value={leadFilter} onChange={(v) => { setLead(v ?? ""); setPage(1); }} options={leadOptions} placeholder={`All ${T.saleLeads}`} searchable clearable compact />
          <AppSelect value={buyerFilter} onChange={(v) => { setBuyer(v ?? ""); setPage(1); }} options={buyerOptions} placeholder={`All ${T.saleBuyers}`} searchable clearable compact />
          <FilterDateRange
            from={from} to={to}
            onFromChange={(e) => { setFrom(e.target.value); setPage(1); }}
            onToChange={(e) => { setTo(e.target.value); setPage(1); }}
          />
        </SaleFilterBar>

        {/* Table — grouped by day via MilikTable's own groupBy (orange-accent section header),
            matching every other PropertySale list page instead of a bespoke timeline layout */}
        <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
          <MilikTable
            columns={activityTableCols}
            rows={activities}
            loading={isLoading}
            empty="No activities found."
            minWidth={820}
            groupBy={(row) => fmtDay(row.date)}
            renderRow={renderActivityRow}
            renderActions={renderActivityActions}
            renderExpanded={renderActivityExpanded}
          />

          <PaginationBar
            page={page}
            pages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            loading={isFetching}
            label="activities"
          />
        </div>
      </div>

      {/* ── Log / Edit Activity Modal ──────────────────────────────────────────── */}
      {actModal && (
        <SaleActivityFormModal
          editingAct={actModal.editingAct}
          initial={actModal.initial}
          saving={saving}
          linkOptions={linkOptions}
          onClose={() => setActModal(null)}
          onSubmit={handleSave}
        />
      )}
    </PropertySaleShell>
  );
}

import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaBell, FaExternalLinkAlt, FaTimes } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterDateRange } from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi } from "../../services/propertySaleApi";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import { fmtDate } from "../../utils/dates";
import MilikTable from "../../components/common/MilikTable";

const PAGE_SIZE = 50;

const STATUS_BADGE = {
  upcoming: "border-blue-200  bg-blue-50  text-blue-700",
  overdue:  "border-rose-200  bg-rose-50  text-rose-700",
  paid:     "border-emerald-200 bg-emerald-50 text-emerald-700",
  waived:   "border-slate-200 bg-slate-50 text-slate-500",
};

const STATUS_OPTS = [
  { value: "",         label: "All Statuses" },
  { value: "overdue",  label: "Overdue" },
  { value: "upcoming", label: "Upcoming" },
  { value: "paid",     label: "Paid" },
  { value: "waived",   label: "Waived" },
];


const SaleSchedule = () => {
  const navigate       = useNavigate();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz            = currentCompany?._id;

  const [statusFilter, setStatusFilter] = useTabState("/sale/schedule:status", "overdue");
  const [dateFrom,     setDateFrom]     = useTabState("/sale/schedule:dateFrom", "");
  const [dateTo,       setDateTo]       = useTabState("/sale/schedule:dateTo", "");
  const [page,         setPage]         = useTabState("/sale/schedule:page", 1);

  useEffect(() => setPage(1), [statusFilter, dateFrom, dateTo]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["sale-all-schedule", biz, statusFilter, dateFrom, dateTo, page],
    queryFn:  () => saleApi.listAllSchedule({
      ...(statusFilter && { status: statusFilter }),
      ...(dateFrom     && { dateFrom }),
      ...(dateTo       && { dateTo }),
      page,
      limit: PAGE_SIZE,
    }),
    enabled:  !!biz,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const { data: overdueData } = useQuery({
    queryKey: ["sale-schedule-overdue-sum", biz],
    queryFn:  () => saleApi.listAllSchedule({ status: "overdue", limit: 500 }),
    enabled:  !!biz,
    staleTime: 60_000,
  });
  const { data: upcomingData } = useQuery({
    queryKey: ["sale-schedule-upcoming-sum", biz],
    queryFn:  () => saleApi.listAllSchedule({ status: "upcoming", limit: 500 }),
    enabled:  !!biz,
    staleTime: 60_000,
  });

  useEffect(() => { if (error) toast.error("Failed to load payment schedule"); }, [error]);

  const items      = data?.data  ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const overdueItems  = overdueData?.data  ?? [];
  const upcomingItems = upcomingData?.data ?? [];
  const overdueAmt    = overdueItems.reduce((s, i) => s + Number(i.expectedAmount || 0), 0);

  const in30Days  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const due30     = upcomingItems.filter((i) => new Date(i.dueDate) <= in30Days);
  const due30Amt  = due30.reduce((s, i) => s + Number(i.expectedAmount || 0), 0);
  const upcomingAmt = upcomingItems.reduce((s, i) => s + Number(i.expectedAmount || 0), 0);

  const activeFilterCount = [statusFilter, dateFrom, dateTo].filter(Boolean).length;

  const [selectedIds,       setSelectedIds]       = useState(new Set());
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderChannel,   setReminderChannel]   = useState("sms");
  const [reminderMessage,   setReminderMessage]   = useState("");
  const [sendingReminders,  setSendingReminders]  = useState(false);

  const toggleSelect = (id) =>
    setSelectedIds((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i._id));
  const toggleAll   = () =>
    setSelectedIds(allSelected ? new Set() : new Set(items.map((i) => i._id)));

  const handleSendReminders = async (e) => {
    e.preventDefault();
    if (selectedIds.size === 0) return;
    setSendingReminders(true);
    try {
      const res = await saleApi.sendReminders({
        business:      biz,
        itemIds:       [...selectedIds],
        channel:       reminderChannel,
        customMessage: reminderMessage || undefined,
      });
      toast.success(`Reminders sent (${res?.sent ?? selectedIds.size} dispatched)`);
      setShowReminderModal(false);
      setSelectedIds(new Set());
      setReminderMessage("");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send reminders");
    } finally {
      setSendingReminders(false);
    }
  };

  const resetFilters = () => {
    setStatusFilter("overdue");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  return (
    <PropertySaleShell>
      {/* Filters */}
      <SaleFilterBar
        leading={
          <>
            <span className="shrink-0 font-mono text-[10px] font-black text-rose-600">{fmtKES(overdueAmt)}</span>
            <span className="shrink-0 text-[10px] text-slate-400">overdue</span>
            <span className="shrink-0 select-none text-slate-200">|</span>
            <span className="shrink-0 font-mono text-[10px] font-black text-blue-600">{fmtKES(due30Amt)}</span>
            <span className="shrink-0 text-[10px] text-slate-400">due 30d</span>
            <span className="shrink-0 select-none text-slate-200">|</span>
            <span className="shrink-0 font-mono text-[10px] font-black text-slate-500">{fmtKES(upcomingAmt)}</span>
            <span className="shrink-0 text-[10px] text-slate-400">upcoming</span>
            <span className="shrink-0 select-none text-slate-200">|</span>
            <span className="shrink-0 font-mono text-[10px] font-black text-slate-500">{total}</span>
            <span className="shrink-0 text-[10px] text-slate-400">showing</span>
          </>
        }
        onReset={resetFilters}
        activeCount={activeFilterCount}
        trailing={
          selectedIds.size > 0 && (
            <button
              onClick={() => setShowReminderModal(true)}
              className="inline-flex items-center gap-1.5 border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100"
            >
              <FaBell size={10} /> Remind ({selectedIds.size})
            </button>
          )
        }
      >
        <AppSelect
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v ?? ""); setPage(1); }}
          options={STATUS_OPTS}
          placeholder="All Statuses"
          clearable
          size="sm"
        />
        <FilterDateRange
          from={dateFrom}
          to={dateTo}
          onFromChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          onToChange={(e) => { setDateTo(e.target.value); setPage(1); }}
        />
      </SaleFilterBar>

      {/* Table */}
      <div className="border border-slate-200 bg-white shadow-sm overflow-hidden">
        <MilikTable
          columns={[
            { label: "#" },
            { label: "Deal" },
            { label: "Property" },
            { label: "Buyer" },
            { label: "Description" },
            { label: "Due Date" },
            { label: "Amount", align: "right" },
            { label: "Status" },
          ]}
          rows={items}
          loading={isLoading}
          empty="No schedule items found for the selected filter."
          checkboxes
          allChecked={allSelected}
          someChecked={selectedIds.size > 0 && !allSelected}
          onCheckAll={toggleAll}
          isChecked={(item) => selectedIds.has(item._id)}
          onCheckRow={(item) => toggleSelect(item._id)}
          rowClassName={(item) => item.status === "overdue" ? "!bg-rose-50/40 border-l-2 border-l-rose-400" : ""}
          renderRow={(item) => {
            const isOverdue = item.status === "overdue";
            return (
              <>
                <td className="px-3 py-1.5 border-r border-gray-100 font-mono text-slate-500">{item.installmentNumber}</td>
                <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-black text-[#027333]">{item.deal?.dealNumber || "—"}</td>
                <td className="max-w-[140px] truncate px-3 py-1.5 border-r border-gray-100 text-slate-700">{item.deal?.listing?.title || item.deal?.listing?.listingNumber || "—"}</td>
                <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{item.deal?.buyer?.fullName || "—"}</td>
                <td className="max-w-[140px] truncate px-3 py-1.5 border-r border-gray-100 text-slate-500">{item.description || `Installment ${item.installmentNumber}`}</td>
                <td className={`px-3 py-1.5 border-r border-gray-100 font-mono tabular-nums ${isOverdue ? "font-black text-rose-700" : "text-slate-700"}`}>{fmtDate(item.dueDate)}</td>
                <td className={`px-3 py-1.5 border-r border-gray-100 text-right font-mono font-black tabular-nums ${isOverdue ? "text-rose-700" : "text-slate-900"}`}>{fmtKES(item.expectedAmount)}</td>
                <td className="px-3 py-1.5">
                  <span className={`inline-block border px-1.5 py-0.5 text-[9px] font-black uppercase ${STATUS_BADGE[item.status] || STATUS_BADGE.upcoming}`}>{item.status}</span>
                </td>
              </>
            );
          }}
          renderActions={(item) => item.deal?._id ? (
            <button onClick={() => navigate("/sale/deals", { state: { openDealId: item.deal._id } })} className="border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50" title="Open deal">
              <FaExternalLinkAlt className="inline" />
            </button>
          ) : null}
        />
      </div>

      {total > PAGE_SIZE && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          isFetching={isFetching}
          onPageChange={setPage}
        />
      )}
      {/* ── Send Reminders Modal ─────────────────────────────────────────────── */}
      {showReminderModal && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
          <form onSubmit={handleSendReminders} className="flex w-full flex-col bg-white shadow-2xl sm:max-w-sm sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
                <FaBell />Send Reminders
              </h3>
              <button type="button" onClick={() => setShowReminderModal(false)} className="p-1 text-white/70 hover:bg-white/10 hover:text-white"><FaTimes /></button>
            </div>
            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4">
              <p className="text-xs text-slate-600">
                Sending reminders for <strong>{selectedIds.size}</strong> schedule item{selectedIds.size !== 1 ? "s" : ""}.
              </p>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-500">Channel</label>
                <div className="flex gap-2">
                  {["sms", "email", "both"].map((ch) => (
                    <label key={ch} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="radio" name="channel" value={ch} checked={reminderChannel === ch} onChange={() => setReminderChannel(ch)} />
                      {ch.charAt(0).toUpperCase() + ch.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-500">Custom Message (optional)</label>
                <textarea
                  rows={3}
                  value={reminderMessage}
                  onChange={(e) => setReminderMessage(e.target.value)}
                  placeholder="Leave blank to use the default reminder template…"
                  className="w-full resize-none border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0B3B2E] focus:outline-none"
                />
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setShowReminderModal(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={sendingReminders} className="bg-amber-600 px-4 py-1.5 text-xs font-black text-white hover:bg-amber-700 disabled:opacity-60">
                {sendingReminders ? "Sending…" : "Send Reminders"}
              </button>
            </div>
          </form>
        </div>
      )}
    </PropertySaleShell>
  );
};

export default SaleSchedule;

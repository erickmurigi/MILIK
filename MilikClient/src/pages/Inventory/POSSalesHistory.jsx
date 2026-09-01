import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import useDebounce from "../../hooks/useDebounce";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaReceipt, FaRedoAlt, FaTimes, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney, todayISO } from "../../services/inventoryApi";
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from "../../components/PaginationBar";
import Modal from "../../components/common/Modal";
import StatusBadge from "../../components/common/StatusBadge";
import { inputClass, labelClass } from "../../utils/formStyles";

const STATUS_BADGE = {
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  voided:    "border-red-200    bg-red-50    text-red-700",
};

const POSSalesHistory = () => {
  const queryClient = useQueryClient();
  const [locationFilter, setLocationFilter] = useState("");
  const [statusFilter, setStatusFilter] = useTabState("/pos/sales:statusFilter", "");
  const [dateFrom, setDateFrom] = useTabState("/pos/sales:dateFrom", () => todayISO());
  const [dateTo, setDateTo] = useTabState("/pos/sales:dateTo", () => todayISO());
  const [search, setSearch] = useTabState("/pos/sales:search", "");
  const debSearch = useDebounce(search, 400);
  const [page, setPage] = useTabState("/pos/sales:page", 1);
  const [pageSize, setPageSize] = useTabState("/pos/sales:pageSize", 30);
  const [selected, setSelected] = useTabState("/pos/sales:selected", null);
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  const { data: locations = [] } = useQuery({
    queryKey: ['inv-locations-ref'],
    queryFn: async () => { const d = await inventoryApi.listLocations({ active: true }); return Array.isArray(d) ? d : (d?.data ?? []); },
    staleTime: 5 * 60_000,
  });

  const { data: salesData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['inv-pos-sales', locationFilter, statusFilter, dateFrom, dateTo, debSearch, page, pageSize],
    queryFn: async () => {
      const res = await inventoryApi.listSales({
        location: locationFilter || undefined,
        status: statusFilter || undefined,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        receiptNumber: debSearch || undefined,
        page,
        limit: pageSize,
      });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      return { sales: list, total: res?.total ?? list.length };
    },
    placeholderData: (prev) => prev,
  });

  const { data: summary = null } = useQuery({
    queryKey: ['inv-pos-sales-summary', locationFilter, dateFrom, dateTo],
    queryFn: () => inventoryApi.getSalesSummary({
      location: locationFilter || undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
    }).then((r) => r?.data ?? r),
  });

  useEffect(() => { if (error) toast.error("Failed to load sales"); }, [error]);

  const sales = salesData?.sales ?? [];
  const total = salesData?.total ?? 0;
  const pages = Math.ceil(total / pageSize) || 1;

  // Selection
  const allPageIds    = useMemo(() => sales.map((s) => s._id), [sales]);
  const voidableIds   = useMemo(() => sales.filter((s) => s.status === "completed").map((s) => s._id), [sales]);
  const allSelected   = allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id));
  const someSelected  = allPageIds.some((id) => selectedIds.has(id));
  const selCount      = selectedIds.size;
  const selVoidable   = useMemo(() => [...selectedIds].filter((id) => voidableIds.includes(id)).length, [selectedIds, voidableIds]);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) allPageIds.forEach((id) => next.delete(id));
      else allPageIds.forEach((id) => next.add(id));
      return next;
    });
  }, [allSelected, allPageIds]);

  const toggleOne = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkVoid = async () => {
    const ids = [...selectedIds].filter((id) => voidableIds.includes(id));
    if (!ids.length) { toast.warn("No completed sales selected to void"); return; }
    const reason = window.prompt(`Void ${ids.length} sale(s). Enter void reason:`);
    if (!reason?.trim()) return;
    setBulkWorking(true);
    let failed = 0;
    await Promise.all(ids.map((id) => inventoryApi.voidSale(id, { voidReason: reason }).catch(() => { failed++; })));
    if (failed) toast.error(`${failed} sale(s) could not be voided`);
    else toast.success(`${ids.length} sale(s) voided`);
    clearSelection();
    queryClient.invalidateQueries({ queryKey: ['inv-pos-sales'] });
    queryClient.invalidateQueries({ queryKey: ['inv-pos-sales-summary'] });
    setBulkWorking(false);
  };

  const openVoid = (sale) => { setSelected(sale); setVoidReason(""); setShowVoid(true); };

  const handleVoid = async () => {
    if (!voidReason.trim()) { toast.error("Void reason is required"); return; }
    setVoiding(true);
    try {
      await inventoryApi.voidSale(selected._id, { voidReason });
      setShowVoid(false);
      toast.success(`Sale ${selected.receiptNumber} voided`);
      queryClient.invalidateQueries({ queryKey: ['inv-pos-sales'] });
      queryClient.invalidateQueries({ queryKey: ['inv-pos-sales-summary'] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Void failed");
    } finally {
      setVoiding(false);
    }
  };

  const SUMMARY_COLS = [
    ["Sales",       summary?.count        ?? 0,                  false],
    ["Subtotal",    formatMoney(summary?.subtotal),               false],
    ["Discount",    formatMoney(summary?.totalDiscount),          false],
    ["VAT",         formatMoney(summary?.totalVat),               false],
    ["Grand Total", formatMoney(summary?.grandTotal),             true ],
  ];

  return (
    <InventoryShell lockScroll>
      <div className="flex h-full flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
        {/* Toolbar: bulk bar (when selected) OR summary+filter rows */}
        {selCount > 0 ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5">
            <span className="text-[11px] font-extrabold text-amber-700">{selCount} selected</span>
            {selVoidable > 0 && (
              <>
                <span className="h-3.5 w-px bg-amber-300" />
                <button type="button" disabled={bulkWorking} onClick={handleBulkVoid}
                  className="inline-flex items-center gap-1 border border-red-300 bg-white px-2.5 py-1 text-[10px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">
                  <FaTrash className="text-[9px]" /> Void {selVoidable}
                </button>
              </>
            )}
            <button type="button" onClick={clearSelection}
              className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-800">
              <FaTimes className="text-[9px]" /> Clear selection
            </button>
          </div>
        ) : (
        <div className="shrink-0 border-b border-slate-200 bg-[#EDF5F1]">
          {/* Summary row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#d4e8dc] px-3 py-1.5">
            {SUMMARY_COLS.map(([label, val, bold]) => (
              <div key={label} className="flex items-baseline gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}:</span>
                <span className={bold ? "font-extrabold text-[#0B3B2E]" : "font-bold text-slate-800"}>{val}</span>
              </div>
            ))}
            {summary?.byPaymentMethod && Object.entries(summary.byPaymentMethod).map(([method, amt]) => (
              <div key={method} className="flex items-baseline gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{method}:</span>
                <span className="font-semibold text-slate-600">{formatMoney(amt)}</span>
              </div>
            ))}
          </div>
          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
            <div className="flex items-center gap-1">
              <input
                type="date" value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#0B3B2E]"
              />
              <span className="text-[10px] font-bold text-slate-400">TO</span>
              <input
                type="date" value={dateTo}
                min={dateFrom}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#0B3B2E]"
              />
            </div>
            <AppSelect value={locationFilter} onChange={(v) => { setLocationFilter(v ?? ""); setPage(1); }} options={locations.map((l) => ({ value: l._id, label: l.name }))} placeholder="All Locations" clearable size="sm" />
            <AppSelect value={statusFilter} onChange={(v) => { setStatusFilter(v ?? ""); setPage(1); }} options={[{ value: "completed", label: "Completed" }, { value: "voided", label: "Voided" }]} placeholder="All Statuses" clearable size="sm" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Receipt #"
              className="w-28 border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-[#0B3B2E]"
            />
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={refetch} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                <FaRedoAlt className={loading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>
        </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input type="checkbox" checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll} className="h-3.5 w-3.5 cursor-pointer accent-emerald-400" />
                </th>
                {["Receipt #", "Time", "Location", "Customer", "Grand Total", "Payment", "Status", "Cashier", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
              ) : !sales.length ? (
                <tr>
                  <td colSpan={10} className="px-3 py-14 text-center">
                    <FaReceipt className="mx-auto mb-2 text-3xl text-slate-300" />
                    <p className="text-sm font-semibold text-slate-500">No sales found</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {dateFrom || dateTo
                        ? `No sales recorded for ${dateFrom === dateTo ? new Date(dateFrom + "T00:00:00").toLocaleDateString("en-KE") : `${dateFrom || "—"} to ${dateTo || "—"}`}`
                        : "Try adjusting your filters"}
                    </p>
                  </td>
                </tr>
              ) : sales.map((s) => {
                const isSelected = selectedIds.has(s._id);
                return (
                  <tr key={s._id}
                    onClick={() => toggleOne(s._id)}
                    className={`cursor-pointer border-b border-slate-100 transition-colors ${isSelected ? "bg-emerald-50/70" : "hover:bg-slate-50"}`}>
                    <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(s._id)}
                        className="h-3.5 w-3.5 cursor-pointer accent-[#0B3B2E]" />
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 font-mono font-bold text-[#0B3B2E]">
                        <FaReceipt className="shrink-0 text-[10px]" />{s.receiptNumber}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                      {s.createdAt ? new Date(s.createdAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{s.location?.name || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{s.customerName || s.customerPhone || "—"}</td>
                    <td className="px-3 py-2 font-bold text-slate-900">{formatMoney(s.grandTotal)}</td>
                    <td className="px-3 py-2 text-slate-600 capitalize">
                      {s.payments?.map((p) => p.method).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={s.status} map={STATUS_BADGE} /></td>
                    <td className="px-3 py-2 text-slate-500">{s.cashier?.name || "—"}</td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {s.status === "completed" && (
                        <button
                          type="button"
                          onClick={() => openVoid(s)}
                          className="border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-100"
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <PaginationBar
          page={page} pages={pages} total={total} pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          loading={loading}
        />
      </div>

      {showVoid && selected && (
        <Modal
          title={`Void Sale — ${selected.receiptNumber}`}
          onClose={() => setShowVoid(false)}

          footer={
            <>
              <button type="button" onClick={() => setShowVoid(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={handleVoid} disabled={voiding || !voidReason.trim()} className="bg-red-700 px-4 py-2 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-50">
                {voiding ? "Voiding…" : "Confirm Void"}
              </button>
            </>
          }
        >
          <p className="mb-3 text-xs text-slate-600">This will reverse all stock movements for this sale. Provide a reason to continue.</p>
          <div>
            <label className={labelClass}>Void Reason *</label>
            <textarea
              rows={3}
              className={`${inputClass} h-20 resize-none py-2`}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Customer returned items, wrong product scanned…"
            />
          </div>
        </Modal>
      )}
    </InventoryShell>
  );
};

export default POSSalesHistory;

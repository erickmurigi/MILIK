import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaCashRegister, FaRedoAlt, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { useConfirm } from "../../context/ConfirmContext";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney } from "../../services/inventoryApi";
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from "../../components/PaginationBar";

const STATUS_BADGE = {
  open:   "border-emerald-200 bg-emerald-50 text-emerald-700",
  closed: "border-slate-200   bg-slate-50   text-slate-600",
};

const StatusPill = ({ status }) => (
  <span className={`inline-flex border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_BADGE[status] || "border-slate-200 bg-slate-50 text-slate-500"}`}>
    {status}
  </span>
);

const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" }) : "—";

const POSSessions = () => {
  const confirm     = useConfirm();
  const queryClient = useQueryClient();
  const [locationFilter, setLocationFilter] = useTabState("/pos/sessions:locationFilter", "");
  const [statusFilter, setStatusFilter] = useTabState("/pos/sessions:statusFilter", "");
  const [page, setPage] = useTabState("/pos/sessions:page", 1);
  const [pageSize, setPageSize] = useTabState("/pos/sessions:pageSize", 30);
  const [closing, setClosing] = useState(null);
  const [closingFloat, setClosingFloat] = useState("");
  const [showClose, setShowClose] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  const { data: locations = [] } = useQuery({
    queryKey: ['inv-locations-ref'],
    queryFn: async () => { const d = await inventoryApi.listLocations({ active: true }); return Array.isArray(d) ? d : (d?.data ?? []); },
    staleTime: 5 * 60_000,
  });

  const { data: sessData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['inv-sessions', locationFilter, statusFilter, page, pageSize],
    queryFn: async () => {
      const res = await inventoryApi.listSessions({ location: locationFilter || undefined, status: statusFilter || undefined, page, limit: pageSize });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      return { sessions: list, total: res?.total ?? list.length };
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => { if (error) toast.error("Failed to load sessions"); }, [error]);

  const sessions = sessData?.sessions ?? [];
  const total = sessData?.total ?? 0;
  const pages = Math.ceil(total / pageSize) || 1;

  // Selection — only open sessions can be bulk-closed
  const allPageIds   = useMemo(() => sessions.map((s) => s._id), [sessions]);
  const openPageIds  = useMemo(() => sessions.filter((s) => s.status === "open").map((s) => s._id), [sessions]);
  const allSelected  = allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id));
  const someSelected = allPageIds.some((id) => selectedIds.has(id));
  const selCount     = selectedIds.size;
  const selOpenCount = useMemo(() => [...selectedIds].filter((id) => openPageIds.includes(id)).length, [selectedIds, openPageIds]);

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

  const handleBulkClose = async () => {
    const ids = [...selectedIds].filter((id) => openPageIds.includes(id));
    if (!ids.length) { toast.warn("No open sessions selected"); return; }
    const ok = await confirm({ title: "Close Sessions", message: `Close ${ids.length} open session(s)? Closing float will be set to 0.`, confirmText: "Close Sessions", isDangerous: true });
    if (!ok) return;
    setBulkWorking(true);
    let failed = 0;
    await Promise.all(ids.map((id) => inventoryApi.closeSession(id, { closingFloat: 0 }).catch(() => { failed++; })));
    if (failed) toast.error(`${failed} session(s) could not be closed`);
    else toast.success(`${ids.length} session(s) closed`);
    clearSelection();
    queryClient.invalidateQueries({ queryKey: ['inv-sessions'] });
    setBulkWorking(false);
  };

  const openClose = (session) => {
    setClosing(session);
    setClosingFloat("");
    setShowClose(true);
  };

  const handleClose = async () => {
    setShowClose(false);
    try {
      await inventoryApi.closeSession(closing._id, { closingFloat: Number(closingFloat || 0) });
      toast.success(`Session ${closing.sessionNumber} closed`);
      queryClient.invalidateQueries({ queryKey: ['inv-sessions'] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to close session");
    } finally {
      setClosing(null);
    }
  };

  return (
    <InventoryShell lockScroll>
      <div className="flex h-full flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
        {/* Toolbar */}
        {selCount > 0 ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5">
            <span className="text-[11px] font-extrabold text-amber-700">{selCount} selected</span>
            {selOpenCount > 0 && (
              <>
                <span className="h-3.5 w-px bg-amber-300" />
                <button type="button" disabled={bulkWorking} onClick={handleBulkClose}
                  className="inline-flex items-center gap-1 border border-red-300 bg-white px-2.5 py-1 text-[10px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">
                  Close {selOpenCount} Open Session{selOpenCount !== 1 ? "s" : ""}
                </button>
              </>
            )}
            <button type="button" onClick={clearSelection}
              className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-800">
              <FaTimes className="text-[9px]" /> Clear selection
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
            <AppSelect value={locationFilter} onChange={(v) => { setLocationFilter(v ?? ""); setPage(1); }} options={locations.map((l) => ({ value: l._id, label: l.name }))} placeholder="All Locations" clearable size="sm" />
            <AppSelect value={statusFilter} onChange={(v) => { setStatusFilter(v ?? ""); setPage(1); }} options={[{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }]} placeholder="All Statuses" clearable size="sm" />
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={refetch} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                <FaRedoAlt className={loading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[1080px] text-xs">
            <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input type="checkbox" checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll} className="h-3.5 w-3.5 cursor-pointer accent-emerald-400" />
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Session #</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Location</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Till</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Cashier</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Opened</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Closed</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Float</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Sales</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Total</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Variance</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={13} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
              ) : !sessions.length ? (
                <tr>
                  <td colSpan={13} className="px-3 py-14 text-center">
                    <FaCashRegister className="mx-auto mb-2 text-3xl text-slate-300" />
                    <p className="text-sm font-semibold text-slate-500">No sessions found</p>
                    <p className="mt-0.5 text-xs text-slate-400">Sessions are created when a cashier opens the POS Terminal on a till.</p>
                  </td>
                </tr>
              ) : sessions.map((s) => {
                const isSelected = selectedIds.has(s._id);
                return (
                  <tr key={s._id}
                    onClick={() => toggleOne(s._id)}
                    className={`cursor-pointer border-b border-slate-100 transition-colors ${isSelected ? "bg-emerald-50/70" : "hover:bg-slate-50"}`}>
                    <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(s._id)}
                        className="h-3.5 w-3.5 cursor-pointer accent-[#0B3B2E]" />
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-[#0B3B2E]">{s.sessionNumber || "—"}</td>
                    <td className="px-3 py-2 text-slate-700">{s.location?.name || "—"}</td>
                    <td className="px-3 py-2 font-semibold text-slate-700">{s.till?.name || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{s.openedBy?.name || "—"}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDateTime(s.openedAt)}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDateTime(s.closedAt)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{formatMoney(s.openingFloat)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{s.salesCount ?? 0}</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-800">
                      <div>{formatMoney(s.totalSales)}</div>
                      {(s.totalCash > 0 || s.totalMpesa > 0 || s.totalCard > 0) && (
                        <div className="mt-0.5 space-y-0.5 font-normal text-slate-400">
                          {s.totalCash  > 0 && <div>Cash {formatMoney(s.totalCash)}</div>}
                          {s.totalMpesa > 0 && <div>M-Pesa {formatMoney(s.totalMpesa)}</div>}
                          {s.totalCard  > 0 && <div>Card {formatMoney(s.totalCard)}</div>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.status === "closed" ? (
                        <span className={`font-bold ${s.cashVariance === 0 ? "text-slate-500" : s.cashVariance < 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {s.cashVariance > 0 ? "+" : ""}{formatMoney(s.cashVariance ?? 0)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2"><StatusPill status={s.status} /></td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {s.status === "open" && (
                        <button
                          type="button"
                          onClick={() => openClose(s)}
                          className="border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-100"
                        >
                          Close
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

      {showClose && closing && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="w-full max-w-sm border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-red-700 px-4 py-3 text-white">
              <h2 className="text-sm font-extrabold uppercase tracking-wide">Close Session — {closing.sessionNumber}</h2>
              <button type="button" onClick={() => setShowClose(false)} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-600">
                Location: <strong>{closing.location?.name}</strong> · Cashier: <strong>{closing.openedBy?.name}</strong>
              </p>
              <p className="text-xs text-slate-600">
                Sales: <strong>{closing.salesCount ?? 0}</strong> · Total: <strong>{formatMoney(closing.totalSales)}</strong>
              </p>
              <div>
                <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Closing Float (KES)</label>
                <input
                  type="number" min="0" step="0.01" value={closingFloat}
                  onChange={(e) => setClosingFloat(e.target.value)} placeholder="0.00"
                  className="h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setShowClose(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={handleClose} className="bg-red-700 px-4 py-2 text-xs font-bold text-white hover:bg-red-800">
                Close Session
              </button>
            </div>
          </div>
        </div>
      )}
    </InventoryShell>
  );
};

export default POSSessions;

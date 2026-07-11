import React, { useEffect, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaCashRegister, FaRedoAlt, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney } from "../../services/inventoryApi";

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
  const queryClient = useQueryClient();
  const [locationFilter, setLocationFilter] = useTabState("/pos/sessions:locationFilter", "");
  const [statusFilter, setStatusFilter] = useTabState("/pos/sessions:statusFilter", "");
  const [page, setPage] = useTabState("/pos/sessions:page", 1);
  const [closing, setClosing] = useState(null);
  const [closingFloat, setClosingFloat] = useState("");
  const [showClose, setShowClose] = useState(false);

  const { data: locations = [] } = useQuery({
    queryKey: ['inv-locations-ref'],
    queryFn: async () => { const d = await inventoryApi.listLocations({ active: true }); return Array.isArray(d) ? d : (d?.data ?? []); },
    staleTime: 5 * 60_000,
  });

  const { data: sessData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['inv-sessions', locationFilter, statusFilter, page],
    queryFn: async () => {
      const res = await inventoryApi.listSessions({ location: locationFilter || undefined, status: statusFilter || undefined, page, limit: 30 });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      return { sessions: list, total: res?.total ?? list.length };
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => { if (error) toast.error("Failed to load sessions"); }, [error]);

  const sessions = sessData?.sessions ?? [];
  const total = sessData?.total ?? 0;

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

  const openCount  = sessions.filter((s) => s.status === "open").length;
  const closedCount = sessions.filter((s) => s.status === "closed").length;

  return (
    <InventoryShell
      title="POS Sessions"
      action={
        <button type="button" onClick={refetch} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
          <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      }
    >
      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        {/* Filter strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
          <div className="flex items-baseline gap-4 text-[11px] font-bold uppercase tracking-wide text-slate-600">
            <span>Total: <strong className="text-[#0B3B2E]">{total}</strong></span>
            {openCount > 0 && <span>Open: <strong className="text-emerald-600">{openCount}</strong></span>}
            {closedCount > 0 && <span>Closed: <strong className="text-slate-500">{closedCount}</strong></span>}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={locationFilter}
              onChange={(e) => { setLocationFilter(e.target.value); setPage(1); }}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#0B3B2E]"
            >
              <option value="">All Locations</option>
              {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#0B3B2E]"
            >
              <option value="">All Statuses</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>

        <table className="w-full min-w-[1050px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Session #</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Location</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Till</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Cashier</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Opened</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Closed</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Float</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Sales</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Total</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Variance</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : !sessions.length ? (
              <tr>
                <td colSpan={12} className="px-3 py-14 text-center">
                  <FaCashRegister className="mx-auto mb-2 text-3xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">No sessions found</p>
                  <p className="mt-0.5 text-xs text-slate-400">Sessions are created when a cashier opens the POS Terminal on a till.</p>
                </td>
              </tr>
            ) : sessions.map((s) => (
              <tr key={s._id} className="border-b border-slate-100 hover:bg-slate-50">
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
                <td className="px-3 py-2 text-right">
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
            ))}
          </tbody>
        </table>

        {total > 30 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#0B3B2E]">← Previous</button>
            <span className="text-xs text-slate-500">Page {page} of {Math.ceil(total / 30)}</span>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={sessions.length < 30} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#0B3B2E]">Next →</button>
          </div>
        )}
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
                  type="number"
                  min="0"
                  step="0.01"
                  value={closingFloat}
                  onChange={(e) => setClosingFloat(e.target.value)}
                  placeholder="0.00"
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

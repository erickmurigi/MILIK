import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FaPiggyBank, FaRedoAlt, FaUndo, FaCheckSquare, FaSquare,
  FaExclamationTriangle, FaInfoCircle, FaTrash,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";

const fmt = formatMoney;
const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const daysSince = (date) => {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
};

const DORMANCY_OPTIONS = [
  { label: "All active", days: 0 },
  { label: "30+ days dormant", days: 30 },
  { label: "90+ days dormant", days: 90 },
  { label: "180+ days dormant", days: 180 },
];

export default function CarWashCreditBalances() {
  const queryClient = useQueryClient();
  const canManage = useCarWashPermission("carwash-loyalty", "manage");

  const [tab, setTab] = useState("active"); // "active" | "written_off"
  const [dormantDays, setDormantDays] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const limit = 50;

  const queryKey = ["cw-customer-credits", tab, dormantDays, page];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => carWashApi.listCustomerCredits({ status: tab, dormantDays, page, limit }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const credits  = data?.data || [];
  const total    = data?.total || 0;
  const totalAmt = data?.totalAmount || 0;
  const pages    = data?.pages || 1;

  const allIds = credits.map((c) => c._id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => { const n = new Set(prev); allIds.forEach((id) => n.delete(id)); return n; });
    } else {
      setSelected((prev) => { const n = new Set(prev); allIds.forEach((id) => n.add(id)); return n; });
    }
  };

  const toggleOne = (id) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const writeOffMutation = useMutation({
    mutationFn: (ids) => carWashApi.writeOffCredits(ids),
    onSuccess: (res) => {
      toast.success(res?.message || "Credits written off to Other Income");
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["cw-customer-credits"] });
      queryClient.invalidateQueries({ queryKey: ["cw-customers"] });
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Write-off failed"),
  });

  const undoMutation = useMutation({
    mutationFn: (id) => carWashApi.undoWriteOff(id),
    onSuccess: () => {
      toast.success("Write-off reversed — credit is active again");
      queryClient.invalidateQueries({ queryKey: ["cw-customer-credits"] });
      queryClient.invalidateQueries({ queryKey: ["cw-customers"] });
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Undo failed"),
  });

  const handleBulkWriteOff = () => {
    const ids = [...selected];
    if (!ids.length) return toast.warn("Select at least one credit to write off");
    if (!window.confirm(`Write off ${ids.length} credit(s) totalling KES ${fmt(credits.filter((c) => ids.includes(c._id)).reduce((s, c) => s + c.amount, 0))} to Other Income?\n\nThis can be undone if the customer ever asks.`)) return;
    writeOffMutation.mutate(ids);
  };

  return (
    <CarWashShell title="Customer Credit Balances">
      <div className="mx-auto max-w-5xl px-3 py-4 space-y-4">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <FaPiggyBank className="text-emerald-600" size={18} />
              Customer Credit Balances
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Overpayments held as credits. Apply, refund, or write off to Other Income (breakage).
            </p>
          </div>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey })}
            disabled={isLoading}
            className="flex items-center gap-1 h-7 rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <FaRedoAlt size={9} className={isLoading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200">
          {[
            { key: "active", label: "Active Credits" },
            { key: "written_off", label: "Written Off" },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => { setTab(key); setPage(1); setSelected(new Set()); }}
              className={`px-3 py-1.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                tab === key
                  ? "border-emerald-600 text-emerald-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        {tab === "active" && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Dormancy filter */}
            <div className="flex items-center gap-1">
              {DORMANCY_OPTIONS.map(({ label, days }) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => { setDormantDays(days); setPage(1); setSelected(new Set()); }}
                  className={`h-7 rounded border px-2 text-xs font-semibold transition-colors ${
                    dormantDays === days
                      ? "border-amber-400 bg-amber-50 text-amber-700"
                      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {selected.size > 0 && canManage && (
                <button
                  type="button"
                  onClick={handleBulkWriteOff}
                  disabled={writeOffMutation.isPending}
                  className="flex items-center gap-1 h-7 rounded border border-amber-400 bg-amber-50 px-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                >
                  <FaTrash size={9} />
                  Write off {selected.size} selected
                </button>
              )}
            </div>
          </div>
        )}

        {/* Stats strip */}
        {!isLoading && (
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 bg-slate-50 rounded border border-slate-200 px-3 py-2">
            <span className="font-semibold text-slate-700">{total} credit{total !== 1 ? "s" : ""}</span>
            <span className="text-emerald-700 font-semibold">Total: {fmt(totalAmt)}</span>
            {tab === "active" && dormantDays > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <FaExclamationTriangle size={9} />
                Dormant {dormantDays}+ days
              </span>
            )}
            {tab === "active" && (
              <span className="flex items-center gap-1 text-slate-400">
                <FaInfoCircle size={9} />
                Write-off moves liability to Other Income. Fully reversible.
              </span>
            )}
          </div>
        )}

        {/* Table */}
        <div className="rounded border border-slate-200 bg-white overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {tab === "active" && canManage && (
                  <th className="px-3 py-2 w-8">
                    <button type="button" onClick={toggleAll} className="text-slate-400 hover:text-slate-700">
                      {allSelected ? <FaCheckSquare size={12} className="text-emerald-600" /> : <FaSquare size={12} />}
                    </button>
                  </th>
                )}
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Customer</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Plate</th>
                <th className="px-4 py-2 text-right font-semibold text-slate-600">Amount</th>
                <th className="px-4 py-2 text-center font-semibold text-slate-600">Days Old</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Source Job</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Created</th>
                {tab === "written_off" && (
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Written Off</th>
                )}
                {canManage && <th className="px-3 py-2 text-right font-semibold text-slate-600">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-400">Loading...</td>
                </tr>
              ) : credits.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center">
                    <FaPiggyBank className="mx-auto mb-2 text-slate-300" size={24} />
                    <p className="text-sm text-slate-500">No {tab === "written_off" ? "written-off" : "active"} credits</p>
                  </td>
                </tr>
              ) : credits.map((cr, idx) => {
                const days = daysSince(cr.createdAt);
                const isOld = days >= 90;
                const isMedium = days >= 30 && days < 90;
                return (
                  <tr key={cr._id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                    {tab === "active" && canManage && (
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => toggleOne(cr._id)} className="text-slate-400 hover:text-emerald-600">
                          {selected.has(cr._id)
                            ? <FaCheckSquare size={12} className="text-emerald-600" />
                            : <FaSquare size={12} />
                          }
                        </button>
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <div className="font-semibold text-slate-800">{cr.customer?.name || "—"}</div>
                      <div className="text-[10px] text-slate-400">{cr.customer?.phone || ""}</div>
                    </td>
                    <td className="px-4 py-2">
                      {(cr.customer?.plates || []).map((p) => (
                        <span key={p} className="inline-block rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-mono font-bold text-slate-700 mr-1">{p}</span>
                      ))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-700">
                      {fmt(cr.amount)}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        isOld ? "bg-red-100 text-red-700" : isMedium ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
                      }`}>
                        {days}d
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {cr.sourceJob ? (
                        <span className="font-mono text-[10px]">#{cr.sourceJob.jobNumber}</span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-500 text-[11px]">{fmtDate(cr.createdAt)}</td>
                    {tab === "written_off" && (
                      <td className="px-4 py-2 text-slate-500 text-[11px]">{fmtDate(cr.writtenOffAt)}</td>
                    )}
                    {canManage && (
                      <td className="px-3 py-2 text-right">
                        {tab === "active" ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Write off KES ${fmt(cr.amount)} credit for ${cr.customer?.name || "this customer"} to Other Income?\n\nThis can be undone.`)) {
                                writeOffMutation.mutate([cr._id]);
                              }
                            }}
                            disabled={writeOffMutation.isPending}
                            className="h-6 px-2 rounded border border-amber-300 bg-amber-50 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                          >
                            Write off
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Reverse write-off for KES ${fmt(cr.amount)}? The credit will become active again.`)) {
                                undoMutation.mutate(cr._id);
                              }
                            }}
                            disabled={undoMutation.isPending}
                            className="flex items-center gap-1 h-6 px-2 rounded border border-emerald-300 bg-emerald-50 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            <FaUndo size={8} />
                            Undo
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="h-7 px-3 rounded border border-slate-300 text-xs disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-xs text-slate-500">Page {page} of {pages}</span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="h-7 px-3 rounded border border-slate-300 text-xs disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </CarWashShell>
  );
}

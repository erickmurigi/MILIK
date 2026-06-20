import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FaExclamationTriangle, FaPlus, FaRedoAlt, FaTimes, FaTrash, FaUndo } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";

const icc = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const lc  = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const localISO = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const todayISO = () => localISO(new Date());

const statusPill = (status) => {
  if (status === "deducted") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "waived")   return "border-slate-200 bg-slate-50 text-slate-500";
  return "border-red-200 bg-red-50 text-red-700";
};
const statusLabel = (status) =>
  status === "deducted" ? "Deducted" : status === "waived" ? "Waived" : "Pending";

const emptyForm = () => ({ staff: "", amount: "", description: "", damageDate: todayISO(), notes: "" });

const PAGE_SIZE = 50;

export default function CarWashStaffDamages() {
  const queryClient = useQueryClient();
  const canManage = useCarWashPermission("carwash-commissions", "manage");

  const [page,         setPage]         = useState(1);
  const [filterStaff,  setFilterStaff]  = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [dateFrom,     setDateFrom]     = useState("");
  const [dateTo,       setDateTo]       = useState("");

  const [showForm,     setShowForm]     = useState(false);
  const [form,         setForm]         = useState(emptyForm());
  const [waiveTarget,  setWaiveTarget]  = useState(null);
  const [waiveNotes,   setWaiveNotes]   = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  // ── Queries ───────────────────────────────────────────────────────────────

  const damagesQueryKey = ["cw-damages", page, filterStaff, filterStatus, dateFrom, dateTo];

  const { data: damagesData, isLoading: loading } = useQuery({
    queryKey: damagesQueryKey,
    queryFn: () => {
      const params = { page, limit: PAGE_SIZE };
      if (filterStaff)          params.staff    = filterStaff;
      if (filterStatus !== "all") params.status = filterStatus;
      if (dateFrom)             params.dateFrom = dateFrom;
      if (dateTo)               params.dateTo   = dateTo;
      return carWashApi.listDamages(params);
    },
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  const damages = normalizeListPayload(damagesData, "damages");
  const total   = damagesData?.total ?? 0;

  const { data: staffData } = useQuery({
    queryKey: ["cw-staff-active"],
    queryFn: () => carWashApi.listStaff({ active: true }),
    staleTime: 5 * 60_000,
  });
  const staffList = normalizeListPayload(staffData, "staff");

  const { data: balancesData } = useQuery({
    queryKey: ["cw-damage-balances"],
    queryFn: () => carWashApi.listDamagesBalances(),
    staleTime: 30_000,
  });
  const balances = normalizeListPayload(balancesData, "balances");

  // ── Shared invalidation ───────────────────────────────────────────────────

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["cw-damages"] }),
    queryClient.invalidateQueries({ queryKey: ["cw-damage-balances"] }),
  ]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const addMutation = useMutation({
    mutationFn: (payload) => carWashApi.createDamage(payload),
    onSuccess: () => {
      toast.success("Damage record added");
      setForm(emptyForm());
      setShowForm(false);
      invalidate();
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to add damage"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => carWashApi.deleteDamage(id),
    onSuccess: () => {
      toast.success("Damage deleted");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to delete"),
  });

  const waiveMutation = useMutation({
    mutationFn: ({ id, notes }) => carWashApi.waiveDamage(id, notes),
    onSuccess: () => {
      toast.success("Damage waived — will not be deducted");
      setWaiveTarget(null);
      setWaiveNotes("");
      invalidate();
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to waive"),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleAdd = (e) => {
    e.preventDefault();
    if (!form.staff) return toast.error("Select a staff member");
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return toast.error("Enter a valid amount");
    if (!form.description.trim()) return toast.error("Description is required");
    addMutation.mutate({
      staff:       form.staff,
      amount,
      description: form.description.trim(),
      damageDate:  form.damageDate,
      notes:       form.notes.trim(),
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <CarWashShell
      title="Staff Damages"
      action={
        canManage && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127]"
          >
            <FaPlus className="text-[10px]" /> Record Damage
          </button>
        )
      }
    >
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">

        {/* Pending balances summary */}
        {balances.length > 0 && (
          <div className="flex-shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
            <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-amber-700">Pending — will deduct from next payout</p>
            <div className="flex flex-wrap gap-3">
              {balances.map((b) => (
                <div key={String(b.staff._id)} className="inline-flex items-center gap-1.5 rounded border border-amber-200 bg-white px-2.5 py-1 text-xs">
                  <FaExclamationTriangle className="text-[9px] text-red-500" />
                  <span className="font-bold text-slate-700">{b.staff.name}</span>
                  <span className="font-black text-red-600">−{formatMoney(b.pendingAmount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex-shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
          <select value={filterStaff} onChange={(e) => { setFilterStaff(e.target.value); setPage(1); }}
            className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none">
            <option value="">All Staff</option>
            {staffList.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none">
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="deducted">Deducted</option>
            <option value="waived">Waived</option>
          </select>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none" />
          <input type="date" value={dateTo}   onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none" />
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ["cw-damages"] })}
            className="h-8 border border-slate-300 bg-white px-2 text-slate-500 hover:bg-slate-100"
            title="Refresh"
          >
            <FaRedoAlt className="text-[11px]" />
          </button>
          <span className="ml-auto text-[11px] font-semibold text-slate-500">{total} record{total !== 1 ? "s" : ""}</span>
        </div>

        {/* Table */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-400">Loading…</div>
          ) : damages.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">No damage records found</div>
          ) : (
            <table className="w-full min-w-[700px] text-xs">
              <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.15em]">Date</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.15em]">Staff</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.15em]">Description</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.15em]">Job</th>
                  <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.15em]">Amount</th>
                  <th className="px-3 py-2 text-center text-[10px] font-black uppercase tracking-[0.15em]">Status</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.15em]">Payout</th>
                  <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.15em]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {damages.map((d) => (
                  <tr key={d._id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-600">{fmtDate(d.damageDate)}</td>
                    <td className="px-3 py-2 font-bold text-slate-800">{d.staff?.name || "—"}</td>
                    <td className="px-3 py-2 text-slate-700 max-w-[200px] truncate" title={d.description}>{d.description}</td>
                    <td className="px-3 py-2 text-slate-500">{d.job?.jobNumber || "—"}</td>
                    <td className="px-3 py-2 text-right font-black text-red-600">{formatMoney(d.amount)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-black ${statusPill(d.status)}`}>
                        {statusLabel(d.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{d.commissionPayout?.payoutNumber || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {canManage && d.status === "pending" && (
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => { setWaiveTarget(d); setWaiveNotes(""); }}
                            title="Waive — write off this damage"
                            className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100"
                          >
                            <FaUndo className="text-[9px]" /> Waive
                          </button>
                          <button
                            onClick={() => setDeleteTarget(d)}
                            title="Delete record"
                            className="border border-red-200 bg-red-50 px-2 py-0.5 text-red-600 hover:bg-red-100"
                          >
                            <FaTrash className="text-[9px]" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex-shrink-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-2 text-[11px]">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="border border-slate-300 bg-white px-3 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
              Previous
            </button>
            <span className="font-semibold text-slate-600">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
              className="border border-slate-300 bg-white px-3 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
              Next
            </button>
          </div>
        )}
      </div>

      {/* Add Damage Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-black uppercase tracking-wide text-[#0B3B2E]">Record Staff Damage</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600"><FaTimes /></button>
            </div>
            <form onSubmit={handleAdd} className="space-y-3 p-4">
              <div>
                <label className={lc}>Staff Member *</label>
                <select value={form.staff} onChange={(e) => setForm((f) => ({ ...f, staff: e.target.value }))} className={icc} required>
                  <option value="">Select staff…</option>
                  {staffList.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lc}>Amount (KES) *</label>
                  <input type="number" min="1" step="1" value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    className={icc} placeholder="0" required />
                </div>
                <div>
                  <label className={lc}>Date *</label>
                  <input type="date" value={form.damageDate}
                    onChange={(e) => setForm((f) => ({ ...f, damageDate: e.target.value }))}
                    className={icc} required />
                </div>
              </div>
              <div>
                <label className={lc}>Description *</label>
                <input type="text" value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className={icc} placeholder="e.g. Scratched customer's bumper" required />
              </div>
              <div>
                <label className={lc}>Notes (optional)</label>
                <input type="text" value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className={icc} placeholder="Additional details…" />
              </div>
              <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-700">
                <FaExclamationTriangle className="mr-1 inline text-[9px]" />
                This amount will be automatically deducted from the staff member's next commission payout.
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowForm(false)}
                  className="border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={addMutation.isPending}
                  className="bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:opacity-60">
                  {addMutation.isPending ? "Saving…" : "Save Damage"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h2 className="text-sm font-black uppercase tracking-wide">Delete Damage Record</h2>
              <button onClick={() => setDeleteTarget(null)} className="p-1 text-white/70 hover:text-white"><FaTimes /></button>
            </div>
            <div className="px-4 py-5">
              <p className="text-sm text-slate-700">
                Delete the <span className="font-bold text-red-600">{formatMoney(deleteTarget.amount)}</span> damage record for{" "}
                <span className="font-bold">{deleteTarget.staff?.name || "this staff member"}</span>?
              </p>
              <p className="mt-1 text-[11px] text-slate-500">This action cannot be undone.</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
              <button onClick={() => setDeleteTarget(null)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget._id)}
                disabled={deleteMutation.isPending}
                className="bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waive Modal */}
      {waiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-black uppercase tracking-wide text-[#0B3B2E]">Waive Damage</h2>
              <button onClick={() => setWaiveTarget(null)} className="text-slate-400 hover:text-slate-600"><FaTimes /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-slate-700">
                Waive <strong>{formatMoney(waiveTarget.amount)}</strong> damage for <strong>{waiveTarget.staff?.name}</strong>?
              </p>
              <p className="text-xs text-slate-500">{waiveTarget.description}</p>
              <div>
                <label className={lc}>Reason (optional)</label>
                <input type="text" value={waiveNotes} onChange={(e) => setWaiveNotes(e.target.value)}
                  className={icc} placeholder="Why is this being waived?" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setWaiveTarget(null)}
                  className="border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={() => waiveMutation.mutate({ id: waiveTarget._id, notes: waiveNotes })}
                  disabled={waiveMutation.isPending}
                  className="bg-slate-700 px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {waiveMutation.isPending ? "Waiving…" : "Waive — Write Off"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </CarWashShell>
  );
}

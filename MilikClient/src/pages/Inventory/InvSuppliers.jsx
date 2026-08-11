import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaEdit, FaPlus, FaRedoAlt, FaSearch, FaTimes, FaTrash, FaTruck, FaSyncAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import { useConfirm } from "../../context/ConfirmContext";
import InventoryShell from "./InventoryShell";
import { inventoryApi } from "../../services/inventoryApi";
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from "../../components/PaginationBar";
import Modal from "../../components/common/Modal";
import StatusBadge from "../../components/common/StatusBadge";
import { inputClass, labelClass } from "../../utils/formStyles";

const emptyForm = () => ({ name: "", contactName: "", phone: "", email: "", kraPin: "", address: "", notes: "" });

const InvSuppliers = () => {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [search, setSearch] = useTabState("/inventory/suppliers:search", "");
  const [page, setPage] = useTabState("/inventory/suppliers:page", 1);
  const [pageSize, setPageSize] = useTabState("/inventory/suppliers:pageSize", 30);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const { data: suppData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['inv-suppliers', search, page, pageSize],
    queryFn: async () => {
      const res = await inventoryApi.listSuppliers({ search, page, limit: pageSize });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      return { suppliers: list, total: res?.total ?? list.length };
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => { if (error) toast.error("Failed to load suppliers"); }, [error]);

  const suppliers = suppData?.suppliers ?? [];
  const total = suppData?.total ?? 0;

  // Selection
  const allPageIds   = useMemo(() => suppliers.map((s) => s._id), [suppliers]);
  const allSelected  = allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id));
  const someSelected = allPageIds.some((id) => selectedIds.has(id));
  const selCount     = selectedIds.size;

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

  const handleBulkDelete = async () => {
    const ok = await confirm({ title: "Delete Suppliers", message: `Delete ${selCount} supplier(s)? This cannot be undone.`, confirmText: "Delete", isDangerous: true });
    if (!ok) return;
    setBulkWorking(true);
    let failed = 0;
    await Promise.all([...selectedIds].map((id) => inventoryApi.deleteSupplier(id).catch(() => { failed++; })));
    if (failed) toast.error(`${failed} supplier(s) could not be deleted`);
    else toast.success(`${selCount} supplier(s) deleted`);
    clearSelection();
    queryClient.invalidateQueries({ queryKey: ['inv-suppliers'] });
    queryClient.invalidateQueries({ queryKey: ['inv-suppliers-ref'] });
    setBulkWorking(false);
  };
  const pages = Math.ceil(total / pageSize) || 1;

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const result = await inventoryApi.backfillSupplierApAccounts();
      toast.success(result?.message || "AP accounts created for all suppliers");
      queryClient.invalidateQueries({ queryKey: ['inv-suppliers'] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  };

  const openAdd = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (s) => {
    setEditing(s);
    setForm({ name: s.name, contactName: s.contactName || "", phone: s.phone || "", email: s.email || "", kraPin: s.kraPin || "", address: s.address || "", notes: s.notes || "" });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditing(null); setForm(emptyForm()); };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) await inventoryApi.updateSupplier(editing._id, form);
      else await inventoryApi.createSupplier(form);
      closeModal();
      queryClient.invalidateQueries({ queryKey: ['inv-suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['inv-suppliers-ref'] });
      toast.success(`Supplier ${editing ? "updated" : "created"} successfully`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <InventoryShell lockScroll>
      <div className="flex h-full flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
        {/* Toolbar */}
        {selCount > 0 ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5">
            <span className="text-[11px] font-extrabold text-amber-700">{selCount} selected</span>
            <span className="h-3.5 w-px bg-amber-300" />
            <button type="button" disabled={bulkWorking} onClick={handleBulkDelete}
              className="inline-flex items-center gap-1 border border-red-300 bg-white px-2.5 py-1 text-[10px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">
              <FaTrash className="text-[9px]" /> Delete
            </button>
            <button type="button" onClick={clearSelection}
              className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-800">
              <FaTimes className="text-[9px]" /> Clear selection
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
            <div className="flex h-7 items-center gap-1.5 border border-slate-300 bg-white px-2 text-xs focus-within:border-[#0B3B2E]">
              <FaSearch className="shrink-0 text-[10px] text-slate-400" />
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search suppliers…"
                className="w-40 bg-transparent text-slate-700 placeholder-slate-400 outline-none" />
              {search && <button type="button" onClick={() => { setSearch(""); setPage(1); }} className="text-slate-400 hover:text-slate-600"><FaTimes className="text-[9px]" /></button>}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={refetch} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                <FaRedoAlt className={loading ? "animate-spin" : ""} />
              </button>
              <button type="button" onClick={handleBackfill} disabled={backfilling}
                title="Create missing AP ledger accounts for all suppliers"
                className="inline-flex h-7 items-center gap-1 border border-slate-300 bg-white px-2.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <FaSyncAlt className={backfilling ? "animate-spin" : ""} /> Sync AP Accounts
              </button>
              <button type="button" onClick={openAdd} className="inline-flex h-7 items-center gap-1 bg-[#FF8C00] px-2.5 text-[10px] font-bold text-white hover:bg-[#E67E00]">
                <FaPlus /> New Supplier
              </button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[700px] text-xs">
            <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input type="checkbox" checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll} className="h-3.5 w-3.5 cursor-pointer accent-emerald-400" />
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Name</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Contact</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Phone</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Email</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">KRA PIN</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Status</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
              ) : !suppliers.length ? (
                <tr>
                  <td colSpan={8} className="px-3 py-14 text-center">
                    <FaTruck className="mx-auto mb-2 text-3xl text-slate-300" />
                    <p className="text-sm font-semibold text-slate-500">
                      {search ? "No suppliers match your search" : "No suppliers yet"}
                    </p>
                    {!search && (
                      <p className="mt-0.5 text-xs text-slate-400">Add suppliers to manage your procurement and purchase orders.</p>
                    )}
                  </td>
                </tr>
              ) : suppliers.map((s) => {
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
                      <span className="flex items-center gap-1.5 font-extrabold text-slate-900">
                        <FaTruck className="shrink-0 text-[#0B3B2E]" /> {s.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{s.contactName || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{s.phone || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{s.email || "—"}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">{s.kraPin || "—"}</td>
                    <td className="px-3 py-2"><StatusBadge status={s.active !== false ? "active" : "inactive"} /></td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => openEdit(s)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                        <FaEdit /> Edit
                      </button>
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

      {showModal && (
        <Modal
          title={editing ? "Edit Supplier" : "Add Supplier"}
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" form="supplier-form" disabled={saving} className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                {saving ? "Saving…" : "Save Supplier"}
              </button>
            </>
          }
        >
          <form id="supplier-form" onSubmit={handleSave} className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={labelClass}>Supplier Name *</label>
              <input required autoFocus className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Contact Person</label>
              <input className={inputClass} value={form.contactName} onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input type="tel" className={inputClass} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" className={inputClass} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>KRA PIN</label>
              <input className={`${inputClass} uppercase`} value={form.kraPin} onChange={(e) => setForm((f) => ({ ...f, kraPin: e.target.value }))} placeholder="e.g. P051234567B" />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Address</label>
              <input className={inputClass} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 resize-none" />
            </div>
          </form>
        </Modal>
      )}
    </InventoryShell>
  );
};

export default InvSuppliers;

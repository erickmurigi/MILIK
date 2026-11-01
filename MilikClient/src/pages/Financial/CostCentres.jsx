import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { FaPlus, FaEdit, FaTrash, FaTimes, FaSave, FaToggleOn, FaToggleOff } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import ListToolbar from "../../components/common/ListToolbar";
import MilikTable from "../../components/common/MilikTable";
import { useConfirm } from "../../context/ConfirmContext";
import { getCostCentres, createCostCentre, updateCostCentre, deleteCostCentre } from "../../redux/apiCalls";

const EMPTY_FORM = { name: "", code: "", notes: "" };

const CostCentreFormModal = ({ costCentre, onClose, onSaved }) => {
  const isEditing = Boolean(costCentre?._id);
  const [form, setForm] = useState(() => (costCentre
    ? { name: costCentre.name || "", code: costCentre.code || "", notes: costCentre.notes || "" }
    : { ...EMPTY_FORM }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Give this cost centre a name"); return; }
    setSaving(true);
    try {
      if (isEditing) {
        await updateCostCentre(costCentre._id, form);
        toast.success("Cost centre updated");
      } else {
        await createCostCentre(form);
        toast.success("Cost centre created");
      }
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save cost centre");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
        <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-[#0a3127] bg-[#0B3B2E] px-4 py-3 text-white">
          <h2 className="text-sm font-black uppercase tracking-wide">{isEditing ? "Edit Cost Centre" : "New Cost Centre"}</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors"><FaTimes size={14} /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. Head Office"
                  maxLength={60}
                  className="h-8 w-full border border-slate-300 px-3 text-xs focus:outline-none focus:border-[#0B3B2E]"
                />
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1">
                  Code <span className="text-slate-400 font-normal normal-case">(optional)</span>
                </label>
                <input
                  value={form.code}
                  onChange={(e) => set("code", e.target.value.toUpperCase())}
                  placeholder="HO"
                  maxLength={12}
                  className="h-8 w-full border border-slate-300 px-3 text-xs font-mono focus:outline-none focus:border-[#0B3B2E]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                rows={2}
                placeholder="Optional notes…"
                className="w-full border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:border-[#0B3B2E] resize-none"
              />
            </div>
          </div>
          <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <button type="button" onClick={onClose} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
              <FaSave size={10} />
              {saving ? "Saving…" : isEditing ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default function CostCentres() {
  const confirm = useConfirm();
  const [costCentres, setCostCentres] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [modalItem, setModalItem] = useState(null); // null=closed, false=new, obj=edit
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCostCentres(await getCostCentres());
    } catch {
      toast.error("Failed to load cost centres");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return costCentres;
    return costCentres.filter((c) => c.name.toLowerCase().includes(q) || (c.code || "").toLowerCase().includes(q));
  }, [costCentres, search]);

  const handleToggle = async (cc) => {
    try {
      await updateCostCentre(cc._id, { status: cc.status === "active" ? "inactive" : "active" });
      toast.success(`Cost centre ${cc.status === "active" ? "deactivated" : "activated"}`);
      load();
    } catch {
      toast.error("Failed to update cost centre");
    }
  };

  const handleDelete = async (cc) => {
    if (!await confirm({ message: `Delete cost centre "${cc.name}"? This cannot be undone.`, confirmText: "Delete", isDangerous: true })) return;
    setDeleting(cc._id);
    try {
      await deleteCostCentre(cc._id);
      toast.success("Cost centre deleted");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to delete cost centre");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex flex-col h-full min-h-0 p-0 bg-white overflow-hidden">
        <ListToolbar>
          <ListToolbar.Input
            width="w-48"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or code…"
          />
          <ListToolbar.Divider />
          <ListToolbar.Button icon={FaPlus} onClick={() => setModalItem(false)}>
            Add Cost Centre
          </ListToolbar.Button>
        </ListToolbar>

        <div className="flex-1 min-h-0 px-2 pb-2 overflow-hidden">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm h-full flex flex-col overflow-hidden">
            <MilikTable
              tableFixed
              columns={[
                { label: "#", align: "center", width: "36px" },
                { label: "Name / Code" },
                { label: "Notes" },
                { label: "Status", align: "center", width: "90px" },
              ]}
              rows={visible}
              rowKey="_id"
              loading={loading}
              empty={search ? "No cost centres match your search" : "No cost centres yet — add one so journal lines can be tagged with it"}
              actionsWidth="76px"
              renderActions={(cc) => (
                <div className="flex items-center justify-center gap-1">
                  <button onClick={() => setModalItem(cc)} title="Edit" className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-500 hover:border-[#0B3B2E] hover:text-[#0B3B2E] transition-colors">
                    <FaEdit size={9} />
                  </button>
                  <button
                    onClick={() => handleToggle(cc)}
                    title={cc.status === "active" ? "Deactivate" : "Activate"}
                    className={`flex h-6 w-6 items-center justify-center rounded border transition-colors ${cc.status === "active" ? "border-amber-200 text-amber-500 hover:border-amber-500 hover:text-amber-700" : "border-emerald-200 text-emerald-500 hover:border-emerald-600 hover:text-emerald-700"}`}
                  >
                    {cc.status === "active" ? <FaToggleOff size={9} /> : <FaToggleOn size={9} />}
                  </button>
                  <button onClick={() => handleDelete(cc)} disabled={deleting === cc._id} title="Delete" className="flex h-6 w-6 items-center justify-center rounded border border-red-200 text-red-400 hover:border-red-500 hover:text-red-600 transition-colors disabled:opacity-40">
                    <FaTrash size={9} />
                  </button>
                </div>
              )}
              renderRow={(cc, idx) => (
                <>
                  <td className="px-3 py-1.5 text-center text-slate-400 font-mono border-r border-gray-100">{idx + 1}</td>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    <span className="font-semibold text-slate-900 truncate block">{cc.name}</span>
                    {cc.code && <span className="font-mono text-[10px] text-slate-400 tracking-wide">{cc.code}</span>}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{cc.notes || "—"}</td>
                  <td className="px-3 py-1.5 text-center border-r border-gray-100">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${cc.status === "active" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                      {cc.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </td>
                </>
              )}
            />
          </div>
        </div>
      </div>

      {modalItem !== null && (
        <CostCentreFormModal
          costCentre={modalItem || null}
          onClose={() => setModalItem(null)}
          onSaved={() => { setModalItem(null); load(); }}
        />
      )}
    </DashboardLayout>
  );
}

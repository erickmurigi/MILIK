import React, { useEffect, useState } from "react";
import { FaEdit, FaPlus, FaRedoAlt, FaSave, FaTimes, FaToggleOff, FaToggleOn } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const emptyRule = { name: "", service: "", staff: "", commissionType: "fixed", rate: "", priority: 0, active: true, notes: "" };

const Modal = ({ title, subtitle, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <div>
          <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs font-semibold text-emerald-50">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
      </div>
      <div className="p-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>}
    </div>
  </div>
);

const CarWashCommissionRules = () => {
  const [rules, setRules]       = useState([]);
  const [services, setServices] = useState([]);
  const [staff, setStaff]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [form, setForm]         = useState(emptyRule);
  const [editId, setEditId]     = useState("");
  const [showModal, setShowModal] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [rulePayload, svcPayload, staffPayload] = await Promise.all([
        carWashApi.listCommissionRules(),
        carWashApi.listServices({ active: true }),
        carWashApi.listStaff({ active: true }),
      ]);
      setRules(normalizeListPayload(rulePayload, "rules"));
      setServices(normalizeListPayload(svcPayload, "services"));
      setStaff(normalizeListPayload(staffPayload, "staff"));
    } catch {
      toast.error("Failed to load commission rules");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setEditId(""); setForm(emptyRule); setShowModal(true); };
  const openEdit = (rule) => {
    setEditId(rule._id);
    setForm({
      name: rule.name || "",
      service: rule.service?._id || rule.service || "",
      staff: rule.staff?._id || rule.staff || "",
      commissionType: rule.commissionType || "fixed",
      rate: rule.rate ?? "",
      priority: rule.priority || 0,
      active: rule.active !== false,
      notes: rule.notes || "",
    });
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const payload = { ...form, rate: Number(form.rate || 0), priority: Number(form.priority || 0), service: form.service || null, staff: form.staff || null };
    try {
      if (editId) await carWashApi.updateCommissionRule(editId, payload);
      else await carWashApi.createCommissionRule(payload);
      setShowModal(false);
      await load();
      toast.success("Commission rule saved");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save rule");
    }
  };

  return (
    <CarWashShell
      title="Commission Rules"
      action={
        <>
          <button onClick={load} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt size={9} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={openNew} className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]">
            <FaPlus size={9} /> New Rule
          </button>
        </>
      }
    >
      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-4 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Total Rules: <strong className="text-[#0B3B2E]">{rules.length}</strong></span>
          <span>Active: <strong className="text-emerald-700">{rules.filter((r) => r.active !== false).length}</strong></span>
          <span>Inactive: <strong className="text-slate-500">{rules.filter((r) => r.active === false).length}</strong></span>
        </div>
        <table className="w-full min-w-[860px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Rule Name</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Applies To</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Staff</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Type</th>
              <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Rate</th>
              <th className="px-3 py-1.5 text-center font-bold uppercase tracking-wide">Priority</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody>
            {rules.length ? rules.map((rule) => (
              <tr key={rule._id} className={`border-b border-slate-200 hover:bg-slate-50 ${rule.active === false ? "opacity-50" : ""}`}>
                <td className="px-3 py-2 font-extrabold text-slate-900">{rule.name}</td>
                <td className="px-3 py-2 text-slate-700">{rule.service?.name || <span className="italic text-slate-400">All services</span>}</td>
                <td className="px-3 py-2 text-slate-700">{rule.staff?.name || <span className="italic text-slate-400">All staff</span>}</td>
                <td className="px-3 py-2 capitalize text-slate-700">{rule.commissionType}</td>
                <td className="px-3 py-2 text-right font-black text-slate-900">
                  {rule.commissionType === "percentage" ? `${rule.rate}%` : `Ksh ${Number(rule.rate || 0).toLocaleString()}`}
                </td>
                <td className="px-3 py-2 text-center text-slate-600">{rule.priority || 0}</td>
                <td className="px-3 py-2">
                  {rule.active === false
                    ? <span className="inline-flex items-center gap-1 border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-500"><FaToggleOff size={10} /> Inactive</span>
                    : <span className="inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700"><FaToggleOn size={10} /> Active</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => openEdit(rule)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                    <FaEdit size={9} /> Edit
                  </button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={8} className="px-3 py-12 text-center text-xs font-semibold text-slate-500">
                No commission rules yet. Click "New Rule" to create one.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal
          title={editId ? "Edit Commission Rule" : "New Commission Rule"}
          subtitle="Rules are matched by specificity: staff + service beats staff-only or service-only."
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowModal(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button type="submit" form="cw-rule-form" className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]"><FaSave /> Save Rule</button>
            </>
          }
        >
          <form id="cw-rule-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass}>Rule Name *</label>
              <input className={inputClass} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
            </div>
            <div>
              <label className={labelClass}>Commission Type</label>
              <select className={inputClass} value={form.commissionType} onChange={(e) => setForm((p) => ({ ...p, commissionType: e.target.value }))}>
                <option value="fixed">Fixed amount (Ksh)</option>
                <option value="percentage">Percentage of job price</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Rate ({form.commissionType === "percentage" ? "%" : "Ksh"}) *</label>
              <input
                type="number"
                min="0"
                max={form.commissionType === "percentage" ? 100 : undefined}
                step="0.01"
                className={inputClass}
                value={form.rate}
                onChange={(e) => setForm((p) => ({ ...p, rate: e.target.value }))}
                required
              />
              {form.commissionType === "percentage" && Number(form.rate) > 100 && (
                <p className="mt-0.5 text-[10px] font-bold text-red-500">Percentage cannot exceed 100%</p>
              )}
            </div>
            <div>
              <label className={labelClass}>Applies to Service</label>
              <select className={inputClass} value={form.service} onChange={(e) => setForm((p) => ({ ...p, service: e.target.value }))}>
                <option value="">All services</option>
                {services.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Applies to Staff</label>
              <select className={inputClass} value={form.staff} onChange={(e) => setForm((p) => ({ ...p, staff: e.target.value }))}>
                <option value="">All staff</option>
                {staff.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Priority</label>
              <input type="number" className={inputClass} value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))} />
              <p className="mt-0.5 text-[10px] text-slate-400">Higher priority wins when multiple rules match</p>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" id="rule-active" checked={form.active} onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))} className="accent-[#0B3B2E]" />
              <label htmlFor="rule-active" className="text-sm font-bold text-slate-700">Rule is active</label>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Notes</label>
              <textarea className="min-h-16 w-full border border-slate-300 px-2 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
            </div>
          </form>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashCommissionRules;

import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaEdit, FaPlus, FaRedoAlt, FaSave, FaToggleOff, FaToggleOn, FaTv } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import AppSelect from "../../components/common/AppSelect";
import ListToolbar from "../../components/common/ListToolbar";
import Modal from "../../components/common/Modal";
import { inputClass, labelClass } from "../../utils/formStyles";

const fmtSvc = (svc, fallback = "—") => svc ? (svc.category ? `${svc.category} — ${svc.name}` : svc.name) : fallback;
const emptyRule = { name: "", service: "", staff: "", commissionType: "fixed", rate: "", priority: 0, active: true, notes: "" };

// ─── Rule-edit modal — owns its own form state so keystrokes don't re-render the
// rules table behind it ─────────────────────────────────────────────────────────
const RuleModal = ({ editId, initialForm, services, staff, canManage, onSave, onClose }) => {
  const [form, setForm] = useState(initialForm);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    await onSave(form);
  };

  return (
    <Modal
      title={editId ? "Edit Commission Rule" : "New Commission Rule"}
      subtitle="Rules are matched by specificity: staff + service beats staff-only or service-only."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
          {canManage && <button type="submit" form="cw-rule-form" className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]"><FaSave /> Save Rule</button>}
        </>
      }
    >
      <form id="cw-rule-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Rule Name *</label>
          <input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </div>
        <div>
          <AppSelect
            label="Commission Type"
            value={form.commissionType}
            onChange={(v) => set("commissionType", v ?? "fixed")}
            options={[
              { value: "fixed", label: "Fixed amount (Ksh)" },
              { value: "percentage", label: "Percentage of job price" },
            ]}
            size="md"
          />
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
            onChange={(e) => set("rate", e.target.value)}
            required
          />
          {form.commissionType === "percentage" && Number(form.rate) > 100 && (
            <p className="mt-0.5 text-[10px] font-bold text-red-500">Percentage cannot exceed 100%</p>
          )}
        </div>
        <div>
          <AppSelect
            label="Applies to Service"
            value={form.service}
            onChange={(v) => set("service", v ?? "")}
            options={services.map((s) => ({ value: s._id, label: s.category ? `${s.category} — ${s.name}` : s.name }))}
            placeholder="All services"
            size="md"
            searchable
          />
        </div>
        <div>
          <AppSelect
            label="Applies to Staff"
            value={form.staff}
            onChange={(v) => set("staff", v ?? "")}
            options={staff.map((s) => ({ value: s._id, label: s.name }))}
            placeholder="All staff"
            size="md"
            searchable
          />
        </div>
        <div>
          <label className={labelClass}>Priority</label>
          <input type="number" className={inputClass} value={form.priority} onChange={(e) => set("priority", e.target.value)} />
          <p className="mt-0.5 text-[10px] text-slate-400">Higher priority wins when multiple rules match</p>
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input type="checkbox" id="rule-active" checked={form.active} onChange={(e) => set("active", e.target.checked)} className="accent-[#0B3B2E]" />
          <label htmlFor="rule-active" className="text-sm font-bold text-slate-700">Rule is active</label>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Notes</label>
          <textarea className="min-h-16 w-full border border-slate-300 px-2 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </form>
    </Modal>
  );
};

const CarWashCommissionRules = () => {
  const queryClient = useQueryClient();
  const canManage = useCarWashPermission("carwash-commissions", "manage");

  const [editInitialForm, setEditInitialForm] = useState(emptyRule);
  const [editId, setEditId]     = useState("");
  const [showModal, setShowModal] = useState(false);

  const { data: rulesRaw, isLoading: loading, refetch } = useQuery({
    queryKey: ["cw-commission-rules"],
    queryFn: () => carWashApi.listCommissionRules(),
    staleTime: 30_000,
    select: (data) => normalizeListPayload(data, "rules"),
  });
  const rules = useMemo(() => rulesRaw ?? [], [rulesRaw]);

  const { data: servicesRaw } = useQuery({
    queryKey: ["cw-services-ref"],
    queryFn: () => carWashApi.listServices({ active: true, limit: 500 }),
    staleTime: 5 * 60_000,
    select: (data) => normalizeListPayload(data, "services"),
  });
  const services = servicesRaw ?? [];

  const { data: staffRaw, refetch: refetchStaff } = useQuery({
    queryKey: ["cw-staff-ref"],
    queryFn: () => carWashApi.listStaff({ active: true }),
    staleTime: 5 * 60_000,
    select: (data) => normalizeListPayload(data, "staff"),
  });
  const staff = staffRaw ?? [];

  const [togglingId, setTogglingId] = useState("");
  const toggleEligibility = async (row) => {
    setTogglingId(row._id);
    try {
      await carWashApi.setStaffCommissionEligibility(row._id, row.commissionEligible === false);
      await Promise.all([refetchStaff(), queryClient.invalidateQueries({ queryKey: ["cw-staff"] })]);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update commission eligibility");
    } finally {
      setTogglingId("");
    }
  };

  const openNew = () => { setEditId(""); setEditInitialForm(emptyRule); setShowModal(true); };
  const openEdit = (rule) => {
    setEditId(rule._id);
    setEditInitialForm({
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

  const save = async (form) => {
    const payload = { ...form, rate: Number(form.rate || 0), priority: Number(form.priority || 0), service: form.service || null, staff: form.staff || null };
    try {
      if (editId) await carWashApi.updateCommissionRule(editId, payload);
      else await carWashApi.createCommissionRule(payload);
      setShowModal(false);
      queryClient.invalidateQueries({ queryKey: ["cw-commission-rules"] });
      toast.success("Commission rule saved");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save rule");
    }
  };

  const { activeCount, inactiveCount } = useMemo(() => {
    let activeCount = 0, inactiveCount = 0;
    for (const r of rules) { if (r.active === false) inactiveCount++; else activeCount++; }
    return { activeCount, inactiveCount };
  }, [rules]);

  // CarWashShell no longer renders its own header strip (showToolbar={false} below), so the
  // "Queue Display" button it used to carry is duplicated here, same handler, inside our own toolbar.
  const openQueueDisplay = () => {
    const activeId = localStorage.getItem("milik_active_company_id");
    if (!activeId) return;
    window.open(`/display/carwash/${activeId}`, "_blank", "noopener,noreferrer");
  };

  return (
    <CarWashShell showToolbar={false}>
      <ListToolbar className="mb-1">
        <ListToolbar.Button variant="outline" onClick={() => refetch()}>
          <FaRedoAlt size={9} className={loading ? "animate-spin" : ""} /> Refresh
        </ListToolbar.Button>
        <ListToolbar.Button icon={FaTv} variant="outline" onClick={openQueueDisplay} title="Open customer queue display screen">
          Queue Display
        </ListToolbar.Button>
        <ListToolbar.Divider />
        {canManage && (
          <ListToolbar.Button icon={FaPlus} variant="accent" onClick={openNew}>
            New Rule
          </ListToolbar.Button>
        )}
      </ListToolbar>
      <div className="mb-2 overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
          <p className="text-[11px] font-black uppercase tracking-wide text-slate-600">Staff Commission Eligibility</p>
          <p className="text-[10px] text-slate-500">Attendants switched off here never accrue commission on a job, regardless of any rule below — use this for salaried staff.</p>
        </div>
        <table className="w-full min-w-[520px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Staff</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Role</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Branch</th>
              <th className="px-3 py-1.5 text-center font-bold uppercase tracking-wide">Commission Eligible</th>
            </tr>
          </thead>
          <tbody>
            {staff.length ? staff.map((row) => (
              <tr key={row._id} className="border-b border-slate-200 hover:bg-slate-50">
                <td className="px-3 py-1.5 font-extrabold text-slate-900">{row.name}</td>
                <td className="px-3 py-1.5 text-slate-700">{row.role || "—"}</td>
                <td className="px-3 py-1.5 text-slate-700">{row.branch?.name || "—"}</td>
                <td className="px-3 py-1.5 text-center">
                  <button
                    type="button"
                    disabled={!canManage || togglingId === row._id}
                    onClick={() => toggleEligibility(row)}
                    title={row.commissionEligible === false ? "Salaried — click to enable commission" : "Commission eligible — click to switch to salaried"}
                    className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
                      row.commissionEligible === false
                        ? "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    }`}
                  >
                    {row.commissionEligible === false ? <FaToggleOff size={10} /> : <FaToggleOn size={10} />}
                    {row.commissionEligible === false ? "Salaried" : "Commission"}
                  </button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-xs font-semibold text-slate-500">No active staff found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-4 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Total Rules: <strong className="text-[#0B3B2E]">{rules.length}</strong></span>
          <span>Active: <strong className="text-emerald-700">{activeCount}</strong></span>
          <span>Inactive: <strong className="text-slate-500">{inactiveCount}</strong></span>
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
              {canManage && <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Action</th>}
            </tr>
          </thead>
          <tbody>
            {rules.length ? rules.map((rule) => (
              <tr key={rule._id} className={`border-b border-slate-200 hover:bg-slate-50 ${rule.active === false ? "opacity-50" : ""}`}>
                <td className="px-3 py-2 font-extrabold text-slate-900">{rule.name}</td>
                <td className="px-3 py-2 text-slate-700">{rule.service ? fmtSvc(rule.service) : <span className="italic text-slate-400">All services</span>}</td>
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
                {canManage && (
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => openEdit(rule)} title="Edit rule" className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                      <FaEdit size={12} />
                    </button>
                  </td>
                )}
              </tr>
            )) : (
              <tr><td colSpan={canManage ? 8 : 7} className="px-3 py-12 text-center text-xs font-semibold text-slate-500">
                {loading ? "Loading…" : "No commission rules yet. Click \"New Rule\" to create one."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <RuleModal
          editId={editId}
          initialForm={editInitialForm}
          services={services}
          staff={staff}
          canManage={canManage}
          onSave={save}
          onClose={() => setShowModal(false)}
        />
      )}
    </CarWashShell>
  );
};

export default CarWashCommissionRules;

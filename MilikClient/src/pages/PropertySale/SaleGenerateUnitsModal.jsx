import React, { useMemo, useState } from "react";
import { toast } from "react-toastify";
import { saleApi } from "../../services/propertySaleApi";
import { useTerms } from "../../hooks/useTerm";
import Modal from "../../components/common/Modal";
import AppSelect from "../../components/common/AppSelect";
import AmountInput from "./AmountInput";
import { inputClass, labelClass } from "../../utils/formStyles";
import { SIZE_UNIT_OPTIONS, errorMessage } from "./SaleProjectShared";

const MAX_PER_CALL = 500;
const textareaClass = "w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none";

const unitLabel = (prefix, n, pad) => `${prefix}${pad ? String(n).padStart(pad, "0") : n}`;

// Creates a numbered range of units (e.g. A-1 to A-120) inside a project in one call
export default function SaleGenerateUnitsModal({ project, propertyTypeOptions, agentFormOptions, onDone, onClose }) {
  const T = useTerms("saleUnit", "saleUnits", "saleProject", "saleAgent");
  const [form, setForm] = useState(() => ({
    prefix: "", from: "1", to: "", pad: "0", block: "",
    propertyType: propertyTypeOptions[0]?.value ?? "plot",
    size: "", sizeUnit: "sqm", askingPrice: "", assignedAgent: "",
    negotiable: true, titleDeedAvailable: false, description: "",
  }));
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));
  const setVal = (key) => (v) => setForm((p) => ({ ...p, [key]: v ?? "" }));
  const setCheck = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.checked }));

  const preview = useMemo(() => {
    const from = Number(form.from);
    const to = Number(form.to);
    if (form.from === "" || form.to === "" || !Number.isInteger(from) || !Number.isInteger(to) || from < 0) return { ok: false, text: `Enter the first and last ${T.saleUnit.toLowerCase()} numbers` };
    if (to < from) return { ok: false, text: "The last number must not be less than the first" };
    const count = to - from + 1;
    const pad = Math.min(Math.max(parseInt(form.pad, 10) || 0, 0), 6);
    const prefix = form.prefix.trim();
    const text = count === 1
      ? `${unitLabel(prefix, from, pad)} (1 ${T.saleUnit.toLowerCase()})`
      : `${unitLabel(prefix, from, pad)} … ${unitLabel(prefix, to, pad)} (${count} ${T.saleUnits.toLowerCase()})`;
    return { ok: count <= MAX_PER_CALL, text, count, over: count > MAX_PER_CALL };
  }, [form.from, form.to, form.pad, form.prefix, T.saleUnit, T.saleUnits]);

  const handleSave = async () => {
    if (!preview.ok) return toast.warning(preview.over ? `You can generate at most ${MAX_PER_CALL} ${T.saleUnits.toLowerCase()} at a time` : preview.text);
    if (form.askingPrice === "" || Number(form.askingPrice) < 0) return toast.warning("Asking price is required");
    setSaving(true);
    try {
      const res = await saleApi.generateProjectUnits(project._id, {
        prefix: form.prefix.trim(),
        from: Number(form.from),
        to: Number(form.to),
        pad: Number(form.pad) || 0,
        block: form.block.trim(),
        propertyType: form.propertyType,
        size: form.size === "" ? null : Number(form.size),
        sizeUnit: form.sizeUnit,
        askingPrice: Number(form.askingPrice),
        titleDeedAvailable: form.titleDeedAvailable,
        negotiable: form.negotiable,
        assignedAgent: form.assignedAgent || undefined,
        description: form.description,
      });
      await onDone?.();
      const skipped = res?.skipped ? `, ${res.skipped} skipped (already exist)` : "";
      toast.success(`${res?.created ?? 0} ${T.saleUnits.toLowerCase()} created${skipped}`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, `Failed to generate ${T.saleUnits.toLowerCase()}`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Generate ${T.saleUnits}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving || !preview.ok} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
            {saving ? "Generating…" : preview.ok ? `Generate ${preview.count}` : "Generate"}
          </button>
        </>
      }
    >
      <p className="mb-3 text-[11px] text-slate-500">
        Creates a numbered range of {T.saleUnits.toLowerCase()} in <span className="font-bold text-slate-700">{project.name}</span>. Location comes from the {T.saleProject.toLowerCase()};
        {" "}numbers that already exist are skipped, so it is safe to run a range again.
      </p>
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <label className={labelClass}>Prefix</label>
          <input value={form.prefix} onChange={set("prefix")} className={inputClass} placeholder="e.g. A-" maxLength={20} />
        </div>
        <div>
          <label className={labelClass}>From</label>
          <input type="number" min="0" value={form.from} onChange={set("from")} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>To</label>
          <input type="number" min="0" value={form.to} onChange={set("to")} className={inputClass} placeholder="e.g. 120" />
        </div>
        <div>
          <label className={labelClass}>Zero-pad width</label>
          <input type="number" min="0" max="6" value={form.pad} onChange={set("pad")} className={inputClass} />
        </div>

        <div className={`md:col-span-4 border px-3 py-2 text-xs font-bold ${preview.ok ? "border-[#B7C9C0] bg-[#F1F6F3] text-[#0B3B2E]" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          {preview.over
            ? `${preview.text} — too many: at most ${MAX_PER_CALL} per run, split it into several ranges`
            : preview.ok ? `Preview: ${preview.text}` : preview.text}
        </div>

        <div>
          <label className={labelClass}>Block / Phase</label>
          <input value={form.block} onChange={set("block")} className={inputClass} placeholder="Optional" />
        </div>
        <div>
          <AppSelect label="Property Type" value={form.propertyType} onChange={setVal("propertyType")} options={propertyTypeOptions} size="md" />
        </div>
        <div>
          <label className={labelClass}>Size</label>
          <div className="flex gap-1.5">
            <input type="number" min="0" value={form.size} onChange={set("size")} className="h-8 min-w-0 flex-1 border border-slate-200 bg-white px-3 text-xs focus:border-[#0B3B2E] focus:outline-none" placeholder="e.g. 50" />
            <AppSelect value={form.sizeUnit} onChange={setVal("sizeUnit")} options={SIZE_UNIT_OPTIONS} size="md" />
          </div>
        </div>
        <div>
          <label className={labelClass}>Asking Price (KES) *</label>
          <AmountInput value={form.askingPrice} onChange={setVal("askingPrice")} className={inputClass} placeholder="e.g. 1,500,000" />
        </div>
        <div className="md:col-span-2">
          <AppSelect label={`Assigned ${T.saleAgent}`} value={form.assignedAgent} onChange={setVal("assignedAgent")} options={agentFormOptions} placeholder="Unassigned" size="md" searchable clearable />
        </div>
        <div className="flex items-center gap-4 pt-4 md:col-span-2">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={form.negotiable} onChange={setCheck("negotiable")} className="accent-[#0B3B2E]" />
            <span className="text-xs font-semibold text-slate-700">Negotiable</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={form.titleDeedAvailable} onChange={setCheck("titleDeedAvailable")} className="accent-[#0B3B2E]" />
            <span className="text-xs font-semibold text-slate-700">Title Deed Available</span>
          </label>
        </div>
        <div className="md:col-span-4">
          <label className={labelClass}>Description</label>
          <textarea rows={2} value={form.description} onChange={set("description")} className={textareaClass} />
        </div>
      </div>
    </Modal>
  );
}

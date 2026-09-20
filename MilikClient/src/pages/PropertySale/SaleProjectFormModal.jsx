import React, { useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { saleApi } from "../../services/propertySaleApi";
import { useTerms } from "../../hooks/useTerm";
import Modal from "../../components/common/Modal";
import AmountInput from "./AmountInput";
import SalePhotosField from "./SalePhotosField";
import useSalePhotoDraft from "../../hooks/useSalePhotoDraft";
import { inputClass, labelClass } from "../../utils/formStyles";
import AppSelect from "../../components/common/AppSelect";
import { errorMessage, useSaleFormOptions } from "./SaleProjectShared";

const textareaClass = "w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none";

const blankForm = () => ({
  name: "", description: "", location: "", town: "", county: "", country: "Kenya",
  launchDate: "", targetUnits: "", targetValue: "", notes: "", assignedAgent: "",
});

const formFromProject = (p) => ({
  name: p.name || "", description: p.description || "", location: p.location || "",
  town: p.town || "", county: p.county || "", country: p.country || "Kenya",
  launchDate: p.launchDate ? new Date(p.launchDate).toISOString().split("T")[0] : "",
  targetUnits: p.targetUnits ?? "", targetValue: p.targetValue ?? "", notes: p.notes || "",
  assignedAgent: p.assignedAgent?._id || p.assignedAgent || "",
});

// Create / edit a project. Owns its form state so typing never re-renders the page behind it.
export default function SaleProjectFormModal({ project = null, onSaved, onClose }) {
  const T = useTerms("saleProject", "saleUnits", "saleAgent");
  const biz = useSelector((s) => s.company?.currentCompany?._id);
  const { agentFormOptions } = useSaleFormOptions(biz);
  const [form, setForm] = useState(() => (project ? formFromProject(project) : blankForm()));
  const [saving, setSaving] = useState(false);

  // Photos: staged until the project exists, then uploaded straight away (same behaviour as the listing form)
  const photos = useSalePhotoDraft({
    entityId: project?._id || "",
    initialImages: project?.images ?? [],
    upload: saleApi.uploadProjectImages,
    remove: saleApi.deleteProjectImage,
    onChanged: onSaved,
  });
  const handleClose = () => {
    photos.clearStaged();
    onClose();
  };

  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  const handleSave = async () => {
    if (!form.name.trim()) return toast.warning(`${T.saleProject} name is required`);
    setSaving(true);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        targetUnits: form.targetUnits === "" ? null : Number(form.targetUnits),
        targetValue: form.targetValue === "" ? null : Number(form.targetValue),
        launchDate: form.launchDate || null,
        assignedAgent: form.assignedAgent || null,
      };
      const saved = project ? await saleApi.updateProject(project._id, payload) : await saleApi.createProject(payload);
      if (!project) await photos.uploadStaged(saved?._id);
      await onSaved?.(saved);
      toast.success(`${T.saleProject} ${project ? "updated" : "created"}`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, `Failed to save ${T.saleProject.toLowerCase()}`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={project ? `Edit ${T.saleProject}` : `New ${T.saleProject}`}
      size="lg"
      onClose={handleClose}
      footer={
        <>
          <button type="button" onClick={handleClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
            {saving ? "Saving…" : project ? `Update ${T.saleProject}` : `Create ${T.saleProject}`}
          </button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className={labelClass}>Name *</label>
          <input value={form.name} onChange={set("name")} className={inputClass} placeholder="e.g. Kitengela Gardens Phase 2" autoFocus />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass}>Description</label>
          <textarea rows={2} value={form.description} onChange={set("description")} className={textareaClass} />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass}>Location / Address</label>
          <input value={form.location} onChange={set("location")} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Town / City</label>
          <input value={form.town} onChange={set("town")} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>County</label>
          <input value={form.county} onChange={set("county")} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Country</label>
          <input value={form.country} onChange={set("country")} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Launch Date</label>
          <input type="date" value={form.launchDate} onChange={set("launchDate")} className={inputClass} />
        </div>
        <div className="md:col-span-2">
          <AppSelect
            label={`Default ${T.saleAgent} for ${T.saleUnits.toLowerCase()}`}
            value={form.assignedAgent}
            onChange={(v) => setForm((p) => ({ ...p, assignedAgent: v ?? "" }))}
            options={agentFormOptions}
            placeholder="None"
            size="md"
            searchable
            clearable
          />
          <p className="mt-1 text-[10px] text-slate-400">
            Every {T.saleUnits.toLowerCase()} without its own {T.saleAgent.toLowerCase()} follows this one. Set an {T.saleAgent.toLowerCase()} on a single {T.saleUnits.toLowerCase()} to override it.
          </p>
        </div>
        <div>
          <label className={labelClass}>Target {T.saleUnits}</label>
          <input type="number" min="0" value={form.targetUnits} onChange={set("targetUnits")} className={inputClass} placeholder="Optional" />
        </div>
        <div>
          <label className={labelClass}>Target Value (KES)</label>
          <AmountInput value={form.targetValue} onChange={(v) => setForm((p) => ({ ...p, targetValue: v }))} className={inputClass} placeholder="Optional" />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass}>Internal Notes</label>
          <textarea rows={2} value={form.notes} onChange={set("notes")} className={textareaClass} />
        </div>
        <div className="md:col-span-2">
          <SalePhotosField photos={photos} hasRecord={Boolean(project)} />
        </div>
      </div>
    </Modal>
  );
}

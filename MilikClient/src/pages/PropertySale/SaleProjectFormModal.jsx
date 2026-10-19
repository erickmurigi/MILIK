import React, { useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { saleApi } from "../../services/propertySaleApi";
import { useTerms } from "../../hooks/useTerm";
import Modal from "../../components/common/Modal";
import AmountInput from "./AmountInput";
import SalePhotosField from "./SalePhotosField";
import useSalePhotoDraft from "../../hooks/useSalePhotoDraft";
import AppSelect from "../../components/common/AppSelect";
import { errorMessage } from "./SaleProjectShared";
import useSaleFormOptions from "../../hooks/useSaleFormOptions";

// Local override, not the shared utils/formStyles.js — that file's labelClass/inputClass predate the
// bold-value-matches-label-weight convention now standard across PropertySale forms (see
// SaleActivityFormModal.jsx / AppSelect.jsx's label and selected-value weight).
const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "w-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const textareaClass = "w-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:border-[#0B3B2E] focus:outline-none";
const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

const blankForm = () => ({
  name: "", description: "", location: "", town: "", county: "", country: "Kenya",
  launchDate: "", targetUnits: "", targetValue: "", notes: "", assignedAgent: "", assignedAdvocate: "", owner: "",
});

const formFromProject = (p) => ({
  name: p.name || "", description: p.description || "", location: p.location || "",
  town: p.town || "", county: p.county || "", country: p.country || "Kenya",
  launchDate: p.launchDate ? new Date(p.launchDate).toISOString().split("T")[0] : "",
  targetUnits: p.targetUnits ?? "", targetValue: p.targetValue ?? "", notes: p.notes || "",
  assignedAgent: p.assignedAgent?._id || p.assignedAgent || "",
  assignedAdvocate: p.assignedAdvocate?._id || p.assignedAdvocate || "",
  owner: p.owner?._id || p.owner || "",
});

// Create / edit a project. Owns its form state so typing never re-renders the page behind it.
export default function SaleProjectFormModal({ project = null, onSaved, onClose }) {
  const T = useTerms("saleProject", "saleUnits", "saleAgent", "saleAdvocate", "saleOwner");
  const biz = useSelector((s) => s.company?.currentCompany?._id);
  const { agentFormOptions, advocateFormOptions, ownerFormOptions, saleSettings } = useSaleFormOptions(biz);
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
        assignedAdvocate: form.assignedAdvocate || null,
        owner: form.owner || null,
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
      size="extraWide"
      onClose={handleClose}
      footer={
        <>
          <button type="button" onClick={handleClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
            {saving ? "Saving…" : project ? `Update ${T.saleProject}` : `Create ${T.saleProject}`}
          </button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-3">
          <label className={labelClass}>Name<Required /></label>
          <input value={form.name} onChange={set("name")} className={inputClass} placeholder="e.g. Kitengela Gardens Phase 2" autoFocus />
        </div>
        <div className="md:col-span-3">
          <label className={labelClass}>Description</label>
          <textarea rows={2} value={form.description} onChange={set("description")} className={textareaClass} />
        </div>
        <div className="md:col-span-3">
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
        <div>
          <label className={labelClass}>Target {T.saleUnits}</label>
          <input type="number" min="0" value={form.targetUnits} onChange={set("targetUnits")} className={inputClass} placeholder="Optional" />
        </div>
        <div>
          <label className={labelClass}>Target Value (KES)</label>
          <AmountInput value={form.targetValue} onChange={(v) => setForm((p) => ({ ...p, targetValue: v }))} className={inputClass} placeholder="Optional" />
        </div>
        <div>
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
            Every {T.saleUnits.toLowerCase()} without its own {T.saleAgent.toLowerCase()} follows this one.
          </p>
        </div>
        {saleSettings?.useAdvocates && (
          <div>
            <AppSelect
              label={`Default ${T.saleAdvocate} for ${T.saleUnits.toLowerCase()}`}
              value={form.assignedAdvocate}
              onChange={(v) => setForm((p) => ({ ...p, assignedAdvocate: v ?? "" }))}
              options={advocateFormOptions}
              placeholder="None"
              size="md"
              searchable
              clearable
            />
            <p className="mt-1 text-[10px] text-slate-400">
              Every deal under this {T.saleProject.toLowerCase()} is prefilled with this {T.saleAdvocate.toLowerCase()}, unless overridden.
            </p>
          </div>
        )}
        {saleSettings?.useOwners && (
          <div>
            <AppSelect
              label={T.saleOwner}
              value={form.owner}
              onChange={(v) => setForm((p) => ({ ...p, owner: v ?? "" }))}
              options={ownerFormOptions}
              placeholder="None"
              size="md"
              searchable
              clearable
            />
            <p className="mt-1 text-[10px] text-slate-400">
              Who this is sold on behalf of. Leave empty if the company sells for itself.
            </p>
          </div>
        )}
        <div className="md:col-span-3">
          <label className={labelClass}>Internal Notes</label>
          <textarea rows={2} value={form.notes} onChange={set("notes")} className={textareaClass} />
        </div>
        <div className="md:col-span-3">
          <SalePhotosField photos={photos} hasRecord={Boolean(project)} />
        </div>
      </div>
    </Modal>
  );
}

import React, { useState } from "react";
import { toast } from "react-toastify";
import { saleApi } from "../../services/propertySaleApi";
import { useTerms } from "../../hooks/useTerm";
import useSalePhotoDraft from "../../hooks/useSalePhotoDraft";
import SalePhotosField from "./SalePhotosField";
import AmountInput from "./AmountInput";
import AppSelect from "../../components/common/AppSelect";
import Modal from "../../components/common/Modal";
import { inputClass, labelClass } from "../../utils/formStyles";
import { SIZE_UNIT_OPTIONS } from "../../utils/saleListingConstants";


// `project` ({ _id, name }) marks the listing as a unit inside that project: the form then asks for a unit number and
// block, and a new unit is created inside the project. Without it this is an ordinary standalone listing.
export default function SaleListingFormModal({ initialEditingId, initialForm, listings, biz, propertyTypeOptions, agentFormOptions, invalidate, onClose, project = null }) {
  const T = useTerms("saleListing", "saleAgent", "saleUnit", "saleProject");
  const [editingId,   setEditingId]   = useState(initialEditingId);
  const [justCreated, setJustCreated] = useState(false);
  const [form,        setForm]        = useState(initialForm);
  const [saving,      setSaving]      = useState(false);

  // Photos: staged locally until the listing exists, then uploaded straight away (shared with the project form)
  const photos = useSalePhotoDraft({
    entityId: editingId,
    initialImages: listings.find((l) => l._id === initialEditingId)?.images ?? [],
    upload: saleApi.uploadListingImages,
    remove: saleApi.deleteListingImage,
    onChanged: invalidate,
  });

  const handleClose = () => {
    photos.clearStaged();
    onClose();
  };

  const handleSave = async () => {
    if (!form.title.trim()) return toast.warning("Title is required");
    if (project && !String(form.unitNumber ?? "").trim()) return toast.warning(`${T.saleUnit} number is required`);
    if (!form.askingPrice || Number(form.askingPrice) <= 0) return toast.warning("Valid asking price is required");
    setSaving(true);
    try {
      const payload = {
        ...form, business: biz,
        askingPrice: Number(form.askingPrice),
        size: form.size ? Number(form.size) : null,
        amenities: form.amenities ? form.amenities.split(",").map((s) => s.trim()).filter(Boolean) : [],
        assignedAgent: form.assignedAgent || undefined,
        // A new unit is created inside its project; the server ignores `project` on edits
        ...(project && { project: project._id }),
      };
      if (editingId) {
        await saleApi.updateListing(editingId, payload);
        await invalidate();
        onClose();
        toast.success(`${T.saleListing} updated`);
      } else {
        const created = await saleApi.createListing(payload);
        const newId = created?._id || "";
        await photos.uploadStaged(newId);
        await invalidate();
        setEditingId(newId);
        setJustCreated(true);
        toast.success(`${T.saleListing} saved — add more photos below or click Done`);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || `Failed to save ${T.saleListing.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={editingId ? `Edit ${project ? T.saleUnit : T.saleListing}` : `New ${project ? T.saleUnit : T.saleListing}`}
      extraWide
      onClose={handleClose}
      footer={
        <>
          <button type="button" onClick={handleClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
            {justCreated ? "Done" : "Cancel"}
          </button>
          {!justCreated && (
            <button type="button" onClick={handleSave} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
              {saving ? "Saving…" : editingId ? `Update ${T.saleListing}` : `Save ${T.saleListing}`}
            </button>
          )}
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="md:col-span-2 xl:col-span-2">
          <label className={labelClass}>Title / Property Name</label>
          <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} className={inputClass} />
        </div>
        {project && (
          <>
            <div>
              <label className={labelClass}>{T.saleProject}</label>
              <input value={project.name} readOnly className={`${inputClass} bg-slate-50 text-slate-500`} />
            </div>
            <div>
              <label className={labelClass}>{T.saleUnit} No.</label>
              <input value={form.unitNumber ?? ""} onChange={(e) => setForm((p) => ({ ...p, unitNumber: e.target.value }))} className={inputClass} placeholder="e.g. A-12" />
            </div>
            <div>
              <label className={labelClass}>Block / Phase</label>
              <input value={form.block ?? ""} onChange={(e) => setForm((p) => ({ ...p, block: e.target.value }))} className={inputClass} placeholder="Optional" />
            </div>
          </>
        )}
        <div>
          <AppSelect label="Property Type" value={form.propertyType} onChange={(v) => setForm((p) => ({ ...p, propertyType: v ?? "" }))} options={propertyTypeOptions} size="md" />
        </div>
        <div>
          <label className={labelClass}>Asking Price (KES)</label>
          <AmountInput value={form.askingPrice} onChange={(v) => setForm((p) => ({ ...p, askingPrice: v }))} className={inputClass} placeholder="e.g. 8,500,000" />
        </div>
        <div>
          <label className={labelClass}>Size</label>
          <div className="flex gap-1.5">
            <input type="number" value={form.size} onChange={(e) => setForm((p) => ({ ...p, size: e.target.value }))} className="h-8 flex-1 border border-slate-200 bg-white px-3 text-xs focus:border-[#0B3B2E] focus:outline-none" placeholder="e.g. 50" />
            <AppSelect value={form.sizeUnit} onChange={(v) => setForm((p) => ({ ...p, sizeUnit: v ?? "" }))} options={SIZE_UNIT_OPTIONS} size="md" />
          </div>
        </div>
        <div>
          <AppSelect label={`Assigned ${T.saleAgent}`} value={form.assignedAgent} onChange={(v) => setForm((p) => ({ ...p, assignedAgent: v ?? "" }))} options={agentFormOptions} placeholder={project?.assignedAgent?.fullName ? `Inherited: ${project.assignedAgent.fullName}` : "Unassigned"} size="md" searchable clearable />
        </div>
        <div>
          <label className={labelClass}>Location / Address</label>
          <input value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Town / City</label>
          <input value={form.town} onChange={(e) => setForm((p) => ({ ...p, town: e.target.value }))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>County</label>
          <input value={form.county} onChange={(e) => setForm((p) => ({ ...p, county: e.target.value }))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Listed Date</label>
          <input type="date" value={form.listedDate} onChange={(e) => setForm((p) => ({ ...p, listedDate: e.target.value }))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Title Deed No.</label>
          <input value={form.titleDeedNumber} onChange={(e) => setForm((p) => ({ ...p, titleDeedNumber: e.target.value }))} className={inputClass} />
        </div>
        <div className="flex items-center gap-4 pt-4">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={form.negotiable} onChange={(e) => setForm((p) => ({ ...p, negotiable: e.target.checked }))} className="accent-[#0B3B2E]" />
            <span className="text-xs font-semibold text-slate-700">Negotiable</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={form.titleDeedAvailable} onChange={(e) => setForm((p) => ({ ...p, titleDeedAvailable: e.target.checked }))} className="accent-[#0B3B2E]" />
            <span className="text-xs font-semibold text-slate-700">Title Deed Available</span>
          </label>
        </div>
        <div className="md:col-span-2 xl:col-span-3">
          <label className={labelClass}>Amenities (comma-separated)</label>
          <input value={form.amenities} onChange={(e) => setForm((p) => ({ ...p, amenities: e.target.value }))} className={inputClass} placeholder="Borehole, Power, Road access…" />
        </div>
        <div className="md:col-span-2 xl:col-span-3">
          <label className={labelClass}>Description</label>
          <textarea rows={3} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
        </div>
        <div className="md:col-span-2 xl:col-span-3">
          <label className={labelClass}>Internal Notes</label>
          <textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
        </div>
        {/* Photos — shown for both Add and Edit */}
        <div className="md:col-span-2 xl:col-span-3">
          {justCreated && (
            <div className="mb-2 flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
              ✓ {project ? T.saleUnit : T.saleListing} saved — add more photos below (optional), then click Done.
            </div>
          )}
          <SalePhotosField photos={photos} hasRecord={Boolean(editingId)} />
        </div>
      </div>
    </Modal>
  );
}

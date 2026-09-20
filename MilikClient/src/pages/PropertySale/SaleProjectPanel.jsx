import React, { useState } from "react";
import { FaEdit, FaExternalLinkAlt, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import StatusBadge from "../../components/common/StatusBadge";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import { useTerms } from "../../hooks/useTerm";
import SalePhotoGallery from "./SalePhotoGallery";
import SaleProjectProgressBar from "./SaleProjectProgressBar";
import { PROJECT_STATUS_MAP, errorMessage, fmtPct } from "./SaleProjectShared";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : null);

// Right-hand detail panel of the Projects list (same pattern as the Listings panel): summary, photos, quick actions.
export default function SaleProjectPanel({ project, onClose, onOpen, onEdit, onChanged }) {
  const T = useTerms("saleProject", "saleUnits", "saleAgent");
  const [busy, setBusy] = useState(false);
  const u = project.units || {};

  const upload = async (files) => {
    setBusy(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("images", f));
      await saleApi.uploadProjectImages(project._id, fd);
      await onChanged?.();
      toast.success(`${files.length} photo${files.length > 1 ? "s" : ""} uploaded`);
    } catch (err) {
      toast.error(errorMessage(err, "Upload failed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (url) => {
    setBusy(true);
    try {
      await saleApi.deleteProjectImage(project._id, url);
      await onChanged?.();
      toast.success("Photo removed");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to remove photo"));
    } finally {
      setBusy(false);
    }
  };

  const rows = [
    ["Location", [project.town, project.county].filter(Boolean).join(", ") || project.location],
    [T.saleAgent, project.assignedAgent?.fullName],
    [T.saleUnits, `${u.total || 0} (${u.available || 0} available)`],
    ["Sold", `${u.sold || 0} · ${fmtPct(project.sellThrough)} sell-through`],
    ["Value", fmtKES(project.value?.total || 0)],
    ["Launched", fmtDate(project.launchDate)],
    ["Target", project.targetUnits ? `${project.targetUnits} ${T.saleUnits.toLowerCase()}` : null],
  ].filter(([, v]) => v);

  return (
    <div className="absolute bottom-0 right-0 top-0 z-10 flex w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-xl sm:w-[360px]">
      <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-3 text-white">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-wider text-white/60">{project.projectNumber}</div>
            <div className="mt-0.5 truncate text-sm font-black leading-tight">{project.name}</div>
          </div>
          <button type="button" onClick={onClose} className="flex-shrink-0 p-1 text-white/70 hover:bg-white/10"><FaTimes size={12} /></button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <StatusBadge status={project.status} map={PROJECT_STATUS_MAP} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">{T.saleProject} Details</div>
          <SaleProjectProgressBar units={u} className="mb-3" />
          <div className="space-y-1.5">
            {rows.map(([label, val]) => (
              <div key={label} className="flex items-baseline gap-2">
                <span className="w-[80px] flex-shrink-0 text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</span>
                <span className="text-xs text-slate-800">{val}</span>
              </div>
            ))}
          </div>
          {project.description && <p className="mt-3 text-[11px] leading-relaxed text-slate-500">{project.description}</p>}
        </div>

        <SalePhotoGallery
          images={project.images || []}
          busy={busy}
          onUpload={upload}
          onDelete={remove}
          emptyHint={`Upload photos to showcase this ${T.saleProject.toLowerCase()} to buyers`}
        />
      </div>

      <div className="flex flex-shrink-0 items-center justify-between gap-1 border-t border-slate-200 bg-slate-50 px-3 py-2">
        <button
          type="button"
          onClick={() => onEdit(project)}
          className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
        >
          <FaEdit size={9} /> Edit
        </button>
        <button
          type="button"
          onClick={() => onOpen(project)}
          className="inline-flex items-center gap-1 bg-[#0B3B2E] px-3 py-1 text-[11px] font-bold text-white hover:bg-[#07271e]"
        >
          <FaExternalLinkAlt size={9} /> Open {T.saleProject}
        </button>
      </div>
    </div>
  );
}

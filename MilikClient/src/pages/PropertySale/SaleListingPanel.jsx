import React, { useState } from "react";
import { FaEdit, FaPrint, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import StatusBadge from "../../components/common/StatusBadge";
import { saleApi } from "../../services/propertySaleApi";
import { LISTING_STATUS_MAP } from "../../utils/saleListingConstants";
import SalePhotoGallery from "./SalePhotoGallery";

const errorMessage = (err, fallback) => err?.response?.data?.message || fallback;

/**
 * Right-hand detail panel for a listing or a unit (same panel on the Listings and Units pages): header, details,
 * photos (upload / delete), and quick actions. `detailRows` is a list of [label, value] pairs built by the page (blank
 * values are skipped). Reserve / Release show only when the page passes onStatusChange.
 */
export default function SaleListingPanel({
  row, detailsTitle, detailRows, editLabel, emptyHint = "Upload photos to showcase this property to buyers",
  onClose, onEdit, onPrint, onChanged, statusBusy, onStatusChange,
}) {
  const [busy, setBusy] = useState(false);

  const upload = async (files) => {
    setBusy(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("images", f));
      await saleApi.uploadListingImages(row._id, fd);
      await onChanged?.();
      toast.success(`${files.length} photo${files.length > 1 ? "s" : ""} uploaded`);
    } catch (err) {
      toast.error(errorMessage(err, "Upload failed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (url) => {
    if (busy) return;
    setBusy(true);
    try {
      await saleApi.deleteListingImage(row._id, url);
      await onChanged?.();
      toast.success("Photo removed");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to remove photo"));
    } finally {
      setBusy(false);
    }
  };

  const statusBusyNow = Boolean(statusBusy?.[row._id]);

  return (
    <div className="absolute right-0 top-0 bottom-0 z-10 flex w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-xl sm:w-[360px]">
      <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-3 text-white">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-wider text-white/60">{row.listingNumber}</div>
            <div className="mt-0.5 truncate text-sm font-black leading-tight">{row.title}</div>
          </div>
          <button type="button" onClick={onClose} className="flex-shrink-0 p-1 text-white/70 hover:bg-white/10"><FaTimes size={12} /></button>
        </div>
        <div className="mt-2">
          <StatusBadge status={row.status} map={LISTING_STATUS_MAP} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">{detailsTitle}</div>
          <div className="space-y-1.5">
            {detailRows.filter(([, v]) => v).map(([label, val]) => (
              <div key={label} className="flex items-baseline gap-2">
                <span className="w-[80px] flex-shrink-0 text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</span>
                <span className="text-xs capitalize text-slate-800">{val}</span>
              </div>
            ))}
          </div>
        </div>

        <SalePhotoGallery images={row.images || []} busy={busy} onUpload={upload} onDelete={remove} emptyHint={emptyHint} />
      </div>

      <div className="flex flex-shrink-0 items-center justify-between gap-1 border-t border-slate-200 bg-slate-50 px-3 py-2">
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPrint(row)}
            className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaPrint size={9} /> Print
          </button>
          {onStatusChange && row.status === "available" && (
            <button type="button" disabled={statusBusyNow} onClick={() => onStatusChange(row, "reserved")} className="border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50">
              Reserve
            </button>
          )}
          {onStatusChange && row.status === "reserved" && (
            <button type="button" disabled={statusBusyNow} onClick={() => onStatusChange(row, "available")} className="border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">
              Release
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => onEdit(row)}
          className="inline-flex items-center gap-1 bg-[#0B3B2E] px-3 py-1 text-[11px] font-black text-white hover:bg-[#07271e]"
        >
          <FaEdit size={9} /> {editLabel}
        </button>
      </div>
    </div>
  );
}

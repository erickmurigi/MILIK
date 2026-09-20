import React, { useCallback, useEffect, useRef, useState } from "react";
import { FaCamera, FaChevronLeft, FaChevronRight, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { imgSrc } from "../../utils/saleImage";

const MAX_BYTES = 10 * 1024 * 1024;

// The "Photos" block of a detail panel: thumbnail grid, full-screen viewer (arrow keys / Escape), and an upload zone.
// Omit onUpload / onDelete to make it read-only. Shared by the listing, unit and project panels.
export default function SalePhotoGallery({ images = [], busy = false, onUpload, onDelete, emptyHint = "Upload photos to showcase this to buyers" }) {
  const fileRef = useRef(null);
  const [lightbox, setLightbox] = useState({ open: false, index: 0 });
  const count = images.length;

  const close = useCallback(() => setLightbox({ open: false, index: 0 }), []);

  // Derived, so the viewer stays valid (and closes) when photos are deleted while it is open
  const isOpen = lightbox.open && count > 0;
  const index = Math.min(lightbox.index, Math.max(count - 1, 0));

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") setLightbox((p) => ({ ...p, index: Math.max(0, Math.min(p.index, count - 1) - 1) }));
      if (e.key === "ArrowRight") setLightbox((p) => ({ ...p, index: Math.min(count - 1, Math.min(p.index, count - 1) + 1) }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, count, close]);

  const handleFiles = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !onUpload) return;
    const valid = files.filter((f) => f.size <= MAX_BYTES);
    if (valid.length < files.length) toast.warning(`${files.length - valid.length} file(s) exceed 10 MB and were skipped`);
    if (valid.length) onUpload(valid);
  };

  return (
    <div className="px-4 py-3">
      <div className="mb-3 flex items-baseline gap-1.5">
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Photos</span>
        <span className="text-[10px] font-bold text-slate-500">({count})</span>
      </div>

      {count > 0 ? (
        <div className="mb-3 grid grid-cols-2 gap-1.5">
          {images.map((url, idx) => (
            <div
              key={url}
              className="group relative aspect-[4/3] cursor-zoom-in overflow-hidden border border-slate-200 bg-slate-100"
              onClick={() => setLightbox({ open: true, index: idx })}
            >
              <img
                src={imgSrc(url)}
                alt={`Photo ${idx + 1}`}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/20" />
              <div className="absolute bottom-1 left-1.5 text-[9px] font-black text-white/90 opacity-0 transition-opacity group-hover:opacity-100">
                {idx + 1} / {count}
              </div>
              {onDelete && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(url); }}
                  disabled={busy}
                  className="absolute right-1 top-1 bg-black/55 p-1 text-white opacity-0 transition-opacity hover:bg-red-600 disabled:cursor-not-allowed group-hover:opacity-100"
                >
                  <FaTimes size={9} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-3 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-200 bg-slate-50/60 py-10">
          <FaCamera size={28} className="text-slate-200" />
          <div className="text-xs font-semibold text-slate-400">No photos yet</div>
          {onUpload && <div className="px-4 text-center text-[9px] text-slate-300">{emptyHint}</div>}
        </div>
      )}

      {onUpload && (
        <>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleFiles} />
          <div
            className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 border-2 border-dashed py-4 transition-colors ${busy ? "cursor-wait border-slate-200 bg-slate-50" : "border-[#B7C9C0] bg-[#F1F6F3]/60 hover:border-[#0B3B2E]/30 hover:bg-[#F1F6F3]"}`}
            onClick={() => !busy && fileRef.current?.click()}
          >
            {busy ? (
              <>
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#0B3B2E] border-t-transparent" />
                <div className="text-[11px] font-bold text-[#0B3B2E]">Uploading…</div>
              </>
            ) : (
              <>
                <FaCamera size={18} className="text-[#0B3B2E]/40" />
                <div className="text-[11px] font-bold text-[#0B3B2E]">Upload Photos</div>
                <div className="text-[9px] text-slate-400">Click to select &bull; JPEG, PNG, WebP &bull; 10 MB each</div>
              </>
            )}
          </div>
        </>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90" onClick={close}>
          {index > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightbox({ open: true, index: index - 1 }); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/70 hover:bg-white/10 hover:text-white"
            >
              <FaChevronLeft size={22} />
            </button>
          )}
          <img
            src={imgSrc(images[index])}
            alt={`Photo ${index + 1}`}
            className="max-h-[85vh] max-w-[calc(100vw-140px)] object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {index < count - 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightbox({ open: true, index: index + 1 }); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/70 hover:bg-white/10 hover:text-white"
            >
              <FaChevronRight size={22} />
            </button>
          )}
          <button type="button" onClick={close} className="absolute right-5 top-5 p-2 text-white/70 hover:bg-white/10 hover:text-white">
            <FaTimes size={16} />
          </button>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-xs font-semibold tracking-widest text-white/50">
            {index + 1} / {count}
          </div>
        </div>
      )}
    </div>
  );
}

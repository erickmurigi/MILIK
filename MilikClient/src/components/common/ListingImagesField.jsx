// components/Common/ListingImagesField.jsx
import React, { useRef } from "react";
import { FaTrash, FaPlus, FaImage } from "react-icons/fa";
import { cloudinaryUrl } from "../../utils/cloudinaryUrl";

/**
 * Controlled photo picker used by the Unit and Property forms to build public
 * listing galleries. Fully controlled — the parent owns state and does the
 * actual upload/delete API calls (endpoints differ: /units/:id/images vs
 * /properties/:id/images), this component only renders and emits events.
 *
 * `existingImages` are already-uploaded Cloudinary URLs (edit mode).
 * `stagedFiles` are File objects picked but not yet uploaded (new records
 * can't be uploaded to until the entity has an _id, so files are staged and
 * uploaded right after the create call resolves).
 */
export default function ListingImagesField({
  label = "Photos",
  existingImages = [],
  stagedFiles = [],
  onFilesSelected,
  onRemoveExisting,
  onRemoveStaged,
  disabled = false,
  maxImages = 12,
}) {
  const inputRef = useRef(null);
  const totalCount = existingImages.length + stagedFiles.length;
  const atLimit = totalCount >= maxImages;

  const handleChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const remaining = Math.max(maxImages - totalCount, 0);
    onFilesSelected(files.slice(0, remaining));
    e.target.value = "";
  };

  return (
    <div className="xl:col-span-12">
      <label className="mb-0.5 block text-xs font-semibold text-slate-700">
        {label}
        <span className="ml-1.5 font-normal text-slate-400">
          — {totalCount}/{maxImages} added
        </span>
      </label>

      <div className="flex flex-wrap gap-3 mt-1.5">
        {existingImages.map((url) => (
          <div key={url} className="relative w-24 h-24 rounded-lg overflow-hidden border border-slate-200 group">
            <img src={cloudinaryUrl(url, { width: 192, height: 192 })} alt="" className="w-full h-full object-cover" loading="lazy" />
            <button
              type="button"
              onClick={() => onRemoveExisting(url)}
              disabled={disabled}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove photo"
            >
              <FaTrash />
            </button>
          </div>
        ))}

        {stagedFiles.map((file, idx) => (
          <div key={`${file.name}-${idx}`} className="relative w-24 h-24 rounded-lg overflow-hidden border border-dashed border-[#0B3B2E]/40 group">
            <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
            <span className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[9px] text-center py-0.5">
              Pending
            </span>
            <button
              type="button"
              onClick={() => onRemoveStaged(idx)}
              disabled={disabled}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove"
            >
              <FaTrash />
            </button>
          </div>
        ))}

        {!atLimit && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="w-24 h-24 rounded-lg border-2 border-dashed border-slate-300 hover:border-[#0B3B2E] flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-[#0B3B2E] transition-colors"
          >
            <FaPlus className="text-sm" />
            <span className="text-[10px] font-semibold">Add Photo</span>
          </button>
        )}

        {totalCount === 0 && (
          <div className="hidden sm:flex w-24 h-24 rounded-lg bg-slate-50 items-center justify-center text-slate-300">
            <FaImage className="text-2xl" />
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />
      <p className="mt-1 text-xs text-slate-500">JPEG, PNG or WebP, up to 5MB each.</p>
    </div>
  );
}

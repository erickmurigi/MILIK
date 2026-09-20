import React, { useRef } from "react";
import { FaCamera, FaTimes } from "react-icons/fa";
import { imgSrc } from "../../utils/saleImage";
import { labelClass } from "../../utils/formStyles";

// The "Photos" section of a sales form (listing, project). `photos` is the object returned by useSalePhotoDraft;
// `hasRecord` says whether the record already exists (photos then upload immediately instead of waiting for Save).
export default function SalePhotosField({ photos, hasRecord }) {
  const fileRef = useRef(null);
  const { saved, staged, busy, addFiles, removeStaged, deleteSaved } = photos;

  const onPick = (e) => {
    const files = e.target.files;
    // addFiles copies the list before awaiting, so the input can be reset straight away
    addFiles(files);
    e.target.value = "";
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className={labelClass}>Photos</label>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-50"
        >
          <FaCamera size={9} /> {busy ? "Uploading…" : "Add Photos"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onPick} />
      </div>
      {(saved.length > 0 || staged.length > 0) ? (
        <div className="flex flex-wrap gap-2">
          {saved.map((url) => (
            <div key={url} className="group relative h-20 w-20 shrink-0">
              <img src={imgSrc(url)} alt="" className="h-full w-full border border-slate-200 object-cover" />
              <button
                type="button"
                onClick={() => deleteSaved(url)}
                disabled={busy}
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center bg-black/50 text-white opacity-0 transition-opacity hover:bg-red-600 disabled:cursor-not-allowed group-hover:opacity-100"
              >
                <FaTimes size={7} />
              </button>
            </div>
          ))}
          {staged.map(({ file, preview }) => (
            <div key={preview} className="group relative h-20 w-20 shrink-0">
              <img src={preview} alt={file.name} className="h-full w-full border border-slate-200 object-cover opacity-80" />
              <div className="absolute inset-0 flex items-end justify-center pb-1">
                <span className="bg-black/50 px-1 text-[8px] text-white">pending</span>
              </div>
              <button
                type="button"
                onClick={() => removeStaged(preview)}
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center bg-black/50 text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
              >
                <FaTimes size={7} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[10px] text-slate-400">
          {hasRecord ? "No photos yet — click Add Photos to upload" : "Optional — select photos now and they will upload when you save"}
        </p>
      )}
    </div>
  );
}

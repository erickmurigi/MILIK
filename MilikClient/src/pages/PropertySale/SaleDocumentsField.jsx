import React, { useRef } from "react";
import { FaFileAlt, FaPlus, FaTimes } from "react-icons/fa";
import { imgSrc } from "../../utils/saleImage";

const labelClass = "mb-1 block text-xs font-bold text-slate-900";

const fmtSize = (bytes) => {
  if (!bytes) return "";
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
};

// The "KYC Documents" section of the buyer form/detail panel — real uploaded files (PDF or image),
// unlike the legacy free-text kycDocuments labels. `docs` is the object returned by useSalePhotoDraft
// (itemLabel="document", responseKey="documents"); `hasRecord` says whether the buyer already exists
// (documents then upload immediately instead of waiting for Save).
export default function SaleDocumentsField({ docs, hasRecord }) {
  const fileRef = useRef(null);
  const { saved, staged, busy, addFiles, removeStaged, deleteSaved } = docs;

  const onPick = (e) => {
    const files = e.target.files;
    addFiles(files);
    e.target.value = "";
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className={labelClass}>KYC Documents</label>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-50"
        >
          <FaPlus size={9} /> {busy ? "Uploading…" : "Add Document"}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="hidden" onChange={onPick} />
      </div>
      {(saved.length > 0 || staged.length > 0) ? (
        <div className="space-y-1">
          {saved.map((doc) => (
            <div key={doc.url} className="flex items-center gap-2 border border-slate-200 bg-[#F1F6F3] px-2.5 py-1.5">
              <FaFileAlt size={9} className="flex-shrink-0 text-[#0B3B2E]" />
              <a href={imgSrc(doc.url)} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate text-xs font-semibold text-[#0B3B2E] hover:underline">{doc.name}</a>
              {doc.size > 0 && <span className="flex-shrink-0 text-[10px] text-slate-400">{fmtSize(doc.size)}</span>}
              <button type="button" onClick={() => deleteSaved(doc.url)} disabled={busy} className="flex-shrink-0 p-0.5 text-rose-400 hover:text-rose-600 disabled:cursor-not-allowed">
                <FaTimes size={9} />
              </button>
            </div>
          ))}
          {staged.map(({ file, preview }) => (
            <div key={preview} className="flex items-center gap-2 border border-slate-200 bg-slate-50 px-2.5 py-1.5 opacity-80">
              <FaFileAlt size={9} className="flex-shrink-0 text-slate-400" />
              <span className="flex-1 min-w-0 truncate text-xs text-slate-700">{file.name}</span>
              <span className="flex-shrink-0 text-[9px] uppercase text-slate-400">pending</span>
              <button type="button" onClick={() => removeStaged(preview)} className="flex-shrink-0 p-0.5 text-rose-400 hover:text-rose-600">
                <FaTimes size={9} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[10px] text-slate-400">
          {hasRecord ? "No documents yet — click Add Document to upload a scanned ID, passport, or other KYC file." : "Optional — select documents now and they will upload when you save."}
        </p>
      )}
    </div>
  );
}

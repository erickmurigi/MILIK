import React, { useCallback, useEffect, useRef, useState } from "react";
import { FaDownload, FaPrint, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { saleApi } from "../../services/propertySaleApi";

const KEYFRAMES = `
  @keyframes mlkRepPdfIn  { from { opacity:0; transform:scale(0.97) } to { opacity:1; transform:scale(1) } }
  @keyframes mlkRepPdfOut { from { opacity:1; transform:scale(1)    } to { opacity:0; transform:scale(0.97) } }
`;

const ElapsedTimer = () => {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="text-[10px] text-white/25">{secs > 0 ? `${secs}s elapsed` : "Starting…"}</span>;
};

// Full-page PDF preview — the same fetch-blob-then-iframe pattern as the PMS Landlord Statement
// workspace (Statements.jsx's PdfPreviewModal), generalized to any Reports Center report, plus two
// things worth keeping deliberate rather than copying blindly:
//   1. A blob cache keyed on reportId+filters, so re-opening the same report with the same filters
//      in this session is instant instead of re-paying a Puppeteer render.
//   2. #zoom=125 forced on the blob URL — the user wants the document legible by default, not left
//      to whatever auto-fit zoom the browser's own PDF viewer happens to choose.
export default function SaleReportPdfModal({ open, reportId, title, params, onClose }) {
  const [phase, setPhase] = useState("idle"); // idle | loading | ready
  const [blobUrl, setBlobUrl] = useState(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [closing, setClosing] = useState(false);
  const iframeRef = useRef(null);
  const cacheRef = useRef({ key: null, rawUrl: null, zoomedUrl: null });

  useEffect(() => () => {
    if (cacheRef.current.rawUrl) window.URL.revokeObjectURL(cacheRef.current.rawUrl);
  }, []);

  const cacheKey = `${reportId}|${JSON.stringify(params || {})}`;

  useEffect(() => {
    if (!open || !reportId) return;

    if (cacheRef.current.key === cacheKey && cacheRef.current.zoomedUrl) {
      setBlobUrl(cacheRef.current.zoomedUrl);
      setPhase("ready");
      setIframeLoaded(false);
      return;
    }

    let cancelled = false;
    setPhase("loading");
    setIframeLoaded(false);
    saleApi.getReportPdf(reportId, params)
      .then((blob) => {
        if (cancelled) return;
        if (cacheRef.current.rawUrl && cacheRef.current.key !== cacheKey) {
          window.URL.revokeObjectURL(cacheRef.current.rawUrl);
        }
        const rawUrl = window.URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        const zoomedUrl = `${rawUrl}#zoom=125`;
        cacheRef.current = { key: cacheKey, rawUrl, zoomedUrl };
        setBlobUrl(zoomedUrl);
        setPhase("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err?.response?.data?.message || "Failed to generate the report");
        onClose();
      });
    return () => { cancelled = true; };
  }, [open, reportId, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) return;
    setBlobUrl(null);
    setPhase("idle");
    setIframeLoaded(false);
    setClosing(false);
  }, [open]);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 190);
  }, [closing, onClose]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open, handleClose]);

  const handlePrint = useCallback(() => iframeRef.current?.contentWindow?.print(), []);
  const handleDownload = useCallback(() => {
    if (!cacheRef.current.rawUrl) return;
    const a = document.createElement("a");
    a.href = cacheRef.current.rawUrl;
    a.download = `${(title || "Report").replace(/\s+/g, "-")}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [title]);

  if (!open && !closing) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col"
      style={{ animation: `${closing ? "mlkRepPdfOut" : "mlkRepPdfIn"} 0.2s cubic-bezier(0.16,1,0.3,1) both` }}
    >
      <style>{KEYFRAMES}</style>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={handleClose} aria-hidden="true" />
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex flex-none items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
          <span className="truncate text-xs font-black uppercase tracking-widest text-slate-900">{title}</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={handlePrint} disabled={!iframeLoaded} title="Print"
              className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-35">
              <FaPrint size={11} /> Print
            </button>
            <button type="button" onClick={handleDownload} disabled={phase !== "ready"} title="Save PDF to device"
              className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-35">
              <FaDownload size={11} /> Save PDF
            </button>
            <div className="mx-1 h-5 w-px bg-slate-200" />
            <button type="button" onClick={handleClose} title="Close (Esc)"
              className="inline-flex h-7 w-7 items-center justify-center text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900">
              <FaTimes size={14} />
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 bg-slate-900 p-3">
          {(phase === "loading" || (blobUrl && !iframeLoaded)) && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-slate-900">
              <div className="relative h-10 w-10">
                <div className="absolute inset-0 animate-spin" style={{ border: "3px solid rgba(255,255,255,0.08)", borderTopColor: "#4ade80", borderRightColor: "#86efac", animationDuration: "0.9s" }} />
                <div className="absolute inset-[9px] animate-spin" style={{ border: "2px solid rgba(255,255,255,0.08)", borderBottomColor: "#4ade80", borderLeftColor: "#86efac", animationDuration: "0.6s", animationDirection: "reverse" }} />
              </div>
              <div className="flex flex-col items-center gap-1">
                <p className="text-[11px] font-semibold text-white/50">{phase === "loading" ? "Generating PDF…" : "Loading preview…"}</p>
                {phase === "loading" && <ElapsedTimer />}
              </div>
            </div>
          )}
          {blobUrl && (
            <iframe
              ref={iframeRef}
              src={blobUrl}
              title={title || "Report PDF"}
              onLoad={() => setIframeLoaded(true)}
              className={`h-full w-full border-0 shadow-2xl transition-opacity duration-500 ${iframeLoaded ? "opacity-100" : "opacity-0"}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

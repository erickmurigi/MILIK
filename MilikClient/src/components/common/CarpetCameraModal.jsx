/**
 * CarpetCameraModal — full-screen camera capture for carpet photos.
 *
 * - Opens back camera on mobile, webcam on desktop (getUserMedia)
 * - Shutter button captures a JPEG frame
 * - Preview → Confirm or Retake
 * - Flip button switches front/back on mobile
 * - Gallery button falls back to file picker
 * - Proper cleanup: stops stream on unmount, on close, on file pick
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FaCamera, FaCheck, FaExchangeAlt, FaImages,
  FaRedo, FaTimes,
} from "react-icons/fa";

// ─── helpers ─────────────────────────────────────────────────────────────────

const isVideoReady = (video) =>
  video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;

const friendlyError = (err) => {
  if (!err) return "Unknown camera error.";
  switch (err.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera permission denied. Tap the camera icon in your browser's address bar to allow access, then retry.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera found on this device. Use the gallery button to choose a photo instead.";
    case "NotReadableError":
    case "TrackStartError":
      return "Camera is already in use by another app. Close it and retry.";
    case "OverconstrainedError":
      return "Camera doesn't support the requested settings. Trying alternate configuration…";
    default:
      return `Camera error: ${err.message || err.name}`;
  }
};

// ─── component ────────────────────────────────────────────────────────────────

const CarpetCameraModal = ({ onCapture, onClose }) => {
  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const fileRef     = useRef(null);
  const streamRef   = useRef(null);
  const mountedRef  = useRef(true);  // guards against setState after unmount
  const sessionRef  = useRef(0);     // incremented on each startCamera call; guards stale async results

  const [status, setStatus]       = useState("starting"); // "starting" | "live" | "preview" | "error"
  const [errorMsg, setErrorMsg]   = useState("");
  const [previewSrc, setPreviewSrc] = useState(null);
  const [facingMode, setFacingMode] = useState("environment");
  const [flash, setFlash]          = useState(false);

  // ── stream management ───────────────────────────────────────────────────────

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async (facing) => {
    stopStream();
    if (!mountedRef.current) return;

    const session = ++sessionRef.current;
    setStatus("starting");
    setErrorMsg("");
    setPreviewSrc(null);

    const constraints = {
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    };

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (firstErr) {
      // If facing-mode constraint fails (e.g. desktop with no back camera), retry without it
      if (firstErr.name === "OverconstrainedError") {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch (fallbackErr) {
          if (mountedRef.current && session === sessionRef.current) {
            setErrorMsg(friendlyError(fallbackErr));
            setStatus("error");
          }
          return;
        }
      } else {
        if (mountedRef.current && session === sessionRef.current) {
          setErrorMsg(friendlyError(firstErr));
          setStatus("error");
        }
        return;
      }
    }

    // Guard: component unmounted or a newer session started while we were awaiting
    if (!mountedRef.current || session !== sessionRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      // "canplay" fires as soon as the first frame is ready
      video.oncanplay = () => {
        if (mountedRef.current && session === sessionRef.current) {
          setStatus("live");
        }
      };
      try { await video.play(); } catch { /* some browsers reject play() if not interacted — fine */ }
    }
  }, [stopStream]);

  // ── lifecycle ───────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    startCamera("environment");
    return () => {
      mountedRef.current = false;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── actions ─────────────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    stopStream();
    onClose();
  }, [stopStream, onClose]);

  const capture = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Use actual video dimensions; fall back to 1280×720 if not ready
    canvas.width  = isVideoReady(video) ? video.videoWidth  : 1280;
    canvas.height = isVideoReady(video) ? video.videoHeight : 720;
    const ctx = canvas.getContext("2d");

    if (isVideoReady(video)) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } else {
      // Video not ready — show a visible error instead of a silent black frame
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    stopStream();
    // Shutter flash
    setFlash(true);
    setTimeout(() => { if (mountedRef.current) setFlash(false); }, 150);

    setPreviewSrc(canvas.toDataURL("image/jpeg", 0.88));
    setStatus("preview");
  }, [stopStream]);

  const retake = useCallback(() => {
    setPreviewSrc(null);
    startCamera(facingMode);
  }, [startCamera, facingMode]);

  const flip = useCallback(() => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    startCamera(next);
  }, [facingMode, startCamera]);

  const confirm = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `carpet-${Date.now()}.jpg`, { type: "image/jpeg" }));
        onClose();
      },
      "image/jpeg",
      0.88
    );
  }, [onCapture, onClose]);

  const pickFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopStream();
    onCapture(file);
    onClose();
  }, [stopStream, onCapture, onClose]);

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black select-none">

      {/* ── Header ── */}
      <div className="flex items-center justify-between bg-black/80 px-4 py-3 shrink-0">
        <span className="text-sm font-extrabold uppercase tracking-widest text-white/90">
          Carpet Photo
        </span>
        <button
          type="button"
          aria-label="Close camera"
          onClick={handleClose}
          className="rounded-full p-2 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
        >
          <FaTimes size={18} />
        </button>
      </div>

      {/* ── Viewfinder ── */}
      <div className="relative flex flex-1 min-h-0 items-center justify-center bg-black overflow-hidden">

        {/* Flash overlay */}
        {flash && <div className="absolute inset-0 z-10 bg-white opacity-80 pointer-events-none" />}

        {/* Hidden canvas used for frame capture */}
        <canvas ref={canvasRef} className="hidden" />

        {status === "preview" && previewSrc ? (
          /* ── Preview ── */
          <img
            src={previewSrc}
            alt="Captured carpet"
            className="max-h-full max-w-full object-contain"
          />
        ) : status === "error" ? (
          /* ── Error ── */
          <div className="flex flex-col items-center gap-4 px-8 text-center max-w-sm">
            <div className="rounded-full bg-white/5 p-5">
              <FaCamera size={36} className="text-white/25" />
            </div>
            <p className="text-sm text-red-400 font-semibold leading-relaxed">{errorMsg}</p>
            <div className="flex flex-wrap gap-3 justify-center">
              <button
                type="button"
                onClick={() => startCamera(facingMode)}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2 text-xs font-bold text-white hover:bg-white/20 transition-colors"
              >
                <FaRedo size={10} /> Retry
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2 text-xs font-bold text-white hover:bg-white/20 transition-colors"
              >
                <FaImages size={10} /> Choose from Gallery
              </button>
            </div>
          </div>
        ) : (
          /* ── Live feed ── */
          <>
            {/* Loading spinner — shown until "live" */}
            {status === "starting" && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
                <span className="text-xs text-white/50 tracking-wide">Starting camera…</span>
              </div>
            )}

            {/* Video element — always mounted so srcObject assignment works */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`max-h-full max-w-full object-contain transition-opacity duration-300 ${status === "live" ? "opacity-100" : "opacity-0"}`}
            />

            {/* Viewfinder corners — only when live */}
            {status === "live" && (
              <div className="pointer-events-none absolute inset-6 sm:inset-10">
                <span className="absolute -top-px -left-px h-7 w-7 border-t-[3px] border-l-[3px] border-white rounded-tl-sm" />
                <span className="absolute -top-px -right-px h-7 w-7 border-t-[3px] border-r-[3px] border-white rounded-tr-sm" />
                <span className="absolute -bottom-px -left-px h-7 w-7 border-b-[3px] border-l-[3px] border-white rounded-bl-sm" />
                <span className="absolute -bottom-px -right-px h-7 w-7 border-b-[3px] border-r-[3px] border-white rounded-br-sm" />
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Controls ── */}
      <div className="flex items-center justify-between bg-black/90 px-8 py-6 shrink-0">

        {status === "preview" ? (
          /* ── Preview controls ── */
          <>
            {/* Retake */}
            <button type="button" onClick={retake} className="flex flex-col items-center gap-1.5 text-white/70 hover:text-white transition-colors">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/40 hover:border-white transition-colors">
                <FaRedo size={18} />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider">Retake</span>
            </button>

            {/* Confirm */}
            <button
              type="button"
              onClick={confirm}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 shadow-lg shadow-emerald-900/40 hover:bg-emerald-400 active:scale-95 transition-all"
              aria-label="Use this photo"
            >
              <FaCheck size={28} className="text-white" />
            </button>

            <div className="w-12 h-12" aria-hidden />
          </>
        ) : (
          /* ── Live controls ── */
          <>
            {/* Gallery fallback */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center gap-1.5 text-white/70 hover:text-white transition-colors"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/40 hover:border-white transition-colors">
                <FaImages size={18} />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider">Gallery</span>
            </button>

            {/* Shutter */}
            <button
              type="button"
              onClick={capture}
              disabled={status !== "live"}
              aria-label="Take photo"
              className="flex h-20 w-20 items-center justify-center rounded-full border-[5px] border-white bg-white/10 hover:bg-white/20 active:scale-95 disabled:opacity-30 transition-all"
            >
              <div className="h-14 w-14 rounded-full bg-white" />
            </button>

            {/* Flip camera */}
            <button
              type="button"
              onClick={flip}
              disabled={status !== "live"}
              className="flex flex-col items-center gap-1.5 text-white/70 hover:text-white disabled:opacity-30 transition-colors"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/40 hover:border-white transition-colors">
                <FaExchangeAlt size={16} />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider">Flip</span>
            </button>
          </>
        )}
      </div>

      {/* Hidden file input for gallery fallback */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={pickFile}
      />
    </div>
  );
};

export default CarpetCameraModal;

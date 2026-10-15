import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import {
  FaCar, FaCamera, FaCheck, FaChevronDown, FaCoins, FaExclamationTriangle, FaGift, FaMinus, FaPlus, FaSave,
  FaSearch, FaSpinner, FaTimes, FaTimesCircle, FaUser, FaExpand, FaTag,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload, photoUrl, VEHICLE_TYPES } from "../../services/carWashApi";
import { useFormDraft } from "../../hooks/useFormDraft";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import { selectCurrentCompany } from "../../redux/selectors";
import CarWashShell from "./CarWashShell";
import CarpetCameraModal from "../../components/common/CarpetCameraModal";
import AppSelect from "../../components/common/AppSelect";

const EMPTY_ARRAY = [];

// Bolder/darker label style and compact fixed-height input style matching the
// house Milik add/edit-form standard (see components/Landlord/AddLandlord.jsx)
// — overridden locally rather than in the shared formStyles.js, which other
// already-styled CarWash pages rely on for their own (looser) sizing.
const labelClass = "mb-1 block text-xs font-bold text-slate-900";

const inputClass =
  "h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20";

// Compact variant for Service Lines table/card cells — same h-7 height as inputClass but
// text-xs to match the table's denser type scale. Shared across mobile + desktop layouts
// and both the free-text Name field and the measurement-calculator inputs.
const tableInputClass =
  "h-7 w-full border border-slate-300 bg-white px-2 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const tableInputRewardClass =
  "h-7 w-full border border-amber-200 bg-amber-50 px-2 text-xs font-bold text-amber-800 outline-none";

const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

const Section = ({ title, children, className = "" }) => (
  <div className={`border border-slate-200 bg-white ${className}`}>
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
    </div>
    <div className="p-2.5">{children}</div>
  </div>
);

// ─── Staff multi-select ────────────────────────────────────────────────────────
// Compact dropdown-with-checkboxes picker replacing the old flat chip-toggle grid
// for per-line attendants. Local to this page (not AppSelect — that's shared by
// every other picker in the app and this is a one-off multi-select shape).
// Positioning/outside-click/scroll-close mechanics are adapted from AppSelect.jsx.
const StaffMultiSelect = ({ staff = EMPTY_ARRAY, selected = EMPTY_ARRAY, onToggle, disabled = false }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState({});
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const portalId = `cw-staff-picker-${useId()}`;

  const close = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  const openDropdown = useCallback(() => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const vp = window.innerHeight;
    const spaceBelow = vp - rect.bottom;
    const spaceAbove = rect.top;
    const dropUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const panelWidth = Math.max(rect.width, 190);
    const left = Math.min(rect.left, window.innerWidth - panelWidth - 8);

    setDropdownStyle({
      position: "fixed",
      left: Math.max(8, left),
      width: panelWidth,
      ...(dropUp ? { bottom: vp - rect.top + 4 } : { top: rect.bottom + 4 }),
      zIndex: 9999,
    });
    setOpen(true);
  }, [disabled]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!triggerRef.current?.contains(e.target) && !document.getElementById(portalId)?.contains(e.target)) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close, portalId]);

  // Close on scroll/resize elsewhere (ignore scroll inside the portal's own list)
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (document.getElementById(portalId)?.contains(e.target)) return;
      close();
    };
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [open, close, portalId]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  // Focus the search box on open
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return staff;
    const term = search.trim().toLowerCase();
    return staff.filter((s) => (s.name || "").toLowerCase().includes(term));
  }, [staff, search]);

  const selectedMembers = useMemo(
    () => staff.filter((s) => selected.includes(s._id)),
    [staff, selected]
  );

  const MAX_TAGS = 2;
  const visibleTags = selectedMembers.slice(0, MAX_TAGS);
  const overflowCount = selectedMembers.length - visibleTags.length;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : openDropdown())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-7 w-full items-center gap-1 border px-1.5 text-left transition ${
          disabled
            ? "cursor-not-allowed border-slate-200 bg-slate-100"
            : open
              ? "cursor-pointer border-[#0B3B2E] bg-white ring-1 ring-[#0B3B2E]/20"
              : "cursor-pointer border-slate-300 bg-white hover:border-slate-400"
        }`}
      >
        <div className="flex flex-1 items-center gap-1 overflow-hidden">
          {selectedMembers.length === 0 ? (
            <span className="truncate text-xs text-slate-400">Select staff…</span>
          ) : (
            <>
              {visibleTags.map((m) => (
                <span key={m._id} className="shrink-0 truncate rounded-sm bg-[#0B3B2E]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#0B3B2E]">
                  {m.name.split(" ")[0]}
                </span>
              ))}
              {overflowCount > 0 && (
                <span className="shrink-0 rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                  +{overflowCount}
                </span>
              )}
            </>
          )}
        </div>
        <FaChevronDown size={9} className={`shrink-0 text-slate-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && createPortal(
        <div id={portalId} style={dropdownStyle} className="border border-slate-300 bg-white shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-2 py-1">
            <FaSearch size={9} className="shrink-0 text-slate-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search staff…"
              className="flex-1 bg-transparent text-[11px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
            <button type="button" onClick={close} className="shrink-0 text-slate-400 hover:text-slate-700" aria-label="Close">
              <FaTimes size={9} />
            </button>
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-48 overflow-auto py-0.5">
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-center text-[10px] text-slate-400">No staff found</li>
            ) : (
              filtered.map((s) => {
                const isSelected = selected.includes(s._id);
                return (
                  <li
                    key={s._id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => onToggle(s._id)}
                    className={`flex items-center gap-1.5 px-2 py-1 text-[11px] transition-colors cursor-pointer ${
                      isSelected ? "bg-emerald-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${
                        isSelected ? "border-[#0B3B2E] bg-[#0B3B2E]" : "border-slate-300 bg-white"
                      }`}
                    >
                      {isSelected && <FaCheck size={7} className="text-white" />}
                    </span>
                    <span className={`truncate ${isSelected ? "font-bold text-[#0B3B2E]" : "text-slate-800"}`}>{s.name}</span>
                    {s.role && <span className="ml-auto shrink-0 pl-1 text-[9px] text-slate-400">{s.role}</span>}
                  </li>
                );
              })
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
};

// ─── Plate lookup ─────────────────────────────────────────────────────────────
// Input only — the lookup result banner is a separate component (PlateLookupRow)
// so the parent can place the input in a dense 3-up grid row while the banner
// still renders full-width below that row.
const PlateLookupWidget = ({ plate, onPlateChange, onCustomerFound, onCustomerCleared, onRewardData, onLookupResult, readOnly }) => {
  const [looking, setLooking] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const lookup = useCallback(async (value) => {
    const p = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (p.length < 3) {
      onLookupResult?.(null);
      onRewardData?.(null);
      onCustomerCleared?.();
      return;
    }
    setLooking(true);
    try {
      const result = await carWashApi.lookupPlate(p);
      onLookupResult?.(result);
      if (result?.customer) {
        onCustomerFound({ name: result.customer.name, phone: result.customer.phone });
      } else {
        onCustomerCleared?.();
      }
      onRewardData?.(result?.loyaltyCard || null);
    } catch {
      onLookupResult?.(null);
      onRewardData?.(null);
      onCustomerCleared?.();
    } finally {
      setLooking(false);
    }
  }, [onCustomerFound, onCustomerCleared, onRewardData, onLookupResult]);

  const handleChange = (e) => {
    if (readOnly) return;
    const val = e.target.value.toUpperCase();
    onPlateChange(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => lookup(val), 600);
  };

  return (
    <div>
      <label className={labelClass}>Plate Number<Required /></label>
      <div className="relative">
        <input
          className={`${inputClass} ${readOnly ? "bg-slate-50 text-slate-500" : ""}`}
          value={plate}
          onChange={handleChange}
          required
          autoFocus={!readOnly}
          readOnly={readOnly}
          placeholder="e.g. KAA 123X"
        />
        {looking && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 animate-pulse">looking up…</span>}
      </div>
    </div>
  );
};

// ─── Plate lookup result banner — rendered separately, full width ────────────
// Row content only — no border/margin of its own. Rendered inside the single shared
// status panel below (with CreditAccountRow / the reward row) so three related pieces
// of plate/customer info read as one connected panel, not three stacked alert boxes.
const PlateLookupRow = ({ lookupResult, applyCredit, onApplyCreditChange }) => {
  if (!lookupResult) return null;
  const card = lookupResult?.loyaltyCard;
  const customer = lookupResult?.customer;
  const program = card?.program;
  const creditBalance = Number(lookupResult?.creditBalance || 0);

  if (!customer) {
    return (
      <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">
        <FaCar className="text-[10px]" />
        <span>Plate not registered — customer info won't auto-fill.</span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 bg-emerald-50 px-2.5 py-1.5 text-[11px]">
      <FaUser className="mt-0.5 shrink-0 text-emerald-600" size={10} />
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-black text-slate-800">{customer.name} <span className="font-normal text-slate-500">· {customer.phone}</span></span>
          {card && program ? (
            <span className="flex items-center gap-1 text-slate-500">
              <span className="flex gap-0.5">
                {Array.from({ length: program.stampsRequired }).map((_, i) => (
                  <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < card.currentStamps ? "bg-emerald-500" : "bg-slate-200"}`} />
                ))}
              </span>
              {card.currentStamps}/{program.stampsRequired} stamps
            </span>
          ) : (
            <span className="text-slate-500">No loyalty card yet</span>
          )}
        </div>
        {creditBalance > 0 && (
          <label className="mt-0.5 flex cursor-pointer items-center gap-1.5 text-amber-800">
            <input
              type="checkbox"
              checked={applyCredit}
              onChange={(e) => onApplyCreditChange(e.target.checked)}
              className="accent-amber-600"
            />
            <FaCoins className="shrink-0 text-amber-500" size={10} />
            <span className="font-black">KES {formatMoney(creditBalance)} credit on account</span>
            <span className="font-normal text-amber-700">
              {applyCredit ? "— will be applied to this job's balance" : "— not applying, will collect full amount"}
            </span>
          </label>
        )}
      </div>
    </div>
  );
};

// ─── Credit account banner ─────────────────────────────────────────────────────
const CreditAccountRow = ({ plate, jobTotal, onAccountDetected }) => {
  const [account, setAccount] = useState(null);
  const normalizedPlate = String(plate || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const [prevPlate, setPrevPlate] = useState("");

  // Reset adjusted during render (React's documented pattern for state that depends on a
  // changed prop) instead of inside the effect below, so a stale account from the previous
  // plate never flashes while the new lookup is in flight. Uses state, not a ref, for the
  // comparison — reading a ref's value during render is its own, separate violation.
  if (normalizedPlate && normalizedPlate !== prevPlate) {
    setPrevPlate(normalizedPlate);
    setAccount(null);
    onAccountDetected(null);
  }

  useEffect(() => {
    if (!normalizedPlate || normalizedPlate.length < 4) return;
    carWashApi.lookupAccountByPlate(normalizedPlate)
      .then((data) => { setAccount(data || null); onAccountDetected(data || null); })
      .catch(() => {});
  }, [normalizedPlate]); // eslint-disable-line

  if (!account) return null;

  const isPrepaid = account.accountType === "prepaid";
  const walletBalance = Number(account.accountCredit || 0);
  const outstandingDebt = Number(account.currentBalance || 0);
  const accountCredit = !isPrepaid ? Number(account.accountCredit || 0) : 0;
  const overLimit = account.overLimit;
  const sufficient = isPrepaid ? walletBalance >= (jobTotal || 0) : true;
  const needsWarningIcon = (!sufficient && isPrepaid) || overLimit || (!isPrepaid && outstandingDebt > 0);

  const typeBadge = isPrepaid
    ? "bg-teal-100 text-teal-700"
    : account.accountType === "monthly"
      ? "bg-violet-100 text-violet-700"
      : "bg-blue-100 text-blue-700";

  // One status fragment instead of a separate line — collapses what used to be up to
  // 3 stacked lines into a single wrapping row.
  const [statusMsg, statusClass, bg] = isPrepaid
    ? sufficient
      ? [`${formatMoney(jobTotal || 0)} auto-deducted from wallet on save`, "text-teal-700", "bg-teal-50 text-teal-800"]
      : [`insufficient balance — collect ${formatMoney(Math.max(0, (jobTotal || 0) - walletBalance))} from customer`, "font-bold text-amber-700", "bg-amber-50 text-amber-800"]
    : overLimit
      ? ["credit limit exceeded — collect payment or proceed with caution", "font-bold text-red-700", "bg-red-50 text-red-800"]
      : outstandingDebt > 0
        ? ["has an outstanding balance — job will be added to account", "font-bold text-amber-700", "bg-amber-50 text-amber-800"]
        : ["charged to credit account", "text-emerald-700", "bg-emerald-50 text-emerald-800"];

  return (
    <div className={`flex items-start gap-2 px-2.5 py-1.5 text-[11px] ${bg}`}>
      {needsWarningIcon && (
        <FaExclamationTriangle className={`mt-0.5 flex-shrink-0 ${overLimit ? "text-red-500" : "text-amber-500"}`} size={11} />
      )}
      <div className="flex flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-black">{[account.accountNumber, account.customer?.name].filter(Boolean).join(" · ")}</span>
        <span>
          {isPrepaid ? (
            <>Wallet: <strong>{formatMoney(walletBalance)}</strong></>
          ) : (
            <>
              Outstanding: <strong>{formatMoney(outstandingDebt)}</strong>
              {account.creditLimit > 0 && <> / Limit: <strong>{formatMoney(account.creditLimit)}</strong></>}
            </>
          )}
          <span className={`ml-2 px-1.5 py-0 text-[10px] font-black uppercase ${typeBadge}`}>
            {account.accountType}
          </span>
        </span>
        <span className={statusClass}>— {statusMsg}</span>
        {accountCredit > 0 && (
          <span className="flex items-center gap-1 font-bold text-teal-700">
            <FaCoins size={9} /> {formatMoney(accountCredit)} credit available
          </span>
        )}
      </div>
    </div>
  );
};

const emptyLine = () => ({ service: "", serviceName: "", vehicleType: "", price: "", lineStaff: [], measurements: { shape: "rect", length: "", width: "", diameter: "" } });

// ─── Lightbox ─────────────────────────────────────────────────────────────────
const Lightbox = ({ src, onClose }) => (
  <div
    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-4"
    onClick={onClose}
  >
    <button
      type="button"
      onClick={onClose}
      className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
    >
      <FaTimesCircle size={20} />
    </button>
    <img
      src={src}
      alt="Carpet photo"
      className="max-h-[90vh] max-w-[90vw] rounded object-contain shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    />
  </div>
);

// ─── Carpet photo panel ───────────────────────────────────────────────────────
const CarpetPhotoPanel = ({ jobId, existingPhotos = [], onPhotosChange }) => {
  const [pending, setPending]       = useState([]); // { file, previewUrl }
  const [uploading, setUploading]   = useState(false);
  const [lightbox, setLightbox]     = useState(null);
  const [deleting, setDeleting]     = useState(null);
  const [showCamera, setShowCamera] = useState(false);

  const total = existingPhotos.length + pending.length;
  const canAdd = total < 5;

  const handleCapture = (file) => {
    if (existingPhotos.length + pending.length >= 5) { toast.error("Maximum 5 photos per job"); return; }
    const previewUrl = URL.createObjectURL(file);
    setPending((prev) => [...prev, { file, previewUrl }]);
  };

  const removePending = (idx) => {
    setPending((prev) => {
      URL.revokeObjectURL(prev[idx].previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const upload = async () => {
    if (!pending.length) return;
    setUploading(true);
    try {
      const result = await carWashApi.uploadJobPhotos(jobId, pending.map((p) => p.file));
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPending([]);
      onPhotosChange(result?.photos || existingPhotos);
      toast.success(`${result?.photos?.length - existingPhotos.length || ""} photo(s) saved`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const deletePhoto = async (url) => {
    setDeleting(url);
    try {
      const result = await carWashApi.deleteJobPhoto(jobId, url);
      onPhotosChange(result?.photos || existingPhotos.filter((p) => p !== url));
    } catch {
      toast.error("Could not delete photo");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 bg-[#EDF5F1] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <FaCamera className="text-[#0B3B2E] text-[13px]" />
          <span className="text-xs font-black uppercase tracking-wide text-[#0B3B2E]">
            Carpet Photos
          </span>
          <span className="text-[10px] text-slate-500">{existingPhotos.length + pending.length}/5</span>
        </div>
        {canAdd && (
          <button
            type="button"
            onClick={() => setShowCamera(true)}
            className="inline-flex items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaCamera size={9} /> Take Photo
          </button>
        )}
      </div>

      <div className="p-4">
        {existingPhotos.length === 0 && pending.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-slate-200 py-8 text-slate-400">
            <FaCamera size={28} className="opacity-40" />
            <p className="text-xs font-semibold">No photos yet</p>
            <p className="text-[10px]">Tap "Add Photo" to take or upload a carpet image</p>
          </div>
        )}

        {/* Existing saved photos */}
        {existingPhotos.length > 0 && (
          <div className="mb-3">
            <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Saved</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {existingPhotos.map((url) => (
                <div key={url} className="group relative aspect-square overflow-hidden rounded border border-slate-200 bg-slate-100">
                  <img
                    src={photoUrl(url)}
                    alt="Carpet"
                    className="h-full w-full cursor-pointer object-cover transition-transform group-hover:scale-105"
                    onClick={() => setLightbox(photoUrl(url))}
                  />
                  <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => setLightbox(photoUrl(url))}
                      className="rounded-full bg-white/80 p-1 text-slate-700 hover:bg-white"
                      title="View full size"
                    >
                      <FaExpand size={10} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePhoto(url)}
                      disabled={deleting === url}
                      className="rounded-full bg-red-500/90 p-1 text-white hover:bg-red-600 disabled:opacity-50"
                      title="Delete photo"
                    >
                      <FaTimesCircle size={10} />
                    </button>
                  </div>
                  {deleting === url && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pending (not yet uploaded) */}
        {pending.length > 0 && (
          <div className="mb-3">
            <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">
              Pending Upload ({pending.length})
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {pending.map((p, idx) => (
                <div key={idx} className="group relative aspect-square overflow-hidden rounded border-2 border-dashed border-amber-300 bg-amber-50">
                  <img src={p.previewUrl} alt="Preview" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePending(idx)}
                    className="absolute right-1 top-1 rounded-full bg-red-500 p-0.5 text-white opacity-80 hover:opacity-100"
                  >
                    <FaTimesCircle size={10} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={upload}
              disabled={uploading}
              className="mt-3 flex w-full items-center justify-center gap-2 bg-[#0B3B2E] py-2 text-xs font-extrabold uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:opacity-60"
            >
              {uploading ? (
                <><div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> Uploading…</>
              ) : (
                <><FaCamera size={10} /> Save {pending.length} Photo{pending.length > 1 ? "s" : ""}</>
              )}
            </button>
          </div>
        )}
      </div>

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      {showCamera && (
        <CarpetCameraModal
          onCapture={handleCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  );
};

const CarWashAddJob = () => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { id: editId } = useParams();
  const isEditMode = Boolean(editId);
  const canCreate = useCarWashPermission("carwash-jobs", "create");
  const canUpdate = useCarWashPermission("carwash-jobs", "update");
  const currentCompany = useSelector(selectCurrentCompany);

  const [jobType, setJobType] = useState("vehicle");
  const [plateNumber, setPlateNumber] = useState("");
  const [plateLookupResult, setPlateLookupResult] = useState(null);
  // Defaulted off: credit is the customer's money, so spending it down requires
  // an active staff decision rather than happening silently by default.
  const [applyCustomerCredit, setApplyCustomerCredit] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [expectedReadyAt, setExpectedReadyAt] = useState("");
  const [serviceLines, setServiceLines] = useState([emptyLine()]);
  const [creditAccount, setCreditAccount] = useState(null);
  const [loyaltyCard, setLoyaltyCard] = useState(null);
  const [applyReward, setApplyReward] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountSettings, setDiscountSettings] = useState({ minPrice: 0, maxPct: 0 });
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState([]);
  // When redirected from new-carpet-job save, open photos immediately
  const openPhotosOnLoad = Boolean(location.state?.openPhotos);

  // Reference data — cached across navigations; avoids refetch on every mount.
  // Query keys/staleTime match CarWashJobs.jsx exactly so the cache is shared.
  const { data: servicesRaw } = useQuery({
    queryKey: ["cw-services-ref"],
    queryFn: () => carWashApi.listServices({ active: true, limit: 500 }),
    staleTime: 5 * 60_000,
    select: (data) => normalizeListPayload(data, "services"),
  });
  const services = servicesRaw ?? EMPTY_ARRAY;
  const servicesById = useMemo(() => new Map(services.map((s) => [s._id, s])), [services]);

  const { data: allStaffRaw } = useQuery({
    queryKey: ["cw-staff-ref"],
    queryFn: () => carWashApi.listStaff({ active: true }),
    staleTime: 5 * 60_000,
    select: (data) => normalizeListPayload(data, "staff"),
  });

  const { data: jobDefaults } = useQuery({
    queryKey: ["cw-job-defaults", currentCompany?._id],
    queryFn: () => Promise.allSettled([
      carWashApi.getCarWashSettings(),
      carWashApi.getActiveBranch(),
    ]).then(([s, b]) => ({ settings: s.value ?? null, branch: b.value ?? null })),
    enabled: !!currentCompany?._id,
    staleTime: 5 * 60_000,
  });

  const { data: branchesRaw } = useQuery({
    queryKey: ["cw-addjob-branches-ref"],
    queryFn: () => carWashApi.listBranches({ limit: 100 }),
    staleTime: 5 * 60_000,
    select: (data) => normalizeListPayload(data, "branches"),
  });
  const branches = branchesRaw ?? EMPTY_ARRAY;

  const [staff, setStaff]           = useState([]);
  const allStaffRef                 = React.useRef([]);
  const [isAllBranches, setIsAllBranches] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [branchType, setBranchType] = useState("both");
  const [saving, setSaving]           = useState(false);
  const [loadingJob, setLoadingJob]   = useState(false);
  const [jobPaymentStatus, setJobPaymentStatus] = useState(null);
  const [dupWarning, setDupWarning]   = useState(null); // { jobNumber, customerName, plateNumber }
  const skipDupCheckRef               = React.useRef(false);
  const autoFilledCustomerRef         = React.useRef(false);

  // Voucher job state
  const [isVoucherJob, setIsVoucherJob]     = useState(false);
  const [voucherAccount, setVoucherAccount] = useState(null); // full account object
  const { data: voucherCompaniesRaw } = useQuery({
    queryKey: ["cw-addjob-voucher-accounts-ref"],
    queryFn: () => carWashApi.listCreditAccounts({ accountType: "voucher", status: "active", limit: 200 }),
    staleTime: 5 * 60_000,
    select: (data) => normalizeListPayload(data, "accounts"),
  });
  const voucherCompanies = voucherCompaniesRaw ?? EMPTY_ARRAY;

  const { read: readDraft, write: writeDraft, clear: clearDraft } = useFormDraft("cw-new-job");

  // Restore draft on mount (new job only)
  useEffect(() => {
    if (isEditMode) return;
    const draft = readDraft();
    if (!draft) return;
    if (draft.jobType)          setJobType(draft.jobType);
    if (draft.plateNumber)      setPlateNumber(draft.plateNumber);
    if (draft.customerName)     setCustomerName(draft.customerName);
    if (draft.phone)            setPhone(draft.phone);
    if (draft.itemDescription)  setItemDescription(draft.itemDescription);
    if (draft.expectedReadyAt)  setExpectedReadyAt(draft.expectedReadyAt);
    if (draft.serviceLines?.length) setServiceLines(draft.serviceLines);
    if (draft.discountAmount)   setDiscountAmount(draft.discountAmount);
    if (draft.discountEnabled)  setDiscountEnabled(draft.discountEnabled);
    if (draft.notes)            setNotes(draft.notes);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save draft on change (new job only)
  useEffect(() => {
    if (isEditMode) return;
    const t = setTimeout(() => {
      writeDraft({ jobType, plateNumber, customerName, phone, itemDescription, expectedReadyAt, serviceLines, discountAmount, discountEnabled, notes });
    }, 400);
    return () => clearTimeout(t);
  }, [isEditMode, jobType, plateNumber, customerName, phone, itemDescription, expectedReadyAt, serviceLines, discountAmount, discountEnabled, notes]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPrice = useMemo(
    () => serviceLines.reduce((sum, l) => sum + (Number(l.price) || 0), 0),
    [serviceLines]
  );

  const totalTaxAmount = useMemo(() => {
    return Math.round(serviceLines.reduce((sum, l) => {
      const svc = servicesById.get(l.service);
      if (!svc?.isTaxable || !svc?.taxRate) return sum;
      const p = Number(l.price) || 0;
      return sum + (p * Number(svc.taxRate) / (100 + Number(svc.taxRate)));
    }, 0) * 100) / 100;
  }, [serviceLines, servicesById]);
  const discountNum = Math.max(0, Number(discountAmount) || 0);

  const { minPrice: discountMinPrice, maxPct: discountMaxPct } = discountSettings;
  const round2 = (n) => Math.round(n * 100) / 100;
  const discountEligible = discountMinPrice === 0 || totalPrice > discountMinPrice;
  const discountMaxAllowed = discountMaxPct > 0 ? round2(totalPrice * discountMaxPct / 100) : totalPrice;

  // Clear discount if settings load and job is no longer eligible
  useEffect(() => {
    if (discountEnabled && discountMinPrice > 0 && totalPrice <= discountMinPrice) {
      setDiscountEnabled(false);
      setDiscountAmount("");
    }
  }, [discountSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clamp discount amount when total price changes (e.g. service line edited)
  useEffect(() => {
    if (!discountEnabled || totalPrice <= 0) return;
    const max = discountMaxPct > 0 ? round2(totalPrice * discountMaxPct / 100) : totalPrice;
    if (discountNum > max) setDiscountAmount(String(max));
  }, [totalPrice]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preview discount amount for the loyalty reward (computed from program, not state)
  const rewardProgram = loyaltyCard?.program;
  const rewardPreviewDiscount = useMemo(() => {
    if (!applyReward || !rewardProgram || totalPrice <= 0) return 0;
    if (rewardProgram.rewardType === "free_wash") return totalPrice;
    if (rewardProgram.rewardType === "discount_percent")
      return Math.round(totalPrice * Number(rewardProgram.rewardValue || 0) / 100);
    if (rewardProgram.rewardType === "discount_fixed")
      return Math.min(Number(rewardProgram.rewardValue || 0), totalPrice);
    return 0;
  }, [applyReward, rewardProgram, totalPrice]);

  // Apply reference data (staff filtering, branch type, discount settings) once
  // the cached staff + job-defaults queries have both resolved. Guarded to run
  // only once per mount — matches the previous one-shot Promise.all effect.
  const appliedJobDefaultsRef = useRef(false);
  useEffect(() => {
    if (!allStaffRaw || !jobDefaults || appliedJobDefaultsRef.current) return;
    appliedJobDefaultsRef.current = true;

    allStaffRef.current = allStaffRaw;
    const branchData = jobDefaults.branch;
    const settingsData = jobDefaults.settings;

    const activeBranchId = branchData?._id ? String(branchData._id) : null;
    setIsAllBranches(!activeBranchId);

    // Show staff from this branch + unassigned staff (null branch = migrating)
    setStaff(activeBranchId
      ? allStaffRaw.filter((s) => !s.branch || String(s.branch._id || s.branch) === activeBranchId)
      : allStaffRaw);
    setDiscountSettings({
      minPrice: Number(settingsData?.discountMinJobPrice ?? 0),
      maxPct:   Number(settingsData?.discountMaxPercent  ?? 0),
    });

    const bt = branchData?.branchType || "both";
    setBranchType(bt);
    // In create mode, auto-set job type to match branch capability
    if (!isEditMode && bt !== "both") setJobType(bt);
  }, [allStaffRaw, jobDefaults]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-filter staff whenever the user picks a branch in "All Branches" mode
  useEffect(() => {
    if (!isAllBranches || !allStaffRef.current.length) return;
    const raw = allStaffRef.current;
    setStaff(selectedBranchId
      ? raw.filter((s) => !s.branch || String(s.branch._id || s.branch) === selectedBranchId)
      : raw);
  }, [selectedBranchId, isAllBranches]);

  // In edit mode — load the existing job and pre-fill the form
  useEffect(() => {
    if (!editId) return;
    setLoadingJob(true);
    carWashApi.getJob(editId)
      .then((data) => {
        const job = data?.job || data;
        if (!job) return;
        setJobType(job.jobType || "vehicle");
        setPlateNumber(job.plateNumber || "");
        setJobPaymentStatus(job.paymentStatus || "unpaid");
        setIsVoucherJob(Boolean(job.isVoucher));
        if (job.creditAccount && typeof job.creditAccount === "object") {
          if (job.isVoucher) setVoucherAccount(job.creditAccount);
          else setCreditAccount(job.creditAccount);
        }
        setItemDescription(job.itemDescription || "");
        setExpectedReadyAt(
          job.expectedReadyAt
            ? new Date(job.expectedReadyAt).toISOString().slice(0, 10)
            : ""
        );
        setCustomerName(job.customerName || "");
        setPhone(job.phone || "");
        setNotes(job.notes || "");
        setDiscountAmount(job.discountAmount > 0 ? String(job.discountAmount) : "");
        setDiscountEnabled(job.discountAmount > 0);
        setPhotos(Array.isArray(job.photos) ? job.photos : []);

        const lines =
          Array.isArray(job.serviceLines) && job.serviceLines.length
            ? job.serviceLines.map((l) => ({
                service: String(l.service?._id || l.service || ""),
                serviceName: l.serviceName || "",
                vehicleType: l.vehicleType || "",
                price: l.isRewardLine ? "0" : String(l.price ?? ""),
                lineStaff: Array.isArray(l.lineStaff)
                  ? l.lineStaff.map(s => String(s?._id || s)).filter(Boolean)
                  : (l.lineStaff ? [String(l.lineStaff?._id || l.lineStaff)] : []),
                isRewardLine: Boolean(l.isRewardLine),
                measurements: { shape: "rect", length: "", width: "", diameter: "" },
              }))
            : [
                {
                  service: "",
                  serviceName: job.serviceName || "",
                  vehicleType: job.vehicleType || "",
                  price: String(job.price ?? ""),
                },
              ];
        setServiceLines(lines);

      })
      .catch(() => toast.error("Failed to load job for editing"))
      .finally(() => setLoadingJob(false));
  }, [editId]);

  const handleLineServiceChange = (index, serviceId) => {
    const svc = servicesById.get(serviceId);
    const hasTiers   = svc?.pricingTiers?.length > 0;
    const isPerSqft  = svc?.pricingType === "per_sqft";
    setServiceLines((prev) =>
      prev.map((line, i) =>
        i !== index
          ? line
          : {
              ...line,
              service:      serviceId,
              serviceName:  svc ? svc.name : line.serviceName,
              vehicleType:  hasTiers ? "" : line.vehicleType,
              price:        (hasTiers || isPerSqft) ? "" : String(svc ? (svc.defaultPrice ?? line.price) : line.price),
              measurements: isPerSqft
                ? { shape: "rect", length: "", width: "", diameter: "" }
                : line.measurements,
            }
      )
    );
  };

  const updateMeasurement = (index, field, value) => {
    setServiceLines((prev) => prev.map((line, i) => {
      if (i !== index) return line;
      const svc  = servicesById.get(line.service);
      const rate = Number(svc?.defaultPrice || 30);
      const m    = { ...line.measurements, [field]: value };
      let area   = 0;
      if (m.shape === "rect") {
        const l = parseFloat(m.length  || 0);
        const w = parseFloat(m.width   || 0);
        area = l * w;
      } else {
        const d = parseFloat(m.diameter || 0);
        area = Math.PI * Math.pow(d / 2, 2);
      }
      const price = area > 0 ? String(Math.round(area * rate)) : "";
      return { ...line, measurements: m, price };
    }));
  };

  const handleLineVehicleTypeChange = (index, vehicleType) => {
    const svc = servicesById.get(serviceLines[index]?.service);
    const tier = svc?.pricingTiers?.find((t) => t.vehicleType === vehicleType);
    setServiceLines((prev) =>
      prev.map((line, i) =>
        i !== index
          ? line
          : {
              ...line,
              vehicleType,
              price: tier != null ? String(tier.price) : (svc ? String(svc.defaultPrice ?? "") : line.price),
            }
      )
    );
  };

  const updateLine = (index, field, value) =>
    setServiceLines((prev) => prev.map((line, i) => (i === index ? { ...line, [field]: value } : line)));

  const addLine = () => setServiceLines((prev) => [...prev, emptyLine()]);

  const removeLine = (index) =>
    setServiceLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const toggleLineStaff = (lineIndex, staffId) =>
    setServiceLines((prev) => prev.map((line, i) => {
      if (i !== lineIndex) return line;
      const cur = Array.isArray(line.lineStaff) ? line.lineStaff : [];
      return { ...line, lineStaff: cur.includes(staffId) ? cur.filter(id => id !== staffId) : [...cur, staffId] };
    }));

  const staffSummary = useMemo(() => {
    const map = new Map();
    serviceLines.forEach(line => {
      if (!line.serviceName?.trim() || !Array.isArray(line.lineStaff)) return;
      line.lineStaff.forEach(id => {
        const member = staff.find(s => s._id === id);
        if (!member) return;
        if (!map.has(id)) map.set(id, { name: member.name, role: member.role, services: [] });
        map.get(id).services.push(line.serviceName || "—");
      });
    });
    return [...map.values()];
  }, [serviceLines, staff]);

  // Service dropdown options — derived once per services/jobType change instead of
  // being recomputed (via a filter/partition IIFE) inside every service-line row,
  // in both the mobile and desktop layouts, on every render.
  const { serviceOptionsMobile, serviceOptionsDesktop } = useMemo(() => {
    const filtered = services.filter((s2) => !s2.jobType || s2.jobType === "both" || s2.jobType === jobType);
    const regular  = filtered.filter((s2) => !s2.isCombo);
    const combos   = filtered.filter((s2) => s2.isCombo);
    const comboOptions = combos.length > 0
      ? [{ value: "__combo_sep__", label: "── COMBOS ──", disabled: true }, ...combos.map((s2) => ({ value: s2._id, label: `★ ${s2.name}` }))]
      : [];
    return {
      serviceOptionsMobile: [
        ...regular.map((s2) => ({ value: s2._id, label: s2.name })),
        ...comboOptions,
      ],
      serviceOptionsDesktop: [
        ...regular.map((s2) => ({ value: s2._id, label: s2.category ? `${s2.category} — ${s2.name}` : s2.name })),
        ...comboOptions,
      ],
    };
  }, [services, jobType]);

  const handleReset = useCallback(() => {
    setPlateNumber("");
    setCustomerName("");
    setPhone("");
    setItemDescription("");
    setExpectedReadyAt("");
    setServiceLines([emptyLine()]);
    setCreditAccount(null);
    setLoyaltyCard(null);
    setApplyReward(false);
    setDiscountAmount("");
    setDiscountEnabled(false);
    setNotes("");
    clearDraft();
  }, [clearDraft]);

  const handleCancel = () => {
    clearDraft();
    navigate("/carwash/jobs");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isAllBranches && !isEditMode && !selectedBranchId) {
      toast.error("Select a branch before saving");
      return;
    }
    if (jobType === "vehicle" && !plateNumber?.trim()) {
      toast.error("Plate number is required");
      return;
    }
    if (jobType === "vehicle" && isVoucherJob && !voucherAccount) {
      toast.error("Select a voucher company before saving");
      return;
    }
    if (!serviceLines.some((l) => l.serviceName?.trim())) {
      toast.error("Add at least one service line with a name");
      return;
    }
    const hasRewardLine = serviceLines.some((l) => l.isRewardLine);
    if (totalPrice <= 0 && !hasRewardLine) {
      toast.error("Total price must be greater than zero");
      return;
    }
    if (discountNum > totalPrice) {
      toast.error("Discount cannot exceed total price");
      return;
    }

    // Duplicate plate check — new vehicle jobs only, skip if user already confirmed
    if (!isEditMode && jobType === "vehicle" && plateNumber?.trim() && !skipDupCheckRef.current) {
      try {
        const todayStr = new Date().toISOString().slice(0, 10);
        const existing = await carWashApi.listJobs({
          search:   plateNumber.trim().toUpperCase(),
          dateFrom: todayStr,
          dateTo:   todayStr,
          limit:    1,
        });
        const match = Array.isArray(existing?.jobs) ? existing.jobs[0]
          : Array.isArray(existing)                 ? existing[0]
          : null;
        if (match) {
          setDupWarning(match);
          return; // pause — render warning modal below
        }
      } catch {
        // non-blocking — if check fails, proceed normally
      }
    }

    skipDupCheckRef.current = false; // reset after passing the gate
    setSaving(true);
    const payload = {
      jobType,
      plateNumber: jobType === "vehicle" ? plateNumber : undefined,
      itemDescription: jobType === "carpet" ? itemDescription : undefined,
      expectedReadyAt: jobType === "carpet" && expectedReadyAt ? expectedReadyAt : undefined,
      customerName,
      phone,
      serviceLines: serviceLines
        .filter((l) => l.serviceName?.trim())
        .map((l) => ({
          service: l.service || undefined,
          serviceName: l.serviceName,
          vehicleType: l.vehicleType,
          price: l.isRewardLine ? 0 : (Number(l.price) || 0),
          lineStaff: Array.isArray(l.lineStaff) ? l.lineStaff : [],
          isRewardLine: Boolean(l.isRewardLine),
        })),
      discountAmount: discountNum,
      applyCustomerCredit,
      creditAccount: (jobType === "vehicle" && isVoucherJob) ? (voucherAccount?._id || null) : (creditAccount?._id || null),
      notes,
      branch: (isAllBranches && !isEditMode && selectedBranchId) ? selectedBranchId : undefined,
    };
    try {
      if (isEditMode) {
        await carWashApi.updateJob(editId, payload);
        toast.success("Job updated");
        navigate("/carwash/jobs");
      } else {
        const result = await carWashApi.createJob(payload);
        const newId = result?._id || result?.job?._id;
        // Reward redemption now happens atomically on the backend as part of job creation
        // itself (resolveServiceLines validates availability, createJob consumes it) — no
        // separate client-side redemption call needed or possible to race against.

        clearDraft();
        toast.success(
          isVoucherJob
            ? `Voucher job created — billed to ${voucherAccount?.contactPerson || voucherAccount?.accountNumber || "company"}`
            : applyReward
              ? "Job created and loyalty reward applied!"
              : creditAccount
                ? "Job created and charged to credit account"
                : "Car Wash job created"
        );
        if (jobType === "carpet" && newId) {
          navigate(`/carwash/jobs/${newId}/edit`, { state: { openPhotos: true } });
        } else {
          navigate("/carwash/jobs");
        }
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || (isEditMode ? "Failed to update job" : "Failed to create job"));
    } finally {
      setSaving(false);
    }
  };

  if (loadingJob) {
    return (
      <CarWashShell showToolbar={false}>
        <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading job…</div>
      </CarWashShell>
    );
  }

  return (
    <CarWashShell showToolbar={false}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <form id="carwash-job-form" onSubmit={handleSubmit}>
            <div className="grid gap-2.5 lg:grid-cols-[1fr_320px]">

              {/* ── Left column ─────────────────────────────────────────────────── */}
              <div className="space-y-2.5">

            {/* Branch picker — only shown when logged in as All Branches */}
            {isAllBranches && !isEditMode && (
              <Section title={<>Branch<Required /></>}>
                <AppSelect
                  value={selectedBranchId}
                  onChange={(v) => setSelectedBranchId(v ?? "")}
                  options={branches.map((b) => ({ value: b._id, label: b.name }))}
                  placeholder="— Select branch for this job —"
                  size="sm"
                  searchable
                />
              </Section>
            )}

            {/* Vehicle / item details — the Job Type toggle lives in this Section's own
                header bar instead of spending a whole separate Section on two buttons */}
            <Section
              title={
                isEditMode ? (
                  <span className="inline-flex items-center gap-2 normal-case">
                    <span className="text-[11px] font-black uppercase tracking-wide text-slate-800">
                      {jobType === "vehicle" ? "Vehicle Details" : "Item Details"}
                    </span>
                    <span className="border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold capitalize text-slate-600">
                      {jobType === "vehicle" ? "Vehicle Wash" : "Carpet / Textile"} · locked
                    </span>
                  </span>
                ) : branchType === "both" ? (
                  <span className="inline-flex overflow-hidden border border-slate-300 normal-case">
                    <button
                      type="button"
                      onClick={() => setJobType("vehicle")}
                      className={`px-2.5 py-1 text-[10px] font-bold ${jobType === "vehicle" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
                    >
                      Vehicle Wash
                    </button>
                    <button
                      type="button"
                      onClick={() => { setJobType("carpet"); setIsVoucherJob(false); setVoucherAccount(null); }}
                      className={`border-l border-slate-300 px-2.5 py-1 text-[10px] font-bold ${jobType === "carpet" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
                    >
                      Carpet / Textile
                    </button>
                  </span>
                ) : (
                  jobType === "vehicle" ? "Vehicle Details" : "Item Details"
                )
              }
            >
              {/* Voucher Company picker — shown once "Voucher Job" is toggled in the Job Summary sidebar */}
              {jobType === "vehicle" && isVoucherJob && (!isEditMode || jobPaymentStatus !== "paid") && (
                <div className="mb-2">
                  <label className={labelClass}>Voucher Company<Required /></label>
                  {voucherCompanies.length === 0 ? (
                    <p className="text-[11px] text-amber-600 font-semibold">
                      No active voucher companies found — add one in Credit Accounts first.
                    </p>
                  ) : (
                    <AppSelect
                      value={voucherAccount?._id || ""}
                      onChange={(v) => {
                        const acc = voucherCompanies.find((a) => a._id === (v ?? "")) || null;
                        setVoucherAccount(acc);
                      }}
                      options={voucherCompanies.map((a) => ({ value: a._id, label: `${a.contactPerson || a.accountNumber} (${a.accountNumber})` }))}
                      placeholder="— Select voucher company —"
                      size="sm"
                      searchable
                    />
                  )}
                  {voucherAccount && (
                    <div className="mt-1.5 flex items-center gap-2 border border-orange-300 bg-orange-50 px-3 py-2 text-xs">
                      <FaTag className="shrink-0 text-orange-600" />
                      <div>
                        <span className="font-black text-orange-800">{voucherAccount.contactPerson || voucherAccount.accountNumber}</span>
                        <span className="ml-2 text-orange-600">· Ref: {voucherAccount.accountNumber}</span>
                        <div className="mt-0.5 text-orange-700">No payment collected — company billed via statement.</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Item description — carpet jobs only */}
              {jobType === "carpet" && (
                <div className="mb-2">
                  <label className={labelClass}>Item Description<Required /></label>
                  <textarea
                    className="min-h-[60px] w-full border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                    value={itemDescription}
                    onChange={(e) => setItemDescription(e.target.value)}
                    placeholder="e.g. 2 bedroom carpets, sofa set, car mat…"
                    required
                  />
                </div>
              )}

              {/* Plate / Expected Ready Date + Customer Name + Phone — one dense row */}
              <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-3">
                {jobType === "vehicle" ? (
                  <PlateLookupWidget
                    plate={plateNumber}
                    onPlateChange={setPlateNumber}
                    onCustomerFound={({ name, phone: ph }) => {
                      if (!isEditMode) {
                        setCustomerName((prev) => prev || name);
                        setPhone((prev) => prev || ph);
                        autoFilledCustomerRef.current = true;
                      }
                    }}
                    onCustomerCleared={() => {
                      if (!isEditMode && autoFilledCustomerRef.current) {
                        setCustomerName("");
                        setPhone("");
                        autoFilledCustomerRef.current = false;
                      }
                    }}
                    onRewardData={(card) => {
                      if (!card) setServiceLines((prev) => prev.filter((l) => !l.isRewardLine));
                      setLoyaltyCard(card);
                      setApplyReward(false);
                    }}
                    onLookupResult={setPlateLookupResult}
                    readOnly={isEditMode && jobPaymentStatus === "paid"}
                  />
                ) : (
                  <div>
                    <label className={labelClass}>Expected Ready Date</label>
                    <input
                      className={inputClass}
                      type="date"
                      value={expectedReadyAt}
                      onChange={(e) => setExpectedReadyAt(e.target.value)}
                    />
                  </div>
                )}
                <div>
                  <label className={labelClass}>Customer Name</label>
                  <input className={inputClass} value={customerName} onChange={(e) => { setCustomerName(e.target.value); autoFilledCustomerRef.current = false; }} placeholder="Customer name" />
                </div>
                <div>
                  <label className={labelClass}>
                    {isVoucherJob ? (
                      <>Customer Phone<Required /></>
                    ) : (
                      <>Phone <span className="ml-1 font-normal normal-case text-slate-400">(optional)</span></>
                    )}
                  </label>
                  <input
                    className={`${inputClass} ${isVoucherJob ? "border-orange-400 focus:border-[#FF8C00] focus:ring-orange-400/20" : ""}`}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={isVoucherJob ? "Customer's phone — SMS sent here" : "Captured from M-Pesa on payment"}
                    required={isVoucherJob}
                  />
                  {isVoucherJob && (
                    <p className="mt-1 text-[10px] font-semibold text-orange-700">
                      Payment confirmation &amp; loyalty SMS go to this number, not the car wash cashier.
                    </p>
                  )}
                </div>
              </div>

              {/* Vehicle-only: one unified status panel (plate/customer, credit account, reward)
                  instead of three separately-bordered stacked boxes — each piece below renders
                  flush row content only (no own border/margin) so they read as one connected
                  panel with color-coded rows. */}
              {jobType === "vehicle" && plateLookupResult && (
                <div className="mt-1 divide-y divide-slate-200 border border-slate-200">
                  <PlateLookupRow
                    lookupResult={plateLookupResult}
                    applyCredit={applyCustomerCredit}
                    onApplyCreditChange={setApplyCustomerCredit}
                  />
                  {!isVoucherJob && (
                    <CreditAccountRow
                      plate={plateNumber}
                      jobTotal={totalPrice}
                      onAccountDetected={(acc) => setCreditAccount(acc || null)}
                    />
                  )}
                  {!isVoucherJob && !isEditMode && loyaltyCard?.pendingRewards > 0 && loyaltyCard?.program && (() => {
                    const prog = loyaltyCard.program;
                    const isFreeService = prog.rewardType === "free_service";
                    const rewardSvc = loyaltyCard.rewardService;
                    const rewardLabel = isFreeService
                      ? (rewardSvc ? `Free ${rewardSvc.name}` : "Free service (not configured)")
                      : prog.rewardType === "free_wash" ? "Free wash"
                      : prog.rewardType === "discount_percent" ? `${prog.rewardValue}% off`
                      : `KES ${prog.rewardValue} off`;
                    const canApply = !isFreeService || Boolean(rewardSvc);
                    return (
                      <div className={`flex items-center justify-between gap-3 px-2.5 py-1.5 text-[11px] ${applyReward ? "bg-amber-100" : "bg-amber-50"}`}>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="flex items-center gap-1.5 font-black text-amber-800">
                            <FaGift className="shrink-0 text-amber-600" size={10} />
                            {loyaltyCard.pendingRewards} reward{loyaltyCard.pendingRewards !== 1 ? "s" : ""} available
                          </span>
                          <span className="text-amber-700">
                            {rewardLabel}
                            {!isFreeService && totalPrice > 0 && applyReward && (
                              <span className="ml-1.5 font-black text-emerald-700">→ saves {formatMoney(rewardPreviewDiscount)}</span>
                            )}
                            {isFreeService && applyReward && (
                              <span className="ml-1.5 font-black text-emerald-700">✓ Added as free line</span>
                            )}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={!canApply}
                          onClick={() => {
                            if (isFreeService && rewardSvc) {
                              if (!applyReward) {
                                setServiceLines((prev) => [
                                  { service: String(rewardSvc._id), serviceName: rewardSvc.name, vehicleType: "", price: 0, lineStaff: [], isRewardLine: true },
                                  ...prev.filter((l) => !l.isRewardLine),
                                ]);
                              } else {
                                setServiceLines((prev) => prev.filter((l) => !l.isRewardLine));
                              }
                            }
                            setApplyReward((v) => !v);
                          }}
                          className={`shrink-0 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide transition-colors disabled:opacity-40 ${applyReward ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-white border border-amber-400 text-amber-700 hover:bg-amber-100"}`}
                        >
                          {applyReward ? "✓ Applying" : "Apply Reward"}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}
              {jobType === "vehicle" && isEditMode && jobPaymentStatus !== "paid" && (
                <p className="mt-1 text-[10px] text-amber-600">Plate can be edited — payment not yet completed</p>
              )}
            </Section>

            {/* Service lines */}
            <Section title="Service Lines">
              <div className="border border-slate-200">
              {/* Mobile stacked layout */}
              <div className="sm:hidden divide-y divide-slate-200">
                {serviceLines.map((line, index) => {
                  const svc = servicesById.get(line.service);
                  const hasTiers = svc?.pricingTiers?.length > 0;
                  const isPerSqft = svc?.pricingType === "per_sqft";
                  const isReward = Boolean(line.isRewardLine);
                  return (
                    <div key={index} className={`p-2.5 space-y-1.5 ${isReward ? "bg-amber-50" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Line {index + 1}</span>
                          {isReward && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black text-amber-700"><FaGift className="text-[8px]" /> FREE · Reward</span>}
                        </div>
                        <button type="button" onClick={() => removeLine(index)} disabled={serviceLines.length === 1 || isReward} className="p-1 text-red-400 hover:text-red-600 disabled:opacity-30"><FaMinus className="text-[10px]" /></button>
                      </div>
                      <div>
                        <label className={labelClass}>Service</label>
                        <AppSelect
                          disabled={isReward}
                          value={line.service}
                          onChange={(v) => handleLineServiceChange(index, v ?? "")}
                          options={serviceOptionsMobile}
                          placeholder="— Select service —"
                          size="sm"
                          searchable
                        />
                        {svc?.isCombo && svc?.comboDescription && (
                          <div className="mt-1 border border-purple-200 bg-purple-50 px-2 py-1.5">
                            <p className="text-[9px] font-black uppercase tracking-wide text-purple-500">Includes</p>
                            <p className="text-[10px] text-purple-800 leading-relaxed">{svc.comboDescription}</p>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className={labelClass}>Name *</label>
                        <input readOnly={isReward} className={isReward ? tableInputRewardClass : tableInputClass} value={line.serviceName} onChange={(e) => updateLine(index, "serviceName", e.target.value)} placeholder="Service name" required />
                      </div>
                      {jobType === "vehicle" && (
                        <div>
                          <label className={labelClass}>Vehicle Type</label>
                          {hasTiers ? (
                            <AppSelect
                              value={line.vehicleType}
                              onChange={(v) => handleLineVehicleTypeChange(index, v ?? "")}
                              options={svc.pricingTiers.map((t) => ({ value: t.vehicleType, label: t.vehicleType }))}
                              placeholder="— Select vehicle type —"
                              size="sm"
                            />
                          ) : (
                            <AppSelect
                              value={line.vehicleType}
                              onChange={(v) => updateLine(index, "vehicleType", v ?? "")}
                              options={VEHICLE_TYPES.map((vt) => ({ value: vt, label: vt }))}
                              placeholder="— Vehicle type (optional) —"
                              size="sm"
                            />
                          )}
                        </div>
                      )}
                      <div>
                        <label className={labelClass}>Price (KES)</label>
                        {isReward ? (
                          <div className="flex h-7 items-center border border-amber-200 bg-amber-50 px-2 text-xs font-black text-amber-700">FREE (KES 0)</div>
                        ) : (
                          <div className="flex h-7 items-center justify-end border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 select-none">
                            {line.price !== "" && line.price !== undefined ? Number(line.price).toLocaleString() : <span className="text-slate-400">—</span>}
                          </div>
                        )}
                        {!isReward && <p className="mt-0.5 text-[10px] text-slate-400">Set in Services Setup</p>}
                      </div>
                      <div>
                        <label className={labelClass}>Attendants {isReward && <span className="ml-1 font-normal normal-case text-amber-600">(no commission on free line)</span>}</label>
                        <StaffMultiSelect
                          staff={staff}
                          selected={Array.isArray(line.lineStaff) ? line.lineStaff : EMPTY_ARRAY}
                          onToggle={(staffId) => toggleLineStaff(index, staffId)}
                          disabled={isReward}
                        />
                        {(!Array.isArray(line.lineStaff) || line.lineStaff.length === 0) && !isReward && (
                          <p className="mt-1 text-[10px] text-amber-600 font-semibold">No attendant — no commission</p>
                        )}
                      </div>
                      {isPerSqft && (() => {
                        const m = line.measurements || { shape: "rect", length: "", width: "", diameter: "" };
                        const rate = Number(svc.defaultPrice || 30);
                        let area = 0;
                        if (m.shape === "rect") { const l = parseFloat(m.length || 0); const w = parseFloat(m.width || 0); area = l * w; }
                        else { const d = parseFloat(m.diameter || 0); area = Math.PI * Math.pow(d / 2, 2); }
                        const calcPrice = area > 0 ? Math.round(area * rate) : null;
                        return (
                          <div className="rounded border border-violet-200 bg-violet-50 p-2 space-y-2">
                            <div className="flex overflow-hidden border border-slate-300">
                              <button type="button" onClick={() => updateMeasurement(index, "shape", "rect")} className={`flex-1 py-1.5 text-[11px] font-bold ${m.shape === "rect" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-600"}`}>Rectangle</button>
                              <button type="button" onClick={() => updateMeasurement(index, "shape", "circle")} className={`flex-1 border-l border-slate-300 py-1.5 text-[11px] font-bold ${m.shape === "circle" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-600"}`}>Circle</button>
                            </div>
                            {m.shape === "rect" ? (
                              <div className="grid grid-cols-2 gap-2">
                                <input type="number" min="0" step="0.1" value={m.length} onChange={(e) => updateMeasurement(index, "length", e.target.value)} placeholder="Length (ft)" className={tableInputClass} />
                                <input type="number" min="0" step="0.1" value={m.width} onChange={(e) => updateMeasurement(index, "width", e.target.value)} placeholder="Width (ft)" className={tableInputClass} />
                              </div>
                            ) : (
                              <input type="number" min="0" step="0.1" value={m.diameter} onChange={(e) => updateMeasurement(index, "diameter", e.target.value)} placeholder="Diameter (ft)" className={tableInputClass} />
                            )}
                            {area > 0 && <p className="text-[11px] font-semibold text-[#0B3B2E]">{area.toFixed(2)} sqft × KES {rate}/sqft = <strong>KES {calcPrice?.toLocaleString()}</strong></p>}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
                <div className="border-t border-slate-200 px-3 py-1.5">
                  <button
                    type="button"
                    onClick={addLine}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline"
                  >
                    <FaPlus className="text-[9px]" /> Add Line
                  </button>
                </div>
                {totalTaxAmount > 0 && (
                  <div className="border-t border-slate-200 bg-blue-50 px-4 py-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-extrabold uppercase tracking-wide text-blue-700">VAT Included</span>
                    <span className="text-[11px] font-black text-blue-700">{formatMoney(totalTaxAmount)}</span>
                  </div>
                )}
                <div className="border-t-2 border-slate-200 bg-[#EDF5F1] px-4 py-2 flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Total</span>
                  <span className="text-sm font-black text-[#0B3B2E]">{formatMoney(totalPrice)}</span>
                </div>
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full min-w-[700px] text-xs">
                  <thead className="bg-[#0B3B2E]">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Service</th>
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Name *</th>
                      {jobType === "vehicle" && <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Vehicle Type</th>}
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Price (KES) *</th>
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">
                        Attendants <span className="normal-case font-normal text-white/60">(select who handles this)</span>
                      </th>
                      <th className="w-8 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {serviceLines.map((line, index) => {
                      const isReward = Boolean(line.isRewardLine);
                      return (
                      <React.Fragment key={index}>
                      <tr className={`border-b border-slate-100 ${isReward ? "bg-amber-50/60" : ""}`}>
                        <td className="px-3 py-1.5">
                          {isReward ? (
                            <div className="flex h-7 items-center gap-1.5 px-1">
                              <FaGift className="text-amber-500" size={10} />
                              <span className="text-[10px] font-black text-amber-700">{line.serviceName}</span>
                              <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-600">FREE</span>
                            </div>
                          ) : (() => {
                              const selSvc = servicesById.get(line.service);
                              return (
                                <>
                                  <AppSelect
                                    value={line.service}
                                    onChange={(v) => handleLineServiceChange(index, v ?? "")}
                                    options={serviceOptionsDesktop}
                                    placeholder="— Select service —"
                                    size="sm"
                                    searchable
                                  />
                                  {selSvc?.isCombo && selSvc?.comboDescription && (
                                    <div className="mt-1 border border-purple-200 bg-purple-50 px-2 py-1">
                                      <p className="text-[9px] font-black uppercase tracking-wide text-purple-500">Includes</p>
                                      <p className="text-[10px] text-purple-800 leading-relaxed">{selSvc.comboDescription}</p>
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            readOnly={isReward}
                            className={isReward ? tableInputRewardClass : tableInputClass}
                            value={line.serviceName}
                            onChange={(e) => updateLine(index, "serviceName", e.target.value)}
                            placeholder="Service name"
                            required
                          />
                        </td>
                        {jobType === "vehicle" && (
                          <td className="px-3 py-1.5">
                            {(() => {
                              const svc = servicesById.get(line.service);
                              const hasTiers = svc?.pricingTiers?.length > 0;
                              return hasTiers ? (
                                <AppSelect
                                  value={line.vehicleType}
                                  onChange={(v) => handleLineVehicleTypeChange(index, v ?? "")}
                                  options={svc.pricingTiers.map((t) => ({ value: t.vehicleType, label: t.vehicleType }))}
                                  placeholder="— Select vehicle type —"
                                  size="sm"
                                />
                              ) : (
                                <AppSelect
                                  value={line.vehicleType}
                                  onChange={(v) => updateLine(index, "vehicleType", v ?? "")}
                                  options={VEHICLE_TYPES.map((vt) => ({ value: vt, label: vt }))}
                                  placeholder="— Vehicle type (optional) —"
                                  size="sm"
                                />
                              );
                            })()}
                          </td>
                        )}
                        <td className="px-3 py-1.5">
                          {isReward ? (
                            <div className="flex h-7 items-center justify-end px-2 text-xs font-black text-amber-700">FREE</div>
                          ) : (
                            <div className="flex h-7 items-center justify-end border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 select-none" title="Price is set in Services Setup">
                              {line.price !== "" && line.price !== undefined ? Number(line.price).toLocaleString() : <span className="text-slate-400">—</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {isReward ? (
                            <p className="text-[10px] font-semibold text-amber-600">No commission on free reward line</p>
                          ) : (
                            <div className="max-w-[220px]">
                              <StaffMultiSelect
                                staff={staff}
                                selected={Array.isArray(line.lineStaff) ? line.lineStaff : EMPTY_ARRAY}
                                onToggle={(staffId) => toggleLineStaff(index, staffId)}
                              />
                              {(!Array.isArray(line.lineStaff) || line.lineStaff.length === 0) && (
                                <p className="mt-1 text-[10px] text-amber-600 font-semibold">No attendant — no commission</p>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(index)}
                            disabled={serviceLines.length === 1 || isReward}
                            className="p-1 text-red-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                            title={isReward ? "Reward line — remove via Apply Reward toggle" : "Remove line"}
                          >
                            <FaMinus className="text-[10px]" />
                          </button>
                        </td>
                      </tr>

                      {/* Measurement calculator — shown for per_sqft services */}
                      {(() => {
                        const svc = servicesById.get(line.service);
                        if (svc?.pricingType !== "per_sqft") return null;
                        const m    = line.measurements || { shape: "rect", length: "", width: "", diameter: "" };
                        const rate = Number(svc.defaultPrice || 30);
                        let area   = 0;
                        if (m.shape === "rect") {
                          const l = parseFloat(m.length   || 0);
                          const w = parseFloat(m.width    || 0);
                          area = l * w;
                        } else {
                          const d = parseFloat(m.diameter || 0);
                          area = Math.PI * Math.pow(d / 2, 2);
                        }
                        const calcPrice = area > 0 ? Math.round(area * rate) : null;
                        const colSpan   = jobType === "vehicle" ? 6 : 5;
                        return (
                          <tr className="border-b border-slate-100 bg-violet-50">
                            <td colSpan={colSpan} className="px-4 py-1.5">
                              <div className="flex flex-wrap items-center gap-3">
                                {/* Shape toggle */}
                                <div className="flex overflow-hidden border border-slate-300">
                                  <button type="button" onClick={() => updateMeasurement(index, "shape", "rect")}
                                    className={`px-3 py-1 text-[11px] font-bold ${m.shape === "rect" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                                    Rectangle
                                  </button>
                                  <button type="button" onClick={() => updateMeasurement(index, "shape", "circle")}
                                    className={`border-l border-slate-300 px-3 py-1 text-[11px] font-bold ${m.shape === "circle" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                                    Circle
                                  </button>
                                </div>

                                {/* Dimension inputs */}
                                {m.shape === "rect" ? (
                                  <div className="flex items-center gap-1.5 text-xs">
                                    <input type="number" min="0" step="0.1" value={m.length} onChange={(e) => updateMeasurement(index, "length", e.target.value)}
                                      placeholder="Length" className="h-7 w-20 border border-slate-300 px-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
                                    <span className="font-bold text-slate-500">×</span>
                                    <input type="number" min="0" step="0.1" value={m.width} onChange={(e) => updateMeasurement(index, "width", e.target.value)}
                                      placeholder="Width" className="h-7 w-20 border border-slate-300 px-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
                                    <span className="text-slate-500">ft</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 text-xs">
                                    <span className="text-slate-500">Diameter:</span>
                                    <input type="number" min="0" step="0.1" value={m.diameter} onChange={(e) => updateMeasurement(index, "diameter", e.target.value)}
                                      placeholder="Diameter" className="h-7 w-24 border border-slate-300 px-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
                                    <span className="text-slate-500">ft</span>
                                  </div>
                                )}

                                {/* Result */}
                                {area > 0 && (
                                  <div className="flex items-center gap-1.5 text-[11px]">
                                    <span className="text-slate-500">=</span>
                                    <span className="font-bold text-slate-700">{area.toFixed(2)} sqft</span>
                                    <span className="text-slate-400">×</span>
                                    <span className="font-bold text-slate-700">KES {rate}/sqft</span>
                                    <span className="text-slate-400">=</span>
                                    <span className="font-black text-[#0B3B2E]">KES {calcPrice?.toLocaleString()}</span>
                                  </div>
                                )}
                                {area === 0 && (
                                  <span className="text-[10px] text-slate-400">Enter dimensions to calculate price automatically</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })()}

                      </React.Fragment>
                    );
                    })}
                    <tr>
                      <td colSpan={jobType === "vehicle" ? 6 : 5} className="border-t border-slate-200 px-3 py-1.5">
                        <button
                          type="button"
                          onClick={addLine}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline"
                        >
                          <FaPlus className="text-[9px]" /> Add Line
                        </button>
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    {totalTaxAmount > 0 && (
                      <tr className="border-t border-slate-200 bg-blue-50">
                        <td colSpan={jobType === "vehicle" ? 3 : 2} className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wide text-blue-700">
                          VAT Included
                        </td>
                        <td className="px-3 py-1.5 text-right text-[11px] font-black text-blue-700">
                          {formatMoney(totalTaxAmount)}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    )}
                    <tr className="border-t-2 border-slate-200 bg-[#EDF5F1]">
                      <td colSpan={jobType === "vehicle" ? 3 : 2} className="px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-slate-600">
                        Total
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-black text-[#0B3B2E]">
                        {formatMoney(totalPrice)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
              </div>
            </Section>

            {/* Notes */}
            <Section title="Notes">
              <textarea
                className="min-h-[64px] w-full border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes for this job"
              />
            </Section>
          </div>

          {/* ── Right column ────────────────────────────────────────────────── */}
          <div className="space-y-2.5">

            {/* Attendants summary */}
            <Section title="Attendants">
                {staffSummary.length === 0 ? (
                  <p className="text-[11px] text-amber-600 font-semibold">
                    No attendants assigned — select staff in the service lines above.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {staffSummary.map(({ name, role, services }) => (
                      <li key={name} className="flex items-center gap-1.5 py-1">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#0B3B2E] text-[8px] font-black text-white">
                          {name.charAt(0)}
                        </span>
                        <span className="shrink-0 truncate text-[11px] font-bold text-slate-900" title={name}>
                          {name}
                          {role && <span className="ml-1 font-normal text-slate-400">· {role}</span>}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-1">
                          {services.map((svc, i) => (
                            <span key={i} className="shrink-0 rounded-sm bg-[#0B3B2E]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#0B3B2E]">
                              {svc}
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
            </Section>

            {/* Job summary */}
            <Section title="Job Summary">
              <div className="space-y-2 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span className="font-semibold text-slate-500 uppercase tracking-wide">Type</span>
                  <span className="font-bold">{jobType === "carpet" ? "Carpet / Textile" : "Vehicle Wash"}</span>
                </div>
                {jobType === "vehicle" && plateNumber && (
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500 uppercase tracking-wide">Plate</span>
                    <span className="font-extrabold text-slate-900 tracking-wider">{plateNumber}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="font-semibold text-slate-500 uppercase tracking-wide">Lines</span>
                  <span className="font-bold">{serviceLines.filter((l) => l.serviceName?.trim()).length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-semibold text-slate-500 uppercase tracking-wide">Staff</span>
                  <span className="font-bold">{staffSummary.length || "None"}</span>
                </div>
                {isVoucherJob && voucherAccount && (
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500 uppercase tracking-wide">Voucher</span>
                    <span className="font-bold text-orange-700">
                      <FaTag className="mr-1 inline" size={9} />
                      {voucherAccount.contactPerson || voucherAccount.accountNumber}
                    </span>
                  </div>
                )}
                {!isVoucherJob && creditAccount && (
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500 uppercase tracking-wide">Credit Acct</span>
                    <span className="font-bold text-emerald-700">{creditAccount.accountNumber || "Yes"}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm">
                  <span className="font-extrabold uppercase tracking-wide text-slate-700">Total</span>
                  <span className={`font-black ${(discountNum > 0 || (applyReward && rewardPreviewDiscount > 0)) ? "text-sm text-slate-400 line-through" : "text-lg text-[#0B3B2E]"}`}>
                    {formatMoney(totalPrice)}
                  </span>
                </div>
                {jobType === "vehicle" && (!isEditMode || jobPaymentStatus !== "paid") && (
                  <div className="flex items-center gap-2">
                    <input
                      id="voucher-chk"
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[#FF8C00]"
                      checked={isVoucherJob}
                      onChange={(e) => {
                        setIsVoucherJob(e.target.checked);
                        if (!e.target.checked) setVoucherAccount(null);
                      }}
                    />
                    <label htmlFor="voucher-chk" className="text-[10px] font-bold uppercase tracking-wide text-orange-700 select-none cursor-pointer">
                      Voucher Job
                      <span className="ml-1 font-normal normal-case text-slate-400">(billed to company)</span>
                    </label>
                  </div>
                )}
                {applyReward && (rewardPreviewDiscount > 0 || loyaltyCard?.program?.rewardType === "free_service") ? (
                  <div className="flex items-center justify-between rounded bg-amber-50 px-2 py-1.5 text-xs">
                    <span className="flex items-center gap-1 font-bold text-amber-700"><FaGift size={9} /> Loyalty reward</span>
                    {loyaltyCard?.program?.rewardType === "free_service"
                      ? <span className="font-black text-emerald-700">Free {loyaltyCard.rewardService?.name || "service"}</span>
                      : <span className="font-black text-emerald-700">− {formatMoney(rewardPreviewDiscount)}</span>
                    }
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        id="discount-chk"
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-rose-600"
                        checked={discountEnabled}
                        disabled={!discountEligible || totalPrice <= 0}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setDiscountEnabled(on);
                          if (on && discountMaxPct > 0) {
                            setDiscountAmount(String(round2(totalPrice * discountMaxPct / 100)));
                          } else if (!on) {
                            setDiscountAmount("");
                          }
                        }}
                      />
                      <label htmlFor="discount-chk" className="text-[10px] font-bold uppercase tracking-wide text-rose-600 select-none cursor-pointer">
                        Apply Discount
                        {!discountEligible && discountMinPrice > 0 && (
                          <span className="ml-1 font-normal normal-case text-slate-400">(jobs above KES {discountMinPrice} only)</span>
                        )}
                        {discountMaxPct > 0 && discountEligible && (
                          <span className="ml-1 font-normal normal-case text-slate-400">max {discountMaxPct}%</span>
                        )}
                      </label>
                    </div>
                    {discountEnabled && (
                      <input
                        type="number"
                        min="0"
                        max={discountMaxAllowed}
                        step="1"
                        value={discountAmount}
                        onChange={(e) => {
                          const v = Math.min(Number(e.target.value) || 0, discountMaxAllowed);
                          setDiscountAmount(String(v));
                        }}
                        placeholder="0"
                        className="w-full border border-rose-200 px-2 py-1 text-right text-xs font-bold focus:border-rose-400 focus:outline-none"
                      />
                    )}
                  </div>
                )}
                {(applyReward ? rewardPreviewDiscount > 0 : discountNum > 0) && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-extrabold uppercase tracking-wide text-[#0B3B2E]">Net Payable</span>
                    <span className={`text-lg font-black ${applyReward && rewardPreviewDiscount >= totalPrice ? "text-emerald-600" : "text-[#0B3B2E]"}`}>
                      {applyReward
                        ? formatMoney(Math.max(0, totalPrice - rewardPreviewDiscount))
                        : formatMoney(Math.max(0, totalPrice - discountNum))}
                    </span>
                  </div>
                )}
                {applyReward && rewardPreviewDiscount >= totalPrice && (
                  <p className="text-center text-[10px] font-black uppercase tracking-wide text-emerald-600">FREE — fully covered by reward</p>
                )}
              </div>
            </Section>

            {/* Carpet photos panel — edit mode only */}
            {jobType === "carpet" && isEditMode && (
              <div className={openPhotosOnLoad ? "ring-2 ring-[#0B3B2E] ring-offset-2 rounded" : ""}>
                <CarpetPhotoPanel
                  jobId={editId}
                  existingPhotos={photos}
                  onPhotosChange={setPhotos}
                />
                {openPhotosOnLoad && photos.length === 0 && (
                  <p className="mt-2 text-center text-[10px] font-bold text-[#0B3B2E]">
                    Job saved! Take photos of the carpet now for easy identification.
                  </p>
                )}
              </div>
            )}
              </div>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            {!isEditMode && (
              <button
                type="button"
                onClick={handleReset}
                disabled={saving}
                className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Reset
              </button>
            )}
            {(isEditMode ? canUpdate : canCreate) && (
              <button
                id="cw-job-form-submit"
                type="submit"
                form="carwash-job-form"
                disabled={saving}
                className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <FaSpinner className="animate-spin" size={11} /> : <FaSave size={11} />}
                {saving ? "Saving…"
                  : isEditMode ? "Save Changes"
                  : applyReward ? "Save Job + Apply Reward"
                  : jobType === "carpet" ? "Save & Add Photos →"
                  : "Save Job"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Duplicate plate warning modal */}
      {dupWarning && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm border border-amber-300 bg-white shadow-2xl">
            <div className="bg-amber-500 px-4 py-3">
              <p className="text-sm font-black text-white">Duplicate Plate Number</p>
            </div>
            <div className="px-4 py-4 space-y-3">
              <p className="text-xs text-slate-700">
                Plate <span className="font-black text-slate-900 tracking-wider">{plateNumber.toUpperCase()}</span> already
                has a job today:
              </p>
              <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs space-y-0.5">
                <p className="font-black text-slate-900">{dupWarning.jobNumber}</p>
                {dupWarning.customerName && <p className="text-slate-600">{dupWarning.customerName}</p>}
                <p className="text-slate-500 capitalize">{dupWarning.status || "pending"}</p>
              </div>
              <p className="text-xs text-slate-500">
                This might be a duplicate entry. Confirm only if this is a separate visit.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDupWarning(null)}
                  className="flex-1 h-8 border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    skipDupCheckRef.current = true;
                    setDupWarning(null);
                    setTimeout(() => document.getElementById("cw-job-form-submit")?.click(), 0);
                  }}
                  className="flex-1 h-8 bg-amber-500 hover:bg-amber-600 text-white text-xs font-black"
                >
                  Yes, Proceed Anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </CarWashShell>
  );
};

export default CarWashAddJob;

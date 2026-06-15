import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  FaArrowLeft, FaCar, FaCamera, FaExclamationTriangle, FaGift, FaMinus, FaPlus, FaSave,
  FaTimesCircle, FaUser, FaExpand, FaUserCheck,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload, photoUrl, VEHICLE_TYPES } from "../../services/carWashApi";
import { useFormDraft } from "../../hooks/useFormDraft";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import CarWashShell from "./CarWashShell";
import CarpetCameraModal from "../../components/common/CarpetCameraModal";

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

// ─── Plate lookup ─────────────────────────────────────────────────────────────
const PlateLookupWidget = ({ plate, onPlateChange, onCustomerFound, onRewardData, readOnly }) => {
  const [lookupResult, setLookupResult] = useState(null);
  const [looking, setLooking] = useState(false);
  const timerRef = useRef(null);

  const lookup = useCallback(async (value) => {
    const p = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (p.length < 3) { setLookupResult(null); onRewardData?.(null); return; }
    setLooking(true);
    try {
      const result = await carWashApi.lookupPlate(p);
      setLookupResult(result);
      if (result?.customer) onCustomerFound({ name: result.customer.name, phone: result.customer.phone });
      onRewardData?.(result?.loyaltyCard || null);
    } catch (_) {
      setLookupResult(null);
      onRewardData?.(null);
    } finally {
      setLooking(false);
    }
  }, [onCustomerFound, onRewardData]);

  const handleChange = (e) => {
    if (readOnly) return;
    const val = e.target.value.toUpperCase();
    onPlateChange(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => lookup(val), 600);
  };

  const card = lookupResult?.loyaltyCard;
  const customer = lookupResult?.customer;
  const program = card?.program;
  const pendingRewards = card?.pendingRewards ?? 0;

  return (
    <div>
      <label className={labelClass}>Plate Number *</label>
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
      {lookupResult && (
        <div className={`mt-1.5 border px-3 py-2 text-[11px] ${customer ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
          {customer ? (
            <div className="flex items-start gap-2">
              <FaUser className="mt-0.5 shrink-0 text-emerald-600" />
              <div className="flex-1">
                <div className="font-black text-slate-800">{customer.name} <span className="font-normal text-slate-500">· {customer.phone}</span></div>
                {card && program ? (
                  <div className="mt-1 flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <div className="flex gap-0.5">
                        {Array.from({ length: program.stampsRequired }).map((_, i) => (
                          <div key={i} className={`h-2 w-2 rounded-full ${i < card.currentStamps ? "bg-emerald-500" : "bg-slate-200"}`} />
                        ))}
                      </div>
                      <span className="text-slate-500">{card.currentStamps}/{program.stampsRequired} stamps</span>
                    </div>
                    {pendingRewards > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-black text-amber-700">
                        <FaGift className="text-[8px]" /> {pendingRewards} reward{pendingRewards !== 1 ? "s" : ""} ready!
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mt-0.5 text-slate-500">No loyalty card yet</div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-slate-500">
              <FaCar className="text-[10px]" />
              <span>Plate not registered — customer info won't auto-fill.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Credit account banner ─────────────────────────────────────────────────────
const CreditAccountBanner = ({ plate, onAccountDetected }) => {
  const [account, setAccount] = useState(null);
  const prevPlate = useRef("");

  useEffect(() => {
    const p = String(plate || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!p || p === prevPlate.current) return;
    prevPlate.current = p;
    setAccount(null);
    onAccountDetected(null);
    if (p.length < 4) return;
    carWashApi.lookupAccountByPlate(p)
      .then((data) => { setAccount(data || null); onAccountDetected(data || null); })
      .catch(() => {});
  }, [plate]); // eslint-disable-line

  if (!account) return null;
  const balance = Number(account.currentBalance || 0);
  const overLimit = account.overLimit;
  return (
    <div className={`mt-1.5 flex items-start gap-2 border px-3 py-2 text-xs ${overLimit ? "border-amber-300 bg-amber-50 text-amber-800" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>
      {overLimit && <FaExclamationTriangle className="mt-0.5 flex-shrink-0 text-amber-500" />}
      <div>
        <div className="font-black">{account.accountNumber} · {account.customer?.name}</div>
        <div className="mt-0.5">
          Balance: <strong>{formatMoney(balance)}</strong>
          {account.creditLimit > 0 && <> / Limit: <strong>{formatMoney(account.creditLimit)}</strong></>}
          <span className={`ml-2 rounded px-1.5 py-0 text-[10px] font-black uppercase ${account.accountType === "monthly" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"}`}>
            {account.accountType}
          </span>
        </div>
        {overLimit
          ? <div className="mt-0.5 font-bold text-amber-700">⚠ Credit limit exceeded — proceed with caution</div>
          : <div className="mt-0.5 text-emerald-700">This job will be charged to the credit account.</div>
        }
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

  const [jobType, setJobType] = useState("vehicle");
  const [plateNumber, setPlateNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [expectedReadyAt, setExpectedReadyAt] = useState("");
  const [serviceLines, setServiceLines] = useState([emptyLine()]);
  const [creditAccount, setCreditAccount] = useState(null);
  const [loyaltyCard, setLoyaltyCard] = useState(null);
  const [applyReward, setApplyReward] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [jobNumber, setJobNumber] = useState("");
  const [photos, setPhotos] = useState([]);
  // When redirected from new-carpet-job save, open photos immediately
  const openPhotosOnLoad = Boolean(location.state?.openPhotos);

  const [services, setServices]     = useState([]);
  const [staff, setStaff]           = useState([]);
  const [branchType, setBranchType] = useState("both");
  const [saving, setSaving]         = useState(false);
  const [loadingJob, setLoadingJob] = useState(false);

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
    if (draft.notes)            setNotes(draft.notes);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save draft on change (new job only)
  useEffect(() => {
    if (isEditMode) return;
    const t = setTimeout(() => {
      writeDraft({ jobType, plateNumber, customerName, phone, itemDescription, expectedReadyAt, serviceLines, discountAmount, notes });
    }, 400);
    return () => clearTimeout(t);
  }, [isEditMode, jobType, plateNumber, customerName, phone, itemDescription, expectedReadyAt, serviceLines, discountAmount, notes]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPrice = useMemo(
    () => serviceLines.reduce((sum, l) => sum + (Number(l.price) || 0), 0),
    [serviceLines]
  );
  const discountNum = Math.max(0, Number(discountAmount) || 0);

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

  // Load reference data (services, staff) + active branch type
  useEffect(() => {
    const load = async () => {
      try {
        const [svcPayload, staffPayload, branchData] = await Promise.all([
          carWashApi.listServices({ active: true }),
          carWashApi.listStaff({ active: true }),
          carWashApi.getActiveBranch().catch(() => null),
        ]);
        setServices(normalizeListPayload(svcPayload, "services"));
        setStaff(normalizeListPayload(staffPayload, "staff"));

        const bt = branchData?.branchType || "both";
        setBranchType(bt);
        // In create mode, auto-set job type to match branch capability
        if (!isEditMode && bt !== "both") setJobType(bt);
      } catch {
        toast.error("Failed to load reference data");
      }
    };
    load();
  }, []); // eslint-disable-line

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
        setItemDescription(job.itemDescription || "");
        setExpectedReadyAt(
          job.expectedReadyAt
            ? new Date(job.expectedReadyAt).toISOString().slice(0, 10)
            : ""
        );
        setCustomerName(job.customerName || "");
        setPhone(job.phone || "");
        setNotes(job.notes || "");
        setJobNumber(job.jobNumber || "");
        setDiscountAmount(job.discountAmount > 0 ? String(job.discountAmount) : "");
        setPhotos(Array.isArray(job.photos) ? job.photos : []);

        const lines =
          Array.isArray(job.serviceLines) && job.serviceLines.length
            ? job.serviceLines.map((l) => ({
                service: String(l.service?._id || l.service || ""),
                serviceName: l.serviceName || "",
                vehicleType: l.vehicleType || "",
                price: String(l.price ?? ""),
                lineStaff: Array.isArray(l.lineStaff)
                  ? l.lineStaff.map(s => String(s?._id || s)).filter(Boolean)
                  : (l.lineStaff ? [String(l.lineStaff?._id || l.lineStaff)] : []),
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
    const svc = services.find((s) => s._id === serviceId);
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
      const svc  = services.find((s) => s._id === line.service);
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
    const svc = services.find((s) => s._id === serviceLines[index]?.service);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!serviceLines.some((l) => l.serviceName?.trim())) {
      toast.error("Add at least one service line with a name");
      return;
    }
    if (totalPrice <= 0) {
      toast.error("Total price must be greater than zero");
      return;
    }
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
          price: Number(l.price) || 0,
          lineStaff: Array.isArray(l.lineStaff) ? l.lineStaff : [],
        })),
      discountAmount: discountNum,
      creditAccount: creditAccount?._id || null,
      notes,
    };
    try {
      if (isEditMode) {
        await carWashApi.updateJob(editId, payload);
        toast.success("Job updated");
        navigate("/carwash/jobs");
      } else {
        const result = await carWashApi.createJob(payload);
        const newId = result?._id || result?.job?._id;

        if (applyReward && newId && loyaltyCard?.pendingRewards > 0) {
          try {
            await carWashApi.redeemLoyaltyReward(newId);
          } catch (_) {
            toast.warn("Job created but reward could not be applied — check loyalty card.");
          }
        }

        clearDraft();
        toast.success(applyReward ? "Job created and loyalty reward applied!" : creditAccount ? "Job created and charged to credit account" : "Car Wash job created");
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
      <CarWashShell title="Edit Job">
        <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading job…</div>
      </CarWashShell>
    );
  }

  return (
    <CarWashShell
      title={isEditMode ? `Edit Job${jobNumber ? ` — ${jobNumber}` : ""}` : "New Job"}
      action={
        <button
          type="button"
          onClick={() => { clearDraft(); navigate("/carwash/jobs"); }}
          className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-3 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
        >
          <FaArrowLeft /> Back to Jobs
        </button>
      }
    >
      <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid gap-3 p-3 lg:grid-cols-[1fr_320px]">

          {/* ── Left column ─────────────────────────────────────────────────── */}
          <div className="space-y-3">

            {/* Job type toggle — hidden when branch is locked to one type */}
            {(isEditMode || branchType === "both") && (
              <div className="border border-slate-200 bg-white p-3 shadow-sm">
                <p className={labelClass}>Job Type</p>
                {isEditMode ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 capitalize">
                      {jobType === "vehicle" ? "Vehicle Wash" : "Carpet / Textile"}
                    </span>
                    <span className="text-[10px] text-slate-400">Job type cannot be changed after creation</span>
                  </div>
                ) : (
                  <div className="flex overflow-hidden border border-slate-300">
                    <button
                      type="button"
                      onClick={() => setJobType("vehicle")}
                      className={`flex-1 py-2 text-xs font-bold ${jobType === "vehicle" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
                    >
                      Vehicle Wash
                    </button>
                    <button
                      type="button"
                      onClick={() => setJobType("carpet")}
                      className={`flex-1 border-l border-slate-300 py-2 text-xs font-bold ${jobType === "carpet" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
                    >
                      Carpet / Textile
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Vehicle / item details */}
            <div className="border border-slate-200 bg-white p-4 shadow-sm">
              <p className={`${labelClass} mb-3`}>
                {jobType === "vehicle" ? "Vehicle Details" : "Item Details"}
              </p>
              {jobType === "vehicle" ? (
                <>
                  <PlateLookupWidget
                    plate={plateNumber}
                    onPlateChange={setPlateNumber}
                    onCustomerFound={({ name, phone: ph }) => {
                      if (!isEditMode) {
                        setCustomerName((prev) => prev || name);
                        setPhone((prev) => prev || ph);
                      }
                    }}
                    onRewardData={(card) => {
                      setLoyaltyCard(card);
                      setApplyReward(false);
                    }}
                    readOnly={isEditMode}
                  />
                  <CreditAccountBanner
                    plate={plateNumber}
                    onAccountDetected={(acc) => setCreditAccount(acc || null)}
                  />
                  {!isEditMode && loyaltyCard?.pendingRewards > 0 && loyaltyCard?.program && (
                    <div className={`mt-1.5 border px-3 py-2.5 text-xs ${applyReward ? "border-amber-400 bg-amber-50" : "border-amber-200 bg-amber-50"}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <FaGift className="shrink-0 text-amber-600" />
                          <div>
                            <div className="font-black text-amber-800">
                              {loyaltyCard.pendingRewards} loyalty reward{loyaltyCard.pendingRewards !== 1 ? "s" : ""} available
                            </div>
                            <div className="mt-0.5 text-amber-700">
                              {loyaltyCard.program.rewardType === "free_wash" && "Free wash"}
                              {loyaltyCard.program.rewardType === "discount_percent" && `${loyaltyCard.program.rewardValue}% off`}
                              {loyaltyCard.program.rewardType === "discount_fixed" && `KES ${loyaltyCard.program.rewardValue} off`}
                              {totalPrice > 0 && applyReward && (
                                <span className="ml-1.5 font-black text-emerald-700">→ saves {formatMoney(rewardPreviewDiscount)}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setApplyReward((v) => !v)}
                          className={`shrink-0 rounded px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition-colors ${applyReward ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-white border border-amber-400 text-amber-700 hover:bg-amber-100"}`}
                        >
                          {applyReward ? "✓ Applying" : "Apply Reward"}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="mb-3">
                    <label className={labelClass}>Item Description *</label>
                    <textarea
                      className="min-h-[60px] w-full border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                      value={itemDescription}
                      onChange={(e) => setItemDescription(e.target.value)}
                      placeholder="e.g. 2 bedroom carpets, sofa set, car mat…"
                      required
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Expected Ready Date</label>
                    <input
                      className={inputClass}
                      type="date"
                      value={expectedReadyAt}
                      onChange={(e) => setExpectedReadyAt(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Customer Name</label>
                  <input className={inputClass} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name" />
                </div>
                <div>
                  <label className={labelClass}>
                    Phone
                    <span className="ml-1 font-normal normal-case text-slate-400">(optional)</span>
                  </label>
                  <input
                    className={inputClass}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Captured from M-Pesa on payment"
                  />
                </div>
              </div>
            </div>

            {/* Service lines */}
            <div className="border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 bg-[#EDF5F1] px-4 py-2">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#0B3B2E]">Service Lines</p>
                <button
                  type="button"
                  onClick={addLine}
                  className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
                >
                  <FaPlus className="text-[9px]" /> Add Line
                </button>
              </div>

              {/* Mobile stacked layout */}
              <div className="sm:hidden divide-y divide-slate-200">
                {serviceLines.map((line, index) => {
                  const svc = services.find((s) => s._id === line.service);
                  const hasTiers = svc?.pricingTiers?.length > 0;
                  const isPerSqft = svc?.pricingType === "per_sqft";
                  return (
                    <div key={index} className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Line {index + 1}</span>
                        <button type="button" onClick={() => removeLine(index)} disabled={serviceLines.length === 1} className="p-1 text-red-400 hover:text-red-600 disabled:opacity-30"><FaMinus className="text-[10px]" /></button>
                      </div>
                      <div>
                        <label className={labelClass}>Service</label>
                        <select className="h-9 w-full border border-slate-300 px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none" value={line.service} onChange={(e) => handleLineServiceChange(index, e.target.value)}>
                          <option value="">Select or type below</option>
                          {services.filter((s2) => !s2.jobType || s2.jobType === "both" || s2.jobType === jobType).map((s2) => (
                            <option key={s2._id} value={s2._id}>{s2.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Name *</label>
                        <input className="h-9 w-full border border-slate-300 px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none" value={line.serviceName} onChange={(e) => updateLine(index, "serviceName", e.target.value)} placeholder="Service name" required />
                      </div>
                      {jobType === "vehicle" && (
                        <div>
                          <label className={labelClass}>Vehicle Type</label>
                          {hasTiers ? (
                            <select className={`h-9 w-full border px-2 text-xs focus:outline-none ${!line.vehicleType ? "border-amber-400 bg-amber-50 text-amber-700" : "border-slate-300 text-slate-800 focus:border-[#0B3B2E]"}`} value={line.vehicleType} onChange={(e) => handleLineVehicleTypeChange(index, e.target.value)} required>
                              <option value="">— Select vehicle type —</option>
                              {svc.pricingTiers.map((t) => <option key={t.vehicleType} value={t.vehicleType}>{t.vehicleType}</option>)}
                            </select>
                          ) : (
                            <select className="h-9 w-full border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none" value={line.vehicleType} onChange={(e) => updateLine(index, "vehicleType", e.target.value)}>
                              <option value="">— Vehicle type (optional) —</option>
                              {VEHICLE_TYPES.map((vt) => <option key={vt} value={vt}>{vt}</option>)}
                            </select>
                          )}
                        </div>
                      )}
                      <div>
                        <label className={labelClass}>Price (KES) *</label>
                        <input className="h-9 w-full border border-slate-300 px-2 text-right text-xs font-bold text-slate-900 focus:border-[#0B3B2E] focus:outline-none" type="number" min="0" step="1" value={line.price} onChange={(e) => updateLine(index, "price", e.target.value)} required />
                      </div>
                      <div>
                        <label className={labelClass}>Attendants</label>
                        <div className="flex flex-wrap gap-1">
                          {staff.map((s) => {
                            const selected = Array.isArray(line.lineStaff) && line.lineStaff.includes(s._id);
                            return (
                              <button key={s._id} type="button" onClick={() => toggleLineStaff(index, s._id)} className={`inline-flex items-center gap-1 border px-2.5 py-1.5 text-xs font-bold transition-all ${selected ? "bg-[#0B3B2E] text-white border-[#0B3B2E]" : "bg-white text-slate-500 border-slate-200"}`}>
                                {selected && <span className="text-[8px]">✓</span>}
                                {s.name.split(" ")[0]}
                              </button>
                            );
                          })}
                        </div>
                        {(!Array.isArray(line.lineStaff) || line.lineStaff.length === 0) && (
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
                                <input type="number" min="0" step="0.1" value={m.length} onChange={(e) => updateMeasurement(index, "length", e.target.value)} placeholder="Length (ft)" className="h-9 w-full border border-slate-300 px-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
                                <input type="number" min="0" step="0.1" value={m.width} onChange={(e) => updateMeasurement(index, "width", e.target.value)} placeholder="Width (ft)" className="h-9 w-full border border-slate-300 px-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
                              </div>
                            ) : (
                              <input type="number" min="0" step="0.1" value={m.diameter} onChange={(e) => updateMeasurement(index, "diameter", e.target.value)} placeholder="Diameter (ft)" className="h-9 w-full border border-slate-300 px-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
                            )}
                            {area > 0 && <p className="text-[11px] font-semibold text-[#0B3B2E]">{area.toFixed(2)} sqft × KES {rate}/sqft = <strong>KES {calcPrice?.toLocaleString()}</strong></p>}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
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
                    {serviceLines.map((line, index) => (
                      <React.Fragment key={index}>
                      <tr className="border-b border-slate-100">
                        <td className="px-3 py-1.5">
                          <select
                            className="h-8 w-full border border-slate-300 px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                            value={line.service}
                            onChange={(e) => handleLineServiceChange(index, e.target.value)}
                          >
                            <option value="">Select or type below</option>
                            {services
                              .filter((svc) => !svc.jobType || svc.jobType === "both" || svc.jobType === jobType)
                              .map((svc) => (
                                <option key={svc._id} value={svc._id}>{svc.name}</option>
                              ))}
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            className="h-8 w-full border border-slate-300 px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                            value={line.serviceName}
                            onChange={(e) => updateLine(index, "serviceName", e.target.value)}
                            placeholder="Service name"
                            required
                          />
                        </td>
                        {jobType === "vehicle" && (
                          <td className="px-3 py-1.5">
                            {(() => {
                              const svc = services.find((s) => s._id === line.service);
                              const hasTiers = svc?.pricingTiers?.length > 0;
                              return hasTiers ? (
                                <select
                                  className={`h-8 w-full border px-2 text-xs focus:outline-none ${!line.vehicleType ? "border-amber-400 bg-amber-50 text-amber-700" : "border-slate-300 text-slate-800 focus:border-[#0B3B2E]"}`}
                                  value={line.vehicleType}
                                  onChange={(e) => handleLineVehicleTypeChange(index, e.target.value)}
                                  required
                                >
                                  <option value="">— Select vehicle type —</option>
                                  {svc.pricingTiers.map((t) => (
                                    <option key={t.vehicleType} value={t.vehicleType}>
                                      {t.vehicleType}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <select
                                  className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                                  value={line.vehicleType}
                                  onChange={(e) => updateLine(index, "vehicleType", e.target.value)}
                                >
                                  <option value="">— Vehicle type (optional) —</option>
                                  {VEHICLE_TYPES.map((vt) => (
                                    <option key={vt} value={vt}>{vt}</option>
                                  ))}
                                </select>
                              );
                            })()}
                          </td>
                        )}
                        <td className="px-3 py-1.5">
                          <input
                            className="h-8 w-full border border-slate-300 px-2 text-right text-xs font-bold text-slate-900 focus:border-[#0B3B2E] focus:outline-none"
                            type="number"
                            min="0"
                            step="1"
                            value={line.price}
                            onChange={(e) => updateLine(index, "price", e.target.value)}
                            required
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {staff.map((s) => {
                              const selected = Array.isArray(line.lineStaff) && line.lineStaff.includes(s._id);
                              return (
                                <button
                                  key={s._id}
                                  type="button"
                                  onClick={() => toggleLineStaff(index, s._id)}
                                  title={s.role || s.name}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold border transition-all ${
                                    selected
                                      ? "bg-[#0B3B2E] text-white border-[#0B3B2E] shadow-sm"
                                      : "bg-white text-slate-500 border-slate-200 hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
                                  }`}
                                >
                                  {selected && <span className="text-[8px]">✓</span>}
                                  {s.name.split(" ")[0]}
                                </button>
                              );
                            })}
                          </div>
                          {(!Array.isArray(line.lineStaff) || line.lineStaff.length === 0) && (
                            <p className="mt-1 text-[10px] text-amber-600 font-semibold">No attendant — no commission</p>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(index)}
                            disabled={serviceLines.length === 1}
                            className="p-1 text-red-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                            title="Remove line"
                          >
                            <FaMinus className="text-[10px]" />
                          </button>
                        </td>
                      </tr>

                      {/* Measurement calculator — shown for per_sqft services */}
                      {(() => {
                        const svc = services.find((s) => s._id === line.service);
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
                            <td colSpan={colSpan} className="px-4 py-2.5">
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
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 bg-[#EDF5F1]">
                    <tr>
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

            {/* Notes */}
            <div className="border border-slate-200 bg-white p-4 shadow-sm">
              <label className={labelClass}>Notes</label>
              <textarea
                className="min-h-[64px] w-full border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes for this job"
              />
            </div>
          </div>

          {/* ── Right column ────────────────────────────────────────────────── */}
          <div className="space-y-3">

            {/* Attendants summary */}
            <div className="border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-[#EDF5F1] px-4 py-2.5">
                <FaUserCheck className="text-[#0B3B2E] text-[13px]" />
                <span className="text-xs font-black uppercase tracking-wide text-[#0B3B2E]">Attendants</span>
              </div>
              <div className="p-3">
                {staffSummary.length === 0 ? (
                  <p className="text-[11px] text-amber-600 font-semibold">
                    No attendants assigned — select staff in the service lines above.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {staffSummary.map(({ name, role, services }) => (
                      <div key={name} className="flex items-start gap-2.5 rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
                        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0B3B2E] text-[9px] font-black text-white">
                          {name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-slate-900">{name}</p>
                          {role && <p className="text-[10px] text-slate-500">{role}</p>}
                          <div className="mt-1 flex flex-wrap gap-1">
                            {services.map((svc, i) => (
                              <span key={i} className="rounded-sm bg-[#0B3B2E]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#0B3B2E]">
                                {svc}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Job summary */}
            <div className="border border-slate-200 bg-white p-4 shadow-sm">
              <p className={`${labelClass} mb-3`}>Job Summary</p>
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
                {creditAccount && (
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500 uppercase tracking-wide">Credit Acct</span>
                    <span className="font-bold text-emerald-700">{creditAccount.accountNumber || "Yes"}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm">
                  <span className="font-extrabold uppercase tracking-wide text-slate-700">Total</span>
                  <span className={`font-black ${(discountNum > 0 || applyReward) ? "text-sm text-slate-400 line-through" : "text-lg text-[#0B3B2E]"}`}>
                    {formatMoney(totalPrice)}
                  </span>
                </div>
                {applyReward && rewardPreviewDiscount > 0 ? (
                  <div className="flex items-center justify-between rounded bg-amber-50 px-2 py-1.5 text-xs">
                    <span className="flex items-center gap-1 font-bold text-amber-700"><FaGift size={9} /> Loyalty reward</span>
                    <span className="font-black text-emerald-700">− {formatMoney(rewardPreviewDiscount)}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] font-bold uppercase tracking-wide text-rose-600 whitespace-nowrap">Discount (KES)</label>
                    <input
                      type="number"
                      min="0"
                      max={totalPrice}
                      step="1"
                      value={discountAmount}
                      onChange={(e) => setDiscountAmount(e.target.value)}
                      placeholder="0"
                      className="w-full border border-slate-200 px-2 py-1 text-right text-xs font-bold focus:border-rose-400 focus:outline-none"
                    />
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
            </div>

            {/* Save button */}
            {(isEditMode ? canUpdate : canCreate) && (
              <button
                type="submit"
                disabled={saving}
                className="flex w-full items-center justify-center gap-2 py-3 text-sm font-extrabold uppercase tracking-wide text-white bg-[#0B3B2E] hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FaSave />
                {saving ? "Saving…"
                  : isEditMode ? "Save Changes"
                  : applyReward ? "Save Job + Apply Reward"
                  : jobType === "carpet" ? "Save & Add Photos →"
                  : "Save Job"}
              </button>
            )}

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
    </CarWashShell>
  );
};

export default CarWashAddJob;

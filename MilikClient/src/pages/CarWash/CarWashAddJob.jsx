import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  FaArrowLeft, FaCar, FaExclamationTriangle, FaGift, FaMinus, FaPlus, FaSave, FaUser,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

// ─── Plate lookup ─────────────────────────────────────────────────────────────
const PlateLookupWidget = ({ plate, onPlateChange, onCustomerFound, readOnly }) => {
  const [lookupResult, setLookupResult] = useState(null);
  const [looking, setLooking] = useState(false);
  const timerRef = useRef(null);

  const lookup = useCallback(async (value) => {
    const p = value.trim().toUpperCase();
    if (p.length < 3) { setLookupResult(null); return; }
    setLooking(true);
    try {
      const result = await carWashApi.lookupPlate(p);
      setLookupResult(result);
      if (result?.customer) onCustomerFound({ name: result.customer.name, phone: result.customer.phone });
    } catch (_) {
      setLookupResult(null);
    } finally {
      setLooking(false);
    }
  }, [onCustomerFound]);

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
    const p = String(plate || "").trim().toUpperCase();
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

const emptyLine = () => ({ service: "", serviceName: "", vehicleType: "", price: "" });

const CarWashAddJob = () => {
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const isEditMode = Boolean(editId);

  const [jobType, setJobType] = useState("vehicle");
  const [plateNumber, setPlateNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [expectedReadyAt, setExpectedReadyAt] = useState("");
  const [serviceLines, setServiceLines] = useState([emptyLine()]);
  const [assignedStaff, setAssignedStaff] = useState([]);
  const [creditAccount, setCreditAccount] = useState(null);
  const [notes, setNotes] = useState("");
  const [jobNumber, setJobNumber] = useState("");

  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadingJob, setLoadingJob] = useState(false);

  const totalPrice = useMemo(
    () => serviceLines.reduce((sum, l) => sum + (Number(l.price) || 0), 0),
    [serviceLines]
  );

  // Load reference data (services + staff)
  useEffect(() => {
    const load = async () => {
      try {
        const [svcPayload, staffPayload] = await Promise.all([
          carWashApi.listServices({ active: true }),
          carWashApi.listStaff({ active: true }),
        ]);
        setServices(normalizeListPayload(svcPayload, "services"));
        setStaff(normalizeListPayload(staffPayload, "staff"));
      } catch {
        toast.error("Failed to load reference data");
      }
    };
    load();
  }, []);

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

        const lines =
          Array.isArray(job.serviceLines) && job.serviceLines.length
            ? job.serviceLines.map((l) => ({
                service: String(l.service?._id || l.service || ""),
                serviceName: l.serviceName || "",
                vehicleType: l.vehicleType || "",
                price: String(l.price ?? ""),
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

        const staffIds = Array.isArray(job.assignedStaff)
          ? job.assignedStaff.map((s) => String(s?._id || s)).filter(Boolean)
          : job.assignedStaff
          ? [String(job.assignedStaff?._id || job.assignedStaff)]
          : [];
        setAssignedStaff(staffIds);
      })
      .catch(() => toast.error("Failed to load job for editing"))
      .finally(() => setLoadingJob(false));
  }, [editId]);

  const handleLineServiceChange = (index, serviceId) => {
    const svc = services.find((s) => s._id === serviceId);
    setServiceLines((prev) =>
      prev.map((line, i) =>
        i !== index
          ? line
          : {
              ...line,
              service: serviceId,
              serviceName: svc ? svc.name : line.serviceName,
              vehicleType: svc ? (svc.vehicleType || line.vehicleType) : line.vehicleType,
              price: svc ? (svc.defaultPrice || line.price) : line.price,
            }
      )
    );
  };

  const updateLine = (index, field, value) =>
    setServiceLines((prev) => prev.map((line, i) => (i === index ? { ...line, [field]: value } : line)));

  const addLine = () => setServiceLines((prev) => [...prev, emptyLine()]);

  const removeLine = (index) =>
    setServiceLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const toggleStaff = (staffId) =>
    setAssignedStaff((prev) =>
      prev.includes(staffId) ? prev.filter((id) => id !== staffId) : [...prev, staffId]
    );

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
        })),
      assignedStaff,
      creditAccount: creditAccount?._id || null,
      notes,
    };
    try {
      if (isEditMode) {
        await carWashApi.updateJob(editId, payload);
        toast.success("Job updated");
      } else {
        await carWashApi.createJob(payload);
        toast.success(creditAccount ? "Job created and charged to credit account" : "Car Wash job created");
      }
      navigate("/carwash/jobs");
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
          onClick={() => navigate("/carwash/jobs")}
          className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-3 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
        >
          <FaArrowLeft /> Back to Jobs
        </button>
      }
    >
      <form onSubmit={handleSubmit}>
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">

          {/* ── Left column ─────────────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* Job type toggle — read-only in edit mode */}
            <div className="border border-slate-200 bg-white p-4 shadow-sm">
              <p className={labelClass}>Job Type</p>
              <div className="flex overflow-hidden border border-slate-300">
                <button
                  type="button"
                  onClick={() => !isEditMode && setJobType("vehicle")}
                  className={`flex-1 py-2 text-xs font-bold ${jobType === "vehicle" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-700 hover:bg-slate-50"} ${isEditMode ? "cursor-default" : ""}`}
                >
                  Vehicle Wash
                </button>
                <button
                  type="button"
                  onClick={() => !isEditMode && setJobType("carpet")}
                  className={`flex-1 border-l border-slate-300 py-2 text-xs font-bold ${jobType === "carpet" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-700 hover:bg-slate-50"} ${isEditMode ? "cursor-default" : ""}`}
                >
                  Carpet / Textile
                </button>
              </div>
            </div>

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
                    readOnly={isEditMode}
                  />
                  <CreditAccountBanner
                    plate={plateNumber}
                    onAccountDetected={(acc) => setCreditAccount(acc || null)}
                  />
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

            {/* Service lines table */}
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

              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-slate-500">Service</th>
                      <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-slate-500">Name *</th>
                      {jobType === "vehicle" && <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-slate-500">Vehicle Type</th>}
                      <th className="px-3 py-2 text-right font-bold uppercase tracking-wide text-slate-500">Price (KES) *</th>
                      <th className="w-8 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {serviceLines.map((line, index) => (
                      <tr key={index} className="border-b border-slate-100">
                        <td className="px-3 py-1.5">
                          <select
                            className="h-8 w-full border border-slate-300 px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                            value={line.service}
                            onChange={(e) => handleLineServiceChange(index, e.target.value)}
                          >
                            <option value="">Select or type below</option>
                            {services.map((svc) => (
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
                            <input
                              className="h-8 w-full border border-slate-300 px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                              value={line.vehicleType}
                              onChange={(e) => updateLine(index, "vehicleType", e.target.value)}
                              placeholder="e.g. Sedan"
                            />
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
                      <td />
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
          <div className="space-y-4">

            {/* Staff assignment */}
            <div className="border border-slate-200 bg-white p-4 shadow-sm">
              <p className={`${labelClass} mb-2`}>
                Assigned Staff
                {assignedStaff.length > 1 && (
                  <span className="ml-2 normal-case font-semibold text-emerald-700">
                    Commission split {assignedStaff.length} ways
                  </span>
                )}
              </p>
              {staff.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic">No staff loaded</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {staff.map((member) => {
                    const checked = assignedStaff.includes(member._id);
                    return (
                      <label
                        key={member._id}
                        className={`flex cursor-pointer items-center gap-2.5 border px-3 py-2 text-xs transition-colors ${checked ? "border-emerald-300 bg-emerald-50 font-bold text-emerald-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStaff(member._id)}
                          className="accent-[#0B3B2E]"
                        />
                        <div>
                          <div className="font-bold">{member.name}</div>
                          {member.role && <div className="text-[10px] text-slate-500 normal-case font-normal">{member.role}</div>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
              {assignedStaff.length === 0 && (
                <p className="mt-2 text-[10px] text-slate-400">No staff assigned — commission will not be accrued.</p>
              )}
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
                  <span className="font-bold">{assignedStaff.length || "None"}</span>
                </div>
                {creditAccount && (
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500 uppercase tracking-wide">Credit Acct</span>
                    <span className="font-bold text-emerald-700">{creditAccount.accountNumber || "Yes"}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm">
                  <span className="font-extrabold uppercase tracking-wide text-slate-700">Total</span>
                  <span className="text-lg font-black text-[#0B3B2E]">{formatMoney(totalPrice)}</span>
                </div>
              </div>
            </div>

            {/* Save button */}
            <button
              type="submit"
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 bg-[#0B3B2E] py-3 text-sm font-extrabold uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FaSave />
              {saving ? "Saving…" : isEditMode ? "Save Changes" : "Save Job"}
            </button>
          </div>
        </div>
      </form>
    </CarWashShell>
  );
};

export default CarWashAddJob;

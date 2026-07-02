import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import {
  FaCheckCircle, FaCodeBranch, FaExclamationTriangle, FaMobileAlt, FaRedoAlt,
  FaSearch, FaTimesCircle, FaCopy, FaLink, FaTimes, FaCarAlt, FaUndo,
  FaUpload, FaFileAlt, FaToggleOn, FaToggleOff, FaBan,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import { selectCurrentCompany } from "../../redux/selectors";

const PAGE_SIZE = 50;

const STATUS_META = {
  matched:   { label: "Matched",   bg: "bg-emerald-50",  border: "border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500", icon: FaCheckCircle },
  unmatched: { label: "Unmatched", bg: "bg-amber-50",    border: "border-amber-200",   text: "text-amber-700",  dot: "bg-amber-400",  icon: FaExclamationTriangle },
  duplicate: { label: "Duplicate", bg: "bg-blue-50",     border: "border-blue-200",    text: "text-blue-700",   dot: "bg-blue-400",   icon: FaCopy },
  rejected:  { label: "Rejected",  bg: "bg-red-50",      border: "border-red-200",     text: "text-red-700",    dot: "bg-red-400",    icon: FaTimesCircle },
  error:     { label: "Error",     bg: "bg-slate-50",    border: "border-slate-200",   text: "text-slate-500",  dot: "bg-slate-400",  icon: FaExclamationTriangle },
};

const ReversedBadge = () => (
  <span className="inline-flex items-center gap-1 border border-red-300 bg-red-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-red-600">
    <FaUndo size={7} /> Reversed
  </span>
);

const StatusBadge = ({ status }) => {
  const m = STATUS_META[status] || STATUS_META.error;
  return (
    <span className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[10px] font-bold uppercase ${m.bg} ${m.border} ${m.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
};

const fmtDate = (v) =>
  v ? new Date(v).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const extractActor = (text) => {
  if (!text) return null;
  const m = text.match(/\bby\s+([^|]+?)(?:\s*\||$)/i);
  return m?.[1]?.trim() || null;
};

// ─── Allocate Modal — memoized row ───────────────────────────────────────────
const JobAllocRow = React.memo(({ job, value, available, onSet, onFill }) => (
  <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 hover:bg-slate-50">
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-extrabold tracking-wider text-slate-900">{job.plateNumber}</span>
        <span className="font-mono text-[10px] text-slate-400">{job.jobNumber}</span>
      </div>
      <div className="mt-0.5 text-[10px] text-slate-500">
        {job.customerName || "—"} · {job.serviceName || "—"} · {fmtDate(job.createdAt)}
      </div>
    </div>
    <div className="flex-shrink-0 text-right">
      <div className="text-[10px] text-slate-400">Outstanding</div>
      <div className="text-xs font-bold text-red-600">{formatMoney(job.outstanding)}</div>
    </div>
    <div className="flex flex-shrink-0 items-center gap-1">
      <input
        type="number" min="0" step="1" max={job.outstanding}
        value={value}
        onChange={(e) => onSet(String(job._id), e.target.value)}
        className="h-8 w-24 border border-slate-300 px-2 text-right text-xs focus:border-[#0B3B2E] focus:outline-none"
        placeholder="0"
      />
      <button
        type="button"
        onClick={() => onFill(String(job._id), job.outstanding)}
        className="h-8 border border-slate-200 bg-slate-50 px-2 text-[10px] font-bold text-slate-500 hover:bg-slate-100"
        title="Fill outstanding"
      >
        Fill
      </button>
    </div>
  </div>
));

// ─── Allocate Modal ───────────────────────────────────────────────────────────
function AllocateModal({ notif, onClose, onAllocated }) {
  const [jobs, setJobs]               = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [plateSearch, setPlateSearch] = useState("");
  const [allocations, setAllocations] = useState({});
  const [saving, setSaving]           = useState(false);

  const available = Number(notif.amount) - Number(notif.allocatedAmount || 0);

  useEffect(() => {
    carWashApi.listUnpaidJobs()
      .then((d) => setJobs(Array.isArray(d) ? d : []))
      .catch(() => toast.error("Failed to load unpaid jobs"))
      .finally(() => setLoadingJobs(false));
  }, []);

  const filtered = useMemo(() => {
    const q = plateSearch.trim().toUpperCase();
    if (!q) return jobs;
    return jobs.filter((j) =>
      j.plateNumber?.toUpperCase().includes(q) ||
      j.jobNumber?.includes(q) ||
      j.customerName?.toUpperCase().includes(q)
    );
  }, [jobs, plateSearch]);

  // Stable setters — functional updates so rows don't need leftover in deps
  const onSet = useCallback((id, val) => setAllocations((p) => ({ ...p, [id]: val })), []);
  const onFill = useCallback((id, outstanding) => {
    setAllocations((p) => {
      const otherTotal = Object.entries(p).reduce((s, [k, v]) => k !== id ? s + (Number(v) || 0) : s, 0);
      const leftover   = available - otherTotal;
      return { ...p, [id]: String(Math.min(outstanding, Math.max(0, leftover))) };
    });
  }, [available]);

  const totalAllocating = useMemo(
    () => Object.values(allocations).reduce((s, v) => s + (Number(v) || 0), 0),
    [allocations]
  );
  const leftover = available - totalAllocating;
  const isOver   = totalAllocating > available + 0.01;

  const handleConfirm = useCallback(async () => {
    const allocs = Object.entries(allocations)
      .map(([jobId, amount]) => ({ jobId, amount: Number(amount) }))
      .filter((a) => a.amount > 0);
    if (!allocs.length) return toast.warning("Add at least one amount");
    if (isOver) return toast.warning("Total exceeds available amount");
    setSaving(true);
    try {
      const res = await carWashApi.allocateMpesaPayment(notif._id, { allocations: allocs });
      toast.success(res?.message || "Payment allocated");
      onAllocated(res?.notification || res?.data?.notification);
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Allocation failed");
    } finally {
      setSaving(false);
    }
  }, [allocations, isOver, notif._id, onAllocated, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-2xl flex-col border border-slate-200 bg-white shadow-xl" style={{ maxHeight: "90vh" }}>
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between bg-[#0B3B2E] px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-white">Allocate Payment</p>
            <p className="text-[11px] text-emerald-200">
              Ksh {formatMoney(notif.amount)} · {notif.senderName || "Unknown"} · <span className="font-mono">{notif.transactionCode || "—"}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><FaTimes size={14} /></button>
        </div>

        {/* Amount strip */}
        <div className="flex flex-shrink-0 items-center gap-6 border-b border-slate-200 bg-slate-50 px-4 py-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Available</div>
            <div className="text-sm font-black text-emerald-700">{formatMoney(available)}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Allocating</div>
            <div className={`text-sm font-black ${isOver ? "text-red-600" : "text-slate-900"}`}>{formatMoney(totalAllocating)}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Leftover</div>
            <div className={`text-sm font-black ${leftover < 0 ? "text-red-600" : "text-slate-400"}`}>{formatMoney(Math.abs(leftover))}</div>
          </div>
        </div>

        {/* Search */}
        <div className="flex-shrink-0 border-b border-slate-200 px-4 py-2">
          <input
            className="h-8 w-full border border-slate-300 px-3 text-xs font-semibold uppercase placeholder:normal-case focus:border-[#0B3B2E] focus:outline-none"
            placeholder="Search by plate, job #, or customer…"
            value={plateSearch}
            onChange={(e) => setPlateSearch(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        {/* Job list */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingJobs ? (
            <p className="px-4 py-8 text-center text-xs text-slate-400">Loading unpaid jobs…</p>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-slate-400">
              {plateSearch ? "No jobs match your search" : "No unpaid jobs found in the last 6 months"}
            </p>
          ) : filtered.map((j) => (
            <JobAllocRow
              key={j._id}
              job={j}
              value={allocations[String(j._id)] ?? ""}
              available={available}
              onSet={onSet}
              onFill={onFill}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
          {isOver ? (
            <span className="text-xs font-bold text-red-600">Total exceeds available by {formatMoney(Math.abs(leftover))}</span>
          ) : (
            <span className="text-[11px] text-slate-500">
              {Object.values(allocations).filter((v) => Number(v) > 0).length} job(s) · {formatMoney(totalAllocating)} allocating
            </span>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="inline-flex h-8 items-center px-3 text-xs font-bold text-slate-600 hover:text-slate-900">Cancel</button>
            <button
              onClick={handleConfirm}
              disabled={saving || isOver || totalAllocating <= 0}
              className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"
            >
              <FaCodeBranch size={9} /> {saving ? "Allocating…" : "Confirm Allocation"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Assign Modal ─────────────────────────────────────────────────────────────
function AssignModal({ notif, onClose, onAssigned }) {
  const [search, setSearch] = useState(notif?.plate || "");
  const [jobs, setJobs] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (notif?.plate) doSearch(notif.plate);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doSearch = async (q = search) => {
    const term = q.trim();
    if (!term) return;
    setSearching(true);
    setSelected(null);
    try {
      const res = await carWashApi.listJobs({ search: term, limit: 20 });
      setJobs(normalizeListPayload(res, "jobs"));
    } catch {
      toast.error("Job search failed");
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await carWashApi.reassignMpesaNotification(notif._id, selected._id);
      const updated = res?.notification || res?.data?.notification;
      toast.success(`Assigned to job ${selected.jobNumber} — Ksh ${formatMoney(notif.amount)} recorded`);
      onAssigned(updated || { ...notif, status: "matched", matchedJob: selected });
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to assign notification");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg bg-white shadow-xl border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B3B2E] px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-white">Assign to Job</p>
            <p className="text-[11px] text-emerald-200">
              Ksh {formatMoney(notif.amount)} · ref: <span className="font-mono">{notif.billRefNumber || "—"}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><FaTimes size={14} /></button>
        </div>

        {/* Wrong ref info */}
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-800">
          <FaExclamationTriangle className="inline mr-1.5 text-amber-500" size={11} />
          Customer typed <strong className="font-mono">&ldquo;{notif.billRefNumber}&rdquo;</strong> as account reference — search below to find the correct job.
        </div>

        {/* Search */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              className="h-9 flex-1 border border-slate-300 px-3 text-xs font-semibold uppercase placeholder:normal-case focus:border-[#0B3B2E] focus:outline-none"
              placeholder="Plate, job #, or customer name"
              value={search}
              onChange={e => setSearch(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && doSearch()}
            />
            <button
              type="button"
              onClick={() => doSearch()}
              disabled={searching}
              className="inline-flex h-9 items-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00] disabled:opacity-50"
            >
              <FaSearch size={10} /> Search
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="max-h-64 overflow-y-auto border-t border-slate-100">
          {searching && (
            <p className="px-4 py-6 text-center text-xs text-slate-400">Searching…</p>
          )}
          {!searching && jobs.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-slate-400">No jobs found. Try searching by plate or job number.</p>
          )}
          {!searching && jobs.map((j) => {
            const isSelected = selected?._id === j._id;
            const isPaid = j.paymentStatus === "paid";
            return (
              <button
                key={j._id}
                type="button"
                disabled={isPaid}
                onClick={() => setSelected(j)}
                className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition-colors ${
                  isSelected ? "bg-emerald-50 border-l-2 border-l-emerald-500" : "hover:bg-slate-50"
                } ${isPaid ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                <FaCarAlt size={13} className={isSelected ? "text-emerald-600" : "text-slate-400"} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-slate-900 tracking-wider text-xs">{j.plateNumber}</span>
                    <span className="text-[10px] text-slate-500 font-mono">{j.jobNumber}</span>
                    <StatusBadge status={j.paymentStatus === "paid" ? "matched" : j.paymentStatus === "partial" ? "unmatched" : "unmatched"} />
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {j.customerName || "—"} · Ksh {formatMoney(Math.max(0, (j.price || 0) - (j.discountAmount || 0)))} · {fmtDate(j.createdAt)}
                  </div>
                </div>
                {isPaid && <span className="text-[9px] font-bold uppercase text-slate-400">Fully Paid</span>}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
          {selected ? (
            <div className="text-[11px] text-slate-600">
              Assigning <strong>Ksh {formatMoney(Math.min(notif.amount, Math.max(0, (selected.price || 0) - (selected.discountAmount || 0))))}</strong> to{" "}
              <strong className="text-[#0B3B2E]">{selected.plateNumber} · {selected.jobNumber}</strong>
            </div>
          ) : (
            <span className="text-[11px] text-slate-400">Select a job above</span>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="inline-flex h-8 items-center px-3 text-xs font-bold text-slate-600 hover:text-slate-900">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!selected || saving}
              className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"
            >
              <FaLink size={10} /> {saving ? "Assigning…" : "Confirm Assignment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Mark Reversed Modal ──────────────────────────────────────────────────────
function MarkReversedModal({ notif, onClose, onReversed }) {
  const [reversalRef, setReversalRef] = useState("");
  const [saving, setSaving]           = useState(false);
  const hasPayment = Boolean(notif.matchedPayment);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const res = await carWashApi.markMpesaNotificationReversed(notif._id, { reversalRef: reversalRef.trim() });
      toast.success("Notification marked as reversed — allocation blocked");
      onReversed(res?.data || res);
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to mark as reversed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between bg-red-700 px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-white">Mark as Reversed</p>
            <p className="text-[11px] text-red-200">
              {formatMoney(notif.amount)} · <span className="font-mono">{notif.transactionCode || "—"}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><FaTimes size={14} /></button>
        </div>

        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-700">
            Mark this notification as reversed? Allocation and assignment will be permanently blocked.
          </p>

          {hasPayment && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800">
              <FaExclamationTriangle className="mr-1.5 inline text-amber-500" size={11} />
              This notification has a recorded payment. Make sure you have already reversed that payment on the <strong>Jobs page</strong> before marking this as reversed.
            </div>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
              M-Pesa Reversal Reference (optional)
            </label>
            <input
              type="text"
              value={reversalRef}
              onChange={(e) => setReversalRef(e.target.value)}
              placeholder="e.g. RI12345678 or leave blank"
              className="h-9 w-full border border-slate-300 px-3 text-xs text-slate-700 focus:border-red-500 focus:outline-none"
              autoFocus
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button onClick={onClose} className="inline-flex h-8 items-center px-3 text-xs font-bold text-slate-600 hover:text-slate-900">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="inline-flex h-8 items-center gap-1.5 bg-red-600 px-4 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
          >
            <FaBan size={10} /> {saving ? "Saving…" : "Mark as Reversed"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CSV client-side parser (preview only) ────────────────────────────────────
const parseClientCsv = (text) => {
  const rows = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (ch === "," && !inQ) {
        cells.push(cur.trim()); cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
};

const normH = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const detectCsvFormat = (headers) => {
  const nh = headers.map(normH);
  if (nh.includes("receiptno") || nh.includes("paidin") || nh.includes("amountpaidin")) return "portal";
  if (nh.includes("transid") || nh.includes("billrefnumber")) return "daraja";
  return null;
};

const RESULT_META = {
  matched:   { label: "Matched",   bg: "bg-emerald-50 border-emerald-200 text-emerald-700" },
  duplicate: { label: "Duplicate", bg: "bg-blue-50 border-blue-200 text-blue-700" },
  unmatched: { label: "Unmatched", bg: "bg-amber-50 border-amber-200 text-amber-700" },
  skipped:   { label: "Skipped",   bg: "bg-slate-50 border-slate-200 text-slate-500" },
  error:     { label: "Error",     bg: "bg-red-50 border-red-200 text-red-700" },
};

// ─── Upload Modal ─────────────────────────────────────────────────────────────
function UploadModal({ onClose, onUploaded, paybills = [] }) {
  const fileInputRef              = useRef(null);
  const [file, setFile]           = useState(null);
  const [preview, setPreview]     = useState(null); // { headers, rows, total, format }
  const [sendSms, setSendSms]     = useState(false);
  const [selectedShortCode, setSelectedShortCode] = useState("");
  const [processing, setProcessing] = useState(false);
  const [results, setResults]     = useState(null); // { summary, results[] }
  const [dragOver, setDragOver]   = useState(false);

  const loadFile = (f) => {
    if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (ext !== "csv") { toast.error("Only CSV files are supported"); return; }
    setFile(f);
    setResults(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const rows = parseClientCsv(text);
      if (rows.length < 2) { toast.error("File appears empty"); return; }
      const format = detectCsvFormat(rows[0]);
      if (!format) {
        toast.error("Unrecognised format. Expected M-Pesa Business Portal or Daraja C2B export.");
        setFile(null);
        return;
      }
      setPreview({ headers: rows[0], rows: rows.slice(1, 51), total: rows.length - 1, format });
    };
    reader.readAsText(f);
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  };

  const handleProcess = async () => {
    if (!file) return;
    setProcessing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sendSms", String(sendSms));
      if (selectedShortCode) fd.append("shortCode", selectedShortCode);
      const res = await carWashApi.uploadMpesaStatement(fd);
      setResults(res);
      if (res?.summary?.matched > 0) onUploaded?.();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Upload failed");
    } finally {
      setProcessing(false);
    }
  };

  const { summary, results: rows } = results || {};

  // Preview columns per format
  const previewCols = preview?.format === "portal"
    ? [
        { label: "Receipt No.",    key: "receiptno" },
        { label: "Date",           key: "completiontime" },
        { label: "Reference",      key: "details" },
        { label: "Amount (Paid In)", key: "paidin" },
        { label: "Status",         key: "transactionstatus" },
      ]
    : [
        { label: "TransID",        key: "transid" },
        { label: "Date",           key: "transtime" },
        { label: "BillRefNumber",  key: "billrefnumber" },
        { label: "Amount",         key: "transamount" },
        { label: "MSISDN",         key: "msisdn" },
      ];

  const headerIdxMap = preview
    ? Object.fromEntries(preview.headers.map((h, i) => [normH(h), i]))
    : {};
  const getCell = (cells, key) => {
    const i = headerIdxMap[key] ?? -1;
    return i >= 0 ? (cells[i] || "—") : "—";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-3xl flex-col border border-slate-200 bg-white shadow-xl" style={{ maxHeight: "90vh" }}>

        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between bg-[#0B3B2E] px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-white">Upload M-Pesa Statement</p>
            <p className="text-[11px] text-emerald-200">
              Import a CSV from M-Pesa Business Portal or Daraja to reconcile missed payments
            </p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><FaTimes size={14} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">

          {/* ── Step 1: file pick ── */}
          {!preview && !results && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded border-2 border-dashed py-12 transition-colors ${
                  dragOver ? "border-[#0B3B2E] bg-[#EDF5F1]" : "border-slate-300 hover:border-slate-400"
                }`}
              >
                <FaFileAlt size={32} className="text-slate-300" />
                <div className="text-center">
                  <p className="text-sm font-bold text-slate-600">Drop CSV here, or click to browse</p>
                  <p className="mt-1 text-[11px] text-slate-400">Supports M-Pesa Business Portal export and Daraja C2B format</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => loadFile(e.target.files?.[0])}
                />
              </div>

              {/* Format guide */}
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
                <p className="mb-1.5 font-black uppercase tracking-wide text-slate-500">Supported CSV Formats</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <p className="font-bold text-slate-700">M-Pesa Business Portal</p>
                    <p className="text-slate-500">Headers: Receipt No., Completion Time, Details, Transaction Status, Paid In</p>
                  </div>
                  <div>
                    <p className="font-bold text-slate-700">Safaricom Daraja C2B</p>
                    <p className="text-slate-500">Headers: TransID, TransTime, TransAmount, BillRefNumber, MSISDN</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Step 2: preview ── */}
          {preview && !results && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-800">{file.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {preview.total} row{preview.total !== 1 ? "s" : ""} · Format:{" "}
                    <span className="font-bold text-[#0B3B2E]">
                      {preview.format === "portal" ? "M-Pesa Business Portal" : "Safaricom Daraja C2B"}
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => { setFile(null); setPreview(null); }}
                  className="text-[11px] font-bold text-slate-400 hover:text-red-500"
                >
                  Change file
                </button>
              </div>

              {/* Preview table */}
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full min-w-[500px] text-xs">
                  <thead className="bg-[#0B3B2E] text-white">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide text-[10px]">#</th>
                      {previewCols.map((c) => (
                        <th key={c.key} className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-[10px]">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.rows.map((cells, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-2 py-1.5 text-slate-400 font-mono text-[10px]">{i + 2}</td>
                        {previewCols.map((c) => (
                          <td key={c.key} className="px-3 py-1.5 text-slate-700 max-w-[160px] truncate" title={getCell(cells, c.key)}>
                            {getCell(cells, c.key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.total > 50 && (
                  <p className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500">
                    Showing first 50 of {preview.total} rows — all rows will be processed
                  </p>
                )}
              </div>

              {/* Paybill selector (multi-paybill only) */}
              {paybills.length > 1 && (
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-slate-500">Paybill</p>
                  <select
                    value={selectedShortCode}
                    onChange={(e) => setSelectedShortCode(e.target.value)}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
                  >
                    <option value="">Auto-detect (primary paybill)</option>
                    {paybills.map((pb) => (
                      <option key={pb.shortCode} value={pb.shortCode}>
                        {pb.name ? `${pb.name} (${pb.shortCode})` : pb.shortCode}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-slate-400">
                    Select the paybill this statement belongs to. Notifications will be tagged accordingly.
                  </p>
                </div>
              )}

              {/* SMS toggle */}
              <button
                type="button"
                onClick={() => setSendSms((v) => !v)}
                className="flex items-center gap-2.5 rounded border border-slate-200 bg-slate-50 px-3 py-2.5 text-left hover:bg-slate-100"
              >
                {sendSms
                  ? <FaToggleOn size={22} className="flex-shrink-0 text-[#0B3B2E]" />
                  : <FaToggleOff size={22} className="flex-shrink-0 text-slate-400" />}
                <div>
                  <p className="text-xs font-bold text-slate-700">
                    {sendSms ? "SMS enabled — customers will be notified" : "SMS disabled — silent reconciliation"}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Turn on for same-day uploads. Leave off for back-dated statement reconciliation.
                  </p>
                </div>
              </button>
            </>
          )}

          {/* ── Step 3: results ── */}
          {results && (
            <>
              {selectedShortCode && paybills.length > 1 && (
                <p className="text-[11px] font-bold text-slate-500">
                  Paybill:{" "}
                  <span className="text-[#0B3B2E]">
                    {paybills.find((pb) => pb.shortCode === selectedShortCode)?.name || selectedShortCode} ({selectedShortCode})
                  </span>
                </p>
              )}
              {/* Summary strip */}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-1.5">
                {[
                  { label: "Matched",   value: summary.matched,   sub: `Ksh ${formatMoney(summary.totalMatched)}`, cls: "bg-emerald-50 border-emerald-300 text-emerald-700" },
                  { label: "Duplicate", value: summary.duplicate, sub: "already done",     cls: "bg-blue-50 border-blue-200 text-blue-700" },
                  { label: "Unmatched", value: summary.unmatched, sub: "no open job",      cls: "bg-amber-50 border-amber-200 text-amber-700" },
                  { label: "Skipped",   value: summary.skipped,   sub: "zero / no code",   cls: "bg-slate-50 border-slate-200 text-slate-500" },
                  { label: "Errors",    value: summary.error,     sub: "parse failures",   cls: "bg-red-50 border-red-200 text-red-600" },
                ].map(({ label, value, sub, cls }) => (
                  <div key={label} className={`border rounded px-3 py-2 text-center ${cls}`}>
                    <p className="text-xl font-black leading-none">{value}</p>
                    <p className="mt-0.5 text-[9px] font-black uppercase tracking-wide opacity-70">{label}</p>
                    <p className="text-[9px] opacity-60">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Per-row results */}
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full min-w-[600px] text-xs">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">Row</th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">Status</th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">Transaction Code</th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">Plate</th>
                      <th className="px-3 py-1.5 text-right text-[10px] font-black uppercase tracking-wide text-slate-500">Amount</th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">Job / Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => {
                      const meta = RESULT_META[r.status] || RESULT_META.error;
                      return (
                        <tr key={r.row} className="hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-mono text-[10px] text-slate-400">{r.row}</td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[9px] font-black uppercase ${meta.bg}`}>
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 font-mono text-slate-700">{r.transactionCode || "—"}</td>
                          <td className="px-3 py-1.5 font-extrabold tracking-wider text-slate-800">{r.plate || "—"}</td>
                          <td className="px-3 py-1.5 text-right font-bold text-slate-700">
                            {r.amount > 0 ? formatMoney(r.amount) : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-slate-500">
                            {r.jobNumber
                              ? <span className="font-bold text-[#0B3B2E]">{r.jobNumber}{r.customerName ? ` · ${r.customerName}` : ""}</span>
                              : <span className="italic text-slate-400">{r.reason || "—"}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
          {results ? (
            <span className="text-[11px] text-slate-500">
              {summary.matched} payment{summary.matched !== 1 ? "s" : ""} recorded · Ksh {formatMoney(summary.totalMatched)}
            </span>
          ) : preview ? (
            <span className="text-[11px] text-slate-500">{preview.total} rows will be processed</span>
          ) : (
            <span className="text-[11px] text-slate-400">Select a CSV file to begin</span>
          )}
          <div className="flex gap-2">
            {results ? (
              <button onClick={onClose} className="inline-flex h-8 items-center px-4 text-xs font-bold text-slate-600 hover:text-slate-900">
                Close
              </button>
            ) : (
              <>
                <button onClick={onClose} className="inline-flex h-8 items-center px-3 text-xs font-bold text-slate-600 hover:text-slate-900">
                  Cancel
                </button>
                {preview && (
                  <button
                    onClick={handleProcess}
                    disabled={processing}
                    className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"
                  >
                    <FaUpload size={10} />
                    {processing ? `Processing…` : `Process ${preview.total} row${preview.total !== 1 ? "s" : ""}`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CarWashMpesaNotifications() {
  const canRecord = useCarWashPermission("carwash-payments", "record");
  const canEdit   = useCarWashPermission("carwash-payments", "edit");

  const [notifications, setNotifications] = useState([]);
  const [summary, setSummary] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded]         = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const [allocateTarget, setAllocateTarget] = useState(null);
  const [showUpload, setShowUpload]         = useState(false);
  const [reverseTarget, setReverseTarget]   = useState(null);

  const company   = useSelector(selectCurrentCompany);
  const paybills  = company?.paymentIntegration?.mpesaPaybills || [];

  const [filters, setFilters] = useState({ status: "", shortCode: "", plate: "", search: "", dateFrom: todayISO(), dateTo: todayISO() });
  const [applied, setApplied] = useState({ status: "", shortCode: "", plate: "", search: "", dateFrom: todayISO(), dateTo: todayISO() });
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await carWashApi.listMpesaNotifications({
        status:    applied.status    || undefined,
        shortCode: applied.shortCode || undefined,
        plate:     applied.plate     || undefined,
        search:    applied.search    || undefined,
        dateFrom:  applied.dateFrom  || undefined,
        dateTo:    applied.dateTo    || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setNotifications(res?.notifications || res?.data?.notifications || []);
      setPagination(res?.pagination || res?.data?.pagination || { page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
      setSummary(res?.summary || res?.data?.summary || []);
    } catch {
      toast.error("Failed to load M-Pesa notifications");
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => { load(); }, [load]);

  const apply = (e) => { e.preventDefault(); setPage(1); setApplied({ ...filters }); };
  const reset = () => {
    const d = { status: "", shortCode: "", plate: "", search: "", dateFrom: todayISO(), dateTo: todayISO() };
    setFilters(d); setApplied(d); setPage(1);
  };

  const handleAssigned = useCallback((updated) => {
    setNotifications((prev) => prev.map((n) => (n._id === updated._id ? { ...n, ...updated } : n)));
    setSummary([]);
    load();
  }, [load]);

  const handleAllocated = useCallback((updated) => {
    if (updated) setNotifications((prev) => prev.map((n) => (n._id === updated._id ? { ...n, ...updated } : n)));
    load();
  }, [load]);

  const summaryMap = Object.fromEntries(summary.map(s => [s._id, s]));
  const totalMatched   = summaryMap.matched?.count   || 0;
  const totalUnmatched = summaryMap.unmatched?.count || 0;
  const totalDuplicate = summaryMap.duplicate?.count || 0;
  const totalAmount    = summaryMap.matched?.totalAmount || 0;

  return (
    <CarWashShell
      title="M-Pesa Notifications"
      action={
        <>
          {canEdit && (
            <button
              onClick={() => setShowUpload(true)}
              className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
            >
              <FaUpload size={10} /> Upload CSV
            </button>
          )}
          <button onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} size={11} /> Refresh
          </button>
        </>
      }
    >
      {showUpload && (
        <UploadModal
          onClose={() => { setShowUpload(false); load(); }}
          onUploaded={() => load()}
          paybills={paybills}
        />
      )}
      {reverseTarget && (
        <MarkReversedModal
          notif={reverseTarget}
          onClose={() => setReverseTarget(null)}
          onReversed={(updated) => {
            setNotifications((prev) => prev.map((n) => n._id === updated._id ? { ...n, ...updated } : n));
            setReverseTarget(null);
          }}
        />
      )}
      {allocateTarget && (
        <AllocateModal
          notif={allocateTarget}
          onClose={() => setAllocateTarget(null)}
          onAllocated={handleAllocated}
        />
      )}
      {assignTarget && (
        <AssignModal
          notif={assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssigned={handleAssigned}
        />
      )}

      {/* Summary strip */}
      <div className="mb-2 flex flex-wrap gap-2">
        {[
          { label: "Matched",   value: totalMatched,    sub: `Ksh ${formatMoney(totalAmount)}`, dot: "bg-emerald-500", text: "text-emerald-700", border: "border-emerald-200 bg-emerald-50" },
          { label: "Unmatched", value: totalUnmatched,  sub: "needs assignment",                dot: "bg-amber-400",   text: "text-amber-700",  border: "border-amber-200 bg-amber-50"   },
          { label: "Duplicate", value: totalDuplicate,  sub: "already processed",               dot: "bg-blue-400",    text: "text-blue-700",   border: "border-blue-200 bg-blue-50"     },
          { label: "Total",     value: pagination.total, sub: "in filter",                      dot: "bg-slate-400",   text: "text-slate-700",  border: "border-slate-200 bg-white"      },
        ].map(({ label, value, sub, dot, text, border }) => (
          <div key={label} className={`inline-flex items-center gap-2.5 border px-3 py-1.5 ${border}`}>
            <span className={`h-2 w-2 rounded-full ${dot}`} />
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</span>
            <span className={`text-sm font-black ${text}`}>{value}</span>
            <span className="text-[10px] text-slate-400">{sub}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <form onSubmit={apply} className="mb-2 flex flex-wrap items-center gap-2 border border-slate-200 bg-white p-2 shadow-sm">
        <select
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.status}
          onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {paybills.length > 1 && (
          <select
            className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
            value={filters.shortCode}
            onChange={e => setFilters(p => ({ ...p, shortCode: e.target.value }))}
          >
            <option value="">All paybills</option>
            {paybills.map((pb) => (
              <option key={pb.shortCode} value={pb.shortCode}>
                {pb.name || pb.shortCode} ({pb.shortCode})
              </option>
            ))}
          </select>
        )}
        <input
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none uppercase placeholder:normal-case"
          placeholder="Plate (e.g. KBY 578D)"
          value={filters.plate}
          onChange={e => setFilters(p => ({ ...p, plate: e.target.value.toUpperCase() }))}
        />
        <div className="relative flex items-center">
          <FaSearch size={9} className="pointer-events-none absolute left-2 text-slate-400" />
          <input
            className="h-8 w-52 border border-slate-300 pl-6 pr-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none placeholder:font-normal placeholder:normal-case"
            placeholder="Txn ID or sender name"
            value={filters.search}
            onChange={e => setFilters(p => ({ ...p, search: e.target.value }))}
          />
          {filters.search && (
            <button type="button" onClick={() => setFilters(p => ({ ...p, search: "" }))}
              className="absolute right-1.5 text-slate-400 hover:text-slate-600">
              <FaTimesCircle size={11} />
            </button>
          )}
        </div>
        <input type="date" className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))} title="From" />
        <span className="text-xs text-slate-400 font-bold">→</span>
        <input type="date" className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))} title="To" />
        <button type="submit" className="inline-flex h-8 items-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch size={10} /> Search
        </button>
        <button type="button" onClick={reset} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]">
          <FaRedoAlt size={10} /> Reset
        </button>
        <span className="ml-auto text-[11px] font-semibold text-slate-500">
          {pagination.total} notification{pagination.total !== 1 ? "s" : ""}
        </span>
      </form>

      {/* Table */}
      <div className="overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-4 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing <strong className="text-[#0B3B2E]">{notifications.length}</strong> / {pagination.total}</span>
          <span>Page <strong className="text-[#0B3B2E]">{pagination.page}</strong> / {pagination.pages}</span>
        </div>

        <table className="w-full min-w-[1000px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Time</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Plate (reference)</th>
              <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Sender Name</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Phone</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Transaction Code</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Matched Job</th>
              <th className="px-2 py-1.5 text-center font-bold uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody>
            {!loading && notifications.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center text-xs font-semibold text-slate-400">
                  No notifications found for the selected filters.
                </td>
              </tr>
            )}
            {notifications.map((n) => {
              const canAssign = canRecord && !n.isReversed && (n.status === "unmatched" || n.status === "error");
              const rowBg = n.isReversed ? "bg-red-50/40" : (STATUS_META[n.status]?.bg || "");
              return (
                <React.Fragment key={n._id}>
                  <tr className={`border-b border-slate-100 hover:bg-slate-50 ${rowBg}`}>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(n.createdAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-0.5">
                        <StatusBadge status={n.status} />
                        {n.isReversed && <ReversedBadge />}
                        {n.shortCode && paybills.length > 1 && (
                          <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 tracking-wide">
                            {paybills.find(pb => pb.shortCode === n.shortCode)?.name || n.shortCode}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-extrabold text-slate-900 tracking-wider">{n.plate || "—"}</div>
                      {n.billRefNumber && n.billRefNumber !== n.plate && (
                        <div className="text-[10px] text-slate-400">raw: {n.billRefNumber}</div>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right font-extrabold ${n.status === "matched" ? "text-emerald-700" : "text-slate-700"}`}>
                      {n.amount > 0 ? formatMoney(n.amount) : "—"}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-700">
                      {n.senderName || <span className="text-slate-400 italic font-normal">—</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {n.msisdn ? (
                        <span className="inline-flex items-center gap-1 font-mono">
                          <FaMobileAlt size={9} className="text-slate-400" />
                          {n.msisdn.slice(0, 4)}{"***"}{n.msisdn.slice(-3)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-700">{n.transactionCode || "—"}</td>
                    <td className="px-3 py-2">
                      {(() => {
                        const isManual    = n.resultDesc?.toLowerCase().includes("manually assigned");
                        const isAllocated = n.notes?.includes("multi-allocation");
                        const actor       = extractActor(isManual ? n.resultDesc : n.notes);
                        return n.matchedJob ? (
                          <div>
                            <div className="flex flex-wrap items-center gap-1">
                              <p className={`font-bold ${n.isReversed ? "text-slate-400 line-through" : "text-[#0B3B2E]"}`}>{n.matchedJob.jobNumber}</p>
                              {isManual && (
                                <span className="inline-flex items-center border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-700">Manual</span>
                              )}
                              {isAllocated && (
                                <span className="inline-flex items-center border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-violet-700">Allocated</span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500">{n.matchedJob.customerName || n.matchedJob.plateNumber}</p>
                            {actor && <p className="text-[9px] text-slate-400">by {actor}</p>}
                            {n.isReversed && <p className="text-[9px] text-red-500 font-semibold">Payment reversed</p>}
                          </div>
                        ) : isAllocated ? (
                          <div>
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-[10px] text-slate-500 italic">{n.notes?.match(/Allocated to (\d+ job\(s\))/)?.[1] || "Multiple jobs"}</span>
                              <span className="inline-flex items-center border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-violet-700">Allocated</span>
                            </div>
                            {actor && <p className="text-[9px] text-slate-400">by {actor}</p>}
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">{n.resultDesc || "—"}</span>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {canRecord && !n.isReversed && n.amount > 0 && (
                          n.status === "unmatched" || n.status === "error" ||
                          (n.allocatedAmount > 0 && n.allocatedAmount < n.amount)
                        ) && (
                          <button
                            type="button"
                            onClick={() => setAllocateTarget(n)}
                            className="inline-flex items-center gap-1 border border-violet-300 bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700 hover:bg-violet-100"
                            title="Allocate payment across jobs"
                          >
                            <FaCodeBranch size={9} /> Allocate
                          </button>
                        )}
                        {canAssign && (
                          <button
                            type="button"
                            onClick={() => setAssignTarget(n)}
                            className="inline-flex items-center gap-1 border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-100"
                            title="Assign to correct job"
                          >
                            <FaLink size={9} /> Assign
                          </button>
                        )}
                        {canEdit && !n.isReversed && n.status !== "matched" && (
                          <button
                            type="button"
                            onClick={() => setReverseTarget(n)}
                            className="inline-flex items-center gap-1 border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-bold text-red-600 hover:bg-red-100"
                            title="Mark as reversed — blocks all allocation"
                          >
                            <FaBan size={9} /> Reversed
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === n._id ? null : n._id)}
                          className="text-[10px] font-bold text-slate-400 hover:text-slate-700 px-1"
                          title="View raw payload"
                        >
                          {expanded === n._id ? "▲" : "▼"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === n._id && (
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td colSpan={9} className="px-4 py-3">
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Raw Safaricom Payload</span>
                          {n.notes && (
                            <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5">
                              {n.notes}
                            </span>
                          )}
                        </div>
                        <pre className="max-h-48 overflow-auto rounded border border-slate-200 bg-white p-3 text-[10px] font-mono text-slate-700">
                          {JSON.stringify(n.rawPayload, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        <div className="flex min-h-9 items-center justify-between border-t border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600">
          <span>{PAGE_SIZE} per page</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1 || loading}
              onClick={() => setPage(p => p - 1)}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-45"
            >
              Previous
            </button>
            <span>Page {pagination.page} of {pagination.pages}</span>
            <button
              disabled={page >= pagination.pages || loading}
              onClick={() => setPage(p => p + 1)}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-45"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </CarWashShell>
  );
}

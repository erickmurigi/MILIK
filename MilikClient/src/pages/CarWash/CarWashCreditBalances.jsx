import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import {
  FaPiggyBank, FaRedoAlt, FaUndo, FaCheckSquare, FaSquare,
  FaExclamationTriangle, FaInfoCircle, FaTrash, FaTimes,
  FaSearch, FaSort, FaSortUp, FaSortDown,
  FaDownload, FaLayerGroup, FaCheck, FaMoneyBillWave,
  FaCarSide, FaChevronDown, FaChevronRight,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import AppSelect from "../../components/common/AppSelect";
import { fmtDate } from "../../utils/dates";
import { useConfirm } from "../../context/ConfirmContext";

const fmt = formatMoney;

const daysSince = (date) => {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
};

const DORMANCY_OPTIONS = [
  { label: "All active", days: 0 },
  { label: "30+ days", days: 30 },
  { label: "90+ days", days: 90 },
  { label: "180+ days", days: 180 },
];

// ─── Sort header ───────────────────────────────────────────────────────────────
const SortTh = React.memo(({ label, field, sortBy, sortDir, onSort, className = "" }) => {
  const active = sortBy === field;
  return (
    <th
      className={`px-3 py-2 font-semibold text-slate-600 cursor-pointer select-none group whitespace-nowrap ${className || "text-left"}`}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        <span className={`transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-40"}`}>
          {active ? (sortDir === "asc" ? <FaSortUp size={9} /> : <FaSortDown size={9} />) : <FaSort size={9} />}
        </span>
      </div>
    </th>
  );
});

// ─── Apply-to-Job modal ────────────────────────────────────────────────────────
const ApplyJobModal = ({ credit, onApply, onClose }) => {
  const [jobSearch, setJobSearch] = useState(credit.customer?.plates?.[0] || "");
  const [selectedJob, setSelectedJob]  = useState(null);
  const [applying, setApplying]        = useState(false);

  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: ["cw-apply-jobs", jobSearch],
    queryFn:  () => carWashApi.listJobs({ plate: jobSearch.trim().toUpperCase(), paymentStatus: "unpaid", limit: 30 }),
    enabled:  jobSearch.trim().length >= 3,
    staleTime: 30_000,
  });
  const jobs = useMemo(() => {
    const raw = jobsData?.data ?? (Array.isArray(jobsData) ? jobsData : []);
    return raw.filter((j) => j.status !== "cancelled" && (j.outstanding ?? j.price) > 0);
  }, [jobsData]);

  const doApply = async () => {
    if (!selectedJob) return toast.warning("Select a job to apply credit to");
    setApplying(true);
    try { await onApply(selectedJob._id); }
    finally { setApplying(false); }
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/50 px-4">
      <div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#0B3B2E] px-4 py-3 text-white">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2">
              <FaCheck /> Apply Credit to Job
            </h2>
            <p className="mt-0.5 text-xs text-emerald-100">
              {credit.customer?.name} · Credit: {fmt(credit.amount)}
            </p>
          </div>
          <button onClick={onClose}><FaTimes /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-widest text-slate-500">
              Search by plate
            </label>
            <div className="relative">
              <FaSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={9} />
              <input
                className="h-9 w-full border border-slate-300 pl-6 pr-3 text-sm focus:border-[#0B3B2E] focus:outline-none"
                value={jobSearch}
                onChange={(e) => { setJobSearch(e.target.value); setSelectedJob(null); }}
                placeholder="e.g. KCA123A"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto space-y-1 rounded border border-slate-200 bg-slate-50 p-2">
            {jobsLoading ? (
              <div className="py-4 text-center text-[11px] text-slate-400">Searching…</div>
            ) : jobs.length === 0 ? (
              <div className="py-4 text-center text-[11px] text-slate-400">
                {jobSearch.trim().length < 3 ? "Enter at least 3 characters" : "No unpaid jobs found"}
              </div>
            ) : jobs.map((j) => {
              const sel = selectedJob?._id === j._id;
              return (
                <button
                  key={j._id}
                  type="button"
                  onClick={() => setSelectedJob(j)}
                  className={`flex w-full items-center gap-3 rounded border px-3 py-2 text-left transition-colors ${
                    sel ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <FaCarSide size={11} className={sel ? "text-emerald-600" : "text-slate-300"} />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-900 text-[11px]">
                      #{j.jobNumber} · {j.plateNumber}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {j.serviceName} · {fmtDate(j.jobDate || j.createdAt)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-black text-[11px] text-red-600">{fmt(j.outstanding ?? j.price)}</div>
                    <div className="text-[9px] text-slate-400 uppercase">{j.paymentStatus}</div>
                  </div>
                </button>
              );
            })}
          </div>
          {selectedJob && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
              <strong>Applying</strong> {fmt(credit.amount)} credit to job #{selectedJob.jobNumber} (owed {fmt(selectedJob.outstanding ?? selectedJob.price)})
              {credit.amount < (selectedJob.outstanding ?? selectedJob.price) && (
                <div className="mt-0.5 text-[10px] text-amber-700">
                  Remaining balance {fmt((selectedJob.outstanding ?? selectedJob.price) - credit.amount)} will still be owed.
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button onClick={onClose} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">
            Cancel
          </button>
          <button onClick={doApply} disabled={!selectedJob || applying}
            className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
            <FaCheck size={9} /> {applying ? "Applying…" : "Apply Credit"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Refund modal ──────────────────────────────────────────────────────────────
const RefundModal = ({ credit, cashbooks, onRefund, onClose }) => {
  const [cashbookAccount, setCashbook] = useState(cashbooks[0]?._id || "");
  const [note, setNote]                = useState("");
  const [refunding, setRefunding]      = useState(false);

  const doRefund = async () => {
    if (!cashbookAccount) return toast.warning("Select a cashbook account for the refund");
    setRefunding(true);
    try { await onRefund({ cashbookAccount, note: note.trim() }); }
    finally { setRefunding(false); }
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/50 px-4">
      <div className="w-full max-w-sm border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-orange-700 px-4 py-3 text-white">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2">
              <FaMoneyBillWave /> Refund Credit
            </h2>
            <p className="mt-0.5 text-xs text-orange-100">
              {credit.customer?.name} · {fmt(credit.amount)}
            </p>
          </div>
          <button onClick={onClose}><FaTimes /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="rounded border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
            <FaExclamationTriangle className="inline mr-1.5" />
            Cash will be paid out to the customer. The credit liability will be removed from your books.
          </div>
          <div>
            <AppSelect
              label="Pay from Cashbook *"
              value={cashbookAccount}
              onChange={(v) => setCashbook(v ?? "")}
              options={cashbooks.map((cb) => ({ value: cb._id, label: `${cb.code} - ${cb.name}` }))}
              placeholder="Select account"
              searchable
              size="md"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-widest text-slate-500">
              Note (optional)
            </label>
            <input
              className="h-9 w-full border border-slate-300 px-2 text-sm focus:border-orange-400 focus:outline-none"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Customer requested refund in cash"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button onClick={onClose} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">
            Cancel
          </button>
          <button onClick={doRefund} disabled={!cashbookAccount || refunding}
            className="inline-flex items-center gap-1.5 bg-orange-600 px-4 py-2 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-50">
            <FaMoneyBillWave size={9} /> {refunding ? "Refunding…" : `Refund ${fmt(credit.amount)}`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── CSV export ────────────────────────────────────────────────────────────────
const exportCsv = (credits, tab) => {
  const headers = tab === "written_off"
    ? ["Customer", "Phone", "Plates", "Amount", "Days Old", "Source Job", "Created", "Written Off"]
    : ["Customer", "Phone", "Plates", "Amount", "Days Old", "Source Job", "Created"];
  const rows = credits.map((cr) => [
    cr.customer?.name || "",
    cr.customer?.phone || "",
    (cr.customer?.plates || []).join("; "),
    cr.amount,
    daysSince(cr.createdAt),
    cr.sourceJob?.jobNumber || "",
    fmtDate(cr.createdAt),
    ...(tab === "written_off" ? [fmtDate(cr.writtenOffAt)] : []),
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `customer-credits-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ─── Grouped view ──────────────────────────────────────────────────────────────
const GroupedCredits = ({ credits, canManage, onApply, onWriteOff, onUndo, onRefund, tab }) => {
  const [collapsed, setCollapsed] = useState(new Set());
  const groups = useMemo(() => {
    const map = new Map();
    for (const cr of credits) {
      const key = String(cr.customer?._id || "unknown");
      if (!map.has(key)) map.set(key, { customer: cr.customer, credits: [] });
      map.get(key).credits.push(cr);
    }
    return [...map.values()].sort((a, b) => {
      const sa = a.credits.reduce((s, c) => s + c.amount, 0);
      const sb = b.credits.reduce((s, c) => s + c.amount, 0);
      return sb - sa;
    });
  }, [credits]);

  const toggle = (key) => setCollapsed((p) => {
    const n = new Set(p);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const key   = String(g.customer?._id || "unknown");
        const total = g.credits.reduce((s, c) => s + c.amount, 0);
        const open  = !collapsed.has(key);
        return (
          <div key={key} className="rounded border border-slate-200 bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(key)}
              className="flex w-full items-center gap-3 bg-slate-50 px-4 py-2.5 text-left hover:bg-slate-100"
            >
              {open ? <FaChevronDown size={9} className="text-slate-400" /> : <FaChevronRight size={9} className="text-slate-400" />}
              <div className="flex-1 min-w-0">
                <span className="font-bold text-sm text-slate-900">{g.customer?.name || "Unknown"}</span>
                {g.customer?.phone && <span className="ml-2 text-[11px] text-slate-400">{g.customer.phone}</span>}
              </div>
              <div className="text-right shrink-0">
                <div className="font-black text-emerald-700">{fmt(total)}</div>
                <div className="text-[10px] text-slate-400">{g.credits.length} credit{g.credits.length !== 1 ? "s" : ""}</div>
              </div>
            </button>
            {open && (
              <div className="divide-y divide-slate-100">
                {g.credits.map((cr) => {
                  const days = daysSince(cr.createdAt);
                  return (
                    <div key={cr._id} className="flex items-center gap-3 px-4 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap gap-1 text-[10px] text-slate-500">
                          {(cr.customer?.plates || []).map((p) => (
                            <span key={p} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono font-bold text-slate-600">{p}</span>
                          ))}
                          {cr.sourceJob && <span>· Job #{cr.sourceJob.jobNumber}</span>}
                          <span>· {fmtDate(cr.createdAt)}</span>
                          {tab === "written_off" && <span>· Written off {fmtDate(cr.writtenOffAt)}</span>}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          days >= 90 ? "bg-red-100 text-red-700" : days >= 30 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
                        }`}>{days}d</span>
                        <span className="font-black text-emerald-700 text-xs tabular-nums">{fmt(cr.amount)}</span>
                        {canManage && tab === "active" && (
                          <div className="flex gap-1">
                            <button onClick={() => onApply(cr)}
                              className="h-6 px-2 border border-emerald-300 bg-emerald-50 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100">
                              Apply
                            </button>
                            <button onClick={() => onRefund(cr)}
                              className="h-6 px-2 border border-orange-200 bg-orange-50 text-[10px] font-semibold text-orange-700 hover:bg-orange-100">
                              Refund
                            </button>
                            <button onClick={() => onWriteOff([cr._id], cr.amount, cr.customer?.name)}
                              className="h-6 px-2 border border-amber-300 bg-amber-50 text-[10px] font-semibold text-amber-700 hover:bg-amber-100">
                              Write off
                            </button>
                          </div>
                        )}
                        {canManage && tab === "written_off" && (
                          <button onClick={() => onUndo(cr._id)}
                            className="flex items-center gap-1 h-6 px-2 border border-emerald-300 bg-emerald-50 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100">
                            <FaUndo size={8} /> Undo
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────
export default function CarWashCreditBalances() {
  const queryClient = useQueryClient();
  const confirm     = useConfirm();
  const businessId  = useSelector((s) => s.company?.currentCompany?._id);
  const canManage   = useCarWashPermission("carwash-loyalty", "manage");

  const [tab, setTab]               = useTabState("/carwash/customers/credit-balances:tab", "active");
  const [dormantDays, setDormantDays] = useTabState("/carwash/customers/credit-balances:dormantDays", 0);
  const [selected, setSelected]       = useState(new Set());
  const [page, setPage]               = useTabState("/carwash/customers/credit-balances:page", 1);
  const limit                         = 50;

  // Search / sort
  const [search, setSearch]               = useTabState("/carwash/customers/credit-balances:search", "");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef                       = useRef(null);
  const [sortBy, setSortBy]               = useTabState("/carwash/customers/credit-balances:sortBy", "createdAt");
  const [sortDir, setSortDir]             = useTabState("/carwash/customers/credit-balances:sortDir", "desc");

  // View toggles
  const [grouped, setGrouped]   = useState(false);

  // Action modals
  const [applyTarget, setApplyTarget]   = useState(null);
  const [refundTarget, setRefundTarget] = useState(null);

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); setDebouncedSearch(val); }, 300);
  };

  const handleSort = useCallback((field) => {
    setSortDir((prev) => sortBy === field ? (prev === "asc" ? "desc" : "asc") : "desc");
    setSortBy(field);
    setPage(1);
  }, [sortBy]);

  // ── Cashbooks for refund ──
  const { data: cashbooksData } = useQuery({
    queryKey: ["cw-cashbooks-ref", businessId],
    queryFn:  () => carWashApi.listChartOfAccounts({ type: "asset" }),
    enabled:  !!businessId,
    staleTime: 5 * 60_000,
  });
  const cashbooks = useMemo(
    () => (Array.isArray(cashbooksData) ? cashbooksData : []).filter((a) => a.isPosting !== false),
    [cashbooksData]
  );

  // ── Data ──
  const queryKey = ["cw-customer-credits", tab, dormantDays, debouncedSearch, sortBy, sortDir, page];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => carWashApi.listCustomerCredits({ status: tab, dormantDays, search: debouncedSearch || undefined, sortBy, sortDir, page, limit }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const credits  = useMemo(() => data?.data || [], [data]);
  const total    = data?.total    || 0;
  const totalAmt = data?.totalAmount || 0;
  const pages    = data?.pages    || 1;

  const allIds      = credits.map((c) => c._id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected((p) => { const n = new Set(p); allIds.forEach((id) => n.delete(id)); return n; });
    } else {
      setSelected((p) => { const n = new Set(p); allIds.forEach((id) => n.add(id)); return n; });
    }
  };
  const toggleOne = (id) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Clear selection on page/filter change
  useEffect(() => { setSelected(new Set()); }, [tab, dormantDays, debouncedSearch, page]);

  const writeOffMutation = useMutation({
    mutationFn: (ids) => carWashApi.writeOffCredits(ids),
    onSuccess: (res) => {
      toast.success(res?.message || "Credits written off to Other Income");
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["cw-customer-credits"] });
      queryClient.invalidateQueries({ queryKey: ["cw-customers"] });
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Write-off failed"),
  });

  const undoMutation = useMutation({
    mutationFn: (id) => carWashApi.undoWriteOff(id),
    onSuccess: () => {
      toast.success("Write-off reversed — credit is active again");
      queryClient.invalidateQueries({ queryKey: ["cw-customer-credits"] });
      queryClient.invalidateQueries({ queryKey: ["cw-customers"] });
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Undo failed"),
  });

  const applyMutation = useMutation({
    mutationFn: ({ creditId, jobId }) => carWashApi.applyCredit(creditId, jobId),
    onSuccess: (res) => {
      toast.success(res?.message || "Credit applied to job");
      setApplyTarget(null);
      queryClient.invalidateQueries({ queryKey: ["cw-customer-credits"] });
      queryClient.invalidateQueries({ queryKey: ["cw-customers"] });
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to apply credit"),
  });

  const refundMutation = useMutation({
    mutationFn: ({ creditId, payload }) => carWashApi.refundCredit(creditId, payload),
    onSuccess: (res) => {
      toast.success(res?.message || "Credit refunded");
      setRefundTarget(null);
      queryClient.invalidateQueries({ queryKey: ["cw-customer-credits"] });
      queryClient.invalidateQueries({ queryKey: ["cw-customers"] });
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Refund failed"),
  });

  const handleWriteOff = useCallback(async (ids, amount, name) => {
    const label = ids.length === 1 ? (name ? `for ${name}` : "") : `(${ids.length} credits)`;
    if (!(await confirm(`Write off KES ${fmt(amount)} credit ${label} to Other Income?\n\nThis can be undone if the customer ever asks.`))) return;
    writeOffMutation.mutate(ids);
  }, [writeOffMutation, confirm]);

  const handleBulkWriteOff = () => {
    const ids = [...selected];
    if (!ids.length) return toast.warn("Select at least one credit");
    const amt = credits.filter((c) => ids.includes(c._id)).reduce((s, c) => s + c.amount, 0);
    handleWriteOff(ids, amt);
  };

  const handleApply = useCallback((credit) => setApplyTarget(credit), []);
  const handleRefund = useCallback((credit) => setRefundTarget(credit), []);
  const handleUndo   = useCallback(async (id) => {
    if (await confirm("Reverse write-off? The credit will become active again.")) undoMutation.mutate(id);
  }, [undoMutation, confirm]);

  return (
    <CarWashShell title="Credit Balances">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Car Wash</div>
              <h1 className="text-sm font-bold text-slate-900 leading-tight flex items-center gap-1.5">
                <FaPiggyBank className="text-emerald-600" size={13} />
                Customer Credit Balances
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-1">

              {/* Search */}
              <div className="relative">
                <FaSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={9} />
                <input
                  type="text"
                  placeholder="Name / phone / plate…"
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="h-7 w-40 border border-slate-300 bg-white pl-6 pr-5 text-xs focus:border-[#0B3B2E] focus:outline-none"
                />
                {search && (
                  <button type="button" onClick={() => handleSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <FaTimes size={9} />
                  </button>
                )}
              </div>

              {/* Group by customer toggle */}
              <button
                type="button"
                onClick={() => setGrouped((p) => !p)}
                title={grouped ? "Show flat list" : "Group by customer"}
                className={`flex h-7 items-center gap-1 border px-2 text-[10px] font-semibold transition-colors ${
                  grouped ? "border-violet-400 bg-violet-50 text-violet-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <FaLayerGroup size={9} /> Group
              </button>

              {/* CSV export */}
              {credits.length > 0 && (
                <button
                  type="button"
                  onClick={() => exportCsv(credits, tab)}
                  className="flex h-7 items-center gap-1 border border-slate-300 bg-white px-2 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <FaDownload size={9} /> CSV
                </button>
              )}

              <button
                type="button"
                onClick={() => queryClient.invalidateQueries({ queryKey })}
                disabled={isLoading}
                className="flex h-7 items-center gap-1 border border-slate-300 bg-white px-2 text-[10px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                <FaRedoAlt size={9} className={isLoading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          {/* ── Tabs + filters ── */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {[
              { key: "active", label: "Active Credits" },
              { key: "written_off", label: "Written Off" },
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => { setTab(key); setPage(1); setSelected(new Set()); }}
                className={`px-3 py-1 text-[11px] font-semibold border-b-2 transition-colors ${
                  tab === key ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
            {tab === "active" && (
              <>
                <span className="text-slate-300 mx-0.5">|</span>
                {DORMANCY_OPTIONS.map(({ label, days }) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => { setDormantDays(days); setPage(1); setSelected(new Set()); }}
                    className={`h-6 px-2 text-[10px] font-semibold border transition-colors ${
                      dormantDays === days
                        ? "border-amber-400 bg-amber-50 text-amber-700"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </>
            )}
          </div>

          {/* ── KPI strip + bulk actions ── */}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-semibold text-slate-700">{total} credit{total !== 1 ? "s" : ""}</span>
            <span className="font-bold text-emerald-700">Total: {fmt(totalAmt)}</span>
            {tab === "active" && dormantDays > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <FaExclamationTriangle size={9} /> Dormant {dormantDays}+ days
              </span>
            )}
            {tab === "active" && (
              <span className="flex items-center gap-1 text-slate-400">
                <FaInfoCircle size={9} /> Write-off moves liability to Other Income. Fully reversible.
              </span>
            )}
            {selected.size > 0 && canManage && (
              <button
                type="button"
                onClick={handleBulkWriteOff}
                disabled={writeOffMutation.isPending}
                className="ml-auto flex items-center gap-1 h-6 border border-amber-400 bg-amber-50 px-2 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
              >
                <FaTrash size={8} /> Write off {selected.size} selected
              </button>
            )}
          </div>
        </div>

        {/* ── Content ── */}
        <div className="min-h-0 flex-1 overflow-auto">
          {grouped ? (
            <div className="p-3">
              {isLoading ? (
                <div className="py-12 text-center text-slate-400 text-sm">Loading…</div>
              ) : credits.length === 0 ? (
                <div className="py-12 text-center">
                  <FaPiggyBank className="mx-auto mb-2 text-slate-200" size={28} />
                  <div className="text-sm text-slate-400">{debouncedSearch ? "No credits match your search" : `No ${tab === "written_off" ? "written-off" : "active"} credits`}</div>
                </div>
              ) : (
                <GroupedCredits
                  credits={credits}
                  canManage={canManage}
                  tab={tab}
                  onApply={handleApply}
                  onWriteOff={handleWriteOff}
                  onUndo={handleUndo}
                  onRefund={handleRefund}
                />
              )}
            </div>
          ) : (
            <table className="w-full min-w-[860px] text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200">
                  {tab === "active" && canManage && (
                    <th className="w-8 px-3 py-2 text-center">
                      <button type="button" onClick={toggleAll} className="text-slate-400 hover:text-slate-700">
                        {allSelected ? <FaCheckSquare size={12} className="text-emerald-600" /> : <FaSquare size={12} />}
                      </button>
                    </th>
                  )}
                  <SortTh label="Customer"  field="customer"  sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="w-40 text-left" />
                  <th className="w-28 px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">Plates</th>
                  <th className="w-28 px-3 py-2 text-right font-semibold text-slate-600 cursor-pointer select-none whitespace-nowrap group"
                    onClick={() => handleSort("amount")}>
                    <div className="flex items-center justify-end gap-1">
                      {sortBy === "amount"
                        ? (sortDir === "asc" ? <FaSortUp size={9} /> : <FaSortDown size={9} />)
                        : <FaSort size={9} className="opacity-0 group-hover:opacity-40" />}
                      Amount
                    </div>
                  </th>
                  <th className="w-16 px-3 py-2 text-center font-semibold text-slate-600 cursor-pointer select-none whitespace-nowrap group"
                    onClick={() => handleSort("age")}>
                    <div className="flex items-center justify-center gap-1">
                      Age
                      {sortBy === "age"
                        ? (sortDir === "asc" ? <FaSortUp size={9} /> : <FaSortDown size={9} />)
                        : <FaSort size={9} className="opacity-0 group-hover:opacity-40" />}
                    </div>
                  </th>
                  <th className="w-36 px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">Source Job</th>
                  <SortTh label="Created"   field="createdAt" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="w-28 text-left" />
                  {tab === "written_off" && (
                    <th className="w-28 px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">Written Off</th>
                  )}
                  {canManage && <th className="w-44 px-3 py-2 text-right font-semibold text-slate-600">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr><td colSpan={9} className="py-10 text-center text-slate-400">Loading…</td></tr>
                ) : credits.length === 0 ? (
                  <tr><td colSpan={9} className="py-14 text-center">
                    <FaPiggyBank className="mx-auto mb-2 text-slate-200" size={28} />
                    <div className="text-sm text-slate-400">
                      {debouncedSearch ? "No credits match your search" : `No ${tab === "written_off" ? "written-off" : "active"} credits`}
                    </div>
                    {tab === "active" && !debouncedSearch && (
                      <div className="mt-1 text-[11px] text-slate-400">Credits are created automatically from overpayments</div>
                    )}
                  </td></tr>
                ) : credits.map((cr) => {
                  const days     = daysSince(cr.createdAt);
                  const ageClass = days >= 90 ? "bg-red-100 text-red-700" : days >= 30 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";
                  return (
                    <tr key={cr._id} className="bg-white hover:bg-slate-50/50">
                      {tab === "active" && canManage && (
                        <td className="px-3 py-2 text-center">
                          <button type="button" onClick={() => toggleOne(cr._id)} className="text-slate-400 hover:text-emerald-600">
                            {selected.has(cr._id)
                              ? <FaCheckSquare size={12} className="text-emerald-600" />
                              : <FaSquare size={12} />}
                          </button>
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-800 truncate">{cr.customer?.name || "—"}</div>
                        <div className="text-[10px] text-slate-400 truncate">{cr.customer?.phone || ""}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-0.5">
                          {(cr.customer?.plates || []).map((p) => (
                            <span key={p} className="inline-block border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-mono font-bold text-slate-700">{p}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-black text-emerald-700">
                        {fmt(cr.amount)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block px-1.5 py-0.5 text-[10px] font-semibold ${ageClass}`}>{days}d</span>
                      </td>
                      <td className="px-3 py-2 text-slate-600 font-mono text-[10px]">
                        {cr.sourceJob ? `#${cr.sourceJob.jobNumber}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-[11px]">{fmtDate(cr.createdAt)}</td>
                      {tab === "written_off" && (
                        <td className="px-3 py-2 text-slate-500 text-[11px]">{fmtDate(cr.writtenOffAt)}</td>
                      )}
                      {canManage && (
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {tab === "active" ? (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => handleApply(cr)}
                                className="h-6 px-2 border border-emerald-300 bg-emerald-50 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                              >
                                Apply
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRefund(cr)}
                                className="h-6 px-2 border border-orange-200 bg-orange-50 text-[10px] font-semibold text-orange-700 hover:bg-orange-100"
                              >
                                Refund
                              </button>
                              <button
                                type="button"
                                onClick={() => handleWriteOff([cr._id], cr.amount, cr.customer?.name)}
                                disabled={writeOffMutation.isPending}
                                className="h-6 px-2 border border-amber-300 bg-amber-50 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                              >
                                Write off
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleUndo(cr._id)}
                              disabled={undoMutation.isPending}
                              className="flex items-center gap-1 h-6 px-2 border border-emerald-300 bg-emerald-50 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                            >
                              <FaUndo size={8} /> Undo
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination ── */}
        {pages > 1 && (
          <div className="flex-shrink-0 flex items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5 text-[11px]">
            <span className="text-slate-500">Showing {((page - 1) * limit) + 1}–{Math.min(page * limit, total)} of {total}</span>
            <div className="flex items-center gap-1">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="h-6 px-3 border border-slate-300 text-xs disabled:opacity-40 hover:bg-slate-50">Prev</button>
              <span className="px-2 text-slate-500">Page {page} of {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
                className="h-6 px-3 border border-slate-300 text-xs disabled:opacity-40 hover:bg-slate-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {applyTarget && (
        <ApplyJobModal
          credit={applyTarget}
          onApply={(jobId) => applyMutation.mutateAsync({ creditId: applyTarget._id, jobId })}
          onClose={() => setApplyTarget(null)}
        />
      )}
      {refundTarget && (
        <RefundModal
          credit={refundTarget}
          cashbooks={cashbooks}
          onRefund={(payload) => refundMutation.mutateAsync({ creditId: refundTarget._id, payload })}
          onClose={() => setRefundTarget(null)}
        />
      )}
    </CarWashShell>
  );
}

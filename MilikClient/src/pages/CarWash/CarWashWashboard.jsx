import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaRedoAlt, FaClock, FaExclamationTriangle } from "react-icons/fa";
import { carWashApi, formatMoney, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const POLL_INTERVAL = 20_000;

const today = () => new Date().toISOString().slice(0, 10);

const elapsed = (iso) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
};

const getUrgency = (iso, status) => {
  if (status === "done") return null;
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins >= 45) return { border: "border-red-500", bg: "bg-red-50", text: "text-red-500" };
  if (mins >= 20) return { border: "border-orange-400", bg: null,       text: "text-orange-500" };
  return null;
};

const PAY_BADGE  = { paid: "bg-emerald-100 text-emerald-700", partial: "bg-amber-100 text-amber-700", unpaid: "bg-red-100 text-red-700" };
const PAY_LABEL  = { paid: "Paid", partial: "Partial", unpaid: "Unpaid" };

const STATUS_CONFIG = {
  waiting: { label: "Queue",             bg: "bg-amber-50",    border: "border-amber-400",   text: "text-amber-800",    badge: "bg-amber-100 text-amber-700"   },
  washing: { label: "Washing",          bg: "bg-blue-50",     border: "border-blue-400",    text: "text-blue-800",     badge: "bg-blue-100 text-blue-700"     },
  drying:  { label: "Drying/Detailing", bg: "bg-purple-50",   border: "border-purple-400",  text: "text-purple-800",   badge: "bg-purple-100 text-purple-700" },
  ready:   { label: "Ready",            bg: "bg-green-50",    border: "border-green-500",   text: "text-green-800",    badge: "bg-green-100 text-green-700"   },
};

const COLUMNS       = ["waiting", "washing", "drying", "ready"];
const TIME_LABEL    = { waiting: "Arrived", washing: "Washing", drying: "Drying", ready: "Ready" };
const ADVANCE_MAP   = { waiting: "washing", washing: "drying", drying: "ready" };
const ADVANCE_LABEL = { washing: "→ Start Washing", drying: "→ Start Drying/Detailing", ready: "→ Mark Ready" };
const ADVANCE_CLS   = {
  washing: "border-blue-400   bg-blue-50   text-blue-700   hover:bg-blue-100",
  drying:  "border-purple-400 bg-purple-50 text-purple-700 hover:bg-purple-100",
  ready:   "border-green-500  bg-green-50  text-green-700  hover:bg-green-100",
};

const JobCard = ({ job, onAdvance, onPayLater, payingLaterRef }) => {
  const cfg       = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.waiting;
  const advanceTo = ADVANCE_MAP[job.status] ?? null;
  const elapsedIso = job.status === "waiting" ? job.createdAt : job.updatedAt;
  const urgency   = getUrgency(elapsedIso, job.status);
  const borderCls = urgency?.border ?? cfg.border;
  const bgCls     = urgency?.bg     ?? cfg.bg;
  const timeCls   = urgency?.text   ?? "text-slate-400";
  const payStatus = job.paymentStatus || "unpaid";
  const canPayLater = job.status === "ready" && payStatus !== "paid";

  return (
    <div className={`mb-1.5 border-l-4 ${borderCls} ${bgCls} rounded-sm px-2.5 py-1.5 shadow-sm`}>
      <div className="flex items-start justify-between gap-1">
        <div className={`text-sm font-black tracking-widest ${cfg.text} leading-tight`}>
          {job.plateNumber || job.itemDescription || "—"}
        </div>
        <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold ${PAY_BADGE[payStatus] ?? PAY_BADGE.unpaid}`}>
          {PAY_LABEL[payStatus] ?? "Unpaid"}
        </span>
      </div>
      {job.serviceName && (
        <div className="mt-0.5 text-[10px] font-semibold text-slate-500">{job.serviceName}</div>
      )}
      {job.branch?.name && (
        <div className="text-[9px] font-medium text-slate-400">{job.branch.name}</div>
      )}
      <div className={`text-[9px] font-semibold ${timeCls}`}>
        {TIME_LABEL[job.status]} {elapsed(elapsedIso)}
      </div>
      {advanceTo && (
        <button
          type="button"
          onClick={() => onAdvance(job, advanceTo)}
          className={`mt-1.5 w-full border py-1 text-[10px] font-bold ${ADVANCE_CLS[advanceTo]}`}
        >
          {ADVANCE_LABEL[advanceTo]}
        </button>
      )}
      {canPayLater && (
        <button
          type="button"
          onClick={() => onPayLater(job)}
          className="mt-1 w-full border border-slate-300 bg-slate-50 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100"
        >
          ⏱ Pay Later
        </button>
      )}
    </div>
  );
};

const ColHeader = ({ status, count }) => {
  const cfg = STATUS_CONFIG[status];
  return (
    <div className={`mb-3 border-b-2 ${cfg.border} pb-2 flex items-center justify-between`}>
      <span className={`text-xs font-black uppercase tracking-widest ${cfg.text}`}>{cfg.label}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${cfg.badge}`}>{count}</span>
    </div>
  );
};

const OutstandingCard = ({ job, onNavigate }) => {
  const payStatus = job.paymentStatus || "unpaid";
  const daysAgo = Math.floor((Date.now() - new Date(job.payLaterAt || job.updatedAt).getTime()) / 86_400_000);
  const timeLabel = daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : `${daysAgo} days ago`;
  const isOld = daysAgo >= 3;

  return (
    <div
      className={`flex items-center justify-between gap-3 border-l-4 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 ${isOld ? "border-red-400 bg-red-50" : "border-amber-400 bg-amber-50"}`}
      onClick={() => onNavigate(job._id)}
    >
      <div className="flex-1 min-w-0">
        <div className="font-black text-slate-800 tracking-widest truncate">
          {job.plateNumber || job.itemDescription || "—"}
        </div>
        <div className="text-[10px] text-slate-500 truncate">{job.serviceName || "Car Wash"}</div>
        {job.customerName && <div className="text-[10px] text-slate-400 truncate">{job.customerName}</div>}
      </div>
      <div className="shrink-0 text-right">
        <div className={`font-black ${isOld ? "text-red-700" : "text-amber-700"}`}>
          {job.price > 0 ? formatMoney(job.price - (job.discountAmount || 0)) : "—"}
        </div>
        <div className={`text-[10px] flex items-center gap-1 justify-end ${isOld ? "text-red-500" : "text-amber-600"}`}>
          {isOld && <FaExclamationTriangle size={8} />}
          {timeLabel}
        </div>
        <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${PAY_BADGE[payStatus] ?? PAY_BADGE.unpaid}`}>
          {PAY_LABEL[payStatus] ?? "Unpaid"}
        </span>
      </div>
    </div>
  );
};

const CarWashWashboard = () => {
  const navigate = useNavigate();
  const [jobs,             setJobs]             = useState([]);
  const [outstanding,      setOutstanding]      = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [lastLoaded,       setLastLoaded]       = useState(null);
  const [outstandingOpen,  setOutstandingOpen]  = useState(true);
  const [,                 setTick]             = useState(0);
  const timerRef       = useRef(null);
  const tickRef        = useRef(null);
  const advancingRef   = useRef(new Set());
  const payingLaterRef = useRef(new Set());
  const failCountRef   = useRef(0);

  const load = useCallback(async () => {
    try {
      const [boardPayload, outPayload] = await Promise.all([
        carWashApi.listJobs({ dateFrom: today(), dateTo: today(), limit: 200 }),
        carWashApi.listJobs({ payLater: "true", status: "done", limit: 200 }),
      ]);
      const boardList = normalizeListPayload(boardPayload, "jobs");
      const outList   = normalizeListPayload(outPayload,   "jobs");
      setJobs(boardList.filter((j) => COLUMNS.includes(j.status)));
      setOutstanding(outList.filter((j) => j.paymentStatus !== "paid"));
      setLastLoaded(Date.now());
      if (failCountRef.current >= 3) toast.dismiss("washboard-offline");
      failCountRef.current = 0;
    } catch {
      failCountRef.current += 1;
      if (failCountRef.current >= 3) {
        toast.warn("Connection lost — showing cached data. Retrying...", { toastId: "washboard-offline", autoClose: false });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, POLL_INTERVAL);
    tickRef.current  = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => { clearInterval(timerRef.current); clearInterval(tickRef.current); };
  }, [load]);

  const advance = useCallback(async (job, nextStatus) => {
    if (advancingRef.current.has(job._id)) return;
    advancingRef.current.add(job._id);
    const prev = { status: job.status, updatedAt: job.updatedAt };
    setJobs((all) => all.map((j) => (j._id === job._id ? { ...j, status: nextStatus, updatedAt: new Date().toISOString() } : j)));
    try {
      await carWashApi.updateJobStatus(job._id, nextStatus);
    } catch (err) {
      setJobs((all) => all.map((j) => (j._id === job._id ? { ...j, ...prev } : j)));
      toast.error(err?.response?.data?.message || "Status update failed");
    } finally {
      advancingRef.current.delete(job._id);
    }
  }, []);

  const payLater = useCallback(async (job) => {
    if (payingLaterRef.current.has(job._id)) return;
    payingLaterRef.current.add(job._id);
    // Optimistically remove from board, add to outstanding
    setJobs((all) => all.filter((j) => j._id !== job._id));
    setOutstanding((all) => [{ ...job, payLater: true, payLaterAt: new Date().toISOString(), status: "done" }, ...all]);
    setOutstandingOpen(true);
    try {
      await carWashApi.markPayLater(job._id);
    } catch (err) {
      // Roll back on failure
      setJobs((all) => [...all, job]);
      setOutstanding((all) => all.filter((j) => j._id !== job._id));
      toast.error(err?.response?.data?.message || "Could not mark as pay-later");
    } finally {
      payingLaterRef.current.delete(job._id);
    }
  }, []);

  const byStatus = (s) => jobs.filter((j) => j.status === s);

  const refreshAction = (
    <div className="flex items-center gap-3">
      {lastLoaded && (
        <span className="text-xs text-slate-400">Updated {elapsed(new Date(lastLoaded).toISOString())}</span>
      )}
      <button
        type="button"
        onClick={load}
        className="inline-flex h-7 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
      >
        <FaRedoAlt size={9} /> Refresh
      </button>
    </div>
  );

  return (
    <CarWashShell title="Washboard" action={refreshAction}>
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading…</div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col gap-2 p-2 overflow-hidden">
          {/* ── Active columns ── */}
          <div className="flex flex-1 min-h-0 gap-2 overflow-hidden">
            {COLUMNS.map((col) => {
              const colJobs = byStatus(col);
              return (
                <div key={col} className="flex flex-1 flex-col overflow-hidden rounded border border-slate-200 bg-white p-3 shadow-sm">
                  <ColHeader status={col} count={colJobs.length} />
                  <div className="flex-1 overflow-y-auto">
                    {colJobs.length === 0 ? (
                      <p className="mt-4 text-center text-xs font-semibold text-slate-300 uppercase tracking-widest">None</p>
                    ) : (
                      colJobs.map((j) => (
                        <JobCard key={j._id} job={j} onAdvance={advance} onPayLater={payLater} payingLaterRef={payingLaterRef} />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Outstanding / Pay-Later strip ── */}
          <div className="shrink-0 border border-amber-300 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setOutstandingOpen((o) => !o)}
              className="flex w-full items-center justify-between px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <FaClock size={11} className="text-amber-500" />
                <span className="text-[11px] font-black uppercase tracking-widest text-amber-700">
                  Outstanding — Pay Later
                </span>
                {outstanding.length > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">
                    {outstanding.length}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-slate-400">{outstandingOpen ? "▲ hide" : "▼ show"}</span>
            </button>
            {outstandingOpen && (
              outstanding.length === 0 ? (
                <p className="px-3 pb-2 text-[10px] text-slate-400">No outstanding pay-later jobs.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {outstanding.map((j) => (
                    <OutstandingCard
                      key={j._id}
                      job={j}
                      onNavigate={(id) => navigate(`/carwash/jobs/${id}`)}
                    />
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </CarWashShell>
  );
};

export default CarWashWashboard;

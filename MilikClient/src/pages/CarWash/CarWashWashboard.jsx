import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { FaRedoAlt } from "react-icons/fa";
import { carWashApi, normalizeListPayload } from "../../services/carWashApi";
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

const STATUS_CONFIG = {
  waiting: { label: "Waiting", bg: "bg-amber-50",   border: "border-amber-400",  text: "text-amber-800",   badge: "bg-amber-100 text-amber-700" },
  washing: { label: "Washing", bg: "bg-blue-50",    border: "border-blue-400",   text: "text-blue-800",    badge: "bg-blue-100 text-blue-700" },
  done:    { label: "Done",    bg: "bg-emerald-50", border: "border-emerald-400", text: "text-emerald-800", badge: "bg-emerald-100 text-emerald-700" },
};

const COLUMNS = ["waiting", "washing", "done"];

const TIME_LABEL = { waiting: "Arrived", washing: "Washing", done: "Done" };

const JobCard = ({ job, onAdvance }) => {
  const cfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.waiting;
  const advanceTo = job.status === "waiting" ? "washing" : job.status === "washing" ? "done" : null;
  const btnCls = advanceTo === "washing"
    ? "border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100"
    : "border-emerald-400 bg-emerald-50 text-emerald-700 hover:bg-emerald-100";
  const elapsedIso = job.status === "waiting" ? job.createdAt : job.updatedAt;

  return (
    <div className={`mb-3 border-l-4 ${cfg.border} ${cfg.bg} rounded-sm px-4 py-3 shadow-sm`}>
      <div className={`text-2xl font-black tracking-widest ${cfg.text} leading-tight`}>
        {job.plateNumber || job.itemDescription || "—"}
      </div>
      {job.serviceName && (
        <div className="mt-0.5 text-sm font-semibold text-slate-500">{job.serviceName}</div>
      )}
      <div className="mt-1 text-xs font-semibold text-slate-400">
        {TIME_LABEL[job.status]} {elapsed(elapsedIso)}
      </div>
      {advanceTo && (
        <button
          type="button"
          onClick={() => onAdvance(job, advanceTo)}
          className={`mt-2.5 w-full border py-2 text-sm font-bold ${btnCls}`}
        >
          {job.status === "waiting" ? "→ Start Washing" : "→ Mark Done"}
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

const CarWashWashboard = () => {
  const [jobs,    setJobs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [,        setTick]    = useState(0); // drives elapsed time re-renders every minute
  const timerRef     = useRef(null);
  const tickRef      = useRef(null);
  const advancingRef = useRef(new Set());
  const failCountRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const payload = await carWashApi.listJobs({ dateFrom: today(), dateTo: today(), limit: 200 });
      const list = normalizeListPayload(payload, "jobs");
      setJobs(list.filter((j) => ["waiting", "washing", "done"].includes(j.status)));
      if (failCountRef.current >= 3) toast.dismiss("washboard-offline");
      failCountRef.current = 0;
    } catch {
      failCountRef.current += 1;
      if (failCountRef.current >= 3) {
        toast.warn("Connection lost — showing cached data. Retrying...", { toastId: "washboard-offline", autoClose: false });
      }
    }
    finally { setLoading(false); }
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
    const prevStatus    = job.status;
    const prevUpdatedAt = job.updatedAt;
    // also update updatedAt optimistically so elapsed time reflects the new state immediately
    setJobs((all) => all.map((j) => (j._id === job._id ? { ...j, status: nextStatus, updatedAt: new Date().toISOString() } : j)));
    try {
      await carWashApi.updateJobStatus(job._id, nextStatus);
    } catch (err) {
      setJobs((all) => all.map((j) => (j._id === job._id ? { ...j, status: prevStatus, updatedAt: prevUpdatedAt } : j)));
      toast.error(err?.response?.data?.message || "Status update failed");
    } finally {
      advancingRef.current.delete(job._id);
    }
  }, []);

  const byStatus = (s) => jobs.filter((j) => j.status === s);

  const refreshAction = (
    <button
      type="button"
      onClick={load}
      className="inline-flex h-7 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
    >
      <FaRedoAlt size={9} /> Refresh
    </button>
  );

  return (
    <CarWashShell title="Washboard" action={refreshAction}>
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading…</div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-2 p-2 overflow-hidden">
          {COLUMNS.map((col) => {
            const colJobs = byStatus(col);
            return (
              <div key={col} className="flex flex-1 flex-col overflow-hidden rounded border border-slate-200 bg-white p-3 shadow-sm">
                <ColHeader status={col} count={colJobs.length} />
                <div className="flex-1 overflow-y-auto">
                  {colJobs.length === 0 ? (
                    <p className="mt-4 text-center text-xs font-semibold text-slate-300 uppercase tracking-widest">None</p>
                  ) : (
                    colJobs.map((j) => <JobCard key={j._id} job={j} onAdvance={advance} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CarWashShell>
  );
};

export default CarWashWashboard;

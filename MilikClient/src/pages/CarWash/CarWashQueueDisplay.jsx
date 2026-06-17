import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

const POLL_INTERVAL  = 20_000; // 20 s
const COLLECTED_TTL  = 3 * 60 * 1000; // 3 minutes

const elapsed = (iso) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
};

const ColHeader = ({ label, count, color }) => (
  <div className={`mb-4 border-b-4 pb-3 ${color}`}>
    <div className="flex items-end justify-between">
      <span className="text-2xl font-black uppercase tracking-widest text-white">{label}</span>
      <span className="mb-0.5 text-lg font-bold text-white/50">{count}</span>
    </div>
  </div>
);

const StatusPulse = () => (
  <span className="relative mr-2 inline-flex h-3 w-3">
    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
    <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-400" />
  </span>
);

const JobCard = ({ job, position, dimmed }) => {
  const isWashing  = job.status === "washing";
  const isWaiting  = job.status === "waiting";
  const isCollected = job.status === "done" || job.status === "paid";

  const borderColor = dimmed
    ? "border-slate-600/30"
    : {
        waiting: "border-amber-500/60",
        washing: "border-blue-500/60",
        ready:   "border-emerald-500/60",
        done:    "border-teal-500/40",
        paid:    "border-teal-500/40",
      }[job.status] ?? "border-white/10";

  const plateColor = dimmed ? "text-slate-500" : "text-white";
  const timeIso    = isWaiting ? job.createdAt : job.updatedAt;

  return (
    <div className={`mb-3 border-l-4 ${borderColor} bg-white/5 ${dimmed ? "opacity-50" : ""} px-4 py-3`}>
      {position && (
        <div className="mb-1 text-xs font-bold uppercase tracking-widest text-white/25">
          #{position} in queue
        </div>
      )}

      {isCollected && (
        <div className="mb-1 text-[9px] font-extrabold uppercase tracking-widest text-teal-400/70">
          Collected
        </div>
      )}

      <div
        className={`font-black leading-none tracking-widest ${plateColor}`}
        style={{ fontSize: "clamp(1.4rem, 3vw, 2.6rem)" }}
      >
        {job.plate}
      </div>

      {job.service && (
        <div className="mt-1 text-sm font-semibold text-slate-400 leading-snug">
          {job.service}
        </div>
      )}

      <div className="mt-1.5 flex items-center text-xs text-slate-500">
        {isWashing && <StatusPulse />}
        <span>{elapsed(timeIso)}</span>
      </div>
    </div>
  );
};

const CarWashQueueDisplay = () => {
  const { businessId } = useParams();
  const [data,      setData]      = useState(null);
  const [clock,     setClock]     = useState("");
  const [lastOk,    setLastOk]    = useState(null);
  // collected: Map<jobId, { job, expireAt }>
  const collectedRef = useRef(new Map());
  const [collected, setCollected] = useState([]);
  const prevJobsRef  = useRef(new Map()); // jobId → status from last poll
  const timerRef     = useRef(null);
  const pruneRef     = useRef(null);

  // Clock — tick every second
  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Prune expired collected entries every 10 s
  useEffect(() => {
    pruneRef.current = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, entry] of collectedRef.current) {
        if (entry.expireAt <= now) {
          collectedRef.current.delete(id);
          changed = true;
        }
      }
      if (changed) setCollected([...collectedRef.current.values()].map((e) => e.job));
    }, 10_000);
    return () => clearInterval(pruneRef.current);
  }, []);

  const fetchQueue = async () => {
    try {
      const res  = await fetch(`/api/carwash/display/${businessId}/queue`);
      if (!res.ok) return;
      const json = await res.json();
      if (!json.success) return;

      const incoming = json.jobs ?? [];
      const incomingMap = new Map(incoming.map((j) => [String(j._id), j]));
      const prev        = prevJobsRef.current;

      // Detect jobs that moved from ready → done/paid in this poll
      const expireAt = Date.now() + COLLECTED_TTL;
      for (const [id, job] of incomingMap) {
        const prevStatus = prev.get(id);
        if (prevStatus === "ready" && (job.status === "done" || job.status === "paid")) {
          collectedRef.current.set(id, { job, expireAt });
        }
        // Also capture jobs that were already done/paid on first load within TTL
        if ((job.status === "done" || job.status === "paid") && !collectedRef.current.has(id)) {
          const age = Date.now() - new Date(job.updatedAt).getTime();
          if (age < COLLECTED_TTL) {
            collectedRef.current.set(id, { job, expireAt: Date.now() + (COLLECTED_TTL - age) });
          }
        }
      }

      // Update previous-status map
      prevJobsRef.current = new Map(Array.from(incomingMap.entries(), ([id, j]) => [id, j.status]));

      setCollected([...collectedRef.current.values()].map((e) => e.job));
      setData(json);
      setLastOk(new Date());
    } catch { /* keep last data on network error */ }
  };

  // Clear stale cross-business state when the route changes
  useEffect(() => {
    collectedRef.current.clear();
    prevJobsRef.current.clear();
    setCollected([]);
  }, [businessId]);

  useEffect(() => {
    fetchQueue();
    timerRef.current = setInterval(fetchQueue, POLL_INTERVAL);
    return () => clearInterval(timerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const jobs    = data?.jobs ?? [];
  const waiting = jobs.filter((j) => j.status === "waiting");
  const washing = jobs.filter((j) => j.status === "washing");
  const ready   = jobs.filter((j) => j.status === "ready");

  const businessName = data?.business?.name ?? "Car Wash";

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ background: "linear-gradient(160deg, #050d1a 0%, #0a1120 60%, #050d1a 100%)" }}
    >
      {/* Header */}
      <header className="flex items-center justify-between border-b border-white/10 px-8 py-4">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.3em] text-white/30">Live Queue</p>
          <h1
            className="font-black uppercase tracking-wide text-white leading-tight"
            style={{ fontSize: "clamp(1.8rem, 3vw, 3rem)" }}
          >
            {businessName}
          </h1>
        </div>
        <div className="text-right">
          <div
            className="font-mono font-black tabular-nums text-white"
            style={{ fontSize: "clamp(2rem, 4vw, 4.5rem)" }}
          >
            {clock}
          </div>
          {lastOk && (
            <p className="mt-0.5 text-xs text-white/20">
              Updated {elapsed(lastOk.toISOString())}
            </p>
          )}
        </div>
      </header>

      {/* Columns */}
      <main className="grid flex-1 grid-cols-4 gap-0 overflow-hidden divide-x divide-white/10">

        {/* WAITING */}
        <section className="flex flex-col overflow-hidden px-5 py-4">
          <ColHeader label="Waiting" count={waiting.length} color="border-amber-500" />
          <div className="flex-1 overflow-y-auto pr-1">
            {waiting.length === 0
              ? <p className="mt-6 text-center text-base font-semibold text-white/20">No cars waiting</p>
              : waiting.map((j, i) => <JobCard key={j._id} job={j} position={i + 1} />)}
          </div>
        </section>

        {/* WASHING */}
        <section className="flex flex-col overflow-hidden px-5 py-4">
          <ColHeader label="Washing" count={washing.length} color="border-blue-500" />
          <div className="flex-1 overflow-y-auto pr-1">
            {washing.length === 0
              ? <p className="mt-6 text-center text-base font-semibold text-white/20">No cars being washed</p>
              : washing.map((j) => <JobCard key={j._id} job={j} />)}
          </div>
        </section>

        {/* READY */}
        <section className="flex flex-col overflow-hidden px-5 py-4">
          <ColHeader label="Ready" count={ready.length} color="border-emerald-500" />
          <div className="flex-1 overflow-y-auto pr-1">
            {ready.length === 0
              ? <p className="mt-6 text-center text-base font-semibold text-white/20">No cars ready yet</p>
              : ready.map((j) => <JobCard key={j._id} job={j} />)}
          </div>
        </section>

        {/* COLLECTED */}
        <section className="flex flex-col overflow-hidden px-5 py-4">
          <ColHeader label="Collected" count={collected.length} color="border-teal-600" />
          <div className="flex-1 overflow-y-auto pr-1">
            {collected.length === 0
              ? <p className="mt-6 text-center text-base font-semibold text-white/20">Nothing collected yet</p>
              : collected.map((j) => <JobCard key={j._id} job={j} dimmed />)}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="flex items-center justify-center border-t border-white/10 py-2" />
    </div>
  );
};

export default CarWashQueueDisplay;

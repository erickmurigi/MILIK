import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

const POLL_INTERVAL = 20_000; // 20 s

const STATUS_ORDER = { waiting: 0, washing: 1, done: 2, paid: 3 };

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
      <span className="text-3xl font-black uppercase tracking-widest text-white">{label}</span>
      <span className="mb-0.5 text-xl font-bold text-white/50">{count}</span>
    </div>
  </div>
);

const StatusPulse = () => (
  <span className="relative mr-2 inline-flex h-3 w-3">
    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
    <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-400" />
  </span>
);

const JobCard = ({ job, position }) => {
  const isPaid = job.status === "paid";
  const isWashing = job.status === "washing";
  const isWaiting = job.status === "waiting";

  const borderColor = {
    waiting: "border-amber-500/60",
    washing: "border-blue-500/60",
    done:    "border-emerald-500/60",
    paid:    "border-slate-600/40",
  }[job.status] ?? "border-white/10";

  const plateColor = isPaid ? "text-slate-500" : "text-white";
  // waiting: show time since arrival; washing/done/paid: show time in current state
  const timeIso = isWaiting ? job.createdAt : job.updatedAt;

  return (
    <div className={`mb-3 border-l-4 ${borderColor} bg-white/5 px-5 py-4`}>
      {/* Queue position (waiting only) */}
      {position && (
        <div className="mb-1 text-xs font-bold uppercase tracking-widest text-white/25">
          #{position} in queue
        </div>
      )}

      {/* Plate / item */}
      <div className={`font-black leading-none tracking-widest ${plateColor}`}
        style={{ fontSize: "clamp(2rem, 4.5vw, 4rem)" }}>
        {isPaid && <span className="mr-3 text-xs font-extrabold uppercase tracking-widest text-slate-500 align-middle">COLLECTED</span>}
        {job.plate}
      </div>

      {/* Service */}
      {job.service && (
        <div className="mt-1.5 text-lg font-semibold text-slate-300">
          {job.service}
        </div>
      )}

      {/* Time & washing pulse */}
      <div className="mt-2 flex items-center text-sm text-slate-500">
        {isWashing && <StatusPulse />}
        <span>{elapsed(timeIso)}</span>
      </div>
    </div>
  );
};

const CarWashQueueDisplay = () => {
  const { businessId } = useParams();
  const [data,    setData]    = useState(null);   // { business, jobs }
  const [clock,   setClock]   = useState("");
  const [lastOk,  setLastOk]  = useState(null);
  const timerRef = useRef(null);

  // Clock — tick every second
  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Queue polling
  const fetchQueue = async () => {
    try {
      const res = await fetch(`/api/carwash/display/${businessId}/queue`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) {
        setData(json);
        setLastOk(new Date());
      }
    } catch { /* keep last data on network error */ }
  };

  useEffect(() => {
    fetchQueue();
    timerRef.current = setInterval(fetchQueue, POLL_INTERVAL);
    return () => clearInterval(timerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const jobs = data?.jobs ?? [];
  const waiting  = jobs.filter((j) => j.status === "waiting");
  const washing  = jobs.filter((j) => j.status === "washing");
  const done     = jobs.filter((j) => j.status === "done" || j.status === "paid")
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || new Date(b.updatedAt) - new Date(a.updatedAt));

  const businessName = data?.business?.name ?? "Car Wash";

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ background: "linear-gradient(160deg, #050d1a 0%, #0a1120 60%, #050d1a 100%)" }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-white/10 px-8 py-5">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.3em] text-white/30">Live Queue</p>
          <h1 className="font-black uppercase tracking-wide text-white leading-tight"
            style={{ fontSize: "clamp(2rem, 3.5vw, 3.5rem)" }}>
            {businessName}
          </h1>
        </div>
        <div className="text-right">
          <div className="font-mono font-black tabular-nums text-white"
            style={{ fontSize: "clamp(2.5rem, 5vw, 5rem)" }}>
            {clock}
          </div>
          {lastOk && (
            <p className="mt-0.5 text-xs text-white/20">
              Updated {elapsed(lastOk.toISOString())}
            </p>
          )}
        </div>
      </header>

      {/* ── Columns ─────────────────────────────────────────────────────── */}
      <main className="grid flex-1 grid-cols-3 gap-0 overflow-hidden divide-x divide-white/10">

        {/* WAITING */}
        <section className="flex flex-col overflow-hidden px-6 py-5">
          <ColHeader label="Waiting" count={waiting.length} color="border-amber-500" />
          <div className="flex-1 overflow-y-auto pr-1">
            {waiting.length === 0 ? (
              <p className="mt-6 text-center text-lg font-semibold text-white/20">No cars waiting</p>
            ) : waiting.map((j, i) => <JobCard key={j._id} job={j} position={i + 1} />)}
          </div>
        </section>

        {/* WASHING */}
        <section className="flex flex-col overflow-hidden px-6 py-5">
          <ColHeader label="Washing" count={washing.length} color="border-blue-500" />
          <div className="flex-1 overflow-y-auto pr-1">
            {washing.length === 0 ? (
              <p className="mt-6 text-center text-lg font-semibold text-white/20">No cars being washed</p>
            ) : washing.map((j) => <JobCard key={j._id} job={j} />)}
          </div>
        </section>

        {/* DONE / READY */}
        <section className="flex flex-col overflow-hidden px-6 py-5">
          <ColHeader label="Ready" count={done.filter((j) => j.status === "done").length} color="border-emerald-500" />
          <div className="flex-1 overflow-y-auto pr-1">
            {done.length === 0 ? (
              <p className="mt-6 text-center text-lg font-semibold text-white/20">No cars ready yet</p>
            ) : done.map((j) => <JobCard key={j._id} job={j} />)}
          </div>
        </section>
      </main>

      {/* ── Footer ticker ───────────────────────────────────────────────── */}
      <footer className="flex items-center justify-center border-t border-white/10 py-2">
      </footer>
    </div>
  );
};

export default CarWashQueueDisplay;

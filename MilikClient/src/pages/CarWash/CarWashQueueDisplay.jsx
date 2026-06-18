import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

const POLL_INTERVAL = 20_000;

const elapsed = (iso) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
};

const COLS = [
  { key: "waiting", label: "Queue",             color: "border-amber-500",   pulse: "bg-amber-400",   border: "border-amber-500/60"  },
  { key: "washing", label: "Washing",           color: "border-blue-500",    pulse: "bg-blue-400",    border: "border-blue-500/60"   },
  { key: "drying",  label: "Drying / Detailing",color: "border-purple-500",  pulse: "bg-purple-400",  border: "border-purple-500/60" },
  { key: "ready",   label: "Ready",             color: "border-emerald-500", pulse: "bg-emerald-400", border: "border-emerald-500/60"},
];

const StatusPulse = ({ color }) => (
  <span className="relative mr-2 inline-flex h-2.5 w-2.5">
    <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-75`} />
    <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
  </span>
);

const JobCard = ({ job, colCfg, position }) => {
  const timeIso = job.status === "waiting" ? job.createdAt : job.updatedAt;
  return (
    <div className={`mb-2 border-l-4 ${colCfg.border} bg-white/5 px-3 py-2`}>
      {position && (
        <div className="mb-0.5 text-[9px] font-bold uppercase tracking-widest text-white/25">
          #{position}
        </div>
      )}
      <div
        className="font-black leading-none tracking-widest text-white"
        style={{ fontSize: "clamp(1.2rem, 2.5vw, 2.2rem)" }}
      >
        {job.plate || "—"}
      </div>
    </div>
  );
};

const CarWashQueueDisplay = () => {
  const { businessId } = useParams();
  const [data,       setData]       = useState(null);
  const [clock,      setClock]      = useState("");
  const [lastOk,     setLastOk]     = useState(null);
  const [fetchError, setFetchError] = useState(false);
  const timerRef     = useRef(null);
  const failCountRef = useRef(0);

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const fetchQueue = async (signal) => {
    try {
      const res  = await fetch(`/api/carwash/display/${businessId}/queue`, { signal });
      if (!res.ok) return;
      const json = await res.json();
      if (!json.success) return;
      setData(json);
      setLastOk(new Date());
      failCountRef.current = 0;
      setFetchError(false);
    } catch (err) {
      if (err.name === "AbortError") return;
      failCountRef.current += 1;
      if (failCountRef.current >= 3) setFetchError(true);
    }
  };

  useEffect(() => {
    failCountRef.current = 0;
    setFetchError(false);
  }, [businessId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchQueue(controller.signal);
    timerRef.current = setInterval(() => fetchQueue(controller.signal), POLL_INTERVAL);
    return () => { controller.abort(); clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const jobs         = data?.jobs ?? [];
  const businessName = data?.business?.name ?? "Car Wash";
  const byStatus     = (s) => jobs.filter((j) => j.status === s);

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ background: "linear-gradient(160deg, #050d1a 0%, #0a1120 60%, #050d1a 100%)" }}
    >
      {/* Compact header */}
      <header className="flex flex-shrink-0 items-center justify-between border-b border-white/10 px-6 py-2">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">Live Queue</span>
          <h1 className="text-sm font-black uppercase tracking-wide text-white">
            {businessName}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          {fetchError && (
            <span className="text-[10px] font-bold text-red-400 animate-pulse">Connection lost — retrying…</span>
          )}
          {lastOk && (
            <span className="text-[10px] text-white/20">Updated {elapsed(lastOk.toISOString())}</span>
          )}
          <div className="font-mono font-black tabular-nums text-white" style={{ fontSize: "clamp(1rem, 2vw, 1.5rem)" }}>
            {clock}
          </div>
        </div>
      </header>

      {/* Columns */}
      <main className="grid flex-1 grid-cols-4 divide-x divide-white/10 overflow-hidden">
        {COLS.map((col) => {
          const colJobs = byStatus(col.key);
          return (
            <section key={col.key} className="flex flex-col overflow-hidden px-4 py-3">
              <div className={`mb-3 border-b-4 pb-2 ${col.color}`}>
                <div className="flex items-end justify-between">
                  <span className="text-xl font-black uppercase tracking-widest text-white">{col.label}</span>
                  <span className="mb-0.5 text-base font-bold text-white/50">{colJobs.length}</span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto pr-1">
                {colJobs.length === 0
                  ? <p className="mt-4 text-center text-xs font-semibold text-white/20">—</p>
                  : colJobs.map((j, i) => (
                      <JobCard
                        key={j._id}
                        job={j}
                        colCfg={col}
                        position={col.key === "waiting" ? i + 1 : null}
                      />
                    ))
                }
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
};

export default CarWashQueueDisplay;

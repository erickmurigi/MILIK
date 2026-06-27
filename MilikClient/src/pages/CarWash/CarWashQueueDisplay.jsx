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
  { key: "waiting", label: "Queue",              color: "border-amber-400",   pulse: "bg-amber-400",   border: "border-amber-400/80"  },
  { key: "washing", label: "Washing",            color: "border-blue-400",    pulse: "bg-blue-400",    border: "border-blue-400/80"   },
  { key: "drying",  label: "Drying / Detailing", color: "border-purple-400",  pulse: "bg-purple-400",  border: "border-purple-400/80" },
  { key: "ready",   label: "Ready",              color: "border-emerald-400", pulse: "bg-emerald-400", border: "border-emerald-400/80"},
];

const StatusPulse = ({ color }) => (
  <span className="relative mr-2 inline-flex h-2.5 w-2.5">
    <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-75`} />
    <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
  </span>
);

const JobCard = ({ job, colCfg, position, hasBg }) => (
  <div
    className={`mb-2 border-l-4 ${colCfg.border} px-3 py-2.5 rounded-sm ${
      hasBg
        ? "bg-black/40 backdrop-blur-[2px] shadow-lg"
        : "bg-white/8"
    }`}
  >
    {position && (
      <div className="mb-0.5 text-[9px] font-bold uppercase tracking-widest text-white/40">
        #{position}
      </div>
    )}
    <div
      className="font-black leading-none tracking-widest text-white"
      style={{
        fontSize: "clamp(1.3rem, 2.6vw, 2.4rem)",
        textShadow: hasBg
          ? "0 1px 3px rgba(0,0,0,1), 0 4px 16px rgba(0,0,0,0.8)"
          : "none",
      }}
    >
      {job.plate || "—"}
    </div>
  </div>
);

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
  const bgImage      = data?.business?.queueBgImage
    ? `/api/carwash/display/${businessId}/bg`
    : null;
  const byStatus     = (s) => jobs.filter((j) => j.status === s);

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden"
      style={bgImage
        ? { backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center 40%", paddingTop: "18px" }
        : { background: "linear-gradient(160deg, #050d1a 0%, #0a1120 60%, #050d1a 100%)", paddingTop: "18px" }
      }
    >
      {/* Very light overlay — nighttime photo is already dark, just need subtle depth */}
      {bgImage && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.00) 20%, rgba(0,0,0,0.00) 80%, rgba(0,0,0,0.12) 100%)" }}
        />
      )}

      <div className="relative z-10 flex h-full flex-col">

        {/* ── Header ── */}
        <header
          className="flex flex-shrink-0 items-center justify-between px-8 py-3"
          style={{
            borderBottom: "1px solid rgba(255,255,255,0.12)",
            background: bgImage ? "rgba(0,0,0,0.40)" : "transparent",
          }}
        >
          <div className="flex items-baseline gap-3">
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">Live Queue</span>
            <h1
              className="text-sm font-black uppercase tracking-wide text-white"
              style={{ textShadow: bgImage ? "0 1px 6px rgba(0,0,0,1)" : "none" }}
            >
              {businessName}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {fetchError && (
              <span className="animate-pulse text-[10px] font-bold text-red-400">Connection lost — retrying…</span>
            )}
            {lastOk && (
              <span className="text-[10px] text-white/30">Updated {elapsed(lastOk.toISOString())}</span>
            )}
            <div
              className="font-mono font-black tabular-nums text-white"
              style={{
                fontSize: "clamp(1rem, 2vw, 1.5rem)",
                textShadow: bgImage ? "0 1px 6px rgba(0,0,0,1)" : "none",
              }}
            >
              {clock}
            </div>
          </div>
        </header>

        {/* ── 4-column grid with horizontal margins ── */}
        <main className="grid flex-1 grid-cols-4 overflow-hidden px-6 pb-4 pt-3 gap-3">
          {COLS.map((col) => {
            const colJobs = byStatus(col.key);
            return (
              <section
                key={col.key}
                className={`flex flex-col overflow-hidden rounded-lg px-4 py-3 ${
                  bgImage ? "bg-black/10 backdrop-blur-[3px]" : ""
                }`}
                style={bgImage ? { border: "1px solid rgba(255,255,255,0.10)" } : {}}
              >
                {/* Column heading */}
                <div className={`-mx-4 mb-3 border-b-4 px-4 pb-2 ${col.color} ${bgImage ? "bg-black/55" : ""}`}>
                  <div className="flex items-center gap-2 py-1">
                    <StatusPulse color={col.pulse} />
                    <span
                      className="text-[1.05rem] font-black uppercase tracking-widest text-white"
                      style={{ textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}
                    >
                      {col.label}
                    </span>
                    <span className="text-[1.05rem] font-black text-white/70" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>
                      {colJobs.length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto pr-1">
                  {colJobs.length === 0
                    ? <p className="mt-4 text-center text-xs font-semibold text-white/25">—</p>
                    : colJobs.map((j, i) => (
                        <JobCard
                          key={j._id}
                          job={j}
                          colCfg={col}
                          position={col.key === "waiting" ? i + 1 : null}
                          hasBg={!!bgImage}
                        />
                      ))
                  }
                </div>
              </section>
            );
          })}
        </main>

      </div>
    </div>
  );
};

export default CarWashQueueDisplay;

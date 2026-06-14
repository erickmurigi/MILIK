import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaBan, FaCar, FaCheckCircle, FaClock, FaHandHoldingUsd,
  FaMoneyBillWave, FaPhone, FaPlus, FaRedoAlt, FaSoap,
} from "react-icons/fa";
import { carWashApi, formatMoney, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const paymentLabels = { cash: "Cash", mpesa: "M-Pesa", bank: "Bank", card: "Card", other: "Other" };

const paymentColors = {
  cash:  { bar: "bg-[#0B3B2E]",   text: "text-[#0B3B2E]" },
  mpesa: { bar: "bg-[#E65F1A]",   text: "text-[#E65F1A]" },
  bank:  { bar: "bg-sky-600",     text: "text-sky-600" },
  card:  { bar: "bg-violet-600",  text: "text-violet-600" },
  other: { bar: "bg-slate-400",   text: "text-slate-500" },
};

const queueStatus = [
  { key: "waiting",   label: "Waiting",   icon: FaClock,          ring: "border-amber-400",   num: "text-amber-600",   bg: "bg-amber-50",   hover: "hover:bg-amber-50"   },
  { key: "washing",   label: "Washing",   icon: FaSoap,           ring: "border-sky-400",     num: "text-sky-600",     bg: "bg-sky-50",     hover: "hover:bg-sky-50"     },
  { key: "done",      label: "Done",      icon: FaCheckCircle,    ring: "border-indigo-400",  num: "text-indigo-600",  bg: "bg-indigo-50",  hover: "hover:bg-indigo-50"  },
  { key: "paid",      label: "Paid",      icon: FaHandHoldingUsd, ring: "border-emerald-500", num: "text-emerald-700", bg: "bg-emerald-50", hover: "hover:bg-emerald-50" },
  { key: "cancelled", label: "Cancelled", icon: FaBan,            ring: "border-slate-300",   num: "text-slate-500",   bg: "bg-slate-50",   hover: "hover:bg-slate-100"  },
];

const fmt = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
};

const StatCard = ({ label, value, icon: Icon, tone = "green", sub }) => {
  const s = {
    green:  "bg-[#0B3B2E] border-[#0B3B2E]",
    orange: "bg-[#C8511A] border-[#C8511A]",
    slate:  "bg-slate-700 border-slate-700",
  }[tone] || "bg-[#0B3B2E] border-[#0B3B2E]";
  return (
    <div className={`relative overflow-hidden border ${s} px-4 py-3 shadow-sm`}>
      <Icon className="absolute right-3 top-2.5 h-10 w-10 text-white/10" />
      <p className="text-[9px] font-extrabold uppercase tracking-widest text-white/60">{label}</p>
      <p className="mt-1.5 text-2xl font-black leading-none text-white">{value}</p>
      {sub && <p className="mt-1 text-[10px] text-white/50">{sub}</p>}
    </div>
  );
};

const Card = ({ title, right, children, className = "" }) => (
  <div className={`border border-slate-200 bg-white shadow-sm ${className}`}>
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">{title}</h2>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
    {children}
  </div>
);

const payBadge = (status) =>
  status === "paid"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-orange-200 bg-orange-50 text-orange-700";

const jobStatusBadge = (status) => {
  const map = {
    waiting:   "border-amber-200 bg-amber-50 text-amber-700",
    washing:   "border-sky-200 bg-sky-50 text-sky-700",
    done:      "border-indigo-200 bg-indigo-50 text-indigo-700",
    paid:      "border-emerald-200 bg-emerald-50 text-emerald-700",
    cancelled: "border-slate-200 bg-slate-50 text-slate-500",
  };
  return map[status] || "border-slate-200 bg-slate-50 text-slate-500";
};

const DASH_DATE_KEY = "cw_dash_date";

const CarWashDashboard = () => {
  const navigate     = useNavigate();
  const dateInputRef = useRef(null);
  const [summary, setSummary]   = useState(null);
  const [jobs, setJobs]         = useState([]);
  const [payments, setPayments] = useState([]);
  const [date, setDate]         = useState(() => sessionStorage.getItem(DASH_DATE_KEY) || todayISO());
  const [loading, setLoading]   = useState(false);

  const today = todayISO();

  const changeDate = (val) => {
    sessionStorage.setItem(DASH_DATE_KEY, val);
    setDate(val);
  };

  const stepDay = (n) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + n);
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, "0");
    const dd   = String(d.getDate()).padStart(2, "0");
    changeDate(`${yyyy}-${mm}-${dd}`);
  };

  const resetToday = () => {
    sessionStorage.removeItem(DASH_DATE_KEY);
    setDate(todayISO());
  };

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, jobsRes, payRes] = await Promise.all([
        carWashApi.getDailySummary(date),
        carWashApi.listJobs({ date, limit: 30 }),
        carWashApi.listPayments({ date, limit: 10 }),
      ]);
      setSummary(sumRes || null);
      setJobs(normalizeListPayload(jobsRes, "jobs"));
      setPayments(normalizeListPayload(payRes, "payments"));
    } catch {
      setSummary(null);
      setJobs([]);
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const counts        = summary?.statusCounts    || {};
  const byMethod      = summary?.revenueByMethod || {};
  const totalRevenue  = Number(summary?.todayRevenue || 0);
  const activeQueue   = (counts.waiting || 0) + (counts.washing || 0) + (counts.done || 0);
  const cashTotal     = Number(summary?.cashTotal   || 0);
  const mpesaTotal    = Number(summary?.mpesaTotal  || 0);
  const nonCash       = totalRevenue - cashTotal;

  const paymentRows = useMemo(
    () => Object.keys(paymentLabels).map((m) => ({ method: m, label: paymentLabels[m], amount: Number(byMethod[m] || 0) })),
    [byMethod]
  );

  return (
    <CarWashShell
      title="Daily Operations"
      action={
        <>
          {/* Date stepper */}
          <div className="flex h-7 items-center divide-x divide-slate-300 border border-slate-300 bg-white">
            <button
              type="button"
              onClick={() => stepDay(-1)}
              className="flex h-full w-6 items-center justify-center text-slate-500 hover:bg-slate-100"
              title="Previous day"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => dateInputRef.current?.showPicker()}
              className="relative flex h-full items-center px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              title="Pick a date"
            >
              {new Date(date + "T00:00:00").toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}
              <input
                ref={dateInputRef}
                type="date"
                value={date}
                onChange={(e) => changeDate(e.target.value)}
                className="pointer-events-none absolute inset-0 h-0 w-0 opacity-0"
                tabIndex={-1}
              />
            </button>
            <button
              type="button"
              onClick={() => stepDay(1)}
              className="flex h-full w-6 items-center justify-center text-slate-500 hover:bg-slate-100"
              title="Next day"
            >
              ›
            </button>
          </div>
          {/* Today reset — only shown when not on today */}
          {date !== today && (
            <button
              type="button"
              onClick={resetToday}
              className="h-7 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
            >
              Today
            </button>
          )}
          <button
            type="button"
            onClick={loadDashboard}
            className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt size={9} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => navigate("/carwash/jobs/new")}
            className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]"
          >
            <FaPlus size={9} /> New Job
          </button>
        </>
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto">
      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard label={date === today ? "Today Jobs" : "Jobs"} value={summary?.todayJobsCount || 0} icon={FaCar} tone="green" />
        <StatCard label="Active Queue"  value={activeQueue}                  icon={FaClock}         tone="orange" sub={activeQueue > 0 ? "in progress" : "all clear"} />
        <StatCard label={date === today ? "Today Revenue" : "Revenue"} value={formatMoney(totalRevenue)} icon={FaMoneyBillWave} tone="green" />
        <StatCard label="Cash"          value={formatMoney(cashTotal)}       icon={FaMoneyBillWave} tone="orange" />
        <StatCard label="M-Pesa"        value={formatMoney(mpesaTotal)}      icon={FaPhone}         tone="green" />
      </div>

      {/* ── Operations Queue ───────────────────────────────────────────────── */}
      <Card title="Operations Queue" className="mt-1.5" right={
        <span className="text-[10px] font-bold text-slate-400">
          {new Date(date).toLocaleDateString("en-KE", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })}
        </span>
      }>
        <div className="grid grid-cols-5 divide-x divide-slate-100">
          {queueStatus.map(({ key, label, icon: Icon, ring, num, bg, hover }) => (
            <button
              key={key}
              type="button"
              onClick={() => navigate(`/carwash/jobs?status=${key}&dateFrom=${date}&dateTo=${date}`)}
              className={`group flex flex-col items-center justify-between gap-1 px-2 py-3 transition ${hover} sm:flex-row sm:gap-2 sm:px-3`}
              title={`View ${label} jobs`}
            >
              <div className="flex flex-col items-center gap-1 sm:flex-row sm:gap-2">
                <span className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 ${ring} ${bg}`}>
                  <Icon className={`h-3 w-3 ${num}`} />
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
              </div>
              <span className={`text-xl font-black leading-none tabular-nums ${num}`}>{counts[key] || 0}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* ── Main two-column area ───────────────────────────────────────────── */}
      <div className="mt-1.5 grid grid-cols-1 items-start gap-1.5 xl:grid-cols-[1fr_280px]">

        {/* Left: Today Jobs */}
        <Card
          title="Today Jobs"
          right={
            <button
              type="button"
              onClick={() => navigate("/carwash/jobs")}
              className="text-[10px] font-extrabold uppercase tracking-wide text-[#0B3B2E] hover:text-[#FF8C00]"
            >
              View All →
            </button>
          }
        >
          {/* Mobile cards */}
          <div className="divide-y divide-slate-100 xl:hidden">
            {jobs.length ? jobs.slice(0, 10).map((job) => (
              <div key={job._id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-mono font-bold text-[#0B3B2E]">{job.jobNumber || "—"}</span>
                    <span className="font-extrabold text-slate-800">{job.plateNumber || "—"}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {job.serviceName || "—"} · {fmt(job.createdAt)}
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${jobStatusBadge(job.status)}`}>
                    {job.status || "—"}
                  </span>
                  <span className="text-xs font-extrabold text-slate-900">{formatMoney(job.price)}</span>
                </div>
              </div>
            )) : (
              <p className="px-3 py-8 text-center text-xs font-semibold text-slate-400">
                No jobs recorded for this date.
              </p>
            )}
          </div>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full min-w-[700px] text-xs">
              <thead>
                <tr className="bg-[#0B3B2E]">
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Time</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Job No.</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Plate</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Service</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Staff</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Status</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Payment</th>
                  <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Price</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length ? jobs.slice(0, 15).map((job) => (
                  <tr key={job._id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-400">{fmt(job.createdAt)}</td>
                    <td className="px-3 py-2 font-mono font-bold text-[#0B3B2E]">{job.jobNumber || "—"}</td>
                    <td className="px-3 py-2 font-extrabold text-slate-900">{job.plateNumber || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{job.serviceName || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{job.assignedStaff?.name || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${jobStatusBadge(job.status)}`}>
                        {job.status || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${payBadge(job.paymentStatus)}`}>
                        {job.paymentStatus || "unpaid"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900">{formatMoney(job.price)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-xs font-semibold text-slate-400">
                      No Car Wash jobs recorded for this date.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Right sidebar */}
        <div className="flex flex-col gap-1.5">

          {/* Daily Summary */}
          <Card title="Daily Summary">
            <div className="divide-y divide-slate-100">
              {[
                { label: "Paid Jobs",     value: counts.paid || 0,               note: "fully settled",           bold: true },
                { label: "In Queue",      value: activeQueue,                    note: "not yet paid",            warn: activeQueue > 0 },
                { label: "Cancelled",     value: counts.cancelled || 0,          note: "not counted in revenue",  muted: true },
                { label: "Payments",      value: summary?.paymentCount || 0,     note: "transactions recorded" },
                { label: "Non-Cash",      value: formatMoney(nonCash),           note: "M-Pesa · bank · card",   money: true },
              ].map(({ label, value, note, bold, warn, muted, money }) => (
                <div key={label} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <p className={`text-xs font-bold ${muted ? "text-slate-400" : "text-slate-700"}`}>{label}</p>
                    <p className="text-[10px] text-slate-400">{note}</p>
                  </div>
                  <span className={`text-right font-extrabold tabular-nums ${
                    bold ? "text-emerald-700" :
                    warn ? "text-orange-600" :
                    muted ? "text-slate-400" :
                    money ? "text-[#0B3B2E]" :
                    "text-slate-900"
                  } ${money ? "text-sm" : "text-base"}`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* Payment Mix */}
          <Card title="Payment Mix">
            <div className="space-y-1 px-3 py-2">
              {paymentRows.map(({ method, label, amount }) => {
                const pct = totalRevenue > 0 ? Math.round((amount / totalRevenue) * 100) : 0;
                const { bar, text } = paymentColors[method] || paymentColors.other;
                return (
                  <div key={method}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-600">{label}</span>
                      <span className={`font-extrabold tabular-nums ${amount > 0 ? text : "text-slate-300"}`}>
                        {formatMoney(amount)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-7 text-right text-[10px] font-bold text-slate-400">{pct}%</span>
                    </div>
                  </div>
                );
              })}
              {totalRevenue === 0 && (
                <p className="py-2 text-center text-[10px] text-slate-400">No revenue recorded yet.</p>
              )}
            </div>
          </Card>

          {/* Recent Payments */}
          <Card title="Recent Payments">
            <div className="divide-y divide-slate-100">
              {payments.length ? payments.map((p) => (
                <div key={p._id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-bold uppercase text-slate-800">{p.method || "—"}</span>
                      {p.reference && <span className="truncate font-mono text-[10px] text-slate-400">{p.reference}</span>}
                    </div>
                    <p className="text-[10px] text-slate-400">
                      {fmt(p.paymentDate)}{p.job?.jobNumber ? ` · ${p.job.jobNumber}` : ""}
                    </p>
                  </div>
                  <span className="flex-shrink-0 text-sm font-extrabold tabular-nums text-[#0B3B2E]">
                    {formatMoney(p.amount)}
                  </span>
                </div>
              )) : (
                <p className="px-3 py-6 text-center text-[11px] font-semibold text-slate-400">
                  No payments recorded yet.
                </p>
              )}
            </div>
          </Card>

        </div>
      </div>
      </div>{/* end overflow-y-auto */}
    </CarWashShell>
  );
};

export default CarWashDashboard;

import React from "react";

const STAT_TONES = {
  green:  "bg-[#0B3B2E] border-[#0B3B2E]",
  orange: "bg-[#C8511A] border-[#C8511A]",
  slate:  "bg-slate-700 border-slate-700",
  red:    "bg-rose-700 border-rose-700",
  blue:   "bg-blue-700 border-blue-700",
  amber:  "bg-amber-600 border-amber-600",
  violet: "bg-violet-700 border-violet-700",
};

// compact: a shorter tile, for dashboards that want the table below it to have the room
export const DashboardStatCard = ({ label, value, sub, icon: Icon, tone = "green", onClick, compact = false }) => {
  const bg = STAT_TONES[tone] ?? STAT_TONES.green;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`relative overflow-hidden border ${bg} ${compact ? "px-3 py-1.5" : "px-4 py-3"} shadow-sm w-full text-left ${onClick ? "cursor-pointer hover:brightness-110 transition-all" : ""}`}
    >
      {Icon && <Icon className={`absolute text-white/10 ${compact ? "right-2.5 top-1.5 h-7 w-7" : "right-3 top-2.5 h-10 w-10"}`} />}
      <p className="text-[9px] font-extrabold uppercase tracking-widest text-white/60">{label}</p>
      <p className={`${compact ? "mt-1 text-lg" : "mt-1.5 text-2xl"} font-black leading-none text-white`}>{value}</p>
      {sub && <p className={`${compact ? "mt-0.5 text-[9px]" : "mt-1 text-[10px]"} text-white/50`}>{sub}</p>}
    </Tag>
  );
};

const DashboardCard = ({ title, right, children, className = "" }) => (
  <div className={`border border-slate-200 bg-white shadow-sm ${className}`}>
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">{title}</h2>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
    {children}
  </div>
);

/** The "View All →" link that sits in a card header. */
export const DashboardLinkButton = ({ onClick, children = "View All →" }) => (
  <button type="button" onClick={onClick} className="text-[10px] font-extrabold uppercase tracking-wide text-[#0B3B2E] hover:text-[#FF8C00]">
    {children}
  </button>
);

/** A grid of icon + label shortcuts. links: [{ label, to, Icon }] */
export const DashboardQuickAccess = ({ links, onNavigate }) => (
  <div className="grid grid-cols-2 gap-px bg-slate-100">
    {links.map(({ label, to, Icon }) => (
      <button key={to} type="button" onClick={() => onNavigate(to)} className="flex items-center gap-2 bg-white px-3 py-2.5 text-left hover:bg-[#F1F6F3]">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-[#0B3B2E]/10 text-xs text-[#0B3B2E]">
          <Icon />
        </span>
        <span className="text-xs font-bold leading-tight text-slate-800">{label}</span>
      </button>
    ))}
  </div>
);

/** Label / note on the left, a figure on the right. rows: [{ label, note, value, tone }] with tone "good" | "warn" | undefined */
export const DashboardSummaryRows = ({ rows, loading }) => (
  <div className="divide-y divide-slate-100">
    {rows.map(({ label, note, value, tone }) => (
      <div key={label} className="flex items-center justify-between gap-2 px-3 py-2">
        <div>
          <p className="text-xs font-bold text-slate-700">{label}</p>
          {note && <p className="text-[10px] text-slate-400">{note}</p>}
        </div>
        <span className={`text-right text-base font-extrabold tabular-nums ${tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-orange-600" : "text-slate-900"}`}>
          {loading ? "…" : value}
        </span>
      </div>
    ))}
  </div>
);

export default DashboardCard;

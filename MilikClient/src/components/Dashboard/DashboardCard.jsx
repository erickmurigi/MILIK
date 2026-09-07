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

export const DashboardStatCard = ({ label, value, sub, icon: Icon, tone = "green", onClick }) => {
  const bg = STAT_TONES[tone] ?? STAT_TONES.green;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`relative overflow-hidden border ${bg} px-4 py-3 shadow-sm w-full text-left ${onClick ? "cursor-pointer hover:brightness-110 transition-all" : ""}`}
    >
      {Icon && <Icon className="absolute right-3 top-2.5 h-10 w-10 text-white/10" />}
      <p className="text-[9px] font-extrabold uppercase tracking-widest text-white/60">{label}</p>
      <p className="mt-1.5 text-2xl font-black leading-none text-white">{value}</p>
      {sub && <p className="mt-1 text-[10px] text-white/50">{sub}</p>}
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

export default DashboardCard;

import React from "react";

/** Shared "built, not screenshotted" visual chrome — an abstract pattern
 * built from the logo's own overlapping-square motif, with soft ambient
 * glow behind it. Used across the homepage and every module page so the
 * whole site shares one visual language instead of each page inventing its
 * own screenshot/illustration treatment. Pass whatever content (metric
 * tiles, a statement preview, etc.) as children. */
export default function BrandPatternPanel({ eyebrow, children, className = "" }) {
  return (
    <div className={`relative isolate overflow-hidden border border-slate-200 bg-white p-6 shadow-[0_24px_60px_-12px_rgba(11,59,46,0.25)] sm:p-8 ${className}`}>
      <div aria-hidden className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#18A06F]/15 blur-3xl" />
      <div aria-hidden className="absolute -left-10 bottom-0 h-48 w-48 rounded-full bg-[#FF8C00]/10 blur-3xl" />
      <svg aria-hidden className="absolute inset-0 h-full w-full" viewBox="0 0 500 460" fill="none" preserveAspectRatio="xMidYMid slice">
        <rect x="30" y="30" width="190" height="190" stroke="#0B3B2E" strokeOpacity="0.08" strokeWidth="14" />
        <rect x="120" y="100" width="150" height="150" stroke="#FF8C00" strokeOpacity="0.22" strokeWidth="10" />
        <rect x="300" y="240" width="170" height="170" stroke="#0B3B2E" strokeOpacity="0.07" strokeWidth="12" />
        <rect x="270" y="30" width="80" height="80" stroke="#18A06F" strokeOpacity="0.2" strokeWidth="8" />
      </svg>

      <div className="relative">
        {eyebrow && <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">{eyebrow}</p>}
        <div className={eyebrow ? "mt-5" : ""}>{children}</div>
      </div>
    </div>
  );
}

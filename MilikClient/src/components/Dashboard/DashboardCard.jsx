import React from 'react';

const DashboardCard = ({ title, right, children, className = '' }) => (
  <div className={`border border-slate-200 bg-white shadow-sm ${className}`}>
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">{title}</h2>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
    {children}
  </div>
);

export default DashboardCard;

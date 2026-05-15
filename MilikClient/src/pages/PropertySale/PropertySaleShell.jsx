import React from "react";
import DashboardLayout from "../../components/Layout/DashboardLayout";

const PropertySaleShell = ({ title, subtitle, action, children }) => (
  <DashboardLayout>
    <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-slate-50 text-slate-900">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm" style={{ borderLeftWidth: 3, borderLeftColor: "#027333", borderLeftStyle: "solid" }}>
        <div className="flex items-baseline gap-2.5">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#027333]">MILIK PROPERTY SALES</span>
          {title && <span className="text-sm font-extrabold text-slate-900">{title}</span>}
          {subtitle && <span className="hidden text-xs font-semibold text-slate-500 sm:inline">{subtitle}</span>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      <div className="flex-1 overflow-auto p-2">{children}</div>
    </div>
  </DashboardLayout>
);

export default PropertySaleShell;

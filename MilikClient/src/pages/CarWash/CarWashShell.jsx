import React from "react";
import DashboardLayout from "../../components/Layout/DashboardLayout";

const CarWashShell = ({ title, action, children, showToolbar = true }) => {
  return (
    <DashboardLayout>
      <div className="min-h-[calc(100vh-8rem)] bg-[#F4F7F5] p-2 text-slate-900">
        {showToolbar && (
          <div className="mb-2 flex min-h-9 items-center justify-between gap-2 border border-slate-200 border-l-[#0B3B2E] bg-white px-3 py-1.5 shadow-sm" style={{ borderLeftWidth: 3 }}>
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#0B3B2E]">MILIK Car Wash</span>
              <span className="text-sm font-extrabold text-slate-900">{title}</span>
            </div>
            <div className="flex items-center gap-2">{action}</div>
          </div>
        )}
        {children}
      </div>
    </DashboardLayout>
  );
};

export default CarWashShell;

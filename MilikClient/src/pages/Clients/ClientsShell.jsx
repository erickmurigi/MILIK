import React from 'react';
import DashboardLayout from '../../components/Layout/DashboardLayout';

const ClientsShell = ({ title, action, children }) => (
  <DashboardLayout lockContentScroll>
    <div className="h-full flex flex-col bg-[#F4F7F5] p-1.5 text-slate-900">
      <div
        className="mb-1 flex-shrink-0 flex min-h-8 items-center justify-between gap-1.5 border border-slate-200 border-l-[#0B3B2E] bg-white px-3 py-1 shadow-sm"
        style={{ borderLeftWidth: 3 }}
      >
        <div className="flex items-baseline gap-2">
          <span className="hidden sm:inline text-[11px] font-bold uppercase tracking-[0.16em] text-[#0B3B2E]">
            Client Management
          </span>
          <span className="text-sm font-extrabold text-slate-900">{title}</span>
        </div>
        <div className="flex items-center gap-1.5">{action}</div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  </DashboardLayout>
);

export default ClientsShell;

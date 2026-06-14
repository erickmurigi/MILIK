import React from "react";
import { FaWarehouse } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";

const InventoryShell = ({ title, action, children, subtitle = "" }) => (
  <DashboardLayout>
    <div className="min-h-[calc(100vh-8rem)] bg-[#F4F7F5] p-2 text-slate-900">
      <div
        className="mb-2 flex min-h-9 items-center justify-between gap-2 border border-slate-200 bg-white px-3 py-1.5 shadow-sm"
        style={{ borderLeftWidth: 3, borderLeftColor: "#0B3B2E" }}
      >
        <div className="flex items-baseline gap-2">
          <FaWarehouse className="text-[#0B3B2E] text-xs shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#0B3B2E]">Inventory & POS</span>
          {title && <span className="text-sm font-extrabold text-slate-900">{title}</span>}
          {subtitle && <span className="text-xs text-slate-500">{subtitle}</span>}
        </div>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
      {children}
    </div>
  </DashboardLayout>
);

export default InventoryShell;

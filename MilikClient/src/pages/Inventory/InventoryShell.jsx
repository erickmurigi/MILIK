import React from "react";
import { FaWarehouse } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";

const InventoryShell = ({ title, action, children, subtitle = "", lockScroll = false }) => (
  <DashboardLayout lockContentScroll={lockScroll}>
    <div className={lockScroll ? "flex h-full min-h-0 flex-col overflow-hidden bg-[#F4F7F5] p-2 text-slate-900" : "min-h-[calc(100vh-8rem)] bg-[#F4F7F5] p-2 text-slate-900"}>
      {(title || action) && (
        <div
          className="mb-1.5 flex shrink-0 items-center justify-between gap-2 border border-slate-200 bg-white px-3 py-1 shadow-sm"
          style={{ borderLeftWidth: 3, borderLeftColor: "#0B3B2E" }}
        >
          <div className="flex items-center gap-2">
            <FaWarehouse className="text-[#0B3B2E] text-[11px] shrink-0" />
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#0B3B2E]">Inventory & POS</span>
            {title && <><span className="text-slate-300">·</span><span className="text-xs font-extrabold text-slate-800">{title}</span></>}
            {subtitle && <span className="text-[11px] text-slate-500">{subtitle}</span>}
          </div>
          {action && <div className="flex items-center gap-1.5">{action}</div>}
        </div>
      )}
      <div className={lockScroll ? "flex min-h-0 flex-1 flex-col overflow-hidden" : undefined}>
        {children}
      </div>
    </div>
  </DashboardLayout>
);

export default InventoryShell;

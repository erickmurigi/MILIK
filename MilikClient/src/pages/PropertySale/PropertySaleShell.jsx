import React, { useContext } from "react";
import { EmbeddedReportContext } from "./EmbeddedReportContext";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { useTerm } from "../../hooks/useTerm";

const PropertySaleShell = ({ title, subtitle, action, children }) => {
  const moduleName = useTerm("saleModule");
  const embedded = useContext(EmbeddedReportContext);
  if (embedded) return <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-1.5">{children}</div>;
  const hasHeader = title || subtitle || action;
  return (
    <DashboardLayout lockContentScroll>
      <div className="h-full flex flex-col bg-slate-50 text-slate-900">

        {/* ── Page header — only when there is content ── */}
        {hasHeader && (
          <div
            className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm"
            style={{ borderLeftWidth: 3, borderLeftColor: "#0B3B2E", borderLeftStyle: "solid" }}
          >
            <div className="flex items-baseline gap-2.5">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#0B3B2E]">MILIK {moduleName}</span>
              {title    && <span className="text-sm font-extrabold text-slate-900">{title}</span>}
              {subtitle && <span className="hidden text-xs font-semibold text-slate-500 sm:inline">{subtitle}</span>}
            </div>
            {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
          </div>
        )}

        {/* ── Page content ── */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-1.5">{children}</div>
      </div>
    </DashboardLayout>
  );
};

export default PropertySaleShell;

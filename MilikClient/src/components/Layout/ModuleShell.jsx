import React from "react";
import DashboardLayout from "./DashboardLayout";

/**
 * The page frame shared by the module dashboards: the app layout, then a slim header bar
 * ("MILIK <module>  ·  <title>", with actions on the right), then the content.
 * Pages that need extras in the frame (Car Wash's branch picker, for example) keep their own shell.
 */
const ModuleShell = ({ moduleLabel, title, subtitle, action, children }) => {
  const hasHeader = title || subtitle || action;
  return (
    <DashboardLayout lockContentScroll>
      <div className="h-full flex flex-col bg-slate-50 text-slate-900">
        {hasHeader && (
          <div
            className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm"
            style={{ borderLeftWidth: 3, borderLeftColor: "#0B3B2E", borderLeftStyle: "solid" }}
          >
            <div className="flex items-baseline gap-2.5">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#0B3B2E]">{moduleLabel}</span>
              {title && <span className="text-sm font-extrabold text-slate-900">{title}</span>}
              {subtitle && <span className="hidden text-xs font-semibold text-slate-500 sm:inline">{subtitle}</span>}
            </div>
            {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
          </div>
        )}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-1.5">{children}</div>
      </div>
    </DashboardLayout>
  );
};

export default ModuleShell;

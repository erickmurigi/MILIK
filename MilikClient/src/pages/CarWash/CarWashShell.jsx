import React, { useEffect, useState } from "react";
import { FaCodeBranch } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { carWashApi, getActiveBranchId, normalizeListPayload } from "../../services/carWashApi";

const CarWashShell = ({ title, action, children, showToolbar = true }) => {
  const [branchName, setBranchName] = useState("");
  const assignedBranchId = getActiveBranchId();

  useEffect(() => {
    if (!assignedBranchId) return;
    carWashApi.listBranches({ active: true })
      .then((result) => {
        const branches = normalizeListPayload(result, "branches");
        const match = branches.find((b) => b._id === assignedBranchId);
        if (match) setBranchName(match.name);
      })
      .catch(() => {});
  }, [assignedBranchId]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="h-full flex flex-col bg-[#F4F7F5] p-1.5 text-slate-900">
        {showToolbar && (
          <div className="mb-1 flex-shrink-0 flex min-h-8 flex-wrap items-center justify-between gap-1.5 border border-slate-200 border-l-[#0B3B2E] bg-white px-3 py-1 shadow-sm" style={{ borderLeftWidth: 3 }}>
            <div className="flex items-baseline gap-2">
              <span className="hidden sm:inline text-[11px] font-bold uppercase tracking-[0.16em] text-[#0B3B2E]">MILIK Car Wash</span>
              <span className="text-sm font-extrabold text-slate-900">{title}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1.5 border border-[#B7C9C0] bg-[#F1F6F3] px-2.5 py-1">
                <FaCodeBranch className="text-[#0B3B2E] text-[11px]" />
                <span className="text-xs font-bold text-[#0B3B2E]">
                  {assignedBranchId ? (branchName || "Loading…") : "All Branches"}
                </span>
              </div>
              {action}
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default CarWashShell;

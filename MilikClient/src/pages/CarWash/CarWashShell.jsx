import React, { useEffect, useState } from "react";
import { FaCodeBranch } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { carWashApi, getActiveBranchId, normalizeListPayload, setActiveBranchId } from "../../services/carWashApi";

const CarWashShell = ({ title, action, children, showToolbar = true }) => {
  const [branches, setBranches] = useState([]);
  const [activeBranchId, setLocalBranchId] = useState(getActiveBranchId());

  useEffect(() => {
    carWashApi.listBranches({ active: true })
      .then((result) => setBranches(normalizeListPayload(result, "branches")))
      .catch(() => setBranches([]));
  }, []);

  const handleBranchChange = (id) => {
    setActiveBranchId(id);
    setLocalBranchId(id);
    window.location.reload();
  };

  const activeBranch = branches.find((b) => b._id === activeBranchId);

  return (
    <DashboardLayout>
      <div className="min-h-[calc(100vh-8rem)] bg-[#F4F7F5] p-2 text-slate-900">
        {showToolbar && (
          <div className="mb-2 flex min-h-9 items-center justify-between gap-2 border border-slate-200 border-l-[#0B3B2E] bg-white px-3 py-1.5 shadow-sm" style={{ borderLeftWidth: 3 }}>
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#0B3B2E]">MILIK Car Wash</span>
              <span className="text-sm font-extrabold text-slate-900">{title}</span>
            </div>
            <div className="flex items-center gap-2">
              {branches.length > 0 && (
                <div className="flex items-center gap-1.5 border border-[#B7C9C0] bg-[#F1F6F3] px-2" style={{ height: 32 }}>
                  <FaCodeBranch className="text-[#0B3B2E] text-[11px]" />
                  <select
                    className="h-full bg-transparent text-xs font-bold text-[#0B3B2E] focus:outline-none"
                    value={activeBranchId}
                    onChange={(e) => handleBranchChange(e.target.value)}
                  >
                    <option value="">All Branches</option>
                    {branches.map((b) => (
                      <option key={b._id} value={b._id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {activeBranch && (
                <span className="hidden sm:inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                  {activeBranch.location || activeBranch.name}
                </span>
              )}
              {action}
            </div>
          </div>
        )}
        {children}
      </div>
    </DashboardLayout>
  );
};

export default CarWashShell;

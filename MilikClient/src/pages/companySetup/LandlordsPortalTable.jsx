import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaKey, FaLock, FaLockOpen, FaUserPlus } from "react-icons/fa";
import { adminRequests } from "../../utils/requestMethods";
import { sendLandlordPortalInvite, updateLandlord } from "../../redux/apiCalls";

const fmtDateTime = (value) => {
  if (!value) return "Never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Never";
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" }).format(d);
};

const statusFor = (landlord) => {
  if (landlord.portalAccess !== "Enabled") return { label: "Not invited", className: "border-slate-200 bg-slate-50 text-slate-600" };
  if (!landlord.portalLastLogin) return { label: "Invited, not signed in", className: "border-amber-200 bg-amber-50 text-amber-700" };
  return { label: "Active", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
};

const LandlordRow = React.memo(function LandlordRow({ landlord, busy, onInvite, onDisable, onOpen }) {
  const status = statusFor(landlord);
  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-1.5 border-r border-gray-100">
        <button type="button" onClick={() => onOpen(landlord)} className="font-bold text-[#0B3B2E] hover:underline">
          {landlord.landlordName || "—"}
        </button>
      </td>
      <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{landlord.landlordCode || "—"}</td>
      <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{landlord.email || "—"}</td>
      <td className="px-3 py-1.5 border-r border-gray-100">
        <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${status.className}`}>{status.label}</span>
      </td>
      <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">{fmtDateTime(landlord.portalLastLogin)}</td>
      <td className="px-3 py-1.5 text-right">
        <div className="inline-flex gap-1">
          {!landlord.email && (
            <span className="text-[10px] font-semibold text-rose-500" title="Add an email on the landlord record before inviting">No email on file</span>
          )}
          {landlord.email && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onInvite(landlord)}
              className="inline-flex items-center gap-1.5 border border-[#B7C9C0] bg-[#F1F6F3] px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#E3EDE8] disabled:cursor-not-allowed disabled:opacity-50"
              title={landlord.portalAccess === "Enabled" ? "Reset access" : "Invite"}
            >
              {landlord.portalAccess === "Enabled" ? <FaKey size={9} /> : <FaUserPlus size={9} />}
              {landlord.portalAccess === "Enabled" ? "Reset" : "Invite"}
            </button>
          )}
          {landlord.portalAccess === "Enabled" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDisable(landlord)}
              className="border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              title="Disable portal access"
            >
              <FaLock size={9} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});

export default function LandlordsPortalTable({ biz }) {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState(null);

  const { data, isFetching, error } = useQuery({
    queryKey: ["portal-landlords", biz],
    queryFn: () => adminRequests.get("/landlords", { params: { companyId: biz, limit: 500 } }).then((r) => r.data?.data || []),
    enabled: !!biz,
    staleTime: 15_000,
  });

  const landlords = data || [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["portal-landlords", biz] });

  const handleInvite = async (landlord) => {
    setBusyId(landlord._id);
    try {
      const result = await dispatch(sendLandlordPortalInvite(landlord._id));
      const temporaryPassword = result?.data?.temporaryPassword;
      if (temporaryPassword) {
        toast.success(`${result?.message || "Portal access enabled"} — temporary password: ${temporaryPassword}`, { autoClose: false });
      } else {
        toast.success(result?.message || `Portal invite sent to ${landlord.email}`);
      }
      invalidate();
    } catch (err) {
      toast.error(err.message || "Failed to send portal invite");
    } finally {
      setBusyId(null);
    }
  };

  const handleDisable = async (landlord) => {
    setBusyId(landlord._id);
    try {
      await dispatch(updateLandlord(landlord._id, { portalAccess: "Disabled" }));
      toast.success("Portal access disabled");
      invalidate();
    } catch (err) {
      toast.error(err.message || "Failed to disable portal access");
    } finally {
      setBusyId(null);
    }
  };

  const handleOpen = (landlord) => navigate('/landlords/new', {
    state: { mode: 'edit', tabTitle: 'Landlord Details', landlordId: landlord._id, landlordData: landlord },
  });

  return (
    <>
      {error && (
        <div className="mb-2 border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700">Failed to load landlords.</div>
      )}
      <div className="flex-1 overflow-auto border border-slate-200">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#0B3B2E]">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-white">Landlord</th>
              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-white">Code</th>
              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-white">Email</th>
              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-white">Status</th>
              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-white">Last Login</th>
              <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-wide text-white">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!isFetching && landlords.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-xs font-semibold text-slate-400">No landlords found.</td></tr>
            )}
            {landlords.map((landlord) => (
              <LandlordRow
                key={landlord._id}
                landlord={landlord}
                busy={busyId === landlord._id}
                onInvite={handleInvite}
                onDisable={handleDisable}
                onOpen={handleOpen}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

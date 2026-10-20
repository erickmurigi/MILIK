import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaArrowRight, FaGavel, FaHome, FaKey, FaLock, FaLockOpen,
  FaUserPlus, FaUserShield, FaUsers, FaUserTie,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import MilikConfirmDialog from "../../components/Modals/MilikConfirmDialog";
import { selectCurrentCompany } from "../../redux/selectors";
import { toggleUserLock, resetUserPassword } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";
import { saleApi } from "../../services/propertySaleApi";
import AttachAdvocateModal from "../PropertySale/AttachAdvocateModal";

// The extensibility point: each entry describes one portal type. `available: false` entries render a
// plain "not built yet" panel — Tenant/Landlord/Employee portals don't have a userIds link field or role
// preset yet, unlike Advocate (see SaleAdvocate.userIds, moduleRolePresets.js's "advocate" role), and
// Tenants/Landlords aren't company Users at all so they'll need their own design, not this one.
// `fetchRecords`/`recordOptionLabel`/`linkUser` are optional — only entries that can actually attach a
// user to a record from this page set them. Users are created exactly one way, in Users & Access — never
// here. This page lists every company user; "Invite" attaches the chosen one to a record and resends
// their login the same way account creation does (fresh temp password, emailed) — no new account, ever.
const PORTAL_REGISTRY = {
  advocates: {
    label: "Advocates Portal",
    icon: FaGavel,
    available: true,
    fetchRecords: (biz) => saleApi.listAdvocates({ business: biz, limit: 500 }).then((r) => r.data || []),
    recordOptionLabel: (r) => (r.firm ? `${r.fullName} (${r.firm})` : r.fullName),
    recordLink: () => "/sale/advocates",
    linkUser: (recordId, userId) => saleApi.linkAdvocateUser(recordId, userId),
  },
  tenants:   { label: "Tenants Portal",   icon: FaUsers,   available: false },
  landlords: { label: "Landlords Portal", icon: FaHome,    available: false },
  employees: { label: "Employees Portal", icon: FaUserTie, available: false },
};

const PORTAL_ORDER = ["advocates", "tenants", "landlords", "employees"];

// Mirrors CompanySetupPage.jsx's getSessionStatus exactly (small enough not to warrant a cross-file import).
const getSessionStatus = (user = {}) => {
  if (user.locked) return { label: "Locked", className: "border-amber-200 bg-amber-50 text-amber-700" };
  if (user.isActive === false) return { label: "Inactive", className: "border-slate-200 bg-slate-50 text-slate-600" };
  if (!user.lastLogin) return { label: "Never signed in", className: "border-rose-200 bg-rose-50 text-rose-700" };
  const ageDays = Math.floor((Date.now() - new Date(user.lastLogin).getTime()) / (1000 * 60 * 60 * 24));
  if (ageDays <= 1) return { label: "Recently active", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if (ageDays <= 30) return { label: "Active", className: "border-blue-200 bg-blue-50 text-blue-700" };
  return { label: "Dormant", className: "border-orange-200 bg-orange-50 text-orange-700" };
};

const fmtDateTime = (value) => {
  if (!value) return "Never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Never";
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" }).format(d);
};

// Module scope + React.memo so opening the Invite modal or a lock/reset confirm dialog (state local to
// the parent) doesn't force every row to recompute and re-render — only the row(s) whose own props
// actually changed do. Real cost scales with company user count, and this page is getting real traffic
// now that advocate-scoped users can reach it (today's role-grant changes).
const UserRow = React.memo(function UserRow({ user, attachedRecord, portal, onNavigateToRecord, onInvite, onResetAccess, onToggleLock }) {
  const session = getSessionStatus(user);
  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-1.5 border-r border-gray-100 font-bold text-slate-900">{`${user.otherNames || ""} ${user.surname || ""}`.trim() || "—"}</td>
      <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{user.email || "—"}</td>
      <td className="px-3 py-1.5 border-r border-gray-100">
        {attachedRecord ? (
          <button type="button" onClick={onNavigateToRecord} className="font-semibold text-[#0B3B2E] hover:underline">
            {portal.recordOptionLabel(attachedRecord)}
          </button>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="px-3 py-1.5 border-r border-gray-100">
        <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${session.className}`}>{session.label}</span>
      </td>
      <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">{fmtDateTime(user.lastLogin)}</td>
      <td className="px-3 py-1.5 text-right">
        <div className="inline-flex gap-1">
          {portal.linkUser && (
            <button type="button" onClick={() => onInvite(user)} className="inline-flex items-center gap-1.5 border border-[#B7C9C0] bg-[#F1F6F3] px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#E3EDE8]" title="Invite">
              <FaUserPlus size={9} /> Invite
            </button>
          )}
          <button type="button" onClick={() => onResetAccess(user)} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]" title="Reset access">
            <FaKey size={9} />
          </button>
          <button type="button" onClick={() => onToggleLock(user)} className={`border px-2 py-0.5 text-[11px] font-bold ${user.locked ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"}`} title={user.locked ? "Unlock" : "Lock"}>
            {user.locked ? <FaLockOpen size={9} /> : <FaLock size={9} />}
          </button>
        </div>
      </td>
    </tr>
  );
});

export default function PortalUsersPage() {
  const { portalKey = "advocates" } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const currentCompany = useSelector(selectCurrentCompany);
  const biz = currentCompany?._id;
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", isDangerous: false, confirmText: "Confirm", onConfirm: null });
  const [attachTarget, setAttachTarget] = useState(null); // the user row while the Attach/Invite modal is open
  const [inviting, setInviting] = useState(false);

  const portal = PORTAL_REGISTRY[portalKey] || PORTAL_REGISTRY.advocates;

  // Every company user — not filtered to any one profile, so the admin can attach anyone to a record,
  // not just users who already happen to carry the matching profile.
  const { data: usersData, isFetching: usersLoading, error: usersError } = useQuery({
    queryKey: ["portal-users-all", biz],
    queryFn: () => adminRequests.get("/users", { params: { companyId: biz, limit: 500 } }).then((r) => r.data?.users || []),
    enabled: !!biz && portal.available,
    staleTime: 15_000,
  });

  const { data: records, isFetching: recordsLoading, error: recordsError } = useQuery({
    queryKey: ["portal-records", biz, portalKey],
    queryFn: () => portal.fetchRecords(biz),
    enabled: !!biz && portal.available && typeof portal.fetchRecords === "function",
    staleTime: 15_000,
  });

  const loading = usersLoading || recordsLoading;
  const users = usersData || [];
  const recordList = records || [];

  const invalidate = useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["portal-users-all", biz] }),
    queryClient.invalidateQueries({ queryKey: ["portal-records", biz, portalKey] }),
  ]), [queryClient, biz, portalKey]);

  const advocateOptions = useMemo(
    () => recordList.map((r) => ({ value: r._id, label: portal.recordOptionLabel ? portal.recordOptionLabel(r) : r.fullName })),
    [recordList, portal]
  );

  // Which record (if any) each user is currently attached to — read straight off the already-populated
  // userIds on each record, no extra fetch needed.
  const recordByUserId = useMemo(() => {
    const map = new Map();
    recordList.forEach((record) => {
      (record.userIds || []).forEach((u) => map.set(String(u._id), record));
    });
    return map;
  }, [recordList]);

  const handleToggleLock = useCallback((user) => {
    const isLocked = Boolean(user.locked);
    const name = `${user.surname || ""} ${user.otherNames || ""}`.trim() || user.email || "this user";
    setConfirmDialog({
      isOpen: true,
      title: isLocked ? "Unlock user" : "Lock user",
      message: isLocked ? `Unlock ${name}? They will be able to sign in again.` : `Lock ${name}? They will be blocked from signing in immediately.`,
      isDangerous: !isLocked,
      confirmText: isLocked ? "Unlock" : "Lock",
      onConfirm: async () => {
        setConfirmDialog((p) => ({ ...p, isOpen: false }));
        try {
          await dispatch(toggleUserLock(user._id));
          toast.success(isLocked ? "User unlocked" : "User locked");
          invalidate();
        } catch (err) {
          toast.error(err?.response?.data?.message || "Failed to update lock status");
        }
      },
    });
  }, [dispatch, invalidate]);

  const handleResetAccess = useCallback((user) => {
    setConfirmDialog({
      isOpen: true,
      title: "Reset access",
      message: `Send a new temporary password to ${user.email}?`,
      isDangerous: false,
      confirmText: "Reset & Send",
      onConfirm: async () => {
        setConfirmDialog((p) => ({ ...p, isOpen: false }));
        try {
          await dispatch(resetUserPassword(user._id));
          toast.success("New password sent to " + user.email);
        } catch (err) {
          toast.error(err?.response?.data?.message || "Failed to reset access");
        }
      },
    });
  }, [dispatch]);

  const handleInviteClick = useCallback((user) => setAttachTarget(user), []);
  const handleNavigateToRecord = useCallback(() => navigate(portal.recordLink()), [navigate, portal]);

  // Attach the chosen record to this user, then resend their login the same way account creation does —
  // being attached to a firm is a real access change worth notifying them about.
  const handleInvite = async (recordId) => {
    if (!portal.linkUser || !attachTarget) return;
    setInviting(true);
    try {
      await portal.linkUser(recordId, attachTarget._id);
      const name = `${attachTarget.otherNames || ""} ${attachTarget.surname || ""}`.trim() || attachTarget.email;
      try {
        await dispatch(resetUserPassword(attachTarget._id));
        toast.success(`${name} invited and emailed their login`);
      } catch {
        toast.warning(`${name} attached, but the login email failed to send — use Reset Access to retry.`);
      }
      await invalidate();
      setAttachTarget(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to invite user");
    } finally {
      setInviting(false);
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">

          {/* Header */}
          <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FaUserShield className="text-sm text-[#B7C9C0]" />
                <div>
                  <h1 className="text-[12px] font-bold uppercase tracking-wide text-white">Portal Users — {portal.label}</h1>
                  <p className="mt-0.5 text-[10px] text-[#B7C9C0]">Every company user, who's attached to a {portal.label.toLowerCase().replace(" portal", "")}, and who still needs inviting.</p>
                </div>
              </div>
              <button onClick={() => navigate("/company-setup")} className="inline-flex h-7 items-center gap-1.5 border border-[#2A5C4A] px-3 text-[11px] font-bold text-white hover:bg-[#0A3127]">
                Company Setup <FaArrowRight size={10} />
              </button>
            </div>
          </div>

          {/* Portal type tabs */}
          <div className="flex flex-shrink-0 gap-1 border-b border-slate-200 bg-slate-50 px-2 pt-2">
            {PORTAL_ORDER.map((key) => {
              const p = PORTAL_REGISTRY[key];
              const Icon = p.icon;
              const active = key === portalKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => navigate(`/portal-users/${key}`)}
                  className={`inline-flex items-center gap-1.5 border-x border-t px-3 py-1.5 text-[11px] font-bold ${
                    active ? "border-slate-200 bg-white text-[#0B3B2E]" : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <Icon size={10} /> {p.label}
                </button>
              );
            })}
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
            {!portal.available && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-slate-400">
                <portal.icon size={28} />
                <p className="text-sm font-bold text-slate-500">{portal.label} isn't available yet</p>
                <p className="max-w-sm text-xs text-slate-400">This company module doesn't have a portal-access feature built for this group yet.</p>
              </div>
            )}

            {portal.available && (
              <>
                {(usersError || recordsError) && (
                  <div className="mb-2 border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700">Failed to load portal users.</div>
                )}

                <div className="flex-1 overflow-auto border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#0B3B2E]">
                      <tr>
                        <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-white">Name</th>
                        <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-white">Email</th>
                        <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-white">Attached To</th>
                        <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-white">Status</th>
                        <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-white">Last Login</th>
                        <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-wide text-white">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!loading && users.length === 0 && (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-xs font-semibold text-slate-400">No company users found.</td></tr>
                      )}
                      {users.map((user) => (
                        <UserRow
                          key={user._id}
                          user={user}
                          attachedRecord={recordByUserId.get(String(user._id))}
                          portal={portal}
                          onNavigateToRecord={handleNavigateToRecord}
                          onInvite={handleInviteClick}
                          onResetAccess={handleResetAccess}
                          onToggleLock={handleToggleLock}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <MilikConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText={confirmDialog.confirmText}
        cancelText="Cancel"
        isDangerous={confirmDialog.isDangerous}
        onConfirm={() => confirmDialog.onConfirm?.()}
        onCancel={() => setConfirmDialog((p) => ({ ...p, isOpen: false }))}
      />

      {attachTarget && portal.linkUser && (
        <AttachAdvocateModal
          user={attachTarget}
          advocateOptions={advocateOptions}
          inviting={inviting}
          onClose={() => setAttachTarget(null)}
          onInvite={handleInvite}
        />
      )}
    </DashboardLayout>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import {
  FaBan, FaCheckCircle, FaEllipsisV, FaLock, FaPlus,
  FaShieldAlt, FaUnlock, FaUserEdit, FaUsers,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import PaginationBar from "../../components/PaginationBar";
import { getUsers } from "../../redux/apiCalls";
import { selectAllUsers } from "../../redux/selectors";
import { adminRequests } from "../../utils/requestMethods";

const PAGE_SIZE = 25;
const STATUS_FILTERS = ["All", "Active", "Locked", "Inactive"];

const GRN = "#0B3B2E";

const userStatusInfo = (user) => {
  if (user?.locked)           return { label: "Locked",   cls: "border-amber-200 bg-amber-50 text-amber-700"   };
  if (user?.isActive === false) return { label: "Inactive", cls: "border-red-200 bg-red-50 text-red-700"         };
  return                              { label: "Active",   cls: "border-emerald-200 bg-emerald-50 text-emerald-700" };
};

const moduleAccessSummary = (user) => {
  const seen = new Set();
  (Array.isArray(user?.companyAssignments) ? user.companyAssignments : []).forEach((a) => {
    Object.entries(a?.moduleAccess || {}).forEach(([key, val]) => {
      if (val === "View only" || val === "Full access") seen.add(key);
    });
  });
  return [...seen];
};

const MODULE_SHORT = {
  propertyMgmt: "Prop Mgmt", accounts: "Accounts", humanResource: "HR",
  propertySale: "Sale", carwash: "Car Wash", inventory: "Inventory", procurement: "Procurement",
};

export default function CompanyUsers() {
  const dispatch      = useDispatch();
  const navigate      = useNavigate();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const currentUser   = useSelector((s) => s.auth?.currentUser);
  const users         = useSelector(selectAllUsers);
  const isFetching    = useSelector((s) => s.user?.isFetching);

  const [search,       setSearch]       = useTabState("/users:search",       "");
  const [statusFilter, setStatusFilter] = useTabState("/users:statusFilter", "All");
  const [page,         setPage]         = useTabState("/users:page",         1);
  const [actionMenuId, setActionMenuId] = useState(null);
  const [togglingId,   setTogglingId]   = useState(null);

  const companyId = useMemo(() =>
    currentCompany?._id || (typeof currentUser?.company === "string" ? currentUser.company : currentUser?.company?._id),
    [currentCompany, currentUser]
  );

  const load = useCallback(() => {
    if (!companyId) return;
    dispatch(getUsers(companyId, { status: statusFilter === "All" ? "all" : statusFilter.toLowerCase() }));
  }, [companyId, dispatch, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, statusFilter, setPage]);

  useEffect(() => {
    const close = () => setActionMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const name = `${u.surname || ""} ${u.otherNames || ""}`.toLowerCase();
      return name.includes(q) || (u.email || "").toLowerCase().includes(q) || (u.phoneNumber || "").toLowerCase().includes(q);
    });
  }, [users, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const active   = users.filter((u) => !u.locked && u.isActive !== false).length;
  const locked   = users.filter((u) =>  u.locked).length;
  const inactive = users.filter((u) => !u.locked && u.isActive === false).length;

  const handleToggleLock = async (user) => {
    const action = user.locked ? "unlock" : "lock";
    setTogglingId(user._id);
    setActionMenuId(null);
    try {
      await adminRequests.put(`/users/${user._id}`, { locked: !user.locked });
      toast.success(`User ${action}ed`);
      load();
    } catch {
      toast.error(`Failed to ${action} user`);
    } finally { setTogglingId(null); }
  };

  const handleToggleActive = async (user) => {
    const activate = user.isActive === false;
    setTogglingId(user._id);
    setActionMenuId(null);
    try {
      await adminRequests.put(`/users/${user._id}`, { isActive: activate });
      toast.success(activate ? "User activated" : "User deactivated");
      load();
    } catch {
      toast.error("Failed to update user status");
    } finally { setTogglingId(null); }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 text-slate-900">

        {/* Dark header */}
        <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FaUsers className="text-sm text-[#B7C9C0]" />
              <div>
                <h1 className="text-[12px] font-bold uppercase tracking-wide text-white">Users &amp; Access</h1>
                <p className="mt-0.5 text-[10px] text-[#B7C9C0]">
                  {active} active · {locked} locked · {inactive} inactive
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate("/users/new", { state: { returnTo: "/users" } })}
              className="inline-flex items-center gap-1.5 border border-white/30 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-white/20"
            >
              <FaPlus className="text-[10px]" /> Add User
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex-shrink-0 flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2">
          <div className="flex items-center gap-1.5 border border-slate-200 bg-white px-2.5 h-7 flex-1 max-w-xs">
            <svg className="shrink-0 text-[11px] text-slate-400 w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone…"
              className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="flex items-center gap-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-2.5 py-1 text-[10px] font-bold transition-colors ${
                  statusFilter === f ? "bg-[#0B3B2E] text-white" : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[11px] text-slate-400">{filtered.length} user{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">
          {isFetching ? (
            <div className="flex h-32 items-center justify-center text-xs text-slate-400">Loading users…</div>
          ) : paginated.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-xs text-slate-400">
              <FaUsers className="text-2xl opacity-30" />
              <span>{search ? "No users match your search." : "No users found."}</span>
            </div>
          ) : (
            <table className="w-full border-collapse text-[11px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-3 py-1.5 text-left font-bold border-r border-white/10">Name</th>
                  <th className="px-3 py-1.5 text-left font-bold border-r border-white/10 hidden sm:table-cell">Email</th>
                  <th className="px-3 py-1.5 text-left font-bold border-r border-white/10 hidden md:table-cell">Phone</th>
                  <th className="px-3 py-1.5 text-left font-bold border-r border-white/10 hidden lg:table-cell">Profile</th>
                  <th className="px-3 py-1.5 text-left font-bold border-r border-white/10 hidden lg:table-cell">Modules</th>
                  <th className="px-3 py-1.5 text-left font-bold border-r border-white/10">Status</th>
                  <th className="px-3 py-1.5 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((user, idx) => {
                  const status  = userStatusInfo(user);
                  const modules = moduleAccessSummary(user);
                  const fullName = `${user.surname || ""} ${user.otherNames || ""}`.trim();
                  const initials = `${(user.surname || "")[0] || ""}${(user.otherNames || "")[0] || ""}`.toUpperCase();
                  const isMe = user._id === currentUser?._id;
                  const busy = togglingId === user._id;

                  return (
                    <tr
                      key={user._id}
                      className={`border-b border-gray-100 ${busy ? "opacity-60" : ""} ${idx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}
                    >
                      <td className="px-3 py-1.5 border-r border-gray-100">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#0B3B2E] text-[9px] font-black text-white">
                            {initials || "?"}
                          </span>
                          <div>
                            <div className="font-bold text-slate-900">
                              {fullName || "—"}
                              {isMe && <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-extrabold text-blue-700">You</span>}
                            </div>
                            <div className="text-[10px] text-slate-400 sm:hidden">{user.email || "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-100 hidden sm:table-cell text-slate-700">{user.email || "—"}</td>
                      <td className="px-3 py-1.5 border-r border-gray-100 hidden md:table-cell text-slate-700">{user.phoneNumber || "—"}</td>
                      <td className="px-3 py-1.5 border-r border-gray-100 hidden lg:table-cell">
                        <span className="inline-flex rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                          {user.profile || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-100 hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {modules.length === 0 ? (
                            <span className="text-[10px] text-slate-400">None</span>
                          ) : (
                            modules.slice(0, 3).map((m) => (
                              <span key={m} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">
                                {MODULE_SHORT[m] || m}
                              </span>
                            ))
                          )}
                          {modules.length > 3 && (
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">+{modules.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-100">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black ${status.cls}`}>
                          {status.label === "Active"   && <FaCheckCircle className="text-[9px]" />}
                          {status.label === "Locked"   && <FaLock className="text-[9px]" />}
                          {status.label === "Inactive" && <FaBan className="text-[9px]" />}
                          {status.label}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => navigate(`/users/${user._id}/edit`, { state: { returnTo: "/users" } })}
                            title="Edit user"
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                          >
                            <FaUserEdit className="text-[11px]" />
                          </button>
                          <div className="relative" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setActionMenuId(actionMenuId === user._id ? null : user._id)}
                              title="More actions"
                              className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                            >
                              <FaEllipsisV className="text-[11px]" />
                            </button>
                            {actionMenuId === user._id && (
                              <div className="absolute right-0 top-full z-50 mt-1 w-44 border border-slate-200 bg-white shadow-lg">
                                <button
                                  onClick={() => handleToggleLock(user)}
                                  disabled={busy}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  {user.locked ? <FaUnlock className="text-amber-500" /> : <FaLock className="text-amber-500" />}
                                  {user.locked ? "Unlock user" : "Lock user"}
                                </button>
                                {!isMe && (
                                  <button
                                    onClick={() => handleToggleActive(user)}
                                    disabled={busy}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    {user.isActive === false
                                      ? <><FaCheckCircle className="text-emerald-500" /> Activate user</>
                                      : <><FaBan className="text-red-500" /> Deactivate user</>}
                                  </button>
                                )}
                                <div className="mx-2 border-t border-gray-100" />
                                <button
                                  onClick={() => { navigate(`/users/${user._id}/edit`, { state: { returnTo: "/users" } }); setActionMenuId(null); }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  <FaShieldAlt className="text-[#0B3B2E]" /> Edit permissions
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <PaginationBar page={page} pages={totalPages} total={filtered.length} onPageChange={setPage} />
        )}

      </div>
    </DashboardLayout>
  );
}

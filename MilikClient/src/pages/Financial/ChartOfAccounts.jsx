import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  FaBook,
  FaSearch,
  FaLayerGroup,
  FaPlus,
  FaEdit,
  FaTrash,
  FaSyncAlt,
  FaFolderOpen,
  FaCheckSquare,
  FaSquare,
} from "react-icons/fa";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getChartOfAccounts } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";
import { hasCompanyPermission } from "../../utils/permissions";
import { useConfirm } from "../../context/ConfirmContext";

const ACCOUNT_GROUPS = [
  {
    key: "assets",
    label: "Assets",
    color: "bg-emerald-50 border-emerald-200",
    tag: "text-emerald-700 bg-emerald-100",
  },
  {
    key: "liabilities",
    label: "Liabilities",
    color: "bg-rose-50 border-rose-200",
    tag: "text-rose-700 bg-rose-100",
  },
  {
    key: "equity",
    label: "Equity",
    color: "bg-violet-50 border-violet-200",
    tag: "text-violet-700 bg-violet-100",
  },
  {
    key: "income",
    label: "Income",
    color: "bg-blue-50 border-blue-200",
    tag: "text-blue-700 bg-blue-100",
  },
  {
    key: "expenses",
    label: "Expenses",
    color: "bg-amber-50 border-amber-200",
    tag: "text-amber-700 bg-amber-100",
  },
];

const SUBGROUP_OPTIONS_BY_TYPE = {
  asset: [
    "Cashbooks",
    "Bank Accounts",
    "Current Assets",
    "Fixed Assets",
    "Receivables",
    "Other Assets",
  ],
  liability: [
    "Current Liabilities",
    "Long-term Liabilities",
    "Payables",
    "Control Accounts",
    "Other Liabilities",
  ],
  equity: ["Equity", "Capital", "Retained Earnings", "Reserves", "Other Equity"],
  income: [
    "Operating Income",
    "Rental Income",
    "Commission Income",
    "Other Income",
  ],
  expense: [
    "Operating Expenses",
    "Administrative Expenses",
    "Property Expenses",
    "Finance Costs",
    "Other Expenses",
  ],
};

const NORMAL_BALANCE_BY_TYPE = {
  asset: "Debit",
  expense: "Debit",
  liability: "Credit",
  equity: "Credit",
  income: "Credit",
};

const blankForm = {
  code: "",
  name: "",
  type: "asset",
  group: "assets",
  subGroup: "Cashbooks",
  parentAccount: "",
  isHeader: false,
  isPosting: true,
};

const normalizeGroup = (value = "", type = "") => {
  const v = String(value || "").toLowerCase();
  if (["assets", "liabilities", "equity", "income", "expenses"].includes(v)) return v;

  const t = String(type || "").toLowerCase();
  if (t === "asset") return "assets";
  if (t === "liability") return "liabilities";
  if (t === "equity") return "equity";
  if (t === "income") return "income";
  if (t === "expense") return "expenses";
  return "assets";
};

const subGroupOptionsForType = (type = "") => {
  const t = String(type || "").toLowerCase();
  return SUBGROUP_OPTIONS_BY_TYPE[t] || [];
};

const typeLabel = (type = "") => {
  const t = String(type || "").toLowerCase();
  if (!t) return "-";
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const classLabel = (account) => {
  if (account?.subGroup) return account.subGroup;
  const type = String(account?.type || "").toLowerCase();
  if (type === "asset") return "Current Assets";
  if (type === "liability") return "Current Liabilities";
  if (type === "equity") return "Equity";
  if (type === "income") return "Operating Income";
  if (type === "expense") return "Operating Expenses";
  return "-";
};

const formatMoney = (value) => {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(amount);
};

const MODULE_SCOPE_OPTIONS = [
  { value: "",                 label: "All Modules" },
  { value: "hr",               label: "HR & Payroll" },
  { value: "propertyManagement", label: "Property Management" },
  { value: "carwash",          label: "Car Wash" },
  { value: "general",          label: "General" },
];

const ChartOfAccounts = () => {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const activityBase = location.pathname.startsWith("/carwash/")  ? "/carwash/chart-of-accounts"
    : location.pathname.startsWith("/hr/")       ? "/hr/chart-of-accounts"
    : location.pathname.startsWith("/sale/")     ? "/sale/chart-of-accounts"
    : location.pathname.startsWith("/accounts/") ? "/accounts/chart-of-accounts"
    : "/financial/chart-of-accounts";
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const canCreateCOA = hasCompanyPermission(currentUser, currentCompany, "chartOfAccounts", "create", "accounts");
  const canUpdateCOA = hasCompanyPermission(currentUser, currentCompany, "chartOfAccounts", "update", "accounts");
  const canDeleteCOA = hasCompanyPermission(currentUser, currentCompany, "chartOfAccounts", "delete", "accounts");

  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState("");
  const [moduleScope, setModuleScope] = useState(() => searchParams.get("scope") || "");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showControlAccounts, setShowControlAccounts] = useState(false);

  const [selectedIds, setSelectedIds] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [formData, setFormData] = useState(blankForm);
  const requestSequenceRef = useRef(0);

  const _uid = currentUser?._id || currentUser?.id;
  const _coaDraftKey = (currentCompany?._id && _uid) ? `milik:draft:coa-account:${currentCompany._id}:${_uid}` : null;
  const _coaDraftRestored = useRef(false);

  useEffect(() => {
    if (!_coaDraftKey || _coaDraftRestored.current) return;
    _coaDraftRestored.current = true;
    try {
      const raw = window.sessionStorage.getItem(_coaDraftKey);
      if (raw) { const { form: s } = JSON.parse(raw); if (s) { setFormData(s); setShowForm(true); } }
    } catch {}
  }, [_coaDraftKey]);

  useEffect(() => {
    if (!_coaDraftKey || !_coaDraftRestored.current || !showForm || editingAccountId) return;
    try { window.sessionStorage.setItem(_coaDraftKey, JSON.stringify({ form: formData })); } catch {}
  }, [_coaDraftKey, formData, showForm, editingAccountId]);

  const businessId = currentCompany?._id || "";

  const loadAccounts = async () => {
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;

    setAccounts([]);
    setSelectedIds([]);
    setShowForm(false);
    setEditingAccountId(null);

    if (!businessId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params = { business: businessId };
      if (moduleScope) params.moduleScope = moduleScope;
      const rows = await getChartOfAccounts(params);
      if (requestSequenceRef.current !== requestId) return;
      setAccounts(Array.isArray(rows) ? rows : []);
    } catch (error) {
      if (requestSequenceRef.current !== requestId) return;
      console.error("Failed to load chart of accounts", error);
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error?.message ||
          "Failed to load chart of accounts"
      );
      setAccounts([]);
    } finally {
      if (requestSequenceRef.current === requestId) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadAccounts();
  }, [businessId, moduleScope]);

  useEffect(() => {
    const handleRefresh = () => loadAccounts();
    window.addEventListener("invoicesUpdated", handleRefresh);
    return () => window.removeEventListener("invoicesUpdated", handleRefresh);
  }, [businessId]);

  const normalizedSearch = search.trim().toLowerCase();

  const filteredAccounts = useMemo(() => {
    return accounts.filter((account) => {
      const isControlAccount =
        String(account?.subGroup || "").toLowerCase().includes("control") ||
        String(account?.name || "").toLowerCase().includes("control") ||
        String(account?.code || "").toLowerCase().includes("ctrl");

      if (!showControlAccounts && isControlAccount) return false;
      if (!normalizedSearch) return true;

      const haystack = [
        account.code,
        account.name,
        account.type,
        account.group,
        account.subGroup,
        account.normalBalanceSide,
        account.parentAccount?.name,
        account.parentAccount?.code,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [accounts, normalizedSearch, showControlAccounts]);

  const groupedAccounts = useMemo(() => {
    return ACCOUNT_GROUPS.map((group) => ({
      ...group,
      accounts: filteredAccounts
        .filter((account) => normalizeGroup(account.group, account.type) === group.key)
        .sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""))),
    }));
  }, [filteredAccounts]);

  const parentOptions = useMemo(() => {
    return accounts
      .slice()
      .sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));
  }, [accounts]);

  const parentAccountForForm = useMemo(() => {
    return parentOptions.find((a) => String(a._id) === String(formData.parentAccount || ""));
  }, [parentOptions, formData.parentAccount]);

  const effectiveType = parentAccountForForm?.type || formData.type;
  const effectiveGroup = parentAccountForForm?.group || normalizeGroup(formData.group, effectiveType);
  const currentSubGroupOptions = subGroupOptionsForType(effectiveType);

  const totalAccounts = accounts.length;
  const totalBalance = accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);

  const selectedAccounts = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    return accounts.filter((account) => selectedSet.has(account._id));
  }, [accounts, selectedIds]);

  const openCreateModal = () => {
    if (!canCreateCOA) { toast.warning("You do not have permission to create chart of accounts entries."); return; }
    setEditingAccountId(null);
    setFormData(blankForm);
    setShowForm(true);
  };

  const openEditModal = () => {
    if (selectedAccounts.length !== 1) {
      toast.info("Select one account to edit.");
      return;
    }
    if (!canUpdateCOA) { toast.warning("You do not have permission to edit chart of accounts entries."); return; }

    const account = selectedAccounts[0];
    setEditingAccountId(account._id);
    setFormData({
      code: account.code || "",
      name: account.name || "",
      type: account.type || "asset",
      group: normalizeGroup(account.group, account.type),
      subGroup: account.subGroup || subGroupOptionsForType(account.type)[0] || "",
      parentAccount: account.parentAccount?._id || account.parentAccount || "",
      isHeader: Boolean(account.isHeader),
      isPosting: account.isHeader ? false : account.isPosting !== false,
    });
    setShowForm(true);
  };

  const closeModal = () => {
    if (_coaDraftKey) { try { window.sessionStorage.removeItem(_coaDraftKey); } catch {} }
    setShowForm(false);
    setEditingAccountId(null);
    setFormData(blankForm);
  };

  const toggleSelect = (accountId) => {
    setSelectedIds((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
    );
  };

  const toggleSelectAllInGroup = (groupAccounts) => {
    const ids = groupAccounts.map((a) => a._id);
    const allSelected = ids.every((id) => selectedIds.includes(id));

    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
    }
  };

  const handleTypeChange = (nextType) => {
    const options = subGroupOptionsForType(nextType);
    setFormData((prev) => ({
      ...prev,
      type: nextType,
      group: normalizeGroup("", nextType),
      subGroup: options[0] || "",
    }));
  };

  const handleParentChange = (parentId) => {
    const parent = parentOptions.find((account) => String(account._id) === String(parentId));
    if (!parent) {
      setFormData((prev) => ({
        ...prev,
        parentAccount: "",
      }));
      return;
    }

    const inheritedOptions = subGroupOptionsForType(parent.type);
    setFormData((prev) => ({
      ...prev,
      parentAccount: parentId,
      type: parent.type,
      group: normalizeGroup(parent.group, parent.type),
      subGroup: parent.subGroup || inheritedOptions[0] || "",
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!businessId) {
      toast.error("Select a company first.");
      return;
    }

    if (!formData.code.trim() || !formData.name.trim() || !effectiveType) {
      toast.error("Code, account name and type are required.");
      return;
    }

    const payload = {
      business: businessId,
      code: formData.code.trim().toUpperCase(),
      name: formData.name.trim(),
      type: effectiveType,
      group: effectiveGroup,
      subGroup:
        formData.subGroup.trim() || currentSubGroupOptions[0] || "",
      parentAccount: formData.parentAccount || null,
      isHeader: Boolean(formData.isHeader),
      isPosting: formData.isHeader ? false : Boolean(formData.isPosting),
    };

    setSaving(true);
    try {
      if (editingAccountId) {
        await adminRequests.put(`/chart-of-accounts/${editingAccountId}`, payload);
        toast.success("Account updated successfully.");
      } else {
        await adminRequests.post("/chart-of-accounts", payload);
        toast.success("Account created successfully.");
      }

      closeModal();
      setSelectedIds([]);
      await loadAccounts();
    } catch (error) {
      console.error("Failed to save chart account", error);
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error?.message ||
          "Failed to save chart account"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedAccounts.length === 0) {
      toast.info("Select at least one account to delete.");
      return;
    }
    if (!canDeleteCOA) { toast.warning("You do not have permission to delete chart of accounts entries."); return; }
    const names = selectedAccounts.map((a) => `${a.code} ${a.name}`).join(", ");
    const confirmed = await confirm({ title: "Delete Accounts", message: `Delete the following account(s)? ${names}`, confirmText: "Delete", isDangerous: true });
    if (!confirmed) return;

    setSaving(true);
    try {
      await Promise.all(
        selectedAccounts.map((account) =>
          adminRequests.delete(`/chart-of-accounts/${account._id}`, { data: { business: businessId } })
        )
      );

      toast.success("Selected account(s) deleted.");
      setSelectedIds([]);
      await loadAccounts();
    } catch (error) {
      console.error("Failed to delete chart account", error);
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error?.message ||
          "Failed to delete chart account"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="flex min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex-none sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
              <div className="relative shrink-0">
                <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Code, account name, type, class, subgroup"
                  className="h-7 w-56 rounded border border-slate-200 bg-white pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                />
              </div>
              <select
                value={moduleScope}
                onChange={(e) => setModuleScope(e.target.value)}
                className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                title="Filter by module"
              >
                {MODULE_SCOPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <label className="h-7 shrink-0 flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={showControlAccounts}
                  onChange={(e) => setShowControlAccounts(e.target.checked)}
                  className="rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
                />
                Control Accounts
              </label>
              <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                <FaFolderOpen className="inline mr-1 text-[#0B3B2E]" />{selectedAccounts.length} selected
              </span>
              <button onClick={loadAccounts} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><FaSyncAlt size={9} /></button>
              <button onClick={openCreateModal} disabled={!canCreateCOA} className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#FF8C00] px-2.5 text-xs font-semibold text-white hover:bg-[#e67e00] disabled:cursor-not-allowed disabled:bg-slate-300"><FaPlus size={9} /> Add Account</button>
              <button onClick={openEditModal} disabled={selectedAccounts.length !== 1 || !canUpdateCOA} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 ${selectedAccounts.length === 1 && canUpdateCOA ? "bg-amber-500 hover:bg-amber-600" : "bg-slate-300"}`}><FaEdit size={9} /> Edit</button>
              <button onClick={handleDeleteSelected} disabled={selectedAccounts.length === 0 || !canDeleteCOA} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 ${selectedAccounts.length > 0 && canDeleteCOA ? "bg-rose-600 hover:bg-rose-700" : "bg-slate-300"}`}><FaTrash size={9} /> Delete</button>
            </div>
          </div>

          {loading && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-800">
              Loading chart of accounts...
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto p-2">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            {groupedAccounts.map((group) => {
              const groupIds = group.accounts.map((a) => a._id);
              const allGroupSelected =
                groupIds.length > 0 && groupIds.every((id) => selectedIds.includes(id));

              return (
                <div key={group.key} className={`rounded-xl border ${group.color} overflow-hidden`}>
                  <div className="px-3 py-1.5 border-b border-slate-200 flex items-center justify-between bg-white/70">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleSelectAllInGroup(group.accounts)}
                        className="text-slate-700 hover:text-slate-900"
                        title="Select group"
                      >
                        {allGroupSelected ? <FaCheckSquare /> : <FaSquare />}
                      </button>
                      <div className="font-bold text-slate-900">{group.label}</div>
                    </div>

                    <span className={`text-xs px-2 py-1 rounded-full font-semibold ${group.tag}`}>
                      {group.accounts.length} accounts
                    </span>
                  </div>

                  <div className="overflow-x-auto bg-white">
                    <table className="w-full min-w-[860px] text-xs">
                      <thead className="bg-[#0B3B2E] text-white">
                        <tr>
                          <th className="text-left px-3 py-1.5 w-[44px]"></th>
                          <th className="text-left px-3 py-1.5">Code</th>
                          <th className="text-left px-3 py-1.5">Account Name</th>
                          <th className="text-left px-3 py-1.5">Type</th>
                          <th className="text-left px-3 py-1.5">Class</th>
                          <th className="text-left px-3 py-1.5">Normal Side</th>
                          <th className="text-right px-3 py-1.5">Balance</th>
                          <th className="text-right px-3 py-1.5">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.accounts.length === 0 ? (
                          <tr>
                            <td colSpan="8" className="px-3 py-6 text-center text-slate-500">
                              No accounts found.
                            </td>
                          </tr>
                        ) : (
                          group.accounts.map((account) => {
                            const selected = selectedIds.includes(account._id);
                            return (
                              <tr
                                key={account._id}
                                className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                                onDoubleClick={() => {
                                  if (account?.isPosting !== false && !account?.isHeader) {
                                    navigate(`${activityBase}/${account._id}/activity`);
                                  }
                                }}
                                title={account?.isPosting !== false && !account?.isHeader ? "Double-click to open ledger activity" : "Header accounts cannot open activity"}
                              >
                                <td className="px-3 py-1.5">
                                  <button
                                    onClick={() => toggleSelect(account._id)}
                                    className="text-slate-700 hover:text-slate-900"
                                  >
                                    {selected ? <FaCheckSquare /> : <FaSquare />}
                                  </button>
                                </td>
                                <td className="px-3 py-1.5 font-mono text-slate-900">{account.code}</td>
                                <td className="px-3 py-1.5">
                                  <div
                                    className="font-medium text-slate-900"
                                    style={{ paddingLeft: `${Number(account.level || 0) * 18}px` }}
                                  >
                                    {account.name}
                                  </div>
                                </td>
                                <td className="px-3 py-1.5 text-slate-700">{typeLabel(account.type)}</td>
                                <td className="px-3 py-1.5 text-slate-600">{classLabel(account)}</td>
                                <td className="px-3 py-1.5 text-slate-600">
                                  {account.normalBalanceSide || NORMAL_BALANCE_BY_TYPE[account.type] || "-"}
                                </td>
                                <td className="px-3 py-1.5 text-right font-semibold text-slate-900">
                                  {formatMoney(account.balance || 0)}
                                </td>
                                <td className="px-3 py-1.5 text-right">
                                  <div className="inline-flex gap-2 flex-wrap justify-end">
                                    {account.isSystem && (
                                      <span className="inline-flex text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">
                                        System
                                      </span>
                                    )}
                                    {account.isHeader ? (
                                      <span className="inline-flex text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">
                                        Header
                                      </span>
                                    ) : (
                                      <span className="inline-flex text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">
                                        Posting
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {showForm && (
          <div className="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white">
              <div className="bg-[#0B3B2E] px-6 py-4 text-white">
                <h3 className="text-lg font-bold">
                  {editingAccountId ? "Edit Chart Account" : "Add Chart Account"}
                </h3>
                <p className="text-sm text-emerald-100 mt-1">
                  Maintain your MILIK chart structure with clean parent-child account setup.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Account Code</span>
                    <input
                      value={formData.code}
                      onChange={(e) => setFormData((prev) => ({ ...prev, code: e.target.value }))}
                      className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]"
                      placeholder="e.g. 1115"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Account Name</span>
                    <input
                      value={formData.name}
                      onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                      className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]"
                      placeholder="e.g. Agency Float Collections"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Type</span>
                    <select
                      value={effectiveType}
                      disabled={Boolean(parentAccountForForm)}
                      onChange={(e) => handleTypeChange(e.target.value)}
                      className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0B3B2E] disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      <option value="asset">Asset</option>
                      <option value="liability">Liability</option>
                      <option value="equity">Equity</option>
                      <option value="income">Income</option>
                      <option value="expense">Expense</option>
                    </select>
                    {parentAccountForForm && (
                      <p className="mt-1 text-xs text-slate-500">
                        Type is inherited from the selected parent account.
                      </p>
                    )}
                  </label>

                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Group</span>
                    <input
                      value={effectiveGroup}
                      disabled
                      className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-slate-100 text-slate-600 focus:outline-none"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Normal Balance Side</span>
                    <input
                      value={NORMAL_BALANCE_BY_TYPE[effectiveType] || ""}
                      disabled
                      className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-slate-100 text-slate-600 focus:outline-none"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Account Class</span>
                    <select
                      value={formData.subGroup}
                      onChange={(e) => setFormData((prev) => ({ ...prev, subGroup: e.target.value }))}
                      className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]"
                    >
                      {currentSubGroupOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Parent Account</span>
                    <select
                      value={formData.parentAccount}
                      onChange={(e) => handleParentChange(e.target.value)}
                      className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]"
                    >
                      <option value="">None</option>
                      {parentOptions
                        .filter((account) => account._id !== editingAccountId)
                        .map((account) => (
                          <option key={account._id} value={account._id}>
                            {account.code} - {account.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex items-center justify-between rounded-xl border border-slate-300 px-3 py-1.5">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Header Account</div>
                      <div className="text-xs text-slate-500">Use for grouping children, not direct posting.</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={formData.isHeader}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          isHeader: e.target.checked,
                          isPosting: e.target.checked ? false : prev.isPosting,
                        }))
                      }
                    />
                  </label>

                  <label className="flex items-center justify-between rounded-xl border border-slate-300 px-3 py-1.5">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Posting Account</div>
                      <div className="text-xs text-slate-500">Receives ledger entries directly.</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={formData.isPosting}
                      disabled={formData.isHeader}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          isPosting: e.target.checked,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 rounded-xl bg-[#FF8C00] hover:bg-[#e67e00] text-white font-semibold shadow-sm disabled:opacity-60"
                  >
                    {saving ? "Saving..." : editingAccountId ? "Save Changes" : "Create Account"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
      </div>
    </DashboardLayout>
  );
};

export default ChartOfAccounts;
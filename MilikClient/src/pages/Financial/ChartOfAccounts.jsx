import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  FaSearch, FaPlus, FaEdit, FaTrash, FaSyncAlt,
  FaChevronDown, FaChevronUp, FaCheckSquare, FaSquare,
  FaExclamationTriangle, FaTimes,
} from "react-icons/fa";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import { getChartOfAccounts } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";
import { hasCompanyPermission } from "../../utils/permissions";
import { useConfirm } from "../../context/ConfirmContext";

const ACCOUNT_GROUPS = [
  { key: "assets",      label: "Assets",      bg: "bg-[#0B3B2E]",  badge: "bg-emerald-100 text-emerald-800" },
  { key: "liabilities", label: "Liabilities", bg: "bg-rose-900",   badge: "bg-rose-100 text-rose-800" },
  { key: "equity",      label: "Equity",      bg: "bg-violet-900", badge: "bg-violet-100 text-violet-800" },
  { key: "income",      label: "Income",      bg: "bg-blue-900",   badge: "bg-blue-100 text-blue-800" },
  { key: "expenses",    label: "Expenses",    bg: "bg-amber-900",  badge: "bg-amber-100 text-amber-800" },
];

const SUBGROUP_OPTIONS_BY_TYPE = {
  asset:     ["Cashbooks", "Bank Accounts", "Current Assets", "Fixed Assets", "Receivables", "Other Assets"],
  liability: ["Current Liabilities", "Long-term Liabilities", "Payables", "Tax Liabilities", "Other Liabilities"],
  equity:    ["Capital", "Retained Earnings", "Reserves", "Other Equity"],
  income:    ["Sales Revenue", "Operating Revenue", "Service Revenue", "Commission & Fees", "Other Income"],
  expense:   ["Cost of Revenue", "Inventory Adjustments", "Cost of Sales", "Operating Expenses", "Administrative Expenses", "Finance Costs", "Other Expenses"],
};

const NORMAL_BALANCE_BY_TYPE = {
  asset: "Debit", expense: "Debit",
  liability: "Credit", equity: "Credit", income: "Credit",
};

const TYPE_OPTIONS = [
  { value: "asset",     label: "Asset" },
  { value: "liability", label: "Liability" },
  { value: "equity",    label: "Equity" },
  { value: "income",    label: "Income" },
  { value: "expense",   label: "Expense" },
];

const MODULE_SCOPE_OPTIONS = [
  { value: "",                   label: "All Modules" },
  { value: "hr",                 label: "HR & Payroll" },
  { value: "propertyManagement", label: "Property Management" },
  { value: "carwash",            label: "Car Wash" },
  { value: "general",            label: "General" },
];

const GROUP_TO_TYPE = {
  assets: "asset", liabilities: "liability", equity: "equity",
  income: "income", expenses: "expense",
};

const blankForm = {
  code: "", name: "", type: "asset", group: "assets",
  subGroup: "Cashbooks", parentAccount: "", isHeader: false, isPosting: true,
};

const normalizeGroup = (value = "", type = "") => {
  const v = String(value || "").toLowerCase();
  if (["assets", "liabilities", "equity", "income", "expenses"].includes(v)) return v;
  const t = String(type || "").toLowerCase();
  if (t === "asset")     return "assets";
  if (t === "liability") return "liabilities";
  if (t === "equity")    return "equity";
  if (t === "income")    return "income";
  if (t === "expense")   return "expenses";
  return "assets";
};

const subGroupOptionsForType = (type = "") =>
  SUBGROUP_OPTIONS_BY_TYPE[String(type || "").toLowerCase()] || [];

const classLabel = (account) => {
  if (account?.subGroup) return account.subGroup;
  const t = String(account?.type || "").toLowerCase();
  if (t === "asset")     return "Current Assets";
  if (t === "liability") return "Current Liabilities";
  if (t === "equity")    return "Equity";
  if (t === "income")    return "Operating Income";
  if (t === "expense")   return "Operating Expenses";
  return "Other";
};

const formatMoney = (value) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(Number(value || 0));

// ─────────────────────────────────────────────
const ChartOfAccounts = () => {
  const confirm    = useConfirm();
  const navigate   = useNavigate();
  const location   = useLocation();
  const [searchParams] = useSearchParams();

  const activityBase =
    location.pathname.startsWith("/carwash/")  ? "/carwash/chart-of-accounts"
    : location.pathname.startsWith("/hr/")     ? "/hr/chart-of-accounts"
    : location.pathname.startsWith("/sale/")   ? "/sale/chart-of-accounts"
    : location.pathname.startsWith("/accounts/") ? "/accounts/chart-of-accounts"
    : "/financial/chart-of-accounts";

  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser    = useSelector(selectCurrentUser);
  const { canCreateCOA, canUpdateCOA, canDeleteCOA } = useMemo(() => ({
    canCreateCOA: hasCompanyPermission(currentUser, currentCompany, "chartOfAccounts", "create", "accounts"),
    canUpdateCOA: hasCompanyPermission(currentUser, currentCompany, "chartOfAccounts", "update", "accounts"),
    canDeleteCOA: hasCompanyPermission(currentUser, currentCompany, "chartOfAccounts", "delete", "accounts"),
  }), [currentUser, currentCompany]);

  const [accounts,            setAccounts]          = useState([]);
  const [search,              setSearch]            = useTabState(`${activityBase}:search`, "");
  const [searchInput,         setSearchInput]       = useState(search);
  const [moduleScope,         setModuleScope]       = useState(() => searchParams.get("scope") || "");
  const [loading,             setLoading]           = useState(false);
  const [refreshing,          setRefreshing]        = useState(false);
  const [saving,              setSaving]            = useState(false);
  const [showControlAccounts, setShowControlAccounts] = useState(true);
  const [selectedIds,         setSelectedIds]       = useState([]);
  const [showForm,            setShowForm]          = useState(false);
  const [editingAccountId,    setEditingAccountId]  = useState(null);
  const [formData,            setFormData]          = useState(blankForm);
  const [collapsed,           setCollapsed]         = useState({});
  const requestSequenceRef = useRef(0);
  const hasLoadedOnce      = useRef(false);

  // ── Draft persistence ──
  const _uid         = currentUser?._id || currentUser?.id;
  const _coaDraftKey = (currentCompany?._id && _uid)
    ? `milik:draft:coa-account:${currentCompany._id}:${_uid}`
    : null;
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

  // ── Search debounce ──
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Data loading ──
  const businessId = currentCompany?._id || "";

  const loadAccounts = useCallback(async () => {
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    setSelectedIds([]);
    if (!businessId) { setLoading(false); return; }
    if (!hasLoadedOnce.current) setLoading(true);
    setRefreshing(true);
    try {
      const params = { business: businessId };
      if (moduleScope) params.moduleScope = moduleScope;
      const rows = await getChartOfAccounts(params);
      if (requestSequenceRef.current !== requestId) return;
      setAccounts(Array.isArray(rows) ? rows : []);
      hasLoadedOnce.current = true;
    } catch (error) {
      if (requestSequenceRef.current !== requestId) return;
      toast.error(
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        "Failed to load chart of accounts"
      );
      if (!hasLoadedOnce.current) setAccounts([]);
    } finally {
      if (requestSequenceRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [businessId, moduleScope]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  useEffect(() => {
    const handleRefresh = () => loadAccounts();
    window.addEventListener("invoicesUpdated", handleRefresh);
    return () => window.removeEventListener("invoicesUpdated", handleRefresh);
  }, [businessId, loadAccounts]);

  // ── Filtering ──
  const normalizedSearch = search.trim().toLowerCase();

  const filteredAccounts = useMemo(() => accounts.filter((account) => {
    const isControl =
      String(account?.subGroup || "").toLowerCase().includes("control") ||
      String(account?.name    || "").toLowerCase().includes("control") ||
      String(account?.code    || "").toLowerCase().includes("ctrl");
    if (!showControlAccounts && isControl) return false;
    if (!normalizedSearch) return true;
    const haystack = [
      account.code, account.name, account.type, account.group, account.subGroup,
      account.normalBalanceSide, account.parentAccount?.name, account.parentAccount?.code,
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(normalizedSearch);
  }), [accounts, normalizedSearch, showControlAccounts]);

  // ── Grouping: by type → by class (all predefined subgroups always visible) ──
  const typeGroups = useMemo(() => {
    return ACCOUNT_GROUPS.map((group) => {
      const groupType = GROUP_TO_TYPE[group.key] || "asset";
      const allSubgroups = subGroupOptionsForType(groupType);

      const typeAccounts = filteredAccounts
        .filter((a) => normalizeGroup(a.group, a.type) === group.key)
        .sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));

      // Seed classMap with ALL predefined subgroups in correct order
      const classMap = new Map(allSubgroups.map((sg) => [sg, []]));
      for (const acc of typeAccounts) {
        const cls = classLabel(acc);
        if (!classMap.has(cls)) classMap.set(cls, []);
        classMap.get(cls).push(acc);
      }

      const classes = [...classMap.entries()]
        // Hide empty classes only when searching (empty = no matching results)
        .filter(([, accs]) => !normalizedSearch || accs.length > 0)
        .map(([cls, accs]) => ({ cls, accounts: accs, isEmpty: accs.length === 0 }));

      const totalBalance = typeAccounts.reduce((s, a) => s + Number(a.balance || 0), 0);
      return { ...group, classes, count: typeAccounts.length, totalBalance, groupType };
    });
  }, [filteredAccounts, normalizedSearch]);

  // ── Form helpers ──
  const parentOptions = useMemo(() =>
    accounts.slice().sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""))),
    [accounts]
  );

  const filteredParentOptions = useMemo(
    () => parentOptions.filter((a) => a._id !== editingAccountId).map((a) => ({ value: a._id, label: `${a.code} — ${a.name}` })),
    [parentOptions, editingAccountId]
  );

  const parentAccountForForm = useMemo(() =>
    parentOptions.find((a) => String(a._id) === String(formData.parentAccount || "")),
    [parentOptions, formData.parentAccount]
  );

  const effectiveType         = parentAccountForForm?.type || formData.type;
  const effectiveGroup        = parentAccountForForm?.group || normalizeGroup(formData.group, effectiveType);
  const currentSubGroupOptions = useMemo(() => {
    const predefined = subGroupOptionsForType(effectiveType);
    const fromAccounts = accounts
      .filter((a) => String(a.type || "").toLowerCase() === effectiveType && a.subGroup)
      .map((a) => a.subGroup);
    return [...new Set([...predefined, ...fromAccounts])];
  }, [effectiveType, accounts]);

  const codeConflict = useMemo(() => {
    if (!formData.code.trim()) return false;
    const upper = formData.code.trim().toUpperCase();
    return accounts.some(
      (a) => a.code === upper && String(a._id) !== String(editingAccountId || "")
    );
  }, [accounts, formData.code, editingAccountId]);

  const selectedAccounts = useMemo(() => {
    const set = new Set(selectedIds);
    return accounts.filter((a) => set.has(a._id));
  }, [accounts, selectedIds]);

  // ── Actions ──
  const openCreateModal = (preset = {}) => {
    if (!canCreateCOA) { toast.warning("No permission to create accounts."); return; }
    setEditingAccountId(null);
    const type = preset.type || "asset";
    setFormData({
      ...blankForm,
      type,
      group:    normalizeGroup("", type),
      subGroup: preset.subGroup || subGroupOptionsForType(type)[0] || "Cashbooks",
    });
    setShowForm(true);
  };

  const openEditModal = (account) => {
    if (!canUpdateCOA) { toast.warning("No permission to edit accounts."); return; }
    setEditingAccountId(account._id);
    setFormData({
      code:          account.code || "",
      name:          account.name || "",
      type:          account.type || "asset",
      group:         normalizeGroup(account.group, account.type),
      subGroup:      account.subGroup || subGroupOptionsForType(account.type)[0] || "",
      parentAccount: account.parentAccount?._id || account.parentAccount || "",
      isHeader:      Boolean(account.isHeader),
      isPosting:     account.isHeader ? false : account.isPosting !== false,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    if (_coaDraftKey) { try { window.sessionStorage.removeItem(_coaDraftKey); } catch {} }
    setShowForm(false);
    setEditingAccountId(null);
    setFormData(blankForm);
  };

  const toggleSelect = (id) =>
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const toggleSelectGroup = (accs) => {
    const ids    = accs.map((a) => a._id);
    const allSel = ids.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) =>
      allSel ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids]))
    );
  };

  const handleTypeChange = (nextType) => {
    const options = subGroupOptionsForType(nextType);
    setFormData((prev) => ({
      ...prev, type: nextType, group: normalizeGroup("", nextType), subGroup: options[0] || "",
    }));
  };

  const handleParentChange = (parentId) => {
    const parent = parentOptions.find((a) => String(a._id) === String(parentId));
    if (!parent) { setFormData((prev) => ({ ...prev, parentAccount: "" })); return; }
    const inheritedOptions = subGroupOptionsForType(parent.type);
    setFormData((prev) => ({
      ...prev,
      parentAccount: parentId,
      type:    parent.type,
      group:   normalizeGroup(parent.group, parent.type),
      subGroup: parent.subGroup || inheritedOptions[0] || "",
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!businessId)                           { toast.error("Select a company first.");           return; }
    if (!formData.code.trim() || !formData.name.trim() || !effectiveType)
                                               { toast.error("Code, name and type are required."); return; }
    if (codeConflict)                          { toast.error("Code already in use — choose another."); return; }

    const payload = {
      business:      businessId,
      code:          formData.code.trim().toUpperCase(),
      name:          formData.name.trim(),
      type:          effectiveType,
      group:         effectiveGroup,
      subGroup:      formData.subGroup.trim() || currentSubGroupOptions[0] || "",
      parentAccount: formData.parentAccount || null,
      isHeader:      Boolean(formData.isHeader),
      isPosting:     formData.isHeader ? false : Boolean(formData.isPosting),
    };

    setSaving(true);
    try {
      if (editingAccountId) {
        await adminRequests.put(`/chart-of-accounts/${editingAccountId}`, payload);
        toast.success("Account updated.");
      } else {
        await adminRequests.post("/chart-of-accounts", payload);
        toast.success("Account created.");
      }
      closeForm();
      setSelectedIds([]);
      await loadAccounts();
    } catch (error) {
      toast.error(
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        "Failed to save account"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (!selectedAccounts.length) { toast.info("Select accounts to delete."); return; }
    if (!canDeleteCOA)            { toast.warning("No permission to delete accounts."); return; }
    const names = selectedAccounts.map((a) => `${a.code} ${a.name}`).join(", ");
    const ok = await confirm({
      title: "Delete Accounts", message: `Delete: ${names}?`, confirmText: "Delete", isDangerous: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await Promise.all(
        selectedAccounts.map((a) =>
          adminRequests.delete(`/chart-of-accounts/${a._id}`, { data: { business: businessId } })
        )
      );
      toast.success("Deleted successfully.");
      setSelectedIds([]);
      await loadAccounts();
    } catch (error) {
      toast.error(
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        "Failed to delete"
      );
    } finally {
      setSaving(false);
    }
  };

  // ── Style shortcuts ──
  const labelCls = "mb-0.5 block text-xs font-semibold text-slate-700";
  const inputCls = "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";

  // ── Render ──
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden bg-slate-100">

        {/* ── Toolbar ── */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2 flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative">
            <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Code, name, type, class..."
              className="h-7 w-52 border border-slate-200 bg-slate-50 pl-6 pr-2 text-xs focus:outline-none focus:border-[#0B3B2E]"
            />
          </div>

          {/* Module scope */}
          <AppSelect
            size="sm"
            clearable
            placeholder="All Modules"
            value={moduleScope}
            onChange={(v) => setModuleScope(v ?? "")}
            options={MODULE_SCOPE_OPTIONS.filter((o) => o.value !== "").map((o) => ({ value: o.value, label: o.label }))}
          />

          {/* Control accounts */}
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showControlAccounts}
              onChange={(e) => setShowControlAccounts(e.target.checked)}
              className="text-[#0B3B2E]"
            />
            Control Accounts
          </label>

          {/* Right-side actions */}
          <div className="ml-auto flex items-center gap-1.5">
            {selectedIds.length > 0 && (
              <span className="text-[11px] font-semibold text-slate-500 px-1">
                {selectedIds.length} selected
              </span>
            )}
            <button
              onClick={loadAccounts}
              title="Refresh"
              className="h-7 px-2.5 border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 flex items-center text-xs"
            >
              <FaSyncAlt size={9} className={refreshing ? "animate-spin" : ""} />
            </button>
            {selectedAccounts.length === 1 && canUpdateCOA && (
              <button
                onClick={() => openEditModal(selectedAccounts[0])}
                className="h-7 px-3 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center gap-1"
              >
                <FaEdit size={9} /> Edit
              </button>
            )}
            {selectedAccounts.length > 0 && canDeleteCOA && (
              <button
                onClick={handleDeleteSelected}
                className="h-7 px-3 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1"
              >
                <FaTrash size={9} /> Delete
              </button>
            )}
            <button
              onClick={openCreateModal}
              disabled={!canCreateCOA}
              className="h-7 px-3 bg-[#FF8C00] hover:bg-[#e67e00] text-white text-xs font-bold flex items-center gap-1 disabled:opacity-50"
            >
              <FaPlus size={9} /> Add Account
            </button>
          </div>
        </div>

        {/* ── Body: list + form panel ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* ── Account list ── */}
          <div className="flex-1 overflow-auto p-3 space-y-2">
            {loading && (
              <p className="text-xs text-slate-500 px-1 py-2">Loading accounts...</p>
            )}

            {!loading && typeGroups.map((group) => {
              const isCollapsed = Boolean(collapsed[group.key]);
              const allGroupAccounts = group.classes.flatMap((c) => c.accounts);
              const allIds  = allGroupAccounts.map((a) => a._id);
              const allSel  = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));

              return (
                <div key={group.key} className="overflow-hidden border border-slate-200 shadow-sm">
                  {/* Type section header */}
                  <div className={`${group.bg} flex items-center gap-2.5 px-3 py-2`}>
                    <button
                      onClick={() => toggleSelectGroup(allGroupAccounts)}
                      className="text-white/50 hover:text-white shrink-0"
                    >
                      {allSel && allIds.length > 0
                        ? <FaCheckSquare size={12} />
                        : <FaSquare size={12} />
                      }
                    </button>
                    <span className="font-bold text-white text-sm">{group.label}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 ${group.badge}`}>
                      {group.count} {group.count === 1 ? "account" : "accounts"}
                    </span>
                    <span className="ml-auto text-xs font-bold text-white/80 tabular-nums">
                      {formatMoney(group.totalBalance)}
                    </span>
                    <button
                      onClick={() => setCollapsed((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                      className="text-white/60 hover:text-white ml-1 shrink-0"
                    >
                      {isCollapsed ? <FaChevronDown size={11} /> : <FaChevronUp size={11} />}
                    </button>
                  </div>

                  {/* Accounts table */}
                  {!isCollapsed && (
                    <div className="overflow-x-auto bg-white">
                      <table className="w-full min-w-[680px] text-[11px] border-collapse">
                        <thead>
                          <tr className="bg-[#0B3B2E] text-white">
                            <th className="w-10 px-3 py-1 border-r border-white/10"></th>
                            <th className="text-left px-3 py-1 font-bold border-r border-white/10">Code</th>
                            <th className="text-left px-3 py-1 font-bold border-r border-white/10">Account Name</th>
                            <th className="text-left px-3 py-1 font-bold border-r border-white/10">Normal Side</th>
                            <th className="text-right px-3 py-1 font-bold border-r border-white/10">Balance</th>
                            <th className="text-right px-3 py-1 font-bold">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.classes.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-3 py-6 text-center text-slate-400 italic text-xs">
                                No accounts in this category
                              </td>
                            </tr>
                          ) : (
                            group.classes.map((clsAcc) => (
                              <React.Fragment key={clsAcc.cls}>
                                {/* Class sub-header */}
                                <tr className="bg-slate-50 border-y border-slate-200 group/cls">
                                  <td colSpan={6} className="px-3 py-1">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                          {clsAcc.cls}
                                        </span>
                                        {!clsAcc.isEmpty && (
                                          <span className="text-[10px] text-slate-400">
                                            ({clsAcc.accounts.length})
                                          </span>
                                        )}
                                      </div>
                                      {canCreateCOA && (
                                        <button
                                          onClick={() => openCreateModal({ type: group.groupType, subGroup: clsAcc.cls })}
                                          className="flex items-center gap-0.5 text-[10px] font-semibold text-slate-400 hover:text-[#0B3B2E] opacity-0 group-hover/cls:opacity-100 transition-opacity"
                                          title={`Add account to ${clsAcc.cls}`}
                                        >
                                          <FaPlus size={7} /> Add
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>

                                {/* Empty class placeholder */}
                                {clsAcc.isEmpty && (
                                  <tr>
                                    <td colSpan={6} className="px-3 py-2 text-center">
                                      <button
                                        onClick={() => openCreateModal({ type: group.groupType, subGroup: clsAcc.cls })}
                                        className="text-[10px] italic text-slate-400 hover:text-[#0B3B2E] font-medium"
                                      >
                                        + Add first account in this class
                                      </button>
                                    </td>
                                  </tr>
                                )}

                                {/* Account rows */}
                                {clsAcc.accounts.map((account) => {
                                  const selected = selectedIds.includes(account._id);
                                  const balance  = Number(account.balance || 0);
                                  return (
                                    <tr
                                      key={account._id}
                                      className={`border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer transition-colors ${
                                        selected ? "bg-emerald-50 hover:bg-emerald-50" : ""
                                      }`}
                                      onDoubleClick={() => {
                                        if (account?.isPosting !== false && !account?.isHeader)
                                          navigate(`${activityBase}/${account._id}/activity`);
                                      }}
                                      title={
                                        account?.isPosting !== false && !account?.isHeader
                                          ? "Double-click to open ledger activity"
                                          : "Header accounts cannot open activity"
                                      }
                                    >
                                      <td className="px-3 py-1 border-r border-gray-100">
                                        <button
                                          onClick={() => toggleSelect(account._id)}
                                          className="text-slate-300 hover:text-slate-600"
                                        >
                                          {selected
                                            ? <FaCheckSquare size={12} className="text-[#0B3B2E]" />
                                            : <FaSquare size={12} />
                                          }
                                        </button>
                                      </td>
                                      <td className="px-3 py-1 border-r border-gray-100 font-mono font-semibold text-slate-700">
                                        {account.code}
                                      </td>
                                      <td className="px-3 py-1 border-r border-gray-100">
                                        <span
                                          className="font-medium text-slate-900"
                                          style={{ paddingLeft: `${Number(account.level || 0) * 16}px` }}
                                        >
                                          {account.name}
                                        </span>
                                      </td>
                                      <td className="px-3 py-1 border-r border-gray-100 text-slate-500">
                                        {account.normalBalanceSide || NORMAL_BALANCE_BY_TYPE[account.type] || "—"}
                                      </td>
                                      <td className={`px-3 py-1 border-r border-gray-100 text-right font-semibold tabular-nums ${
                                        balance !== 0 ? "text-slate-800" : "text-slate-300"
                                      }`}>
                                        {formatMoney(balance)}
                                      </td>
                                      <td className="px-3 py-1 text-right">
                                        <div className="inline-flex gap-1 items-center justify-end">
                                          {canUpdateCOA && (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); openEditModal(account); }}
                                              title="Edit account"
                                              className="text-slate-300 hover:text-amber-500 transition-colors"
                                            >
                                              <FaEdit size={11} />
                                            </button>
                                          )}
                                          {account.isSystem && (
                                            <span className="px-1.5 py-0.5 text-[9px] bg-slate-100 text-slate-500 font-bold uppercase">
                                              System
                                            </span>
                                          )}
                                          {account.isHeader ? (
                                            <span className="px-1.5 py-0.5 text-[9px] bg-blue-100 text-blue-700 font-bold uppercase">
                                              Header
                                            </span>
                                          ) : (
                                            <span className="px-1.5 py-0.5 text-[9px] bg-emerald-100 text-emerald-700 font-bold uppercase">
                                              Posting
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </React.Fragment>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Form panel ── */}
          {showForm && (
            <div className="w-96 shrink-0 border-l border-slate-200 bg-white flex flex-col overflow-hidden shadow-lg">
              {/* Panel header */}
              <div className="bg-[#0B3B2E] px-4 py-3 shrink-0 flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">
                    {editingAccountId ? "Edit Account" : "New Account"}
                  </p>
                  <p className="text-sm font-bold text-white mt-0.5 truncate max-w-[280px]">
                    {editingAccountId
                      ? `${formData.code} — ${formData.name || "…"}`
                      : "Chart of Accounts"
                    }
                  </p>
                </div>
                <button onClick={closeForm} className="text-white/50 hover:text-white mt-0.5">
                  <FaTimes size={14} />
                </button>
              </div>

              {/* Form body */}
              <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                <div className="flex-1 overflow-auto p-4 space-y-4">

                  {/* Code */}
                  <div>
                    <label className={labelCls}>
                      Account Code *
                      {editingAccountId && (
                        <span className="ml-1 text-slate-400 font-normal normal-case">(locked — codes cannot be changed)</span>
                      )}
                    </label>
                    <input
                      value={formData.code}
                      onChange={(e) => !editingAccountId && setFormData((prev) => ({ ...prev, code: e.target.value }))}
                      readOnly={!!editingAccountId}
                      placeholder="e.g. 1600"
                      autoFocus={!editingAccountId}
                      className={`${inputCls} ${editingAccountId ? "bg-slate-100 text-slate-500 cursor-not-allowed" : codeConflict ? "border-red-400 bg-red-50 text-red-700" : ""}`}
                    />
                    {!editingAccountId && codeConflict && (
                      <p className="mt-1 flex items-center gap-1 text-[10px] text-red-600 font-semibold">
                        <FaExclamationTriangle size={8} />
                        Code already in use — choose a different number
                      </p>
                    )}
                    {!editingAccountId && !codeConflict && formData.code.trim() && (
                      <p className="mt-1 text-[10px] text-emerald-600 font-semibold">✓ Code is available</p>
                    )}
                  </div>

                  {/* Name */}
                  <div>
                    <label className={labelCls}>Account Name *</label>
                    <input
                      value={formData.name}
                      onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g. Motor Vehicles"
                      autoFocus={!!editingAccountId}
                      className={inputCls}
                    />
                  </div>

                  {/* Type */}
                  <div>
                    <label className={labelCls}>Type *</label>
                    {parentAccountForForm ? (
                      <p className="text-xs text-slate-500 italic bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                        Inherited from parent: <span className="font-bold capitalize text-slate-700">{effectiveType}</span>
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {TYPE_OPTIONS.map((t) => (
                          <button
                            key={t.value}
                            type="button"
                            onClick={() => handleTypeChange(t.value)}
                            className={`px-2.5 py-1 text-xs font-bold transition-colors ${
                              effectiveType === t.value
                                ? "bg-[#0B3B2E] text-white"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Account class */}
                  <div>
                    <label className={labelCls}>Account Class</label>
                    <AppSelect
                      value={formData.subGroup}
                      onChange={(v) => setFormData((prev) => ({ ...prev, subGroup: v ?? "" }))}
                      options={currentSubGroupOptions.map((opt) => ({ value: opt, label: opt }))}
                      size="sm"
                    />
                  </div>

                  {/* Parent account */}
                  <div>
                    <label className={labelCls}>Parent Account</label>
                    <AppSelect
                      value={formData.parentAccount}
                      onChange={(v) => handleParentChange(v ?? "")}
                      options={filteredParentOptions}
                      placeholder="None"
                      searchable
                      clearable
                      size="sm"
                    />
                  </div>

                  {/* Normal balance (informational) */}
                  <div>
                    <label className={labelCls}>Normal Balance Side</label>
                    <div className="border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500">
                      {NORMAL_BALANCE_BY_TYPE[effectiveType] || "—"} <span className="text-slate-400">(auto-derived)</span>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-slate-100" />

                  {/* Header / Posting toggles */}
                  <div className="space-y-3">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.isHeader}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            isHeader:  e.target.checked,
                            isPosting: e.target.checked ? false : prev.isPosting,
                          }))
                        }
                        className="mt-0.5 text-[#0B3B2E]"
                      />
                      <div>
                        <p className="text-xs font-semibold text-slate-800">Header Account</p>
                        <p className="text-[10px] text-slate-500">Groups child accounts; no direct postings allowed</p>
                      </div>
                    </label>

                    <label className={`flex items-start gap-2.5 ${formData.isHeader ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
                      <input
                        type="checkbox"
                        checked={formData.isPosting}
                        disabled={formData.isHeader}
                        onChange={(e) => setFormData((prev) => ({ ...prev, isPosting: e.target.checked }))}
                        className="mt-0.5 text-[#0B3B2E]"
                      />
                      <div>
                        <p className="text-xs font-semibold text-slate-800">Posting Account</p>
                        <p className="text-[10px] text-slate-500">Receives ledger entries directly</p>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Form footer */}
                <div className="shrink-0 border-t border-slate-200 px-4 py-3 flex gap-2 bg-slate-50">
                  <button
                    type="button"
                    onClick={closeForm}
                    className="flex-1 h-8 border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || codeConflict || !formData.code.trim() || !formData.name.trim()}
                    className="flex-1 h-8 bg-[#FF8C00] hover:bg-[#e67e00] text-white text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving
                      ? "Saving..."
                      : editingAccountId ? "Save Changes" : "Create Account"
                    }
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ChartOfAccounts;

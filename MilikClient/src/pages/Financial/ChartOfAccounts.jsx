import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  FaSearch, FaPlus, FaEdit, FaTrash, FaSyncAlt,
  FaChevronDown, FaChevronUp, FaCheckSquare, FaSquare,
  FaExclamationTriangle, FaTimes, FaPrint, FaDownload,
  FaCompressAlt, FaExpandAlt,
} from "react-icons/fa";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import ListToolbar from "../../components/common/ListToolbar";
import AppSelect from "../../components/common/AppSelect";
import { getChartOfAccounts } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";
import { hasCompanyPermission } from "../../utils/permissions";
import { hasCompanyModule } from "../../utils/companyModules";
import { useConfirm } from "../../context/ConfirmContext";
import { formatMoney } from "../../utils/money";
import { printTabularList } from "../../utils/printKit";

// Group color used to be a different hue per type (rose/violet/blue/amber) — purely decorative
// category-coding, which the house style reserves for genuine status meaning only. Every group header
// is now the same green, same as every other section header in the app; the label text (always in the
// same fixed order) is what tells them apart.
const ACCOUNT_GROUPS = [
  { key: "assets",      label: "Assets" },
  { key: "liabilities", label: "Liabilities" },
  { key: "equity",      label: "Equity" },
  { key: "income",      label: "Income" },
  { key: "expenses",    label: "Expenses" },
];

const SUBGROUP_OPTIONS_BY_TYPE = {
  asset:     ["Cashbooks", "Bank Accounts", "Current Assets", "Fixed Assets", "Receivables", "Other Assets"],
  liability: ["Current Liabilities", "Long-term Liabilities", "Payables", "Tax Liabilities", "Other Liabilities"],
  equity:    ["Capital", "Retained Earnings", "Reserves", "Other Equity"],
  income:    ["Sales Revenue", "Operating Revenue", "Service Revenue", "Commission & Fees", "Other Income"],
  expense:   ["Cost of Revenue", "Inventory Adjustments", "Cost of Sales", "Operating Expenses", "Administrative Expenses", "Finance Costs", "Other Expenses"],
};

// Numbering convention already in consistent use across every company's chart (seed data +
// every hand-created account observed): asset 1xxx, liability 2xxx, equity 3xxx, income 4xxx,
// expense 5xxx. Used only to suggest the next free code — never enforced, still freely editable.
const TYPE_CODE_BASE = { asset: 1000, liability: 2000, equity: 3000, income: 4000, expense: 5000 };

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
  { value: "propertySale",       label: "Property Sales" },
  { value: "inventory",          label: "Inventory & POS" },
  { value: "clients",            label: "Clients" },
  { value: "general",            label: "General" },
];

const GROUP_TO_TYPE = {
  assets: "asset", liabilities: "liability", equity: "equity",
  income: "income", expenses: "expense",
};

// Page-load optimization: this page's account list is local state (not Redux), fetched whole and
// grouped client-side — same "local-state own list" pattern as Take-On Balances/LandlordPayments.
// Without this, switching tabs away and back (or revisiting from another module via activityBase)
// re-fetched the entire chart from scratch every time. Keyed per business+moduleScope since those
// are genuinely different result sets; bypassed with {force:true} after mutations or an explicit Refresh.
const _coaCache = new Map(); // `${businessId}:${moduleScope}` → { data, at }
const COA_CACHE_STALE_MS = 30_000;

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

  // Only offer a module scope the company actually has enabled — "general" isn't a real module (it's
  // the fallback scope for accounts not tied to any specific one), so it's never gated.
  const moduleScopeOptions = useMemo(
    () => MODULE_SCOPE_OPTIONS.filter((o) => o.value === "" || o.value === "general" || hasCompanyModule(currentCompany, o.value))
      .filter((o) => o.value !== "")
      .map((o) => ({ value: o.value, label: o.label })),
    [currentCompany]
  );

  const [accounts,            setAccounts]          = useState([]);
  const [search,              setSearch]            = useTabState(`${activityBase}:search`, "");
  const [searchInput,         setSearchInput]       = useState(search);
  const [moduleScope,         setModuleScope]       = useState(() => searchParams.get("scope") || "");
  const [loading,             setLoading]           = useState(false);
  const [refreshing,          setRefreshing]        = useState(false);
  const [saving,              setSaving]            = useState(false);
  const [showControlAccounts, setShowControlAccounts] = useState(true);
  const [typeFilter,          setTypeFilter]        = useState("");
  const [statusFilter,        setStatusFilter]      = useState("");
  // Hides zero-balance accounts by default — most of a fresh/system-seeded Chart of Accounts is unused
  // stub accounts; "With Balances Only" shows what's actually in use, "All Accounts" shows the full
  // structure for anyone managing it.
  const [balanceFilter,       setBalanceFilter]     = useState("withBalances");
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

  const loadAccounts = useCallback(async ({ force = false } = {}) => {
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    setSelectedIds([]);
    if (!businessId) { setLoading(false); return; }

    const cacheKey = `${businessId}:${moduleScope}`;
    const cached = _coaCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < COA_CACHE_STALE_MS) {
      setAccounts(cached.data);
      hasLoadedOnce.current = true;
      setLoading(false);
      return;
    }

    if (!hasLoadedOnce.current) setLoading(true);
    setRefreshing(true);
    try {
      const params = { business: businessId };
      if (moduleScope) params.moduleScope = moduleScope;
      const rows = await getChartOfAccounts(params);
      if (requestSequenceRef.current !== requestId) return;
      const data = Array.isArray(rows) ? rows : [];
      setAccounts(data);
      _coaCache.set(cacheKey, { data, at: Date.now() });
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
    const handleRefresh = () => loadAccounts({ force: true });
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
    if (statusFilter === "active"   && account.isActive === false) return false;
    if (statusFilter === "inactive" && account.isActive !== false) return false;
    if (!normalizedSearch) return true;
    const haystack = [
      account.code, account.name, account.type, account.group, account.subGroup,
      account.normalBalanceSide, account.parentAccount?.name, account.parentAccount?.code,
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(normalizedSearch);
  }), [accounts, normalizedSearch, showControlAccounts, statusFilter]);

  // ── Grouping: by type → by class (all predefined subgroups always visible) ──
  const typeGroups = useMemo(() => {
    const groupsToShow = typeFilter ? ACCOUNT_GROUPS.filter((g) => g.key === typeFilter) : ACCOUNT_GROUPS;
    return groupsToShow.map((group) => {
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
        .map(([cls, accs]) => {
          // "With Balances Only" narrows what's DISPLAYED, not the underlying set — a class whose real
          // accounts all happen to be zero right now is hidden entirely (nothing to show), never
          // presented as structurally empty (which would wrongly offer "+ Add first account").
          const visible = balanceFilter === "withBalances" ? accs.filter((a) => Number(a.balance || 0) !== 0) : accs;
          return { cls, accounts: visible, isEmpty: accs.length === 0, hiddenByBalanceFilter: accs.length > 0 && visible.length === 0 };
        })
        .filter((c) => {
          if (c.hiddenByBalanceFilter) return false;
          // A genuinely empty class (no accounts at all, not just none with a balance) is the same kind
          // of noise as a zero-balance account — "With Balances Only" hides it too, including its
          // "+ Add first account" placeholder; "All Accounts" still shows the full predefined structure.
          if (balanceFilter === "withBalances" && c.isEmpty) return false;
          return !normalizedSearch || c.accounts.length > 0;
        });

      const visibleGroupAccounts = classes.flatMap((c) => c.accounts);
      const totalBalance = visibleGroupAccounts.reduce((s, a) => s + Number(a.balance || 0), 0);
      return { ...group, classes, count: visibleGroupAccounts.length, totalBalance, groupType };
    });
  }, [filteredAccounts, normalizedSearch, typeFilter, balanceFilter]);

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

  const currentSubGroupSelectOptions = useMemo(
    () => currentSubGroupOptions.map((opt) => ({ value: opt, label: opt })),
    [currentSubGroupOptions]
  );

  // Next free code within the selected type's conventional range — suggested, not forced.
  const suggestedCode = useMemo(() => {
    const base = TYPE_CODE_BASE[effectiveType] || 1000;
    const used = new Set(
      accounts
        .filter((a) => String(a.type || "").toLowerCase() === effectiveType)
        .map((a) => Number(a.code))
        .filter((n) => Number.isFinite(n) && n >= base && n < base + 1000)
    );
    let candidate = used.size ? Math.max(...used) + 1 : base;
    while (used.has(candidate)) candidate += 1;
    return String(candidate);
  }, [accounts, effectiveType]);

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
      await loadAccounts({ force: true });
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
      title: "Delete Accounts",
      message: `Delete: ${names}? An account that already has transactions is not removed: it is switched off (shown as Inactive) and takes no new postings, so payments and journals using it will be refused until it is reactivated.`,
      confirmText: "Delete", isDangerous: true,
    });
    if (!ok) return;
    setSaving(true);
    let removed = 0, switchedOff = 0;
    const failures = [];
    for (const a of selectedAccounts) {
      try {
        const { data } = await adminRequests.delete(`/chart-of-accounts/${a._id}`, { data: { business: businessId } });
        if (data?.softDeleted) switchedOff += 1; else removed += 1;
      } catch (error) {
        failures.push(`${a.code}: ${error?.response?.data?.error || error?.response?.data?.message || error?.message || "failed"}`);
      }
    }
    if (removed) toast.success(`${removed} account${removed === 1 ? "" : "s"} deleted.`);
    if (switchedOff) toast.warning(`${switchedOff} account${switchedOff === 1 ? " has" : "s have"} transactions, so ${switchedOff === 1 ? "it was" : "they were"} switched off (Inactive) instead of deleted.`);
    failures.forEach((message) => toast.error(message));
    setSelectedIds([]);
    await loadAccounts({ force: true });
    setSaving(false);
  };

  const handleReactivate = async (account) => {
    try {
      await adminRequests.post(`/chart-of-accounts/${account._id}/reactivate`, { business: businessId });
      toast.success(`${account.code} ${account.name} is active again.`);
      await loadAccounts({ force: true });
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to reactivate the account");
    }
  };

  const expandAll   = () => setCollapsed({});
  const collapseAll = () => setCollapsed(Object.fromEntries(ACCOUNT_GROUPS.map((g) => [g.key, true])));

  // Everything currently visible, in display order — same accounts/order the on-screen groups render,
  // so print/export always matches what's on screen regardless of which filters are active.
  const visibleAccountsInOrder = useMemo(
    () => typeGroups.flatMap((g) => g.classes.flatMap((c) => c.accounts.map((a) => ({ ...a, _group: g.label, _class: c.cls })))),
    [typeGroups]
  );

  const [printing, setPrinting] = useState(false);
  const handlePrintList = () => {
    if (!visibleAccountsInOrder.length) { toast.info("There are nothing to print — adjust the filters."); return; }
    setPrinting(true);
    const grandTotal = visibleAccountsInOrder.reduce((s, a) => s + Number(a.balance || 0), 0);
    const printed = printTabularList({
      title: "Chart of Accounts",
      subtitle: `${visibleAccountsInOrder.length.toLocaleString()} account${visibleAccountsInOrder.length !== 1 ? "s" : ""}`,
      company: currentCompany,
      summaryItems: [
        ["Total Accounts", visibleAccountsInOrder.length.toLocaleString()],
        ["Net Balance", formatMoney(grandTotal)],
      ],
      columns: [
        { label: "Code", value: (a) => a.code || "-" },
        { label: "Account Name", value: (a) => a.name || "-" },
        { label: "Type", value: (a) => a._group },
        { label: "Class", value: (a) => a._class },
        { label: "Normal Side", value: (a) => a.normalBalanceSide || NORMAL_BALANCE_BY_TYPE[a.type] || "-" },
        { label: "Balance", align: "right", bold: true, value: (a) => formatMoney(Number(a.balance || 0)) },
        { label: "Status", value: (a) => (a.isActive === false ? "INACTIVE" : a.isHeader ? "HEADER" : "POSTING") },
      ],
      rows: visibleAccountsInOrder,
      totalsRow: [`Total (${visibleAccountsInOrder.length.toLocaleString()} accounts)`, "", "", "", "", formatMoney(grandTotal), ""],
    });
    if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
    setPrinting(false);
  };

  const [exporting, setExporting] = useState(false);
  const handleExportCsv = () => {
    if (!visibleAccountsInOrder.length) { toast.info("There is nothing to export — adjust the filters."); return; }
    setExporting(true);
    const header = ["Code", "Account Name", "Type", "Class", "Normal Side", "Balance", "Status"];
    const rows = visibleAccountsInOrder.map((a) => [
      a.code || "", a.name || "", a._group, a._class,
      a.normalBalanceSide || NORMAL_BALANCE_BY_TYPE[a.type] || "",
      Number(a.balance || 0).toFixed(2),
      a.isActive === false ? "INACTIVE" : a.isHeader ? "HEADER" : "POSTING",
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chart-of-accounts.csv";
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  };

  // ── Style shortcuts — the house standard (square corners, fixed h-7), not the older auto-height/rounded pattern ──
  const labelCls = "mb-1 block text-xs font-bold text-slate-900";
  const inputCls = "h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition border-slate-300 focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";

  // ── Render ──
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden bg-slate-100">

        {/* ── Toolbar ── */}
        <ListToolbar>
          <div className="relative shrink-0">
            <FaSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400" />
            <ListToolbar.Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Code, name, type, class..."
              width="w-52"
              className="pl-6"
            />
          </div>

          <AppSelect
            size="sm"
            clearable
            placeholder="All Modules"
            value={moduleScope}
            onChange={(v) => setModuleScope(v ?? "")}
            options={moduleScopeOptions}
          />

          <AppSelect
            size="sm"
            clearable
            placeholder="All Types"
            value={typeFilter}
            onChange={(v) => setTypeFilter(v ?? "")}
            options={ACCOUNT_GROUPS.map((g) => ({ value: g.key, label: g.label }))}
          />

          <AppSelect
            size="sm"
            clearable
            placeholder="Active & Inactive"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v ?? "")}
            options={[{ value: "active", label: "Active Only" }, { value: "inactive", label: "Inactive Only" }]}
          />

          <AppSelect
            size="sm"
            value={balanceFilter}
            onChange={(v) => setBalanceFilter(v ?? "withBalances")}
            options={[{ value: "withBalances", label: "With Balances Only" }, { value: "all", label: "All Accounts" }]}
          />

          <label className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showControlAccounts}
              onChange={(e) => setShowControlAccounts(e.target.checked)}
              className="text-[#0B3B2E]"
            />
            Control Accounts
          </label>

          <ListToolbar.Divider />
          <ListToolbar.Button icon={FaExpandAlt} variant="outline" onClick={expandAll}>Expand All</ListToolbar.Button>
          <ListToolbar.Button icon={FaCompressAlt} variant="outline" onClick={collapseAll}>Collapse All</ListToolbar.Button>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {selectedIds.length > 0 && (
              <span className="border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                {selectedIds.length} selected
              </span>
            )}
            <ListToolbar.Button icon={FaPrint} variant="outline" disabled={printing} onClick={handlePrintList}>Print</ListToolbar.Button>
            <ListToolbar.Button icon={FaDownload} variant="outline" disabled={exporting} onClick={handleExportCsv}>Export</ListToolbar.Button>
            <ListToolbar.Divider />
            <ListToolbar.Button variant="outline" onClick={() => loadAccounts({ force: true })} title="Refresh">
              <FaSyncAlt size={9} className={refreshing ? "animate-spin" : ""} />
            </ListToolbar.Button>
            {selectedAccounts.length === 1 && canUpdateCOA && (
              <ListToolbar.Button icon={FaEdit} variant="dark" onClick={() => openEditModal(selectedAccounts[0])}>Edit</ListToolbar.Button>
            )}
            {selectedAccounts.length > 0 && canDeleteCOA && (
              <ListToolbar.Button icon={FaTrash} variant="danger" onClick={handleDeleteSelected}>Delete</ListToolbar.Button>
            )}
            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaPlus} variant="primary" disabled={!canCreateCOA} onClick={openCreateModal}>Add Account</ListToolbar.Button>
          </div>
        </ListToolbar>

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
                <div key={group.key} className="overflow-hidden border border-slate-200">
                  {/* Type section header */}
                  <div className="bg-[#0B3B2E] flex items-center gap-2.5 px-3 py-2">
                    <button
                      onClick={() => toggleSelectGroup(allGroupAccounts)}
                      className="text-white/50 hover:text-white shrink-0"
                    >
                      {allSel && allIds.length > 0
                        ? <FaCheckSquare size={12} />
                        : <FaSquare size={12} />
                      }
                    </button>
                    <span className="font-black text-white text-sm uppercase tracking-wide">{group.label}</span>
                    <span className="border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-white/90">
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
                            <th style={{ width: "4%" }} className="px-3 py-1.5 border-r border-white/10"></th>
                            <th style={{ width: "12%" }} className="text-left px-3 py-1.5 text-[10px] font-black uppercase tracking-widest border-r border-white/10">Code</th>
                            <th style={{ width: "40%" }} className="text-left px-3 py-1.5 text-[10px] font-black uppercase tracking-widest border-r border-white/10">Account Name</th>
                            <th style={{ width: "12%" }} className="text-left px-3 py-1.5 text-[10px] font-black uppercase tracking-widest border-r border-white/10">Normal Side</th>
                            <th style={{ width: "18%" }} className="text-right px-3 py-1.5 text-[10px] font-black uppercase tracking-widest border-r border-white/10">Balance</th>
                            <th style={{ width: "14%" }} className="text-right px-3 py-1.5 text-[10px] font-black uppercase tracking-widest">Status</th>
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
                                {clsAcc.accounts.map((account, idx) => {
                                  const selected = selectedIds.includes(account._id);
                                  const balance  = Number(account.balance || 0);
                                  return (
                                    <tr
                                      key={account._id}
                                      className={`border-b border-gray-100 cursor-pointer transition-colors ${
                                        selected
                                          ? "bg-[#C8E6D4] shadow-[inset_2px_0_0_#0B3B2E] hover:bg-[#C8E6D4]"
                                          : `hover:bg-[#EBF5EF] ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`
                                      } ${account.isActive === false ? "opacity-60" : ""}`}
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
                                      <td className="px-3 py-1.5 border-r border-gray-100" onClick={(e) => e.stopPropagation()}>
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
                                      <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-bold text-slate-900">
                                        {account.code}
                                      </td>
                                      <td className="px-3 py-1.5 border-r border-gray-100">
                                        <span
                                          className="font-semibold text-slate-900"
                                          style={{ paddingLeft: `${Number(account.level || 0) * 16}px` }}
                                        >
                                          {account.name}
                                        </span>
                                      </td>
                                      <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">
                                        {account.normalBalanceSide || NORMAL_BALANCE_BY_TYPE[account.type] || "—"}
                                      </td>
                                      <td className={`px-3 py-1.5 border-r border-gray-100 text-right font-bold tabular-nums ${
                                        balance !== 0 ? "text-slate-900" : "text-slate-300"
                                      }`}>
                                        {formatMoney(balance)}
                                      </td>
                                      <td className="px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                                        <div className="inline-flex gap-1 items-center justify-end">
                                          {canUpdateCOA && (
                                            <button
                                              onClick={() => openEditModal(account)}
                                              title="Edit account"
                                              className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                                            >
                                              <FaEdit size={11} />
                                            </button>
                                          )}
                                          {account.isSystem && (
                                            <span className="px-1.5 py-0.5 text-[9px] bg-slate-100 text-slate-500 font-bold uppercase">
                                              System
                                            </span>
                                          )}
                                          {account.isActive === false && canUpdateCOA && (
                                            <button
                                              onClick={() => handleReactivate(account)}
                                              title="Switch this account back on so it can take postings again"
                                              className="px-1.5 py-0.5 text-[9px] bg-amber-100 text-amber-800 hover:bg-amber-200 font-bold uppercase"
                                            >
                                              Reactivate
                                            </button>
                                          )}
                                          {account.isActive === false ? (
                                            <span className="px-1.5 py-0.5 text-[9px] bg-red-100 text-red-700 font-bold uppercase" title="Deleted: kept for its history, but it takes no new postings">
                                              Inactive
                                            </span>
                                          ) : account.isHeader ? (
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
                    {!editingAccountId && !formData.code.trim() && (
                      <button
                        type="button"
                        onClick={() => setFormData((prev) => ({ ...prev, code: suggestedCode }))}
                        className="mt-1 text-[10px] font-semibold text-[#0B3B2E] hover:underline"
                      >
                        Suggest next code: {suggestedCode} (click to use)
                      </button>
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
                      options={currentSubGroupSelectOptions}
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
                    className="flex-1 h-8 bg-[#0B3B2E] hover:bg-[#0A3127] text-white text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
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

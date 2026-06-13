import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import { FaBook, FaCheckSquare, FaEdit, FaEye, FaPlus, FaRedoAlt, FaSearch, FaSquare, FaTimes, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import { useConfirm } from "../../context/ConfirmContext";

const PAGE_SIZE = 30;
const defaultFilters = { search: "", type: "" };
const emptyForm = { code: "", name: "", type: "income", subGroup: "Car Wash Income", isPosting: true };

const ACCOUNT_GROUPS = [
  { key: "assets", label: "Assets", accent: "#0B3B2E", countClass: "bg-emerald-100 text-emerald-800" },
  { key: "income", label: "Income", accent: "#0E7490", countClass: "bg-cyan-100 text-cyan-800" },
  { key: "expenses", label: "Expenses", accent: "#FF8C00", countClass: "bg-orange-100 text-orange-800" },
  { key: "liabilities", label: "Liabilities", accent: "#7F1D1D", countClass: "bg-red-100 text-red-800" },
  { key: "equity", label: "Equity", accent: "#4C1D95", countClass: "bg-violet-100 text-violet-800" },
];

const NORMAL_BALANCE_BY_TYPE = {
  asset: "Debit",
  expense: "Debit",
  liability: "Credit",
  equity: "Credit",
  income: "Credit",
};

const normalizeGroup = (group = "", type = "") => {
  const value = String(group || "").trim().toLowerCase();
  if (["assets", "liabilities", "equity", "income", "expenses"].includes(value)) return value;
  const normalizedType = String(type || "").trim().toLowerCase();
  if (normalizedType === "asset") return "assets";
  if (normalizedType === "liability") return "liabilities";
  if (normalizedType === "equity") return "equity";
  if (normalizedType === "income") return "income";
  if (normalizedType === "expense") return "expenses";
  return "assets";
};

const typeLabel = (type = "") => {
  const normalized = String(type || "").trim().toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "-";
};

const accountClass = (account = {}) => String(account.subGroup || "").trim() || "-";

const isCashbookAccount = (account = {}) =>
  String(account?.subGroup || "").toLowerCase().includes("cashbook") ||
  /cash|bank|m-pesa|mpesa/i.test(`${account?.name || ""} ${account?.code || ""}`);

const subGroupForType = (type = "") => {
  if (type === "asset") return "Cashbooks";
  if (type === "expense") return "Car Wash Expenses";
  return "Car Wash Income";
};

const groupForType = (type = "") => {
  if (type === "asset") return "assets";
  if (type === "expense") return "expenses";
  if (type === "liability") return "liabilities";
  if (type === "equity") return "equity";
  return "income";
};

const CarWashChartOfAccounts = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const currentCompany = useSelector(selectCurrentCompany);
  const [filters, setFilters] = useState(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [activityModal, setActivityModal] = useState({ open: false, account: null, rows: [], openingBalance: 0, closingBalance: 0 });
  const [saving, setSaving] = useState(false);

  const canManageSettings = useCarWashPermission("carwash-settings", "manage");
  const canCreate = canManageSettings;
  const canUpdate = canManageSettings;
  const canDelete = canManageSettings;

  const { data: rawAccounts, isLoading: loading, error, refetch } = useQuery({
    queryKey: ["cw-chart-accounts", currentCompany?._id],
    queryFn: () => carWashApi.listChartOfAccounts({ business: currentCompany._id, moduleScope: "carwash" }),
    enabled: !!currentCompany?._id,
    select: (rows) => Array.isArray(rows) ? rows : [],
    staleTime: 0,           // always refetch on mount / window-focus
    refetchOnWindowFocus: true,
  });

  // Immediately refetch when any car wash mutation signals data changed
  useEffect(() => {
    const onDataChanged = () => refetch();
    window.addEventListener("carwash-data-changed", onDataChanged);
    return () => window.removeEventListener("carwash-data-changed", onDataChanged);
  }, [refetch]);

  useEffect(() => { if (error) toast.error(error?.response?.data?.message || "Failed to load Car Wash chart of accounts"); }, [error]);
  useEffect(() => { setSelectedIds([]); }, [rawAccounts]);

  const accounts = rawAccounts ?? [];

  const filteredAccounts = useMemo(() => {
    const search = appliedFilters.search.trim().toLowerCase();
    return accounts.filter((account) => {
      if (appliedFilters.type && String(account.type || "").toLowerCase() !== appliedFilters.type) return false;
      if (!search) return true;
      return [account.code, account.name, account.type, account.group, account.subGroup, account.normalBalanceSide]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [accounts, appliedFilters]);

  const groupedAccounts = useMemo(() => {
    return ACCOUNT_GROUPS.map((group) => ({
      ...group,
      accounts: filteredAccounts
        .filter((account) => normalizeGroup(account.group, account.type) === group.key)
        .sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""))),
    })).filter((group) => group.accounts.length > 0);
  }, [filteredAccounts]);

  const cashbookCount = filteredAccounts.filter(isCashbookAccount).length;
  const incomeCount = filteredAccounts.filter((account) => String(account.type || "").toLowerCase() === "income").length;
  const expenseCount = filteredAccounts.filter((account) => String(account.type || "").toLowerCase() === "expense").length;
  const totalBalance = filteredAccounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const selectedAccounts = useMemo(() => {
    const selected = new Set(selectedIds);
    return accounts.filter((account) => selected.has(account._id));
  }, [accounts, selectedIds]);
  const selectedAccount = selectedAccounts.length === 1 ? selectedAccounts[0] : null;
  const selectedHasSystem = selectedAccounts.some((account) => account.isSystem);

  const applyFilters = (event) => {
    event.preventDefault();
    setAppliedFilters({ ...filters });
  };

  const resetFilters = () => {
    setFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
  };

  const toggleSelected = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const openCreate = () => {
    setEditingId("");
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = () => {
    if (!selectedAccount) {
      toast.info("Select one account to edit.");
      return;
    }
    if (selectedAccount.isSystem) {
      toast.info("System accounts are locked. Create a custom Car Wash account for changes.");
      return;
    }
    setEditingId(selectedAccount._id);
    setForm({
      code: selectedAccount.code || "",
      name: selectedAccount.name || "",
      type: selectedAccount.type || "income",
      subGroup: selectedAccount.subGroup || subGroupForType(selectedAccount.type || "income"),
      isPosting: selectedAccount.isPosting !== false,
    });
    setShowForm(true);
  };

  const saveAccount = async (event) => {
    event.preventDefault();
    if (!currentCompany?._id) return;
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("Account code and account name are required.");
      return;
    }

    const payload = {
      business: currentCompany._id,
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      type: form.type,
      group: groupForType(form.type),
      subGroup: form.subGroup || subGroupForType(form.type),
      isHeader: false,
      isPosting: Boolean(form.isPosting),
      parentAccount: null,
      moduleScopes: ["carwash"],
    };

    setSaving(true);
    try {
      if (editingId) await carWashApi.updateChartAccount(editingId, payload);
      else await carWashApi.createChartAccount(payload);
      toast.success(editingId ? "Car Wash account updated." : "Car Wash account created.");
      setShowForm(false);
      setEditingId("");
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: ["cw-chart-accounts"] });
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to save chart account");
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedAccounts.length) {
      toast.info("Select at least one custom account to delete.");
      return;
    }
    if (selectedHasSystem) {
      toast.info("System accounts cannot be deleted from the Car Wash ledger.");
      return;
    }
    const confirmed = await confirm({ title: "Delete Accounts", message: `Delete ${selectedAccounts.length} selected Car Wash account(s)?`, confirmText: "Delete", isDangerous: true });
    if (!confirmed) return;

    setSaving(true);
    try {
      for (const account of selectedAccounts) {
        await carWashApi.deleteChartAccount(account._id, { business: currentCompany?._id });
      }
      toast.success("Selected account(s) deleted.");
      await queryClient.invalidateQueries({ queryKey: ["cw-chart-accounts"] });
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to delete selected account(s)");
    } finally {
      setSaving(false);
    }
  };

  const openActivity = async () => {
    if (!selectedAccount) {
      toast.info("Select one account to view ledger activity.");
      return;
    }
    try {
      const payload = await carWashApi.getChartAccountActivity(selectedAccount._id, { business: currentCompany?._id });
      setActivityModal({
        open: true,
        account: payload?.account || selectedAccount,
        rows: Array.isArray(payload?.entries) ? payload.entries : [],
        openingBalance: Number(payload?.openingBalance || 0),
        closingBalance: Number(payload?.closingBalance || 0),
      });
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to load ledger activity");
    }
  };

  return (
    <CarWashShell
      title="Chart of Accounts"
      action={
        <>
          <button type="button" onClick={openActivity} disabled={selectedAccounts.length !== 1} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45"><FaEye /> Ledger</button>
          {canCreate && <button type="button" onClick={openCreate} className="inline-flex h-8 items-center gap-1.5 bg-[#FF8C00] px-3 text-xs font-bold text-white hover:bg-[#E67E00]"><FaPlus /> Add Account</button>}
          {canUpdate && <button type="button" onClick={openEdit} disabled={selectedAccounts.length !== 1 || selectedHasSystem} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45"><FaEdit /> Edit</button>}
          {canDelete && <button type="button" onClick={deleteSelected} disabled={!selectedAccounts.length || selectedHasSystem || saving} className="inline-flex h-8 items-center gap-1.5 border border-red-200 bg-red-50 px-2.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-45"><FaTrash /> Delete</button>}
          <button type="button" onClick={() => refetch()} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"><FaRedoAlt className={loading ? "animate-spin" : ""} />Refresh</button>
        </>
      }
    >
      <form onSubmit={applyFilters} className="mb-2 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 md:grid-cols-[1fr_220px_auto_auto]">
        <input className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none" placeholder="Search by code, account name, type, class, or subgroup" value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
        <select className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none" value={filters.type} onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value }))}>
          <option value="">All account types</option>
          <option value="asset">Assets</option>
          <option value="income">Income</option>
          <option value="expense">Expenses</option>
          <option value="liability">Liabilities</option>
          <option value="equity">Equity</option>
        </select>
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]"><FaSearch />Search</button>
        <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]"><FaRedoAlt />Reset</button>
      </form>

      <div className="mb-2 flex min-h-8 flex-wrap items-center gap-x-5 gap-y-1 border border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600 shadow-sm">
        <span>Showing: <strong className="text-[#0B3B2E]">{filteredAccounts.length}</strong></span>
        <span>Cashbooks: <strong className="text-[#0B3B2E]">{cashbookCount}</strong></span>
        <span>Income: <strong className="text-[#0B3B2E]">{incomeCount}</strong></span>
        <span>Expenses: <strong className="text-[#FF8C00]">{expenseCount}</strong></span>
        <span>Total Balance: <strong className="text-[#0B3B2E]">{formatMoney(totalBalance)}</strong></span>
        <span>Selected: <strong className="text-[#0B3B2E]">{selectedAccounts.length}</strong></span>
      </div>

      <div className="min-h-[calc(100vh-15rem)] overflow-x-auto">
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          {groupedAccounts.length ? groupedAccounts.map((group) => (
            <section key={group.key} className="overflow-hidden border border-slate-200 bg-white shadow-sm" style={{ borderTop: `2px solid ${group.accent}` }}>
              <div className="flex min-h-8 items-center justify-between border-b border-slate-200 bg-[#F6FAF8] px-3 py-1.5">
                <div className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
                  <FaBook className="text-[#0B3B2E]" />
                  {group.label}
                </div>
                <span className={`px-2 py-0.5 text-[11px] font-extrabold uppercase ${group.countClass}`}>
                  {group.accounts.length} accounts
                </span>
              </div>

              <div className="overflow-x-auto bg-white">
                <table className="w-full min-w-[480px] table-fixed text-xs">
                  <thead className="bg-[#0B3B2E] text-white">
                    <tr>
                      <th className="w-8 px-2 py-1.5 text-left font-bold uppercase tracking-wide"></th>
                      <th className="w-20 px-2 py-1.5 text-left font-bold uppercase tracking-wide">Code</th>
                      <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Account</th>
                      <th className="w-24 px-2 py-1.5 text-left font-bold uppercase tracking-wide">Type</th>
                      <th className="w-36 px-2 py-1.5 text-left font-bold uppercase tracking-wide">Class</th>
                      <th className="w-24 px-2 py-1.5 text-right font-bold uppercase tracking-wide">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.accounts.slice(0, PAGE_SIZE).map((account) => (
                      <tr key={account._id || account.code} className="border-b border-slate-200 hover:bg-slate-50">
                        <td className="px-2 py-1">
                          <button type="button" onClick={() => toggleSelected(account._id)} className="text-[#0B3B2E] hover:text-[#FF8C00]">
                            {selectedIds.includes(account._id) ? <FaCheckSquare /> : <FaSquare />}
                          </button>
                        </td>
                        <td className="px-2 py-1 font-mono font-extrabold text-slate-900">{account.code}</td>
                        <td className="truncate px-2 py-1 font-semibold text-slate-800" title={account.name}>{account.name}</td>
                        <td className="px-2 py-1 text-slate-700">{typeLabel(account.type)}</td>
                        <td className="truncate px-2 py-1 text-slate-600" title={accountClass(account)}>{accountClass(account)}</td>
                        <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(account.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )) : (
            <div className="border border-slate-200 bg-white px-3 py-10 text-center text-xs font-semibold text-slate-500 shadow-sm">
              No Car Wash chart accounts found for the selected filters.
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="w-full max-w-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h2 className="text-sm font-extrabold uppercase tracking-wide">{editingId ? "Edit Car Wash Account" : "Add Car Wash Account"}</h2>
              <button type="button" onClick={() => setShowForm(false)} className="p-1 text-white/80 hover:bg-white/10 hover:text-white"><FaTimes /></button>
            </div>
            <form onSubmit={saveAccount} className="grid gap-3 p-4 md:grid-cols-2">
              <div><label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Code</label><input className="h-9 w-full border border-slate-300 px-2 text-sm focus:border-[#0B3B2E] focus:outline-none" value={form.code} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} required autoFocus /></div>
              <div><label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Account Name</label><input className="h-9 w-full border border-slate-300 px-2 text-sm focus:border-[#0B3B2E] focus:outline-none" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required /></div>
              <div><label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Type</label><select className="h-9 w-full border border-slate-300 px-2 text-sm focus:border-[#0B3B2E] focus:outline-none" value={form.type} onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value, subGroup: subGroupForType(event.target.value) }))}><option value="asset">Asset</option><option value="income">Income</option><option value="expense">Expense</option></select></div>
              <div><label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Class</label><input className="h-9 w-full border border-slate-300 px-2 text-sm focus:border-[#0B3B2E] focus:outline-none" value={form.subGroup} onChange={(event) => setForm((prev) => ({ ...prev, subGroup: event.target.value }))} required /></div>
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-600 md:col-span-2"><input type="checkbox" checked={form.isPosting} onChange={(event) => setForm((prev) => ({ ...prev, isPosting: event.target.checked }))} /> Posting account</label>
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 md:col-span-2">
                <button type="button" onClick={() => setShowForm(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
                <button type="submit" disabled={saving} className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-60">{saving ? "Saving..." : "Save Account"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activityModal.open && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="w-full max-w-5xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <div><h2 className="text-sm font-extrabold uppercase tracking-wide">{activityModal.account?.code} {activityModal.account?.name}</h2><div className="text-[11px] text-white/80">Opening {formatMoney(activityModal.openingBalance)} | Closing {formatMoney(activityModal.closingBalance)}</div></div>
              <button type="button" onClick={() => setActivityModal({ open: false, account: null, rows: [], openingBalance: 0, closingBalance: 0 })} className="p-1 text-white/80 hover:bg-white/10 hover:text-white"><FaTimes /></button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-3">
              <table className="w-full table-fixed text-xs">
                <thead className="bg-[#0B3B2E] text-white"><tr><th className="w-28 px-2 py-1.5 text-left">Date</th><th className="px-2 py-1.5 text-left">Description</th><th className="w-24 px-2 py-1.5 text-left">Direction</th><th className="w-32 px-2 py-1.5 text-right">Amount</th><th className="w-28 px-2 py-1.5 text-left">Status</th></tr></thead>
                <tbody>
                  {activityModal.rows.length ? activityModal.rows.map((row) => (
                    <tr key={row._id} className="border-b border-slate-200"><td className="px-2 py-1">{row.transactionDate ? new Date(row.transactionDate).toLocaleDateString("en-KE") : "-"}</td><td className="truncate px-2 py-1" title={row.notes || row.description}>{row.notes || row.description || "-"}</td><td className="px-2 py-1 uppercase">{row.direction || "-"}</td><td className="px-2 py-1 text-right font-extrabold">{formatMoney(row.amount)}</td><td className="px-2 py-1 uppercase">{row.status || "-"}</td></tr>
                  )) : <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No ledger activity recorded for this account.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </CarWashShell>
  );
};

export default CarWashChartOfAccounts;

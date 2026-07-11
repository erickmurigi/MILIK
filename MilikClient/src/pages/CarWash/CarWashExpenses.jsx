import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clearDraft, readDraft, writeDraft } from "../../hooks/useFormDraft";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import { FaChevronDown, FaChevronRight, FaCog, FaEdit, FaPlus, FaRedoAlt, FaSearch, FaTimes, FaTrashAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, getActiveBranchId, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import PaginationBar from "../../components/PaginationBar";

const METHODS             = ["cash", "mpesa", "bank", "card", "other"];
const STATUSES            = ["draft", "approved", "paid", "cancelled"];
const DEFAULT_CATEGORIES  = ["Supplies", "Staff Wages", "Water and Utilities", "Equipment Repair", "Rent", "Other"];
const DRAFT_KEY           = "cw-expenses-form";
const PAGE_SIZES  = [25, 50, 100, 200];

const defaultFilters = { date: todayISO(), status: "", category: "", method: "", cashbookAccount: "", search: "" };
const emptyItem  = { description: "", amount: "" };
const emptyForm  = {
  expenseDate: todayISO(), payee: "", category: "Supplies", description: "",
  method: "cash", cashbookAccount: "", reference: "", status: "paid", notes: "",
  items: [{ ...emptyItem }], branch: "",
};

const ic = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const lc = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

const statusBadge = {
  draft:     "border-slate-200 bg-slate-50 text-slate-700",
  approved:  "border-cyan-200 bg-cyan-50 text-cyan-700",
  paid:      "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

const preferredCashbook = (cashbooks = [], method = "cash") => {
  const hay = (cb) => `${cb?.name || ""} ${cb?.code || ""}`.toLowerCase();
  if (method === "mpesa") return cashbooks.find((cb) => /m-?pesa|mpesa/.test(hay(cb)))?._id || "";
  if (method === "bank" || method === "card") return cashbooks.find((cb) => /bank/.test(hay(cb)))?._id || "";
  return cashbooks.find((cb) => /cash|hand|safe/.test(hay(cb)))?._id || cashbooks[0]?._id || "";
};

const statusOptionsFor = (current) => {
  if (current === "cancelled") return ["cancelled"];
  if (current === "paid")      return ["paid", "cancelled"];
  if (current === "approved")  return ["approved", "paid", "cancelled"];
  return STATUSES;
};

const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-GB") : "—";
const userName = (u) => u?.name || u?.username || u?.email || "—";

// ── Modal shell ───────────────────────────────────────────────────────────────
const Modal = ({ title, onClose, onSubmit, submitLabel, children }) => (
  <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
    <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-3xl sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
      <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
      <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
        <button type="button" onClick={onClose} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
        <button type="button" onClick={onSubmit} className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]">{submitLabel}</button>
      </div>
    </div>
  </div>
);

// ── Expense form body (shared create / edit) ──────────────────────────────────
const ExpenseForm = ({ form, setForm, cashbooks, categories, isEditing, branches = [], isConsolidated = false }) => {
  const itemsTotal = form.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  const addItem    = () => setForm((p) => ({ ...p, items: [...p.items, { ...emptyItem }] }));
  const removeItem = (idx) => setForm((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));
  const setItem    = (idx, field, val) =>
    setForm((p) => ({ ...p, items: p.items.map((item, i) => i === idx ? { ...item, [field]: val } : item) }));

  return (
    <div className="space-y-4">
      {/* Branch picker — only in All Branches view */}
      {isConsolidated && !isEditing && (
        <div>
          <label className={lc}>Branch <span className="text-red-500">*</span></label>
          <select
            className={`${ic} ${!form.branch ? "border-amber-400 bg-amber-50" : ""}`}
            value={form.branch}
            onChange={(e) => setForm((p) => ({ ...p, branch: e.target.value }))}
            required
          >
            <option value="">— Select branch —</option>
            {branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
        </div>
      )}

      {/* Row 1 */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        <div>
          <label className={lc}>Expense Date *</label>
          <input type="date" className={ic} required value={form.expenseDate}
            onChange={(e) => setForm((p) => ({ ...p, expenseDate: e.target.value }))} />
        </div>
        <div>
          <label className={lc}>Payee</label>
          <input className={ic} placeholder="Supplier, staff, utility…" value={form.payee}
            onChange={(e) => setForm((p) => ({ ...p, payee: e.target.value }))} />
        </div>
        <div>
          <label className={lc}>Category *</label>
          <select className={ic} value={form.category}
            onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Row 2 */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <div>
          <label className={lc}>Method</label>
          <select className={ic} value={form.method}
            onChange={(e) => setForm((p) => ({ ...p, method: e.target.value, cashbookAccount: preferredCashbook(cashbooks, e.target.value) }))}>
            {METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
          </select>
        </div>
        {!isEditing && (
          <div>
            <label className={lc}>Status</label>
            <select className={ic} value={form.status}
              onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
              <option value="paid">Paid</option>
              <option value="approved">Approved</option>
              <option value="draft">Draft</option>
            </select>
          </div>
        )}
        <div>
          <label className={lc}>Cashbook {form.status === "paid" ? "*" : ""}</label>
          <select className={ic} value={form.cashbookAccount} required={form.status === "paid"}
            onChange={(e) => setForm((p) => ({ ...p, cashbookAccount: e.target.value }))}>
            <option value="">Select cashbook…</option>
            {cashbooks.map((cb) => <option key={cb._id} value={cb._id}>{cb.code} – {cb.name}</option>)}
          </select>
        </div>
        <div>
          <label className={lc}>Reference</label>
          <input className={ic} placeholder="Receipt, M-Pesa code…" value={form.reference}
            onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))} />
        </div>
      </div>

      {/* Expense Items */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className={lc + " mb-0"}>Expense Items *</span>
          <span className="text-[11px] font-extrabold text-[#0B3B2E]">
            Total: {formatMoney(itemsTotal)}
          </span>
        </div>
        <div className="border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#0B3B2E] text-white">
                <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Description</th>
                <th className="w-32 px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount (KES)</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {form.items.map((item, idx) => (
                <tr key={idx} className="border-b border-slate-100">
                  <td className="px-2 py-1">
                    <input
                      className="h-7 w-full border-0 bg-transparent text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
                      placeholder={`Item ${idx + 1} description…`}
                      value={item.description}
                      onChange={(e) => setItem(idx, "description", e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number" min="0" step="any"
                      className="h-7 w-full border-0 bg-transparent text-right text-xs font-semibold text-slate-800 focus:outline-none"
                      placeholder="0"
                      value={item.amount}
                      onChange={(e) => setItem(idx, "amount", e.target.value)}
                    />
                  </td>
                  <td className="px-1 py-1 text-center">
                    {form.items.length > 1 && (
                      <button type="button" onClick={() => removeItem(idx)}
                        className="text-slate-300 hover:text-red-500">
                        <FaTimes size={10} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-100 bg-slate-50 px-2 py-1">
            <button type="button" onClick={addItem}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:text-[#FF8C00]">
              <FaPlus size={8} /> Add Item
            </button>
          </div>
        </div>
      </div>

      {/* Description + Notes */}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className={lc}>Description</label>
          <input className={ic} placeholder="What was this expense for?" value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
        </div>
        <div>
          <label className={lc}>Notes</label>
          <input className={ic} placeholder="Internal notes…" value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
        </div>
      </div>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
const CarWashExpenses = () => {
  const currentCompany = useSelector(selectCurrentCompany);
  const queryClient = useQueryClient();
  const isConsolidated = !getActiveBranchId();
  const canCreate = useCarWashPermission("carwash-expenses", "create");
  const canUpdate = useCarWashPermission("carwash-expenses", "update");
  const canDelete = useCarWashPermission("carwash-expenses", "delete");

  const [rows,         setRows]         = useState([]);
  const [filters,      setFilters]      = useTabState("/carwash/expenses:filters", defaultFilters);
  const [applied,      setApplied]      = useTabState("/carwash/expenses:applied", defaultFilters);
  const [expandedIds,  setExpandedIds]  = useState([]);
  const [page,         setPage]         = useTabState("/carwash/expenses:page", 1);
  const [pageSize,     setPageSize]     = useTabState("/carwash/expenses:pageSize", 25);
  const [pagination,   setPagination]   = useState({ page: 1, limit: 25, total: 0, pages: 1 });
  const [summary,      setSummary]      = useState({ draft: {}, approved: {}, paid: {}, cancelled: {}, totalAmount: 0 });
  const [loading,      setLoading]      = useState(false);

  // Modal state — editingRow=null means "create", otherwise "edit"
  const [showModal,    setShowModal]    = useState(false);
  const [editingRow,   setEditingRow]   = useState(null);
  const [form,         setForm]         = useState(() => readDraft(DRAFT_KEY) || { ...emptyForm });

  // Category management modal
  const [showCatModal, setShowCatModal] = useState(false);
  const [catDraft,     setCatDraft]     = useState([]);
  const [catInput,     setCatInput]     = useState("");

  // Reference data — cached 5 min so navigating away and back is instant
  const { data: cashbooksRaw } = useQuery({
    queryKey: ["cw-expense-cashbooks", currentCompany?._id],
    queryFn: async () => {
      const res = await carWashApi.listChartOfAccounts({ business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks" });
      return (Array.isArray(res) ? res : []).filter((cb) => String(cb?.subGroup || "").toLowerCase().includes("cashbook") && cb.isPosting !== false);
    },
    enabled: !!currentCompany?._id,
    staleTime: 5 * 60_000,
  });
  const cashbooks = cashbooksRaw ?? [];

  const { data: categoriesRaw } = useQuery({
    queryKey: ["cw-expense-categories"],
    queryFn: async () => {
      const res = await carWashApi.getExpenseCategories();
      const list = Array.isArray(res?.categories) ? res.categories : (Array.isArray(res) ? res : DEFAULT_CATEGORIES);
      return list.length > 0 ? list : DEFAULT_CATEGORIES;
    },
    staleTime: 5 * 60_000,
    placeholderData: DEFAULT_CATEGORIES,
  });
  const categories = categoriesRaw ?? DEFAULT_CATEGORIES;

  const { data: branchesRaw } = useQuery({
    queryKey: ["cw-branches-all"],
    queryFn: () => carWashApi.listBranches({ limit: 100 }),
    enabled: isConsolidated,
    staleTime: 5 * 60_000,
  });
  const branches = normalizeListPayload(branchesRaw, "branches");

  // ── Data loaders ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await carWashApi.listExpenses({ ...applied, limit: pageSize, page });
      setRows(normalizeListPayload(payload, "expenses"));
      setPagination(payload?.pagination || { page, limit: pageSize, total: 0, pages: 1 });
      setSummary(payload?.summary || { draft: {}, approved: {}, paid: {}, cancelled: {}, totalAmount: 0 });
      setExpandedIds([]);
    } catch { toast.error("Failed to load expenses"); }
    finally { setLoading(false); }
  }, [applied, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  // Auto-select the best cashbook when cashbooks first arrive and form has none yet
  useEffect(() => {
    if (!cashbooks.length) return;
    setForm((p) => p.cashbookAccount ? p : { ...p, cashbookAccount: preferredCashbook(cashbooks, p.method) });
  }, [cashbooks]);

  // Auto-save draft for create form only
  useEffect(() => {
    if (editingRow) return; // don't draft-save edit state
    const dirty = form.items.some((i) => i.description || i.amount) || form.payee || form.description;
    if (!dirty) { clearDraft(DRAFT_KEY); return; }
    const t = setTimeout(() => writeDraft(DRAFT_KEY, form), 400);
    return () => clearTimeout(t);
  }, [form, editingRow]);

  const pageTotal = useMemo(() => rows.reduce((s, r) => s + Number(r.amount || 0), 0), [rows]);

  // ── Category management ──────────────────────────────────────────────────────
  const openCatModal = () => { setCatDraft([...categories]); setCatInput(""); setShowCatModal(true); };
  const addCatItem   = () => {
    const v = catInput.trim();
    if (!v || catDraft.includes(v)) return;
    setCatDraft((p) => [...p, v]);
    setCatInput("");
  };
  const removeCat = (idx) => setCatDraft((p) => p.filter((_, i) => i !== idx));
  const saveCats  = async () => {
    if (catDraft.length === 0) { toast.error("At least one category is required"); return; }
    try {
      const res  = await carWashApi.updateExpenseCategories(catDraft);
      const list = Array.isArray(res?.categories) ? res.categories : catDraft;
      queryClient.setQueryData(["cw-expense-categories"], list);
      setShowCatModal(false);
      toast.success("Categories saved");
    } catch { toast.error("Failed to save categories"); }
  };

  // ── Filter handlers ──────────────────────────────────────────────────────────
  const applyFilters = (e) => { e.preventDefault(); setPage(1); setApplied({ ...filters }); };
  const resetFilters = () => { setFilters(defaultFilters); setPage(1); setApplied(defaultFilters); };

  // ── Modal handlers ───────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingRow(null);
    setForm((p) => ({ ...p, cashbookAccount: p.cashbookAccount || preferredCashbook(cashbooks, p.method) }));
    setShowModal(true);
  };

  const openEdit = (row) => {
    setEditingRow(row);
    setForm({
      expenseDate:    (row.expenseDate || todayISO()).slice(0, 10),
      payee:          row.payee        || "",
      category:       row.category     || "Supplies",
      description:    row.description  || "",
      method:         row.method       || "cash",
      cashbookAccount: row.cashbookAccount?._id || row.cashbookAccount || "",
      reference:      row.reference    || "",
      status:         row.status       || "draft",
      notes:          row.notes        || "",
      items: row.items?.length > 0
        ? row.items.map((i) => ({ description: i.description, amount: String(i.amount) }))
        : [{ description: row.description || "", amount: String(row.amount || "") }],
    });
    setShowModal(true);
  };

  const closeModal = () => {
    if (!editingRow) clearDraft(DRAFT_KEY);
    setShowModal(false);
    setEditingRow(null);
    setForm({ ...emptyForm, cashbookAccount: preferredCashbook(cashbooks, emptyForm.method) });
  };

  const handleSubmit = async () => {
    if (isConsolidated && !editingRow && !form.branch) { toast.error("Select a branch for this expense"); return; }
    const validItems = form.items.filter((i) => String(i.description).trim() && Number(i.amount) > 0);
    if (validItems.length === 0) { toast.error("Add at least one item with a description and amount"); return; }
    const amount  = validItems.reduce((s, i) => s + Number(i.amount), 0);
    if (form.status === "paid" && !form.cashbookAccount) { toast.error("Select the cashbook for this paid expense"); return; }
    const payload = {
      ...form, amount,
      items: validItems.map((i) => ({ description: String(i.description).trim(), amount: Number(i.amount) })),
      cashbookAccount: form.cashbookAccount || null,
    };
    try {
      if (editingRow) {
        await carWashApi.updateExpense(editingRow._id, payload);
        toast.success("Expense updated");
      } else {
        await carWashApi.createExpense(payload);
        toast.success("Expense recorded");
      }
      closeModal();
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Unable to save expense");
    }
  };

  // ── Row actions ──────────────────────────────────────────────────────────────
  const updateStatus = async (row, status) => {
    if (status === row.status) return;
    let notes = row.notes || "";
    if (status === "cancelled") {
      const input = window.prompt(`Reason for cancelling ${row.expenseNumber}?`, notes);
      if (input === null) return;
      notes = input;
    }
    const cashbookAccount =
      row.cashbookAccount?._id || row.cashbookAccount ||
      (status === "paid" ? preferredCashbook(cashbooks, row.method) : null);
    if (status === "paid" && !cashbookAccount) { toast.error("Select a cashbook before marking as paid"); return; }
    try {
      await carWashApi.updateExpenseStatus(row._id, { status, notes, cashbookAccount });
      await load();
      toast.success("Expense updated");
    } catch (err) { toast.error(err?.response?.data?.message || "Unable to update expense"); }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete draft expense ${row.expenseNumber}? This cannot be undone.`)) return;
    try {
      await carWashApi.deleteExpense(row._id);
      toast.success("Expense deleted");
      await load();
    } catch (err) { toast.error(err?.response?.data?.message || "Unable to delete expense"); }
  };

  const toggleExpanded = (id) => setExpandedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const colSpan = isConsolidated ? 10 : 9;

  return (
    <CarWashShell
      title="Expenses Register"
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          {canUpdate && (
            <button type="button" onClick={openCatModal} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
              <FaCog /> Categories
            </button>
          )}
          {canCreate && (
            <button type="button" onClick={openCreate} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]">
              <FaPlus /> New Expense
            </button>
          )}
        </>
      }
    >
      {/* Filters */}
      <form onSubmit={applyFilters} className="mb-2 flex-shrink-0 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 sm:grid-cols-2 xl:grid-cols-[160px_150px_200px_150px_220px_1fr_auto_auto]">
        <input type="date" className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.date} onChange={(e) => setFilters((p) => ({ ...p, date: e.target.value }))} />
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
          <option value="">All status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={filters.category} onChange={(e) => setFilters((p) => ({ ...p, category: e.target.value }))}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={filters.method} onChange={(e) => setFilters((p) => ({ ...p, method: e.target.value }))}>
          <option value="">All methods</option>
          {METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
        </select>
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={filters.cashbookAccount} onChange={(e) => setFilters((p) => ({ ...p, cashbookAccount: e.target.value }))}>
          <option value="">All cashbooks</option>
          {cashbooks.map((cb) => <option key={cb._id} value={cb._id}>{cb.code} – {cb.name}</option>)}
        </select>
        <input className="h-8 border border-slate-300 px-2 text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          placeholder="Payee / ref / description"
          value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} />
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]"><FaSearch /> Search</button>
        <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]"><FaRedoAlt /> Reset</button>
      </form>

      {/* Table container */}
      <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
        {/* Summary bar */}
        <div className="flex-shrink-0 flex min-h-8 flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing <strong className="text-[#0B3B2E]">{rows.length}</strong> / {pagination.total}</span>
          <span>Page Total <strong className="text-[#0B3B2E]">{formatMoney(pageTotal)}</strong></span>
          <span>Total <strong className="text-[#0B3B2E]">{formatMoney(summary?.totalAmount)}</strong></span>
          <span>Paid <strong className="text-emerald-700">{formatMoney(summary?.paid?.amount)}</strong></span>
          <span>Draft <strong>{summary?.draft?.count || 0}</strong></span>
          <span>Approved <strong className="text-cyan-700">{summary?.approved?.count || 0}</strong></span>
          <span>Cancelled <strong className="text-red-700">{summary?.cancelled?.count || 0}</strong></span>
        </div>

        {/* Mobile */}
        <div className="sm:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-200">
          {rows.length === 0 ? (
            <div className="py-10 text-center text-xs font-semibold text-slate-500">No expenses found for the selected filters.</div>
          ) : rows.map((row) => {
            const expanded = expandedIds.includes(row._id);
            return (
              <div key={row._id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-extrabold text-slate-900">{row.expenseNumber || "—"}</span>
                      <span className={`border px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusBadge[row.status] || statusBadge.draft}`}>{row.status}</span>
                    </div>
                    <div className="mt-0.5 font-semibold text-slate-800">{row.payee || "—"}</div>
                    <div className="text-[11px] text-slate-500">{row.category} · {row.method?.toUpperCase()}</div>
                    <div className="text-[10px] text-slate-400">{fmtDate(row.expenseDate)}</div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="font-extrabold text-slate-900">{formatMoney(row.amount)}</div>
                    {!["cancelled"].includes(row.status) && (
                      <select className={`mt-1 h-6 border px-1.5 text-[10px] font-bold uppercase ${statusBadge[row.status] || statusBadge.draft}`}
                        value={row.status} onChange={(e) => updateStatus(row, e.target.value)}>
                        {statusOptionsFor(row.status).map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                      </select>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" onClick={() => toggleExpanded(row._id)}
                    className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">
                    {expanded ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />} Details
                  </button>
                  {canUpdate && ["draft", "approved"].includes(row.status) && (
                    <button type="button" onClick={() => openEdit(row)}
                      className="inline-flex items-center gap-1 border border-slate-300 px-2.5 py-1 text-xs font-bold text-[#0B3B2E] hover:bg-slate-50">
                      <FaEdit size={9} /> Edit
                    </button>
                  )}
                  {canDelete && row.status === "draft" && (
                    <button type="button" onClick={() => handleDelete(row)}
                      className="inline-flex items-center gap-1 border border-red-200 px-2.5 py-1 text-xs font-bold text-red-500 hover:bg-red-50">
                      <FaTrashAlt size={9} />
                    </button>
                  )}
                </div>
                {expanded && row.items?.length > 0 && (
                  <ul className="mt-2 space-y-0.5 border border-slate-100 bg-slate-50 p-2 text-[11px] text-slate-700">
                    {row.items.map((item, i) => (
                      <li key={i} className="flex justify-between">
                        <span>{item.description}</span>
                        <span className="font-semibold">{formatMoney(item.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:flex sm:flex-col sm:flex-1 sm:min-h-0 sm:overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <table className="w-full min-w-[1080px] text-xs">
              <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                <tr>
                  <th className="w-8 px-2 py-1.5" />
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Date</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Expense #</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Payee</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Category</th>
                  {isConsolidated && <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Branch</th>}
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Method</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Cashbook</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={colSpan} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">No expenses found for the selected filters.</td></tr>
                ) : rows.map((row) => {
                  const expanded = expandedIds.includes(row._id);
                  return (
                    <React.Fragment key={row._id}>
                      <tr className="border-b border-slate-200 hover:bg-slate-50">
                        <td className="px-2 py-1">
                          <button type="button" onClick={() => toggleExpanded(row._id)} className="text-[#0B3B2E] hover:text-[#FF8C00]">
                            {expanded ? <FaChevronDown /> : <FaChevronRight />}
                          </button>
                        </td>
                        <td className="px-2 py-1 text-slate-700">{fmtDate(row.expenseDate)}</td>
                        <td className="px-2 py-1 font-extrabold text-slate-900">{row.expenseNumber || "—"}</td>
                        <td className="px-2 py-1 font-semibold text-slate-800">{row.payee || "—"}</td>
                        <td className="px-2 py-1 text-slate-700">{row.category || "—"}</td>
                        {isConsolidated && <td className="px-2 py-1 text-slate-600">{row.branch?.name || <span className="text-slate-400">—</span>}</td>}
                        <td className="px-2 py-1 font-bold uppercase text-slate-700">{row.method || "—"}</td>
                        <td className="px-2 py-1 text-slate-700">{row.cashbookAccount ? `${row.cashbookAccount.code || ""} ${row.cashbookAccount.name || ""}`.trim() : "—"}</td>
                        <td className="px-2 py-1">
                          <select
                            className={`h-6 border px-2 text-[11px] font-bold uppercase ${statusBadge[row.status] || statusBadge.draft}`}
                            value={row.status}
                            disabled={row.status === "cancelled"}
                            onChange={(e) => updateStatus(row, e.target.value)}
                          >
                            {statusOptionsFor(row.status).map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.amount)}</td>
                      </tr>

                      {expanded && (
                        <tr className="border-b border-slate-200 bg-[#F8FBF9]">
                          <td colSpan={colSpan} className="px-8 py-3">
                            <div className="grid gap-3 text-[11px] text-slate-600 md:grid-cols-5">
                              <div><span className="font-extrabold uppercase text-slate-500">Reference:</span> {row.reference || "—"}</div>
                              <div><span className="font-extrabold uppercase text-slate-500">Created By:</span> {userName(row.createdBy)}</div>
                              <div><span className="font-extrabold uppercase text-slate-500">Approved By:</span> {userName(row.approvedBy)}</div>
                              <div><span className="font-extrabold uppercase text-slate-500">Paid By:</span> {userName(row.paidBy)}</div>
                              <div><span className="font-extrabold uppercase text-slate-500">Paid At:</span> {row.paidAt ? new Date(row.paidAt).toLocaleString("en-KE") : "—"}</div>
                              {row.description && <div className="md:col-span-3"><span className="font-extrabold uppercase text-slate-500">Description:</span> {row.description}</div>}
                              {row.notes       && <div className="md:col-span-2"><span className="font-extrabold uppercase text-slate-500">Notes:</span> {row.notes}</div>}
                              {row.items?.length > 0 && (
                                <div className="md:col-span-5">
                                  <span className="font-extrabold uppercase text-slate-500">Items:</span>
                                  <div className="mt-1 overflow-x-auto">
                                    <table className="min-w-[300px] text-[11px]">
                                      <thead><tr className="border-b border-slate-200">
                                        <th className="pb-1 pr-4 text-left font-extrabold uppercase text-slate-500">Description</th>
                                        <th className="pb-1 text-right font-extrabold uppercase text-slate-500">Amount</th>
                                      </tr></thead>
                                      <tbody>
                                        {row.items.map((item, i) => (
                                          <tr key={i} className="border-b border-slate-100">
                                            <td className="py-0.5 pr-4 text-slate-700">{item.description}</td>
                                            <td className="py-0.5 text-right font-semibold tabular-nums text-slate-800">{formatMoney(item.amount)}</td>
                                          </tr>
                                        ))}
                                        <tr>
                                          <td className="pt-1 font-extrabold uppercase text-slate-500">Total</td>
                                          <td className="pt-1 text-right font-extrabold text-slate-900">{formatMoney(row.amount)}</td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}
                            </div>
                            {/* Row actions */}
                            <div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-2">
                              {canUpdate && ["draft", "approved"].includes(row.status) && (
                                <button type="button" onClick={() => openEdit(row)}
                                  className="inline-flex items-center gap-1.5 border border-slate-300 px-2.5 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-slate-100">
                                  <FaEdit size={9} /> Edit Expense
                                </button>
                              )}
                              {canDelete && row.status === "draft" && (
                                <button type="button" onClick={() => handleDelete(row)}
                                  className="inline-flex items-center gap-1.5 border border-red-200 px-2.5 py-1 text-[11px] font-bold text-red-500 hover:bg-red-50">
                                  <FaTrashAlt size={9} /> Delete Draft
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <PaginationBar
          page={pagination.page}
          pages={pagination.pages}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          loading={loading}
        />
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <Modal
          title={editingRow ? `Edit — ${editingRow.expenseNumber}` : "Record Expense"}
          onClose={closeModal}
          onSubmit={handleSubmit}
          submitLabel={editingRow ? "Save Changes" : "Save Expense"}
        >
          <ExpenseForm form={form} setForm={setForm} cashbooks={cashbooks} categories={categories} isEditing={!!editingRow} branches={branches} isConsolidated={isConsolidated} />
        </Modal>
      )}

      {/* Category Management Modal */}
      {showCatModal && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
          <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-md sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[80vh] rounded-t-2xl sm:rounded-none">
            <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
              <h2 className="text-sm font-extrabold uppercase tracking-wide">Manage Categories</h2>
              <button type="button" onClick={() => setShowCatModal(false)} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  className="h-8 flex-1 border border-slate-300 px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                  placeholder="New category name…"
                  value={catInput}
                  onChange={(e) => setCatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCatItem(); } }}
                />
                <button type="button" onClick={addCatItem}
                  className="inline-flex h-8 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]">
                  <FaPlus size={9} /> Add
                </button>
              </div>
              <ul className="space-y-1">
                {catDraft.map((cat, idx) => (
                  <li key={idx} className="flex items-center justify-between border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800">
                    {cat}
                    <button type="button" onClick={() => removeCat(idx)} className="text-slate-400 hover:text-red-500">
                      <FaTimes size={10} />
                    </button>
                  </li>
                ))}
                {catDraft.length === 0 && (
                  <li className="py-4 text-center text-xs text-slate-400">No categories. Add at least one.</li>
                )}
              </ul>
            </div>
            <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setShowCatModal(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={saveCats} className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]">Save Categories</button>
            </div>
          </div>
        </div>
      )}
    </CarWashShell>
  );
};

export default CarWashExpenses;

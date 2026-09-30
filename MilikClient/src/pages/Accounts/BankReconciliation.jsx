import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaCheck, FaCheckSquare, FaFileDownload, FaFilePdf, FaLock,
  FaPlus, FaSearch, FaSyncAlt, FaTimes, FaTrash, FaUndo,
} from "react-icons/fa";
import { printTabularList } from "../../utils/printList";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import MilikTable from "../../components/common/MilikTable";
import {
  getBankReconciliationAccounts, getReconciliationEntries,
  getReconciliations, createReconciliation, saveReconciliation,
  finalizeReconciliation, deleteReconciliation,
} from "../../redux/apiCalls";
import { fmtDate } from "../../utils/dates";
import { useConfirm } from "../../context/ConfirmContext";

const GRN = "#0B3B2E";
const fmt = (v) => Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const localDate = (d) => { const dt = new Date(d); const y = dt.getFullYear(); const m = String(dt.getMonth()+1).padStart(2,"0"); const day = String(dt.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; };
const todayStr  = () => localDate(new Date());
const firstOfMonth = () => { const d = new Date(); return localDate(new Date(d.getFullYear(), d.getMonth(), 1)); };

// ── Views: LIST or RECONCILE ──────────────────────────────────────────────────
const VIEW = { LIST: "list", RECONCILE: "reconcile" };

const BankReconciliation = () => {
  const confirm     = useConfirm();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const businessId     = currentCompany?._id;

  // ── Global state ──────────────────────────────────────────────────────────
  const [view,     setView]     = useTabState("/accounts/bank-reconciliation:view", VIEW.LIST);
  const [accounts, setAccounts] = useState([]);
  const [history,  setHistory]  = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ── New / active reconciliation ───────────────────────────────────────────
  const [activeRecon,   setActiveRecon]   = useState(null);  // saved BankReconciliation doc
  const [entries,       setEntries]       = useState([]);
  const [cleared,       setCleared]       = useState(new Set()); // Set of entry _id strings
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [search,        setSearch]        = useTabState("/accounts/bank-reconciliation:search", "");

  // ── New reconciliation form ────────────────────────────────────────────────
  const [formAccount,   setFormAccount]   = useState("");
  const [formFrom,      setFormFrom]      = useState(firstOfMonth());
  const [formTo,        setFormTo]        = useState(todayStr());
  const [formOpenBal,   setFormOpenBal]   = useState("");
  const [formCloseBal,  setFormCloseBal]  = useState("");
  const [formNotes,     setFormNotes]     = useState("");
  const [creating,      setCreating]      = useState(false);
  const [showNewForm,   setShowNewForm]   = useState(false);

  // ── Fetch all paginated entry pages and accumulate ────────────────────────
  const fetchAllEntries = useCallback(async ({ business, account, from, to }, initial = [], initialCursor = null) => {
    let all = [...initial];
    let cursor = initialCursor;
    while (cursor) {
      const page = await getReconciliationEntries({ business, account, from, to, after: cursor });
      all = [...all, ...(page.entries || [])];
      cursor = page.nextCursor || null;
    }
    return all;
  }, []);

  // ── Load accounts + history ───────────────────────────────────────────────
  const loadInitial = useCallback(async () => {
    if (!businessId) return;
    setLoadingHistory(true);
    try {
      const [accs, hist] = await Promise.all([
        getBankReconciliationAccounts({ business: businessId }),
        getReconciliations({ business: businessId }),
      ]);
      setAccounts(Array.isArray(accs)  ? accs  : []);
      setHistory( Array.isArray(hist)  ? hist  : []);
    } catch {
      toast.error("Failed to load reconciliation data");
    } finally {
      setLoadingHistory(false);
    }
  }, [businessId]);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  // ── Open a saved reconciliation ────────────────────────────────────────────
  const openRecon = useCallback(async (recon) => {
    setLoadingEntries(true);
    try {
      const full = await getReconciliations({ id: recon._id });
      const accountId = full.account?._id || full.account;
      let allEntries = full.entries || [];
      if (full.hasMore) {
        allEntries = await fetchAllEntries(
          { business: businessId, account: accountId, from: localDate(full.periodStart), to: localDate(full.periodEnd) },
          allEntries,
          full.nextCursor
        );
      }
      setActiveRecon(full);
      setEntries(allEntries);
      setCleared(new Set((full.clearedEntries || []).map(String)));
      setSearch("");
      setView(VIEW.RECONCILE);
    } catch {
      toast.error("Failed to load reconciliation");
    } finally {
      setLoadingEntries(false);
    }
  }, [businessId, fetchAllEntries]);

  // ── Create new reconciliation ──────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!formAccount) return toast.error("Select an account");
    if (!formFrom || !formTo) return toast.error("Select date range");
    if (!formCloseBal) return toast.error("Enter bank statement closing balance");

    setCreating(true);
    try {
      const recon = await createReconciliation({
        business:               businessId,
        account:                formAccount,
        periodStart:            formFrom,
        periodEnd:              formTo,
        statementOpeningBalance: Number(formOpenBal) || 0,
        statementClosingBalance: Number(formCloseBal) || 0,
        notes:                  formNotes,
      });
      // Load entries for this period (cursor-paginated, accumulate all pages)
      const firstPage = await getReconciliationEntries({
        business: businessId,
        account:  formAccount,
        from:     formFrom,
        to:       formTo,
      });
      let allEnts = firstPage.entries || [];
      if (firstPage.hasMore) {
        allEnts = await fetchAllEntries(
          { business: businessId, account: formAccount, from: formFrom, to: formTo },
          allEnts,
          firstPage.nextCursor
        );
      }
      setActiveRecon({ ...recon, entries: allEnts });
      setEntries(allEnts);
      setCleared(new Set());
      setSearch("");
      setShowNewForm(false);
      setView(VIEW.RECONCILE);
      // Refresh history
      const hist = await getReconciliations({ business: businessId });
      setHistory(Array.isArray(hist) ? hist : []);
    } catch {
      toast.error("Failed to create reconciliation");
    } finally {
      setCreating(false);
    }
  }, [businessId, formAccount, formFrom, formTo, formOpenBal, formCloseBal, formNotes, fetchAllEntries]);

  // ── Toggle a single entry cleared/uncleared ────────────────────────────────
  const toggleEntry = useCallback((entryId) => {
    setCleared((prev) => {
      const next = new Set(prev);
      next.has(entryId) ? next.delete(entryId) : next.add(entryId);
      return next;
    });
  }, []);

  // ── Select/clear all visible ───────────────────────────────────────────────
  const visibleIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries
      .filter((e) => !q ||
        (e.notes || "").toLowerCase().includes(q) ||
        (e.sourceTransactionType || "").toLowerCase().includes(q) ||
        (e.category || "").toLowerCase().includes(q) ||
        String(e.amount || "").includes(q)
      )
      .map((e) => String(e._id));
  }, [entries, search]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      (e.notes || "").toLowerCase().includes(q) ||
      (e.sourceTransactionType || "").toLowerCase().includes(q) ||
      (e.category || "").toLowerCase().includes(q) ||
      String(e.amount || "").includes(q)
    );
  }, [entries, search]);

  const allVisibleCleared = visibleIds.length > 0 && visibleIds.every((id) => cleared.has(id));

  const toggleAll = useCallback(() => {
    setCleared((prev) => {
      const next = new Set(prev);
      if (allVisibleCleared) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [allVisibleCleared, visibleIds]);

  // ── Reconciliation maths ──────────────────────────────────────────────────
  const summary = useMemo(() => {
    const openBal  = Number(activeRecon?.statementOpeningBalance || 0);
    const closeBal = Number(activeRecon?.statementClosingBalance || 0);

    let totalDebits = 0, totalCredits = 0;
    let clearedDebits = 0, clearedCredits = 0;

    for (const e of entries) {
      const amt = Number(e.amount || 0);
      if (e.direction === "debit")  { totalDebits  += amt; if (cleared.has(String(e._id))) clearedDebits  += amt; }
      if (e.direction === "credit") { totalCredits += amt; if (cleared.has(String(e._id))) clearedCredits += amt; }
    }

    const bookBalance    = openBal + totalDebits - totalCredits;
    const clearedBalance = openBal + clearedDebits - clearedCredits;
    const difference     = closeBal - clearedBalance;

    return { openBal, closeBal, bookBalance, clearedBalance, difference, clearedDebits, clearedCredits, totalDebits, totalCredits };
  }, [activeRecon, entries, cleared]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!activeRecon?._id) return;
    setSaving(true);
    try {
      await saveReconciliation(activeRecon._id, {
        clearedEntries: [...cleared],
        difference:     summary.difference,
      });
      toast.success("Progress saved");
      const hist = await getReconciliations({ business: businessId });
      setHistory(Array.isArray(hist) ? hist : []);
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [activeRecon, cleared, summary.difference, businessId]);

  // ── Finalise ──────────────────────────────────────────────────────────────
  const handleFinalize = useCallback(async () => {
    if (!activeRecon?._id) return;
    if (Math.abs(summary.difference) > 0.005)
      return toast.error(`Cannot finalise — difference is KES ${fmt(summary.difference)}. Clear all matching entries first.`);

    setSaving(true);
    try {
      // Save cleared state then finalise
      await saveReconciliation(activeRecon._id, {
        clearedEntries: [...cleared],
        difference:     summary.difference,
      });
      await finalizeReconciliation(activeRecon._id, { business: businessId });
      setActiveRecon((prev) => ({ ...prev, status: "reconciled" }));
      toast.success("Reconciliation finalised and locked");
      const hist = await getReconciliations({ business: businessId });
      setHistory(Array.isArray(hist) ? hist : []);
    } catch {
      toast.error("Failed to finalise");
    } finally {
      setSaving(false);
    }
  }, [activeRecon, cleared, summary.difference, businessId]);

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (reconId, e) => {
    e.stopPropagation();
    if (!(await confirm({ title: 'Delete Reconciliation', message: 'Delete this draft reconciliation?', confirmText: 'Delete', isDangerous: true }))) return;
    try {
      await deleteReconciliation(reconId, { business: businessId });
      setHistory((prev) => prev.filter((r) => r._id !== reconId));
      toast.success("Deleted");
    } catch {
      toast.error("Failed to delete");
    }
  }, [businessId]);

  // ── Back to list ──────────────────────────────────────────────────────────
  const backToList = useCallback(() => {
    setActiveRecon(null);
    setEntries([]);
    setCleared(new Set());
    setView(VIEW.LIST);
  }, []);

  // ── Escaping for PDF ──────────────────────────────────────────────────────
  // ── Print PDF ────────────────────────────────────────────────────────
  const handlePrintPDF = useCallback(() => {
    const printed = printTabularList({
      title: "Bank Reconciliation",
      subtitle: `${activeRecon?.accountCode || ""} ${activeRecon?.accountName || ""} · ${fmtDate(activeRecon?.periodStart)} to ${fmtDate(activeRecon?.periodEnd)}`,
      company: currentCompany,
      orientation: "portrait",
      summaryItems: [
        ["Opening balance", fmt(summary.openBal)],
        ["Closing balance", fmt(summary.closeBal)],
        ["Cleared balance", fmt(summary.clearedBalance)],
        ["Difference", fmt(summary.difference)],
      ],
      columns: [
        { label: "Date", value: (e) => fmtDate(e.transactionDate) },
        { label: "Description", value: (e) => e.notes || e.category || "" },
        { label: "Debit (in)", align: "right", value: (e) => (e.direction === "debit" ? fmt(Number(e.amount || 0)) : "") },
        { label: "Credit (out)", align: "right", value: (e) => (e.direction === "credit" ? fmt(Number(e.amount || 0)) : "") },
        { label: "Cleared", value: (e) => (cleared.has(String(e._id)) ? "✓" : "") },
      ],
      rows: entries,
      totalsRow: ["Difference", "", "", fmt(summary.difference), ""],
      signatures: [{ label: "Prepared by" }, { label: "Reviewed by" }],
    });
    if (!printed) toast.error("Pop-ups blocked");
  }, [entries, cleared, summary, activeRecon, currentCompany]);

  const isLocked = activeRecon?.status === "reconciled";

  // ── Render: LIST view ─────────────────────────────────────────────────────
  if (view === VIEW.LIST) {
    return (
      <DashboardLayout lockContentScroll>
        <div className="flex h-[calc(100dvh-152px)] flex-col overflow-hidden">

          {/* Toolbar */}
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-gray-50/95 px-4 py-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bank Reconciliation</p>
            <div className="flex-1" />
            <button
              onClick={() => setShowNewForm(true)}
              className="flex h-7 items-center gap-1.5 rounded px-3 text-xs font-semibold text-white"
              style={{ backgroundColor: GRN }}
            >
              <FaPlus size={9} /> New Reconciliation
            </button>
            <button
              onClick={loadInitial} disabled={loadingHistory}
              className="flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <FaSyncAlt size={10} className={loadingHistory ? "animate-spin" : ""} />
            </button>
          </div>

          {/* New Reconciliation Form */}
          {showNewForm && (
            <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">New Reconciliation</p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-0.5 min-w-[220px]">
                  <label className="mb-0.5 block text-xs font-semibold text-slate-700">Account</label>
                  <AppSelect
                    value={formAccount}
                    onChange={(v) => setFormAccount(v ?? "")}
                    options={accounts.map((a) => ({ value: a._id, label: `${a.code} — ${a.name}` }))}
                    placeholder="Select account…"
                    searchable
                    size="sm"
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="mb-0.5 block text-xs font-semibold text-slate-700">Period From</label>
                  <input type="date" value={formFrom} onChange={(e) => setFormFrom(e.target.value)}
                    className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="mb-0.5 block text-xs font-semibold text-slate-700">Period To</label>
                  <input type="date" value={formTo} onChange={(e) => setFormTo(e.target.value)}
                    className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="mb-0.5 block text-xs font-semibold text-slate-700">Opening Bal (KES)</label>
                  <input type="number" value={formOpenBal} onChange={(e) => setFormOpenBal(e.target.value)}
                    placeholder="0.00"
                    className="w-32 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="mb-0.5 block text-xs font-semibold text-slate-700">Closing Bal (KES) <span className="text-red-500">*</span></label>
                  <input type="number" value={formCloseBal} onChange={(e) => setFormCloseBal(e.target.value)}
                    placeholder="0.00"
                    className="w-32 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="mb-0.5 block text-xs font-semibold text-slate-700">Notes</label>
                  <input type="text" value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Optional notes…"
                    className="w-44 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <button
                  onClick={handleCreate} disabled={creating}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60"
                >
                  {creating ? <FaSyncAlt size={9} className="animate-spin" /> : <FaCheck size={9} />}
                  {creating ? "Creating…" : "Start"}
                </button>
                <button
                  onClick={() => setShowNewForm(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <FaTimes size={9} /> Cancel
                </button>
              </div>
            </div>
          )}

          {/* History list */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <MilikTable
              columns={[
                { label: "Account" },
                { label: "Period" },
                { label: "Statement Balance (KES)", align: "right" },
                { label: "Difference (KES)", align: "right" },
                { label: "Status", align: "center" },
                { label: "Notes" },
              ]}
              rows={history}
              rowKey="_id"
              loading={loadingHistory}
              empty="No reconciliations yet. Click “New Reconciliation” to get started."
              onRowClick={openRecon}
              renderActions={(r) => r.status !== "reconciled" && (
                <button
                  onClick={(e) => handleDelete(r._id, e)}
                  className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                  title="Delete draft"
                >
                  <FaTrash size={10} />
                </button>
              )}
              renderRow={(r) => (
                <>
                  <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">
                    <span className="font-mono text-slate-400 mr-1">{r.accountCode || r.account?.code}</span>
                    {r.accountName || r.account?.name}
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 text-slate-500">
                    {fmtDate(r.periodStart)} — {fmtDate(r.periodEnd)}
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-semibold text-slate-700">
                    {fmt(r.statementClosingBalance)}
                  </td>
                  <td className={`px-3 py-1 border-r border-gray-100 text-right font-mono font-semibold ${Math.abs(r.difference) < 0.005 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmt(r.difference)}
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 text-center">
                    {r.status === "reconciled" ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <FaLock size={8} /> Finalised
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
                        Draft
                      </span>
                    )}
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-1 border-r border-gray-100 text-slate-400" title={r.notes}>{r.notes || "—"}</td>
                </>
              )}
            />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ── Render: RECONCILE view ────────────────────────────────────────────────
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-[calc(100dvh-152px)] flex-col overflow-hidden">

        {/* Toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-gray-50/95 px-4 py-2 backdrop-blur-sm">
          <button
            onClick={backToList}
            className="flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            ← Back
          </button>

          <div className="mx-1 h-5 w-px bg-slate-200" />

          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              {activeRecon?.accountCode} {activeRecon?.accountName}
            </span>
            <span className="mx-1.5 text-slate-300">·</span>
            <span className="text-[10px] text-slate-500">
              {fmtDate(activeRecon?.periodStart)} — {fmtDate(activeRecon?.periodEnd)}
            </span>
            {isLocked && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
                <FaLock size={7} /> Finalised
              </span>
            )}
          </div>

          <div className="mx-1 h-5 w-px bg-slate-200" />

          {/* Search */}
          <div className="relative">
            <FaSearch size={9} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter entries…"
              className="h-7 w-44 rounded border border-slate-200 bg-white pl-6 pr-2 text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
            />
          </div>

          <div className="flex-1" />

          <button
            onClick={handlePrintPDF}
            className="flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <FaFilePdf size={10} /> PDF
          </button>

          {!isLocked && (
            <>
              <button
                onClick={handleSave} disabled={saving}
                className="flex h-7 items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                {saving ? <FaSyncAlt size={9} className="animate-spin" /> : null}
                Save Progress
              </button>
              <button
                onClick={handleFinalize} disabled={saving || Math.abs(summary.difference) > 0.005}
                className="flex h-7 items-center gap-1.5 rounded px-3 text-xs font-semibold text-white disabled:opacity-40"
                style={{ backgroundColor: Math.abs(summary.difference) < 0.005 ? "#059669" : "#94a3b8" }}
                title={Math.abs(summary.difference) > 0.005 ? "Clear all matching entries first (difference must be 0)" : "Finalise reconciliation"}
              >
                <FaLock size={9} /> Finalise
              </button>
            </>
          )}
        </div>

        {/* Summary strip */}
        <div className="grid shrink-0 grid-cols-5 divide-x divide-slate-200 border-b border-slate-200 bg-white">
          {[
            { label: "Opening Balance",  value: summary.openBal,       color: "text-slate-700" },
            { label: "Statement Balance", value: summary.closeBal,      color: "text-slate-700" },
            { label: "Book Balance",      value: summary.bookBalance,   color: "text-slate-700" },
            { label: "Cleared Balance",   value: summary.clearedBalance, color: "text-slate-700" },
            {
              label: "Difference",
              value: summary.difference,
              color: Math.abs(summary.difference) < 0.005 ? "text-emerald-600" : "text-red-600",
              sub: Math.abs(summary.difference) < 0.005 ? "Balanced ✓" : "Unreconciled",
            },
          ].map(({ label, value, color, sub }) => (
            <div key={label} className="flex flex-col items-start px-4 py-2.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</span>
              <span className={`mt-0.5 font-mono text-sm font-black leading-tight ${color}`}>{fmt(value)}</span>
              {sub && <span className={`text-[9px] font-semibold ${color}`}>{sub}</span>}
            </div>
          ))}
        </div>

        {/* Entries table */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <MilikTable
            columns={[
              { label: "Date" },
              { label: "Description / Category" },
              { label: "Type" },
              { label: "Debit (In)", align: "right" },
              { label: "Credit (Out)", align: "right" },
              { label: "Cleared", align: "center" },
            ]}
            rows={filteredEntries}
            rowKey="_id"
            loading={loadingEntries}
            empty="No ledger entries found for this account and period"
            checkboxes={!isLocked}
            allChecked={allVisibleCleared}
            onCheckAll={toggleAll}
            isChecked={(e) => cleared.has(String(e._id))}
            onCheckRow={(e) => toggleEntry(String(e._id))}
            onRowClick={!isLocked ? (e) => toggleEntry(String(e._id)) : undefined}
            rowClassName={(e) => (cleared.has(String(e._id)) ? "bg-emerald-50/40" : "")}
            renderFooter={() => (
              <>
                <td colSpan={3} className="px-3 py-2 uppercase text-slate-500">
                  {cleared.size} of {entries.length} entries cleared
                </td>
                <td className="px-3 py-2 text-right font-mono text-emerald-700">
                  {fmt(summary.clearedDebits)} <span className="text-[9px] font-normal text-slate-400 ml-1">cleared in</span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-red-600">
                  {fmt(summary.clearedCredits)} <span className="text-[9px] font-normal text-slate-400 ml-1">cleared out</span>
                </td>
                <td />
              </>
            )}
            renderRow={(e) => {
              const id = String(e._id);
              const isClear = cleared.has(id);
              const amt = Number(e.amount || 0);
              return (
                <>
                  <td className="px-3 py-1 border-r border-gray-100 text-slate-500 whitespace-nowrap">{fmtDate(e.transactionDate)}</td>
                  <td className="max-w-[240px] truncate px-3 py-1 border-r border-gray-100 text-slate-700" title={e.notes}>{e.notes || "—"}</td>
                  <td className="px-3 py-1 border-r border-gray-100 text-slate-400 capitalize">{(e.sourceTransactionType || "").replace(/_/g, " ")}</td>
                  <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-semibold">
                    {e.direction === "debit" ? <span className="text-emerald-700">{fmt(amt)}</span> : <span className="text-slate-200">—</span>}
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-semibold">
                    {e.direction === "credit" ? <span className="text-red-600">{fmt(amt)}</span> : <span className="text-slate-200">—</span>}
                  </td>
                  <td className="px-3 py-1 text-center">
                    {isClear && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                        <FaCheck size={7} /> Cleared
                      </span>
                    )}
                  </td>
                </>
              );
            }}
          />
        </div>
      </div>
    </DashboardLayout>
  );
};

export default BankReconciliation;

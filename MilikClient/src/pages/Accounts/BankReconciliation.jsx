import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaCheck, FaCheckSquare, FaChevronDown, FaChevronRight, FaFileDownload, FaFileImport, FaFilePdf, FaLink, FaLock, FaLockOpen,
  FaPlus, FaSearch, FaSyncAlt, FaTimes, FaTrash, FaUndo, FaUnlink,
} from "react-icons/fa";
import { printTabularList } from "../../utils/printList";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import ListToolbar from "../../components/common/ListToolbar";
import AppSelect from "../../components/common/AppSelect";
import MilikTable from "../../components/common/MilikTable";
import StatusBadge from "../../components/common/StatusBadge";
import CurrencyInput from "../../components/common/CurrencyInput";
import ImportModal from "../../components/Modals/ImportModal";
import { parseBankStatementCsv } from "../../utils/parseBankStatementCsv";
import {
  getBankReconciliationAccounts, getReconciliationEntries,
  getReconciliations, createReconciliation, saveReconciliation,
  finalizeReconciliation, reopenReconciliation, deleteReconciliation,
  importBankStatementLines, getStatementLines, matchStatementLine,
  unmatchStatementLine, createTransactionFromStatementLine,
  getChartOfAccounts,
} from "../../redux/apiCalls";
import { fmtDate } from "../../utils/dates";
import { useConfirm } from "../../context/ConfirmContext";
const fmt = (v) => Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const localDate = (d) => { const dt = new Date(d); const y = dt.getFullYear(); const m = String(dt.getMonth()+1).padStart(2,"0"); const day = String(dt.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; };
const todayStr  = () => localDate(new Date());
const firstOfMonth = () => { const d = new Date(); return localDate(new Date(d.getFullYear(), d.getMonth(), 1)); };
const addDay = (dateStr) => { const d = new Date(dateStr); d.setDate(d.getDate() + 1); return localDate(d); };

// House standard — square corners, fixed h-7 height — matching AddLandlord.jsx/CarWashAddJob.jsx.
const labelCls = "mb-1 block text-xs font-bold text-slate-900";
const inputCls = "h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition border-slate-300 focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";

const RECON_STATUS_MAP = {
  reconciled: "border-emerald-200 bg-emerald-50 text-emerald-700",
  draft:      "border-blue-200 bg-blue-50 text-blue-600",
};

// ── Views: LIST or RECONCILE ──────────────────────────────────────────────────
const VIEW = { LIST: "list", RECONCILE: "reconcile" };

const BankReconciliation = () => {
  const confirm     = useConfirm();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const businessId     = currentCompany?._id;

  // ── Global state ──────────────────────────────────────────────────────────
  const [view,     setView]     = useTabState("/accounts/bank-reconciliation:view", VIEW.LIST);
  const [accounts, setAccounts] = useState([]); // postable asset accounts — the ones reconcilable
  const [allAccounts, setAllAccounts] = useState([]); // every postable account — for picking the "other side" of a transaction created from a statement line
  const [history,  setHistory]  = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ── New / active reconciliation ───────────────────────────────────────────
  const [activeRecon,   setActiveRecon]   = useState(null);  // saved BankReconciliation doc
  const [entries,       setEntries]       = useState([]);
  const [cleared,       setCleared]       = useState(new Set()); // Set of entry _id strings
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [search,        setSearch]        = useTabState("/accounts/bank-reconciliation:search", "");

  // ── Statement import + matching ────────────────────────────────────────────
  const [statementLines,        setStatementLines]        = useState([]);
  const [loadingStatementLines, setLoadingStatementLines] = useState(false);
  const [showImportModal,       setShowImportModal]       = useState(false);
  const [showStatementLines,    setShowStatementLines]    = useState(true);
  const [lineActionBusy,        setLineActionBusy]        = useState(""); // statement-line _id currently processing

  // ── Reopen (undo a finalised reconciliation) ───────────────────────────────
  const [reopening,     setReopening]     = useState(false);
  const [reopenReason,  setReopenReason]  = useState("");
  const [reopeningBusy, setReopeningBusy] = useState(false);

  // ── New reconciliation form ────────────────────────────────────────────────
  const [formAccount,   setFormAccount]   = useState("");
  const [formFrom,      setFormFrom]      = useState(firstOfMonth());
  const [formTo,        setFormTo]        = useState(todayStr());
  const [formOpenBal,   setFormOpenBal]   = useState("");
  const [formCloseBal,  setFormCloseBal]  = useState("");
  const [formNotes,     setFormNotes]     = useState("");
  const [creating,      setCreating]      = useState(false);
  const [showNewForm,   setShowNewForm]   = useState(false);
  const [lastRecon,     setLastRecon]     = useState(null); // most recent recon for the selected account — continuity hint

  // Continuity: when an account is picked, prefill Period From (day after the last reconciliation's
  // period end) and Opening Balance (that reconciliation's closing balance) so periods never gap or
  // overlap and the opening figure is never hand-typed wrong. Still fully editable afterward.
  useEffect(() => {
    if (!formAccount || !businessId) { setLastRecon(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const list = await getReconciliations({ business: businessId, account: formAccount });
        if (cancelled) return;
        const last = Array.isArray(list) && list.length ? list[0] : null; // already sorted periodEnd desc
        setLastRecon(last);
        if (last) {
          setFormFrom(addDay(localDate(last.periodEnd)));
          setFormOpenBal(String(last.statementClosingBalance ?? 0));
        }
      } catch { /* silent — continuity is a convenience, not a hard requirement */ }
    })();
    return () => { cancelled = true; };
  }, [formAccount, businessId]);

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

  // ── Statement lines: load + keep clearedEntries/difference in sync with the server after
  //    any match/unmatch/create-transaction action (those mutate the reconciliation server-side) ──
  const loadStatementLines = useCallback(async (reconId) => {
    setLoadingStatementLines(true);
    try {
      const lines = await getStatementLines(reconId);
      setStatementLines(Array.isArray(lines) ? lines : []);
    } catch {
      toast.error("Failed to load statement lines");
    } finally {
      setLoadingStatementLines(false);
    }
  }, []);

  const syncReconFromServer = useCallback((recon) => {
    if (!recon) return;
    setActiveRecon((prev) => ({ ...prev, ...recon }));
    setCleared(new Set((recon.clearedEntries || []).map(String)));
  }, []);

  // ── Load accounts + history ───────────────────────────────────────────────
  const loadInitial = useCallback(async () => {
    if (!businessId) return;
    setLoadingHistory(true);
    try {
      const [accs, hist, allAccs] = await Promise.all([
        getBankReconciliationAccounts({ business: businessId }),
        getReconciliations({ business: businessId }),
        getChartOfAccounts({ business: businessId }),
      ]);
      setAccounts(Array.isArray(accs)  ? accs  : []);
      setHistory( Array.isArray(hist)  ? hist  : []);
      setAllAccounts((Array.isArray(allAccs) ? allAccs : []).filter((a) => a?.isPosting !== false && a?.isHeader !== true));
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
      loadStatementLines(full._id);
    } catch {
      toast.error("Failed to load reconciliation");
    } finally {
      setLoadingEntries(false);
    }
  }, [businessId, fetchAllEntries, loadStatementLines]);

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
      setStatementLines([]);
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
    setStatementLines([]);
    setReopening(false);
    setReopenReason("");
    setView(VIEW.LIST);
  }, []);

  // ── Reopen (undo a finalised reconciliation) ───────────────────────────────
  const handleReopen = useCallback(async () => {
    if (!activeRecon?._id || !reopenReason.trim()) return;
    setReopeningBusy(true);
    try {
      const updated = await reopenReconciliation(activeRecon._id, { reason: reopenReason.trim() });
      setActiveRecon((prev) => ({ ...prev, ...updated }));
      setReopening(false);
      setReopenReason("");
      toast.success("Reconciliation reopened — back to draft");
      const hist = await getReconciliations({ business: businessId });
      setHistory(Array.isArray(hist) ? hist : []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to reopen reconciliation");
    } finally {
      setReopeningBusy(false);
    }
  }, [activeRecon, reopenReason, businessId]);

  // ── Statement line actions ─────────────────────────────────────────────────
  const handleMatchLine = useCallback(async (lineId, entryId) => {
    if (!activeRecon?._id) return;
    setLineActionBusy(lineId);
    try {
      const { line, reconciliation } = await matchStatementLine(activeRecon._id, lineId, entryId);
      setStatementLines((prev) => prev.map((l) => (l._id === lineId ? { ...l, ...line } : l)));
      syncReconFromServer(reconciliation);
      toast.success("Matched");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to match");
    } finally {
      setLineActionBusy("");
    }
  }, [activeRecon, syncReconFromServer]);

  const handleUnmatchLine = useCallback(async (lineId) => {
    if (!activeRecon?._id) return;
    setLineActionBusy(lineId);
    try {
      const { line, reconciliation } = await unmatchStatementLine(activeRecon._id, lineId);
      setStatementLines((prev) => prev.map((l) => (l._id === lineId ? { ...l, ...line } : l)));
      syncReconFromServer(reconciliation);
      toast.success("Unmatched");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to unmatch");
    } finally {
      setLineActionBusy("");
    }
  }, [activeRecon, syncReconFromServer]);

  const handleCreateTransactionFromLine = useCallback(async (lineId, offsetAccountId) => {
    if (!activeRecon?._id || !offsetAccountId) return;
    setLineActionBusy(lineId);
    try {
      const { line, reconciliation } = await createTransactionFromStatementLine(activeRecon._id, lineId, { offsetAccount: offsetAccountId });
      setStatementLines((prev) => prev.map((l) => (l._id === lineId ? { ...l, ...line } : l)));
      syncReconFromServer(reconciliation);
      // The new journal entry needs to show up in the main entries table too, not just be cleared —
      // simplest correct way is to reload the period's entries from the server.
      const accountId = activeRecon.account?._id || activeRecon.account;
      const entriesParams = { business: businessId, account: accountId, from: localDate(activeRecon.periodStart), to: localDate(activeRecon.periodEnd) };
      const firstPage = await getReconciliationEntries(entriesParams);
      const allEnts = firstPage.hasMore
        ? await fetchAllEntries(entriesParams, firstPage.entries || [], firstPage.nextCursor)
        : (firstPage.entries || []);
      setEntries(allEnts);
      toast.success("Transaction posted and matched");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to post transaction");
    } finally {
      setLineActionBusy("");
    }
  }, [activeRecon, businessId, fetchAllEntries, syncReconFromServer]);

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
          <ListToolbar>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Bank Reconciliation</p>
            <div className="flex-1" />
            <ListToolbar.Button icon={FaPlus} onClick={() => setShowNewForm(true)}>
              New Reconciliation
            </ListToolbar.Button>
            <ListToolbar.Button variant="outline" onClick={loadInitial} disabled={loadingHistory}>
              <FaSyncAlt size={7} className={loadingHistory ? "animate-spin" : ""} />
            </ListToolbar.Button>
          </ListToolbar>

          {/* New Reconciliation Form */}
          {showNewForm && (
            <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">New Reconciliation</p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[220px]">
                  <label className={labelCls}>Account</label>
                  <AppSelect
                    value={formAccount}
                    onChange={(v) => setFormAccount(v ?? "")}
                    options={accounts.map((a) => ({ value: a._id, label: `${a.code} — ${a.name}` }))}
                    placeholder="Select account…"
                    searchable
                    size="sm"
                  />
                </div>
                <div>
                  <label className={labelCls}>Period From</label>
                  <input type="date" value={formFrom} onChange={(e) => setFormFrom(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Period To</label>
                  <input type="date" value={formTo} onChange={(e) => setFormTo(e.target.value)} className={inputCls} />
                </div>
                <div className="w-32">
                  <label className={labelCls}>Opening Bal</label>
                  <CurrencyInput prefix={null} value={formOpenBal} onChange={(e) => setFormOpenBal(e.target.value)} inputClassName={inputCls} />
                </div>
                <div className="w-32">
                  <label className={labelCls}>Closing Bal <span className="text-red-500">*</span></label>
                  <CurrencyInput prefix={null} value={formCloseBal} onChange={(e) => setFormCloseBal(e.target.value)} inputClassName={inputCls} />
                </div>
                <div className="w-44">
                  <label className={labelCls}>Notes</label>
                  <input type="text" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="Optional notes…" className={inputCls} />
                </div>
                <button
                  onClick={handleCreate} disabled={creating}
                  className="inline-flex h-7 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60"
                >
                  {creating ? <FaSyncAlt size={9} className="animate-spin" /> : <FaCheck size={9} />}
                  {creating ? "Creating…" : "Start"}
                </button>
                <button
                  onClick={() => setShowNewForm(false)}
                  className="inline-flex h-7 items-center gap-1.5 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  <FaTimes size={9} /> Cancel
                </button>
              </div>
              {formAccount && lastRecon && (
                <p className="mt-2 text-[10px] text-slate-500">
                  Continuing from the last reconciliation for this account, ended {fmtDate(lastRecon.periodEnd)} (closing balance KES {fmt(lastRecon.statementClosingBalance)}) — Period From and Opening Balance were prefilled from it.
                </p>
              )}
              {formAccount && !lastRecon && (
                <p className="mt-2 text-[10px] text-slate-500">No prior reconciliation found for this account — enter the opening balance manually.</p>
              )}
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
                { label: "Finalised By" },
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
                  className="p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                  title="Delete draft"
                >
                  <FaTrash size={10} />
                </button>
              )}
              renderRow={(r) => (
                <>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-800">
                    <span className="font-mono text-slate-400 mr-1">{r.accountCode || r.account?.code}</span>
                    {r.accountName || r.account?.name}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">
                    {fmtDate(r.periodStart)} — {fmtDate(r.periodEnd)}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono font-semibold text-slate-700">
                    {fmt(r.statementClosingBalance)}
                  </td>
                  <td className={`px-3 py-1.5 border-r border-gray-100 text-right font-mono font-semibold ${Math.abs(r.difference) < 0.005 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmt(r.difference)}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-center">
                    <StatusBadge status={r.status === "reconciled" ? "reconciled" : "draft"} map={RECON_STATUS_MAP} />
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">
                    {r.status === "reconciled" && r.reconciledBy ? (
                      <>
                        {[r.reconciledBy.surname, r.reconciledBy.otherNames].filter(Boolean).join(" ")}
                        <span className="ml-1 text-[10px] text-slate-400">{fmtDate(r.reconciledAt)}</span>
                      </>
                    ) : "—"}
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-1.5 border-r border-gray-100 text-slate-400" title={r.notes}>{r.notes || "—"}</td>
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
        <ListToolbar>
          <ListToolbar.Button variant="outline" onClick={backToList}>
            ← Back
          </ListToolbar.Button>

          <ListToolbar.Divider />

          <div>
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
              {activeRecon?.accountCode} {activeRecon?.accountName}
            </span>
            <span className="mx-1.5 text-slate-300">·</span>
            <span className="text-[9px] text-slate-500">
              {fmtDate(activeRecon?.periodStart)} — {fmtDate(activeRecon?.periodEnd)}
            </span>
            {isLocked && (
              <span className="ml-2 inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
                <FaLock size={7} /> Finalised
              </span>
            )}
          </div>

          <ListToolbar.Divider />

          {isLocked && !reopening && (
            <ListToolbar.Button variant="outline" icon={FaLockOpen} onClick={() => setReopening(true)}>
              Reopen
            </ListToolbar.Button>
          )}
          {isLocked && reopening && (
            <>
              <ListToolbar.Input
                width="w-56"
                placeholder="Reason for reopening…"
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                autoFocus
              />
              <ListToolbar.Button variant="danger" disabled={reopeningBusy || !reopenReason.trim()} onClick={handleReopen}>
                {reopeningBusy ? <FaSyncAlt size={7} className="animate-spin" /> : null} Confirm Reopen
              </ListToolbar.Button>
              <ListToolbar.Button variant="outline" onClick={() => { setReopening(false); setReopenReason(""); }}>
                Cancel
              </ListToolbar.Button>
            </>
          )}

          {!isLocked && (
            <ListToolbar.Button variant="outline" icon={FaFileImport} onClick={() => setShowImportModal(true)}>
              Import Statement
            </ListToolbar.Button>
          )}

          <ListToolbar.Divider />

          {/* Search */}
          <div className="relative">
            <FaSearch size={8} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <ListToolbar.Input
              width="w-44"
              className="pl-5"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter entries…"
            />
          </div>

          <div className="flex-1" />

          <ListToolbar.Button variant="outline" icon={FaFilePdf} onClick={handlePrintPDF}>
            PDF
          </ListToolbar.Button>

          {!isLocked && (
            <>
              <ListToolbar.Button
                variant="outline"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? <FaSyncAlt size={7} className="animate-spin" /> : null}
                Save Progress
              </ListToolbar.Button>
              <ListToolbar.Button
                variant="primary"
                onClick={handleFinalize}
                disabled={saving || Math.abs(summary.difference) > 0.005}
                title={Math.abs(summary.difference) > 0.005 ? "Clear all matching entries first (difference must be 0)" : "Finalise reconciliation"}
              >
                <FaLock size={7} /> Finalise
              </ListToolbar.Button>
            </>
          )}
        </ListToolbar>

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

        {/* Statement Lines — imported bank statement, auto/manually matched against the ledger */}
        {statementLines.length > 0 && (
          <div className="shrink-0 border-b border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setShowStatementLines((p) => !p)}
              className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-slate-50"
            >
              {showStatementLines ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Imported Statement Lines ({statementLines.length})
              </span>
              <span className="text-[10px] text-slate-400">
                {statementLines.filter((l) => l.status === "unmatched").length} unmatched
              </span>
            </button>
            {showStatementLines && (
              <div className="max-h-64 overflow-y-auto border-t border-slate-100">
                {statementLines.map((line) => (
                  <StatementLineRow
                    key={line._id}
                    line={line}
                    accounts={allAccounts}
                    busy={lineActionBusy === line._id}
                    readOnly={isLocked}
                    stillCleared={!line.matchedEntry || cleared.has(String(line.matchedEntry))}
                    onMatch={(entryId) => handleMatchLine(line._id, entryId)}
                    onUnmatch={() => handleUnmatchLine(line._id)}
                    onCreateTransaction={(offsetAccountId) => handleCreateTransactionFromLine(line._id, offsetAccountId)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

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
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500 whitespace-nowrap">{fmtDate(e.transactionDate)}</td>
                  <td className="max-w-[240px] truncate px-3 py-1.5 border-r border-gray-100 text-slate-700" title={e.notes}>{e.notes || "—"}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-400 capitalize">{(e.sourceTransactionType || "").replace(/_/g, " ")}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono font-semibold">
                    {e.direction === "debit" ? <span className="text-emerald-700">{fmt(amt)}</span> : <span className="text-slate-200">—</span>}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono font-semibold">
                    {e.direction === "credit" ? <span className="text-red-600">{fmt(amt)}</span> : <span className="text-slate-200">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {isClear && (
                      <span className="inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
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

      {showImportModal && (
        <ImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          title="Import Bank Statement"
          entityName="statement line"
          parseFile={parseBankStatementCsv}
          accept=".csv"
          submitColorClass="bg-[#0B3B2E] hover:bg-[#0A3127]"
          previewCols={[
            { header: "Date", render: (r) => fmtDate(r.date) },
            { header: "Description", render: (r) => r.description || "—" },
            { header: "Direction", render: (r) => r.direction },
            { header: "Amount (KES)", render: (r) => fmt(r.amount) },
          ]}
          onImport={async (rows) => {
            const result = await importBankStatementLines(activeRecon._id, rows);
            await loadStatementLines(activeRecon._id);
            const full = await getReconciliations({ id: activeRecon._id });
            syncReconFromServer(full);
            if (result.autoMatched) toast.info(`${result.autoMatched} of ${result.imported} line(s) auto-matched to existing entries`);
            return { successful: result.lines, failed: [] };
          }}
        />
      )}
    </DashboardLayout>
  );
};

// ─── One imported statement line: shows its match status and the action available for it ───────
const StatementLineRow = ({ line, accounts, busy, readOnly, stillCleared, onMatch, onUnmatch, onCreateTransaction }) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [offsetAccount, setOffsetAccount] = useState("");

  const confirmCreate = () => {
    if (!offsetAccount) return;
    onCreateTransaction(offsetAccount);
    setShowCreateForm(false);
    setOffsetAccount("");
  };

  return (
    <div className="border-b border-slate-100 px-4 py-2 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-20 shrink-0 text-[11px] text-slate-500">{fmtDate(line.date)}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-slate-700" title={line.description}>{line.description || "—"}</span>
        <span className={`w-28 shrink-0 text-right font-mono text-xs font-bold ${line.direction === "debit" ? "text-emerald-700" : "text-red-600"}`}>
          {line.direction === "debit" ? "+" : "−"}{fmt(line.amount)}
        </span>

        {line.status === "matched" && (
          <span className={`inline-flex shrink-0 items-center gap-1 border px-2 py-0.5 text-[10px] font-bold ${stillCleared ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
            <FaLink size={8} /> Matched
          </span>
        )}
        {line.status === "created" && (
          <span className={`inline-flex shrink-0 items-center gap-1 border px-2 py-0.5 text-[10px] font-bold ${stillCleared ? "border-blue-200 bg-blue-50 text-blue-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
            <FaPlus size={8} /> Posted
          </span>
        )}
        {!stillCleared && (line.status === "matched" || line.status === "created") && (
          <span className="shrink-0 text-[9px] italic text-amber-600" title="This entry was unticked in the table below — it's no longer counted as cleared, even though it's still linked here.">
            ⚠ unticked below
          </span>
        )}
        {!readOnly && line.status === "matched" && (
          <button type="button" disabled={busy} onClick={onUnmatch} className="shrink-0 p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40" title="Undo this match">
            <FaUnlink size={10} />
          </button>
        )}

        {!readOnly && line.status === "unmatched" && !showCreateForm && (
          <div className="flex shrink-0 items-center gap-1">
            {line.suggestions?.length > 0 ? (
              <AppSelect
                size="sm"
                placeholder={`${line.suggestions.length} possible match${line.suggestions.length !== 1 ? "es" : ""}…`}
                value=""
                onChange={(entryId) => entryId && onMatch(entryId)}
                options={line.suggestions.map((s) => ({
                  value: s._id,
                  label: `KES ${fmt(s.amount)} · ${fmtDate(s.transactionDate)}${s.notes ? ` · ${s.notes}` : ""}`,
                }))}
                className="w-64"
                disabled={busy}
              />
            ) : (
              <span className="text-[10px] italic text-slate-400">No match found in books</span>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowCreateForm(true)}
              className="whitespace-nowrap border border-slate-300 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <FaPlus size={8} className="inline -mt-0.5 mr-1" />Create Transaction
            </button>
          </div>
        )}
      </div>

      {showCreateForm && (
        <div className="mt-1.5 ml-20 flex items-center gap-2 border border-slate-200 bg-slate-50 p-2">
          <span className="text-[10px] font-semibold text-slate-500">Other side of this transaction:</span>
          <AppSelect
            size="sm"
            placeholder="Select offset account…"
            value={offsetAccount}
            onChange={(v) => setOffsetAccount(v ?? "")}
            options={accounts.map((a) => ({ value: a._id, label: `${a.code} — ${a.name}` }))}
            searchable
            className="w-56"
          />
          <button type="button" disabled={busy || !offsetAccount} onClick={confirmCreate} className="border border-[#0B3B2E] bg-[#0B3B2E] px-2 py-1 text-[10px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-40">
            {busy ? "Posting…" : "Post & Match"}
          </button>
          <button type="button" onClick={() => setShowCreateForm(false)} className="border border-slate-300 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};

export default BankReconciliation;

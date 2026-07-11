import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaCheck, FaCheckSquare, FaFileDownload, FaFilePdf, FaLock,
  FaPlus, FaSearch, FaSyncAlt, FaTimes, FaTrash, FaUndo,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import {
  getBankReconciliationAccounts, getReconciliationEntries,
  getReconciliations, createReconciliation, saveReconciliation,
  finalizeReconciliation, deleteReconciliation,
} from "../../redux/apiCalls";

const GRN = "#0B3B2E";
const fmt = (v) => Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const localDate = (d) => { const dt = new Date(d); const y = dt.getFullYear(); const m = String(dt.getMonth()+1).padStart(2,"0"); const day = String(dt.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; };
const todayStr  = () => localDate(new Date());
const firstOfMonth = () => { const d = new Date(); return localDate(new Date(d.getFullYear(), d.getMonth(), 1)); };

// ── Views: LIST or RECONCILE ──────────────────────────────────────────────────
const VIEW = { LIST: "list", RECONCILE: "reconcile" };

const BankReconciliation = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const businessId     = currentCompany?._id;
  const companyName    = String(currentCompany?.companyName || currentCompany?.name || "").trim();

  // ── Global state ──────────────────────────────────────────────────────────
  const [view,     setView]     = useState(VIEW.LIST);
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
      // getReconciliation returns single doc with entries
      setActiveRecon(full);
      setEntries(full.entries || []);
      setCleared(new Set((full.clearedEntries || []).map(String)));
      setSearch("");
      setView(VIEW.RECONCILE);
    } catch {
      toast.error("Failed to load reconciliation");
    } finally {
      setLoadingEntries(false);
    }
  }, []);

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
      // Load entries for this period
      const ents = await getReconciliationEntries({
        business: businessId,
        account:  formAccount,
        from:     formFrom,
        to:       formTo,
      });
      setActiveRecon({ ...recon, entries: ents });
      setEntries(Array.isArray(ents) ? ents : []);
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
  }, [businessId, formAccount, formFrom, formTo, formOpenBal, formCloseBal, formNotes]);

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
    if (!window.confirm("Delete this draft reconciliation?")) return;
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
  const escHtml = (v) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  // ── Print PDF ─────────────────────────────────────────────────────────────
  const handlePrintPDF = useCallback(() => {
    const rows = entries.map((e) => {
      const amt = Number(e.amount || 0);
      return `<tr>
        <td>${fmtDate(e.transactionDate)}</td>
        <td>${escHtml(e.notes || e.category || "")}</td>
        <td class="r">${e.direction === "debit"  ? fmt(amt) : ""}</td>
        <td class="r">${e.direction === "credit" ? fmt(amt) : ""}</td>
        <td class="c">${cleared.has(String(e._id)) ? "✓" : ""}</td>
      </tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><title>Bank Reconciliation</title>
<style>body{font-family:Arial,sans-serif;font-size:10px;margin:20px;color:#1e293b}
h2{font-size:13px;color:#0B3B2E;margin-bottom:2px}p.sub{font-size:9px;color:#64748b;margin:0 0 10px}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
th{background:#f1f5f9;padding:4px 6px;font-size:8px;border-bottom:2px solid #cbd5e1;text-transform:uppercase;text-align:left}
td{padding:3px 6px;border-bottom:1px solid #e2e8f0}
.r{text-align:right}.c{text-align:center}
.sum{font-weight:700;border-top:2px solid #94a3b8;background:#f8fafc}
</style></head><body>
<h2>${escHtml(companyName)} — Bank Reconciliation</h2>
<p class="sub">${escHtml(activeRecon?.accountCode)} ${escHtml(activeRecon?.accountName)} · ${fmtDate(activeRecon?.periodStart)} to ${fmtDate(activeRecon?.periodEnd)}</p>
<table><thead><tr><th>Date</th><th>Description</th><th class="r">Debit (In)</th><th class="r">Credit (Out)</th><th class="c">Cleared</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot>
<tr class="sum"><td colspan="2">Statement Opening Balance</td><td class="r" colspan="3">${fmt(summary.openBal)}</td></tr>
<tr class="sum"><td colspan="2">Statement Closing Balance</td><td class="r" colspan="3">${fmt(summary.closeBal)}</td></tr>
<tr class="sum"><td colspan="2">Cleared Balance</td><td class="r" colspan="3">${fmt(summary.clearedBalance)}</td></tr>
<tr class="sum"><td colspan="2"><b>Difference</b></td><td class="r" colspan="3"><b>${fmt(summary.difference)}</b></td></tr>
</tfoot></table>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return toast.error("Pop-ups blocked");
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 400);
  }, [entries, cleared, summary, activeRecon, companyName]);

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
          <div className="flex-1 overflow-auto">
            {loadingHistory ? (
              <div className="flex h-32 items-center justify-center gap-2 text-sm text-slate-400">
                <FaSyncAlt size={12} className="animate-spin" /> Loading…
              </div>
            ) : history.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center text-slate-400">
                <p className="text-sm font-medium">No reconciliations yet</p>
                <p className="mt-1 text-xs">Click "New Reconciliation" to get started</p>
              </div>
            ) : (
              <table className="min-w-full text-[11px] border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#0B3B2E] text-white">
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Account</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Period</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Statement Balance (KES)</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Difference (KES)</th>
                    <th className="px-3 py-1 text-center font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Notes</th>
                    <th className="px-3 py-1 font-bold" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((r, idx) => (
                    <tr
                      key={r._id}
                      className={`border-b border-gray-100 cursor-pointer ${idx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}
                      onClick={() => openRecon(r)}
                    >
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
                      <td className="px-3 py-1 text-right">
                        {r.status !== "reconciled" && (
                          <button
                            onClick={(e) => handleDelete(r._id, e)}
                            className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                            title="Delete draft"
                          >
                            <FaTrash size={10} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
        <div className="flex-1 overflow-auto">
          {loadingEntries ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-slate-400">
              <FaSyncAlt size={12} className="animate-spin" /> Loading entries…
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-slate-400">
              No ledger entries found for this account and period
            </div>
          ) : (
            <table className="min-w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-3 py-1 text-center font-bold border-r border-white/10">
                    {!isLocked && (
                      <button
                        onClick={toggleAll}
                        className={`flex h-4 w-4 items-center justify-center rounded border ${allVisibleCleared ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white text-transparent"}`}
                        title={allVisibleCleared ? "Uncheck all" : "Check all"}
                      >
                        <FaCheck size={8} />
                      </button>
                    )}
                  </th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Date</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Description / Category</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Type</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Debit (In)</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Credit (Out)</th>
                  <th className="px-3 py-1 text-center font-bold">Cleared</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((e, idx) => {
                  const id = String(e._id);
                  const isClear = cleared.has(id);
                  const amt = Number(e.amount || 0);
                  return (
                    <tr
                      key={id}
                      onClick={() => !isLocked && toggleEntry(id)}
                      className={`border-b border-gray-100 transition-colors ${isLocked ? "" : "cursor-pointer"} ${isClear ? "bg-emerald-50/40" : idx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}
                    >
                      <td className="px-3 py-1 border-r border-gray-100 text-center">
                        <div
                          className={`mx-auto flex h-4 w-4 items-center justify-center rounded border ${
                            isClear ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white text-transparent"
                          }`}
                        >
                          <FaCheck size={8} />
                        </div>
                      </td>
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
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 text-xs font-black">
                  <td colSpan={4} className="px-3 py-2 uppercase text-slate-500">
                    {cleared.size} of {entries.length} entries cleared
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-700">
                    {fmt(summary.clearedDebits)} <span className="text-[9px] font-normal text-slate-400 ml-1">cleared in</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-red-600">
                    {fmt(summary.clearedCredits)} <span className="text-[9px] font-normal text-slate-400 ml-1">cleared out</span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default BankReconciliation;

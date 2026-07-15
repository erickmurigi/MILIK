import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaCheckCircle, FaExclamationCircle, FaExclamationTriangle, FaExternalLinkAlt,
  FaHistory, FaInfoCircle, FaShieldAlt, FaSyncAlt, FaTools, FaUndo, FaWrench,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";
import {
  getChartOfAccounts,
  getGLHealthHistory,
  repairBalanceGroup as apiRepairBalanceGroup,
  repairRecomputeBalances as apiRepairRecompute,
  repairRepostInvoices as apiRepairRepost,
  reverseGlCorrectionEntry as apiReverseGlCorrection,
  getActiveGlCorrections,
  runGLIntegrityReport,
} from "../../redux/apiCalls";
import { useConfirm } from "../../context/ConfirmContext";

const GRN = "#0B3B2E";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtTs = (d) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtNum = (n) =>
  Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const sourceNavUrl = (sourceType, sourceId) => {
  if (!sourceType || !sourceId) return null;
  const t = String(sourceType).toLowerCase();
  if (t === "rent_payment" || t === "receipt")        return `/receipts/${sourceId}`;
  if (t === "invoice" || t === "tenant_invoice")      return `/invoices/rental/${sourceId}`;
  if (t === "invoice_note")                           return `/invoices/notes`;
  if (t === "late_penalty_batch")                     return `/invoices/late-penalties`;
  if (t === "payment_voucher")                        return `/accounts/payment-vouchers`;
  if (t === "landlord_receipt")                       return `/receipts/landlord`;
  if (t === "landlord_payment")                       return `/landlord-payments`;
  if (t === "journal_entry")                          return `/accounts/journals`;
  return null;
};

const STATUS_CFG = {
  clean:    { icon: FaCheckCircle,        cls: "border-emerald-200 bg-emerald-50", text: "text-emerald-700", label: "All Clear"      },
  warnings: { icon: FaExclamationTriangle, cls: "border-amber-200 bg-amber-50",    text: "text-amber-700",   label: "Warnings Found" },
  critical: { icon: FaExclamationCircle,  cls: "border-red-200 bg-red-50",         text: "text-red-700",     label: "Critical Issues"},
};
const SEV_ICON = {
  critical: <FaExclamationCircle  size={11} className="text-red-500 shrink-0" />,
  warning:  <FaExclamationTriangle size={11} className="text-amber-500 shrink-0" />,
  info:     <FaInfoCircle          size={11} className="text-blue-400 shrink-0" />,
};
const SEV_BADGE = {
  critical: "border-red-200 bg-red-50 text-red-700",
  warning:  "border-amber-200 bg-amber-50 text-amber-700",
  info:     "border-blue-200 bg-blue-50 text-blue-700",
};
const STATUS_PILL = {
  clean:    "bg-emerald-100 text-emerald-700",
  warnings: "bg-amber-100 text-amber-700",
  critical: "bg-red-100 text-red-600",
};
const OUTCOME_PILL = {
  success: "bg-emerald-100 text-emerald-700",
  failed:  "bg-red-100 text-red-600",
};

const TH = ({ children, right }) => (
  <th className={`border-b border-slate-200 bg-slate-50 px-3 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-slate-400 ${right ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const TD = ({ children, right, cls = "" }) => (
  <td className={`border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-700 last:border-0 ${right ? "text-right tabular-nums" : ""} ${cls}`}>
    {children}
  </td>
);

const TABS = [
  { id: "check",   label: "Health Check",   icon: FaShieldAlt },
  { id: "repair",  label: "Repair Centre",  icon: FaWrench    },
  { id: "history", label: "History",        icon: FaHistory   },
];

// ─── Balance-Group Modal ───────────────────────────────────────────────────────
function BalanceGroupModal({ group, accounts, businessId, healthRunId, onClose, onDone, navigate }) {
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes]         = useState("");
  const [saving, setSaving]       = useState(false);

  if (!group) return null;

  const direction  = group.difference > 0 ? "Credit" : "Debit";
  const amount     = Math.abs(group.difference);
  const postingAccounts = accounts.filter((a) => a.isPosting && !a.isHeader);

  const submit = async () => {
    if (!accountId) { toast.error("Select a correcting account"); return; }
    setSaving(true);
    try {
      await apiRepairBalanceGroup(group.journalGroupId, { business: businessId, accountId, notes, healthRunId });
      toast.success("Correcting entry posted — group is now balanced");
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || "Repair failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[440px] border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3" style={{ backgroundColor: GRN }}>
          <FaWrench size={11} className="text-white/70" />
          <span className="text-[11px] font-black uppercase tracking-[0.12em] text-white">Post Correcting Entry</span>
          <button onClick={onClose} className="ml-auto text-white/60 hover:text-white text-lg leading-none">&times;</button>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Group info */}
          <div className="border border-slate-100 bg-slate-50 px-3 py-2.5 space-y-1.5">
            {[
              ["Journal Group", String(group.journalGroupId).slice(-12)],
              ["Source Type",   group.sourceType || "—"],
              ["Date",          fmtDate(group.date)],
              ["Debit Sum",     `KES ${fmtNum(group.debit)}`],
              ["Credit Sum",    `KES ${fmtNum(group.credit)}`],
              ["Imbalance",     `KES ${fmtNum(amount)}`],
            ].map(([label, val]) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">{label}</span>
                <span className="text-[10px] font-semibold text-slate-800 font-mono">{val}</span>
              </div>
            ))}
            {/* Source ID — clickable if we can build a nav URL */}
            {(() => {
              const url = sourceNavUrl(group.sourceType, group.sourceId);
              const label = group.sourceId ? `…${String(group.sourceId).slice(-12)}` : "—";
              return (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Source ID</span>
                  {url ? (
                    <button
                      onClick={() => { onClose(); navigate(url); }}
                      className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-800 font-mono"
                    >
                      {label} <FaExternalLinkAlt size={8} />
                    </button>
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-800 font-mono">{label}</span>
                  )}
                </div>
              );
            })()}
            <div className="mt-1 border-t border-slate-200 pt-1.5 text-[10px] text-slate-600">
              A <strong>{direction}</strong> of <strong>KES {fmtNum(amount)}</strong> will be posted to the account you select below.
            </div>
          </div>

          {/* Account selector */}
          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-1">
              Correcting Account <span className="text-red-500">*</span>
            </label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full border border-slate-200 px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-slate-400"
            >
              <option value="">— select account —</option>
              {postingAccounts.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.code} – {a.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[9px] text-slate-400">
              Use a suspense/clearing account (e.g. 9999) unless you know the original missing leg.
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-1">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why is this correction being posted?"
              className="w-full border border-slate-200 px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-slate-400"
            />
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onClose} disabled={saving}
              className="border border-slate-200 px-4 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={submit} disabled={saving || !accountId}
              className="px-5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
              style={{ backgroundColor: GRN }}>
              {saving ? "Posting…" : "Post Correction"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function GLIntegrityReport() {
  const company      = useSelector(selectCurrentCompany);
  const currentUser  = useSelector(selectCurrentUser);
  const businessId   = company?._id;
  const confirm      = useConfirm();
  const navigate     = useNavigate();

  // Repair actions are write operations — require Full Access on accounts module
  const canRepair = hasCompanyPermission(currentUser, company, "financialReports", "process", "accounts");

  const [activeTab,  setActiveTab]  = useTabState("/accounts/gl-integrity:activeTab", "check");
  const [loading,    setLoading]    = useState(false);
  const [report,     setReport]     = useState(null);
  const [history,    setHistory]    = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [accounts,   setAccounts]   = useState([]);
  const [repairing,    setRepairing]    = useState(new Set());
  const [groupModal,   setGroupModal]   = useState(null);
  const [expandedRun,  setExpandedRun]  = useState(null);
  const [corrections,  setCorrections]  = useState([]);

  const healthRunId = report?.healthRunId;

  // ── Data loaders ────────────────────────────────────────────────────────────
  const runCheck = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const data = await runGLIntegrityReport({ business: businessId });
      setReport(data);
      setActiveTab("check");
    } catch (err) {
      toast.error(err?.response?.data?.error || "Health check failed");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  const loadHistory = useCallback(async () => {
    if (!businessId) return;
    setHistLoading(true);
    try {
      setHistory(await getGLHealthHistory({ business: businessId }));
    } catch {
      // silent — history is non-critical
    } finally {
      setHistLoading(false);
    }
  }, [businessId]);

  const loadCorrections = useCallback(async () => {
    if (!businessId) return;
    try {
      const data = await getActiveGlCorrections({ business: businessId });
      setCorrections(data?.corrections ?? []);
    } catch {
      // non-critical
    }
  }, [businessId]);

  // load accounts, history and active corrections on mount
  useEffect(() => {
    if (!businessId) return;
    getChartOfAccounts({ business: businessId, limit: 500 })
      .then((res) => setAccounts(res?.data ?? res ?? []))
      .catch(() => {});
    loadHistory();
    loadCorrections();
  }, [businessId, loadHistory, loadCorrections]);

  // ── Repair actions ───────────────────────────────────────────────────────────
  const startRepair = (key) => setRepairing((s) => { const n = new Set(s); n.add(key); return n; });
  const endRepair   = (key) => setRepairing((s) => { const n = new Set(s); n.delete(key); return n; });

  const doRecompute = async () => {
    const ok = await confirm({
      title: "Recompute All COA Balances",
      message: "This rebuilds every account's cached balance from the raw ledger entries. Safe to run at any time.",
      confirmText: "Recompute",
    });
    if (!ok) return;
    startRepair("recompute");
    try {
      const res = await apiRepairRecompute({ business: businessId, healthRunId });
      toast.success(`Balances recomputed — ${res.accountsUpdated} accounts updated`);
      runCheck().then(loadHistory);
    } catch (err) {
      toast.error(err?.response?.data?.error || "Recompute failed");
    } finally {
      endRepair("recompute");
    }
  };

  const doRepostInvoices = async () => {
    const ok = await confirm({
      title: "Repost Invoice Ledger",
      message: "Posts GL entries for any tenant invoice that has no ledger entry. Does not duplicate existing entries.",
      confirmText: "Repost Invoices",
    });
    if (!ok) return;
    startRepair("invoices");
    try {
      const res = await apiRepairRepost({ business: businessId, healthRunId });
      toast.success(`Done — ${res.posted} invoice(s) reposted, ${res.skipped} skipped`);
      if (res.errors?.length) toast.warn(`${res.errors.length} error(s) — check console`, { autoClose: 6000 });
      runCheck().then(loadHistory);
    } catch (err) {
      toast.error(err?.response?.data?.error || "Repost failed");
    } finally {
      endRepair("invoices");
    }
  };

  const onGroupRepaired = () => {
    setGroupModal(null);
    runCheck().then(loadHistory);
  };

  const doReverseCorrection = async (groupId) => {
    const ok = await confirm({
      title:       "Undo GL Correction",
      message:     `This will reverse the manual correcting entry posted to journal group …${String(groupId).slice(-8)}. The GL will return to its state before the correction so you can find and fix the original transaction.`,
      confirmText: "Undo Correction",
    });
    if (!ok) return;
    const key = `reverse-${groupId}`;
    startRepair(key);
    try {
      const res = await apiReverseGlCorrection(groupId, { business: businessId, healthRunId });
      toast.success(`Correction reversed — ${res.reversedCount} entr${res.reversedCount === 1 ? "y" : "ies"} set to reversed`);
      runCheck().then(loadHistory);
      loadCorrections();
    } catch (err) {
      toast.error(err?.response?.data?.error || "Reverse failed");
    } finally {
      endRepair(key);
    }
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const status   = report?.overallStatus;
  const detail   = report?.detail || {};
  const issues   = report?.issues || [];
  const glBal    = detail.glBalance || {};
  const groups   = detail.unbalancedGroups || [];
  const abnormal = detail.abnormalBalances || [];
  const journals = detail.journalsWithNoLedger || [];
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount  = issues.filter((i) => i.severity === "warning").length;

  // ── Render tabs ──────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden bg-slate-100">

        {/* Top bar */}
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-2.5">
          <FaShieldAlt size={11} style={{ color: GRN }} />
          <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: GRN }}>
            GL Health Centre
          </span>
          {report && (
            <span className={`ml-1 inline-flex items-center px-2 py-0 text-[8px] font-bold uppercase tracking-[0.1em] ${STATUS_PILL[status] || "bg-slate-100 text-slate-500"}`}>
              {status}
            </span>
          )}
          <div className="ml-auto">
            <button
              onClick={runCheck}
              disabled={loading}
              className="flex h-7 items-center gap-1.5 px-4 text-[11px] font-bold text-white disabled:opacity-60"
              style={{ backgroundColor: GRN }}
            >
              <FaSyncAlt size={9} className={loading ? "animate-spin" : ""} />
              {loading ? "Running…" : "Run Check"}
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <div className="flex shrink-0 border-b border-slate-200 bg-white">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => { setActiveTab(id); if (id === "history") loadHistory(); }}
              className={`flex items-center gap-1.5 border-b-2 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] transition-colors ${
                activeTab === id
                  ? "border-b-[#0B3B2E] text-[#0B3B2E]"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <Icon size={9} />
              {label}
              {id === "check" && report && issues.length > 0 && (
                <span className={`ml-1 h-4 min-w-[1rem] px-1 text-[8px] font-black text-white flex items-center justify-center ${
                  criticalCount ? "bg-red-500" : "bg-amber-500"
                }`}>
                  {issues.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── HEALTH CHECK TAB ── */}
          {activeTab === "check" && (
            <>
              {!report && !loading && (
                <div className="border border-dashed border-slate-300 py-24 text-center">
                  <FaShieldAlt size={32} className="mx-auto mb-3 text-slate-300" />
                  <p className="text-[11px] font-semibold text-slate-500">Click "Run Check" to audit your general ledger</p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    Verifies GL balance, journal groups, orphaned entries, abnormal signs &amp; more
                  </p>
                </div>
              )}

              {report && (
                <>
                  {/* Status banner */}
                  {STATUS_CFG[status] && (() => {
                    const cfg = STATUS_CFG[status];
                    const Icon = cfg.icon;
                    return (
                      <div className={`flex items-center gap-3 border px-4 py-3 ${cfg.cls}`}>
                        <Icon size={18} className={cfg.text} />
                        <div>
                          <div className={`text-[12px] font-black ${cfg.text}`}>{cfg.label}</div>
                          <div className="text-[10px] text-slate-500">
                            Checked {fmtTs(report.runAt)} ·{" "}
                            {criticalCount > 0 && <span className="text-red-600 font-bold">{criticalCount} critical</span>}
                            {criticalCount > 0 && warningCount > 0 && ", "}
                            {warningCount > 0 && <span className="text-amber-600">{warningCount} warning(s)</span>}
                            {issues.length === 0 && "No issues found"}
                          </div>
                        </div>
                        {issues.length > 0 && canRepair && (
                          <button
                            onClick={() => setActiveTab("repair")}
                            className="ml-auto flex h-7 items-center gap-1.5 border border-current px-3 text-[10px] font-bold"
                            style={{ color: GRN, borderColor: GRN }}
                          >
                            <FaTools size={9} /> Go to Repairs
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  {/* Issues list */}
                  {issues.length > 0 && (
                    <div className="border border-slate-200 bg-white shadow-sm overflow-hidden">
                      <div className="border-b border-slate-100 px-4 py-2.5" style={{ borderLeftWidth: 3, borderLeftColor: GRN }}>
                        <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">
                          Issues · {issues.length}
                        </span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {issues.map((issue, i) => (
                          <div key={i} className="flex items-start gap-2.5 px-4 py-2.5">
                            <div className="mt-0.5">{SEV_ICON[issue.severity] || SEV_ICON.info}</div>
                            <div>
                              <span className={`inline-flex items-center border px-1.5 py-0 text-[8px] font-bold uppercase tracking-[0.1em] mr-2 ${SEV_BADGE[issue.severity] || SEV_BADGE.info}`}>
                                {issue.severity}
                              </span>
                              <span className="text-[11px] text-slate-700">{issue.issue}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* GL balance summary */}
                  <div className="border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-slate-100 px-4 py-2.5" style={{ borderLeftWidth: 3, borderLeftColor: GRN }}>
                      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">GL Balance Summary</span>
                    </div>
                    <div className="flex overflow-hidden">
                      {[
                        { label: "Total Debits",  val: fmtNum(glBal.totalDebit),  cls: "text-slate-800" },
                        { label: "Total Credits", val: fmtNum(glBal.totalCredit), cls: "text-slate-800" },
                        { label: "Difference",    val: fmtNum(glBal.difference),  cls: "text-red-600"   },
                        { label: "Balanced", val: glBal.balanced ? "Yes" : "No",
                          cls: glBal.balanced ? "text-emerald-700" : "text-red-600" },
                      ].map((item) => (
                        <div key={item.label} className="flex flex-1 flex-col border-r border-slate-100 px-4 py-3 last:border-r-0">
                          <div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">{item.label}</div>
                          <div className={`mt-1 text-[13px] font-black tabular-nums ${item.cls}`}>{item.val}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Counter cards */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Orphaned Entries",          val: detail.orphanedEntriesCount   ?? 0 },
                      { label: "Inactive Account Entries",  val: detail.inactiveAccountEntries  ?? 0 },
                      { label: "Journals With No Ledger",   val: journals.length                    },
                    ].map((item) => (
                      <div key={item.label} className={`border px-4 py-3 shadow-sm ${item.val > 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
                        <div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">{item.label}</div>
                        <div className={`mt-1 text-2xl font-black ${item.val > 0 ? "text-red-600" : "text-emerald-700"}`}>{item.val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Unbalanced groups */}
                  {groups.length > 0 && (
                    <div className="border border-red-200 bg-white shadow-sm overflow-hidden">
                      <div className="border-b border-red-100 bg-red-50 px-4 py-2.5">
                        <span className="text-[10px] font-black uppercase tracking-[0.12em] text-red-700">
                          Unbalanced Journal Groups · {groups.length}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead><tr>
                            <TH>Group ID</TH><TH>Source Type</TH><TH>Source ID</TH><TH>Date</TH>
                            <TH right>Debit</TH><TH right>Credit</TH><TH right>Difference</TH>
                          </tr></thead>
                          <tbody>
                            {groups.map((g) => (
                              <tr key={g.journalGroupId} className="hover:bg-slate-50">
                                <TD cls="font-mono text-[10px] text-slate-400">{String(g.journalGroupId).slice(-8)}</TD>
                                <TD>{g.sourceType || "—"}</TD>
                                <TD cls="font-mono text-[10px] text-slate-500">{g.sourceId ? `…${String(g.sourceId).slice(-12)}` : "—"}</TD>
                                <TD>{fmtDate(g.date)}</TD>
                                <TD right>{fmtNum(g.debit)}</TD>
                                <TD right>{fmtNum(g.credit)}</TD>
                                <TD right cls="font-bold text-red-600">{fmtNum(g.difference)}</TD>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Abnormal balances */}
                  {abnormal.length > 0 && (
                    <div className="border border-amber-200 bg-white shadow-sm overflow-hidden">
                      <div className="border-b border-amber-100 bg-amber-50 px-4 py-2.5">
                        <span className="text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">
                          Abnormal Account Balances · {abnormal.length}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead><tr>
                            <TH>Code</TH><TH>Account Name</TH><TH>Type</TH><TH right>Net Balance</TH>
                          </tr></thead>
                          <tbody>
                            {abnormal.map((row) => (
                              <tr key={row.accountId} className="hover:bg-slate-50">
                                <TD cls="font-mono text-[10px]">{row.code}</TD>
                                <TD>{row.name}</TD>
                                <TD cls="capitalize">{row.type}</TD>
                                <TD right cls={`font-bold ${row.netBalance < 0 ? "text-red-600" : "text-amber-600"}`}>
                                  {fmtNum(row.netBalance)}
                                </TD>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── REPAIR CENTRE TAB ── */}
          {activeTab === "repair" && (
            <>
              {/* ── Active GL Corrections (always visible when present) ── */}
              {corrections.length > 0 && (
                <div className="border border-amber-200 bg-white shadow-sm overflow-hidden mb-3">
                  <div className="border-b border-amber-100 bg-amber-50 px-4 py-2.5 flex items-center gap-2">
                    <FaUndo size={10} className="text-amber-600" />
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">
                      Active GL Corrections · {corrections.length}
                    </span>
                    <span className="ml-1 text-[10px] text-amber-500">Manual correcting entries that can be reversed</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {corrections.map((c) => (
                      <div key={c.journalGroupId} className="flex items-start gap-3 px-4 py-3">
                        <FaWrench size={11} className="mt-0.5 text-amber-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-bold text-slate-700">Journal Group</span>
                            <span className="font-mono text-[10px] text-slate-400">…{String(c.journalGroupId).slice(-8)}</span>
                            <span className="text-[10px] text-slate-400">{fmtTs(c.postedAt)}</span>
                          </div>
                          <div className="mt-1 space-y-0.5">
                            {c.entries.map((e) => (
                              <div key={String(e._id)} className="flex items-center gap-2 text-[10px] text-slate-600">
                                <span className={`w-10 font-bold ${e.direction === "credit" ? "text-blue-600" : "text-emerald-600"}`}>
                                  {e.direction === "credit" ? "CR" : "DR"}
                                </span>
                                <span className="font-mono tabular-nums">KES {fmtNum(e.direction === "credit" ? e.credit : e.debit)}</span>
                                <span className="text-slate-400">→ {e.accountCode} {e.accountName}</span>
                                {e.notes && <span className="text-slate-400 truncate max-w-[200px]">· {e.notes}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                        {canRepair && (
                          <button
                            onClick={() => doReverseCorrection(c.journalGroupId)}
                            disabled={repairing.has(`reverse-${c.journalGroupId}`)}
                            className="shrink-0 flex h-7 items-center gap-1.5 border border-amber-300 bg-amber-50 px-3 text-[10px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                          >
                            {repairing.has(`reverse-${c.journalGroupId}`) ? (
                              <><FaSyncAlt size={8} className="animate-spin" /> Undoing…</>
                            ) : (
                              <><FaUndo size={8} /> Undo</>
                            )}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!report ? (
                <div className="border border-dashed border-slate-300 py-24 text-center">
                  <FaWrench size={32} className="mx-auto mb-3 text-slate-300" />
                  <p className="text-[11px] font-semibold text-slate-500">Run a health check first to see available repairs</p>
                  <button
                    onClick={runCheck}
                    className="mt-4 px-5 py-2 text-[11px] font-bold text-white"
                    style={{ backgroundColor: GRN }}
                  >
                    Run Check Now
                  </button>
                </div>
              ) : (
                <div className="space-y-3">

                  {/* Read-only notice for view-only users */}
                  {!canRepair && (
                    <div className="flex items-center gap-2 border border-amber-200 bg-amber-50 px-4 py-2.5">
                      <FaInfoCircle size={11} className="text-amber-500 shrink-0" />
                      <span className="text-[10px] text-amber-700">
                        You have view-only access. Contact your administrator to perform repairs.
                      </span>
                    </div>
                  )}

                  {/* ── Safe Maintenance ── */}
                  <div className="border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-slate-100 px-4 py-2.5" style={{ borderLeftWidth: 3, borderLeftColor: GRN }}>
                      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">Safe Maintenance</span>
                      <span className="ml-2 text-[10px] text-slate-400">Non-destructive — can be run anytime</span>
                    </div>
                    <div className="divide-y divide-slate-100">

                      {/* Recompute Balances */}
                      <div className="flex items-start gap-3 px-4 py-3">
                        <FaSyncAlt size={12} className="mt-0.5 text-slate-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-bold text-slate-700">Recompute All COA Balances</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Rebuilds each account's cached balance directly from the ledger.
                            Fixes any mismatch between what the Chart of Accounts shows and what the GL contains.
                          </div>
                        </div>
                        <button
                          onClick={doRecompute}
                          disabled={!canRepair || repairing.has("recompute")}
                          title={!canRepair ? "Full Access required" : undefined}
                          className="shrink-0 flex h-7 items-center gap-1.5 border border-slate-200 px-3 text-[10px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {repairing.has("recompute") ? <><FaSyncAlt size={8} className="animate-spin" /> Running…</> : "Recompute"}
                        </button>
                      </div>

                      {/* Repost Invoices */}
                      <div className="flex items-start gap-3 px-4 py-3">
                        <FaTools size={12} className="mt-0.5 text-slate-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-bold text-slate-700">Repost Missing Invoice Ledger</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Finds tenant invoices that have no GL entries and posts the missing receivable and income lines.
                            Skips invoices that already have entries — no duplicates.
                          </div>
                          {journals.length > 0 && (
                            <div className="mt-1.5 inline-flex items-center gap-1 border border-amber-200 bg-amber-50 px-2 py-0.5">
                              <FaExclamationTriangle size={8} className="text-amber-500" />
                              <span className="text-[9px] font-bold text-amber-700">{journals.length} journal(s) with no ledger entries</span>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={doRepostInvoices}
                          disabled={!canRepair || repairing.has("invoices")}
                          title={!canRepair ? "Full Access required" : undefined}
                          className="shrink-0 flex h-7 items-center gap-1.5 border border-slate-200 px-3 text-[10px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {repairing.has("invoices") ? <><FaSyncAlt size={8} className="animate-spin" /> Running…</> : "Repost"}
                        </button>
                      </div>

                    </div>
                  </div>

                  {/* ── Unbalanced Groups ── */}
                  {groups.length > 0 && (
                    <div className="border border-red-200 bg-white shadow-sm overflow-hidden">
                      <div className="border-b border-red-100 bg-red-50 px-4 py-2.5">
                        <span className="text-[10px] font-black uppercase tracking-[0.12em] text-red-700">
                          Unbalanced Journal Groups · {groups.length}
                        </span>
                        <span className="ml-2 text-[10px] text-red-400">Each can be fixed by posting a correcting entry</span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {groups.map((g) => (
                          <div key={g.journalGroupId} className="flex items-start gap-3 px-4 py-3">
                            <FaExclamationCircle size={12} className="mt-0.5 text-red-400 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[11px] font-bold text-slate-700">{g.sourceType || "Journal"}</span>
                                <span className="font-mono text-[10px] text-slate-400">{String(g.journalGroupId).slice(-8)}</span>
                                <span className="text-[10px] text-slate-500">{fmtDate(g.date)}</span>
                                {(() => {
                                  const url = sourceNavUrl(g.sourceType, g.sourceId);
                                  return url ? (
                                    <button
                                      onClick={() => navigate(url)}
                                      className="flex items-center gap-1 font-mono text-[10px] text-blue-600 hover:text-blue-800 hover:underline"
                                    >
                                      …{String(g.sourceId).slice(-10)} <FaExternalLinkAlt size={8} />
                                    </button>
                                  ) : g.sourceId ? (
                                    <span className="font-mono text-[10px] text-slate-400">…{String(g.sourceId).slice(-10)}</span>
                                  ) : null;
                                })()}
                              </div>
                              <div className="mt-0.5 text-[10px] text-slate-500">
                                Dr {fmtNum(g.debit)} / Cr {fmtNum(g.credit)} ·{" "}
                                <span className="font-bold text-red-600">Δ KES {fmtNum(g.difference)}</span>
                                {" · "}{g.difference > 0 ? "missing credit leg" : "missing debit leg"}
                              </div>
                            </div>
                            {canRepair ? (
                              <div className="flex items-center gap-1.5 shrink-0">
                                {g.hasCorrectionEntry && (
                                  <button
                                    onClick={() => doReverseCorrection(g.journalGroupId)}
                                    disabled={repairing.has(`reverse-${g.journalGroupId}`)}
                                    className="flex h-7 items-center gap-1.5 border border-amber-200 bg-amber-50 px-3 text-[10px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                                  >
                                    {repairing.has(`reverse-${g.journalGroupId}`) ? (
                                      <><FaSyncAlt size={8} className="animate-spin" /> Undoing…</>
                                    ) : (
                                      <><FaUndo size={8} /> Undo</>
                                    )}
                                  </button>
                                )}
                                <button
                                  onClick={() => setGroupModal(g)}
                                  className="flex h-7 items-center gap-1.5 border border-red-200 bg-red-50 px-3 text-[10px] font-bold text-red-700 hover:bg-red-100"
                                >
                                  <FaWrench size={8} /> Fix
                                </button>
                              </div>
                            ) : (
                              <span className="shrink-0 text-[9px] text-slate-400 italic self-center">View Only</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Orphaned entries (info only) ── */}
                  {(detail.orphanedEntriesCount ?? 0) > 0 && (
                    <div className="border border-red-200 bg-white shadow-sm overflow-hidden">
                      <div className="border-b border-red-100 bg-red-50 px-4 py-2.5">
                        <span className="text-[10px] font-black uppercase tracking-[0.12em] text-red-700">
                          Orphaned Entries · {detail.orphanedEntriesCount}
                        </span>
                      </div>
                      <div className="px-4 py-3 flex items-start gap-2.5">
                        <FaInfoCircle size={12} className="mt-0.5 text-slate-400 shrink-0" />
                        <div className="text-[10px] text-slate-600">
                          These ledger entries reference accounts that no longer exist in your Chart of Accounts.
                          This is usually caused by a manual account deletion.<br />
                          <span className="font-semibold text-slate-700">
                            To fix: recreate the missing accounts in COA (or contact your administrator), then re-run the health check.
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Inactive account entries (info only) ── */}
                  {(detail.inactiveAccountEntries ?? 0) > 0 && (
                    <div className="border border-amber-200 bg-white shadow-sm overflow-hidden">
                      <div className="border-b border-amber-100 bg-amber-50 px-4 py-2.5">
                        <span className="text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">
                          Inactive Account Entries · {detail.inactiveAccountEntries}
                        </span>
                      </div>
                      <div className="px-4 py-3 flex items-start gap-2.5">
                        <FaInfoCircle size={12} className="mt-0.5 text-amber-400 shrink-0" />
                        <div className="text-[10px] text-slate-600">
                          Entries have been posted to accounts that are now inactive.
                          This does not affect GL balance but the affected accounts should be reviewed.
                          <span className="font-semibold text-slate-700"> Go to Chart of Accounts → reactivate or reassign these accounts.</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Abnormal balances (info only) ── */}
                  {abnormal.length > 0 && (
                    <div className="border border-amber-200 bg-white shadow-sm overflow-hidden">
                      <div className="border-b border-amber-100 bg-amber-50 px-4 py-2.5">
                        <span className="text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">
                          Abnormal Balances · {abnormal.length}
                        </span>
                      </div>
                      <div className="px-4 py-3 flex items-start gap-2.5">
                        <FaInfoCircle size={12} className="mt-0.5 text-amber-400 shrink-0" />
                        <div className="text-[10px] text-slate-600">
                          These accounts carry a balance on their abnormal side (e.g. an asset account with a net credit).
                          This may indicate a reversed entry with no original, a data issue, or a genuine negative balance.
                          <span className="font-semibold text-slate-700"> Review each account's ledger history before posting corrections.</span>
                        </div>
                      </div>
                      <div className="overflow-x-auto border-t border-amber-100">
                        <table className="w-full">
                          <thead><tr>
                            <TH>Code</TH><TH>Account</TH><TH>Type</TH><TH right>Net Balance</TH>
                          </tr></thead>
                          <tbody>
                            {abnormal.map((row) => (
                              <tr key={row.accountId} className="hover:bg-slate-50">
                                <TD cls="font-mono text-[10px]">{row.code}</TD>
                                <TD>{row.name}</TD>
                                <TD cls="capitalize">{row.type}</TD>
                                <TD right cls={`font-bold ${row.netBalance < 0 ? "text-red-600" : "text-amber-600"}`}>
                                  {fmtNum(row.netBalance)}
                                </TD>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* All clear in repair centre */}
                  {issues.length === 0 && (
                    <div className="border border-emerald-200 bg-emerald-50 px-4 py-10 text-center">
                      <FaCheckCircle size={28} className="mx-auto mb-3 text-emerald-400" />
                      <p className="text-[11px] font-bold text-emerald-700">No issues require repair</p>
                      <p className="mt-1 text-[10px] text-emerald-600">Your GL is healthy. Run a new check after any major posting batch.</p>
                    </div>
                  )}

                </div>
              )}
            </>
          )}

          {/* ── HISTORY TAB ── */}
          {activeTab === "history" && (
            <>
              {histLoading && (
                <div className="py-16 text-center text-[11px] text-slate-400">
                  <FaSyncAlt size={16} className="mx-auto mb-2 animate-spin text-slate-300" /> Loading history…
                </div>
              )}

              {!histLoading && history.length === 0 && (
                <div className="border border-dashed border-slate-300 py-24 text-center">
                  <FaHistory size={32} className="mx-auto mb-3 text-slate-300" />
                  <p className="text-[11px] font-semibold text-slate-500">No scan history yet</p>
                  <p className="mt-1 text-[10px] text-slate-400">Run the first health check to start the audit trail</p>
                </div>
              )}

              {!histLoading && history.length > 0 && (
                <div className="border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="border-b border-slate-100 px-4 py-2.5" style={{ borderLeftWidth: 3, borderLeftColor: GRN }}>
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">
                      Scan History · {history.length} run(s)
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead><tr>
                        <TH>Date &amp; Time</TH>
                        <TH>Ran By</TH>
                        <TH>Status</TH>
                        <TH right>Issues</TH>
                        <TH right>Repairs</TH>
                        <TH></TH>
                      </tr></thead>
                      <tbody>
                        {history.map((run) => {
                          const expanded = expandedRun === String(run._id);
                          return (
                            <React.Fragment key={run._id}>
                              <tr
                                className="hover:bg-slate-50 cursor-pointer"
                                onClick={() => setExpandedRun(expanded ? null : String(run._id))}
                              >
                                <TD cls="font-mono text-[10px]">{fmtTs(run.runAt)}</TD>
                                <TD>{run.ranBy?.name || run.ranBy?.username || "System"}</TD>
                                <TD>
                                  <span className={`inline-flex items-center px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] ${STATUS_PILL[run.overallStatus] || "bg-slate-100 text-slate-500"}`}>
                                    {run.overallStatus}
                                  </span>
                                </TD>
                                <TD right cls={run.issueCount > 0 ? "font-bold text-red-600" : "text-emerald-700"}>{run.issueCount}</TD>
                                <TD right cls={run.repairs?.length ? "font-bold text-slate-700" : "text-slate-400"}>{run.repairs?.length || 0}</TD>
                                <TD cls="text-[10px] text-slate-400 select-none">{expanded ? "▲" : "▼"}</TD>
                              </tr>

                              {expanded && (
                                <tr>
                                  <td colSpan={6} className="bg-slate-50 px-4 py-3 border-b border-slate-100">
                                    {/* Issues at time of scan */}
                                    {run.issues?.length > 0 && (
                                      <div className="mb-3">
                                        <div className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400 mb-1.5">Issues Found</div>
                                        <div className="space-y-1">
                                          {run.issues.map((iss, i) => (
                                            <div key={i} className="flex items-start gap-2">
                                              {SEV_ICON[iss.severity] || SEV_ICON.info}
                                              <span className="text-[10px] text-slate-600">{iss.issue}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* Repairs applied */}
                                    {run.repairs?.length > 0 ? (
                                      <div>
                                        <div className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400 mb-1.5">Repairs Applied</div>
                                        <div className="space-y-1.5">
                                          {run.repairs.map((rep, i) => (
                                            <div key={i} className="flex items-start gap-2.5 border border-slate-100 bg-white px-3 py-2">
                                              <span className={`mt-0.5 inline-flex items-center px-1.5 py-0 text-[8px] font-bold uppercase ${OUTCOME_PILL[rep.outcome] || "bg-slate-100 text-slate-500"}`}>
                                                {rep.outcome}
                                              </span>
                                              <div className="flex-1 min-w-0">
                                                <div className="text-[10px] font-semibold text-slate-700">{rep.description}</div>
                                                <div className="text-[9px] text-slate-400 mt-0.5">
                                                  {fmtTs(rep.appliedAt)} · {rep.recordsAffected} record(s) affected
                                                  {rep.errorMessage && <span className="ml-1 text-red-500"> · {rep.errorMessage.slice(0, 100)}</span>}
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="text-[10px] text-slate-400 italic">No repairs recorded for this scan run</div>
                                    )}
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
              )}
            </>
          )}

        </div>

        {/* Balance Group Modal */}
        {groupModal && (
          <BalanceGroupModal
            group={groupModal}
            accounts={accounts}
            businessId={businessId}
            healthRunId={healthRunId}
            onClose={() => setGroupModal(null)}
            onDone={onGroupRepaired}
            navigate={navigate}
          />
        )}

      </div>
    </DashboardLayout>
  );
}

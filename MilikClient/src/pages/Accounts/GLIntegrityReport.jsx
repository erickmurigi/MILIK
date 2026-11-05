import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaCheckCircle, FaExclamationCircle, FaExclamationTriangle, FaExternalLinkAlt, FaInfoCircle, FaListUl,
  FaSyncAlt, FaTimes, FaTools, FaUndo, FaWrench,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { ListToolbar } from "../../components/common/ListToolbar";
import MilikTable from "../../components/common/MilikTable";
import AppSelect from "../../components/common/AppSelect";
import { useTabState } from "../../hooks/useTabState";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";
import {
  getChartOfAccounts,
  getGLHealthHistory,
  repairBalanceGroup as apiRepairBalanceGroup,
  repairClearAbnormalBalance as apiRepairAbnormal,
  repairRecomputeBalances as apiRepairRecompute,
  repairRepostInvoices as apiRepairRepost,
  reverseGlCorrectionEntry as apiReverseGlCorrection,
  apiVoidOrphanedJournalGroup,
  getActiveGlCorrections,
  getGlGroupEntries,
  runGLIntegrityReport,
} from "../../redux/apiCalls";
import { useConfirm } from "../../context/ConfirmContext";
import { fmtDate } from "../../utils/dates";

const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20";
const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

const fmtTs = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtNum = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// the API sends errors as { message }
const errorText = (err, fallback) => err?.response?.data?.message || err?.response?.data?.error || err?.message || fallback;

const sourceNavUrl = (sourceType, sourceId) => {
  if (!sourceType || !sourceId) return null;
  const t = String(sourceType).toLowerCase();
  if (t === "rent_payment" || t === "receipt") return `/receipts?receipt=${sourceId}`;
  if (t === "invoice" || t === "tenant_invoice") return `/invoices/rental?invoice=${sourceId}`;
  if (t === "invoice_note") return "/invoices/notes";
  if (t === "late_penalty_batch") return "/invoices/late-penalties";
  if (t === "payment_voucher") return "/accounts/payment-vouchers";
  if (t === "landlord_receipt") return "/receipts/landlord";
  if (t === "landlord_payment") return "/landlord-payments";
  if (t === "journal_entry") return "/accounts/journals";
  return null;
};
const accountActivityUrl = (accountId) => `/accounts/chart-of-accounts/${accountId}/activity`;

const RESULT = {
  pass:   { label: "Pass",     cls: "text-emerald-700", icon: FaCheckCircle },
  review: { label: "Review",   cls: "text-amber-700",   icon: FaExclamationTriangle },
  fail:   { label: "Fail",     cls: "text-red-700",     icon: FaExclamationCircle },
  info:   { label: "Info",     cls: "text-slate-600",   icon: FaInfoCircle },
};
const RUN_STATUS = {
  clean:    { label: "Clean",    cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  warnings: { label: "Warnings", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  critical: { label: "Critical", cls: "border-red-200 bg-red-50 text-red-700" },
};

// small inner tables inside an expanded check
const SubTable = ({ head, children }) => (
  <table className="w-full border border-slate-200 bg-white text-[11px] normal-case">
    <thead>
      <tr className="border-b border-slate-200 bg-slate-50">
        {head.map((h) => (
          <th key={h.label} className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600 ${h.right ? "text-right" : "text-left"}`}>{h.label}</th>
        ))}
      </tr>
    </thead>
    <tbody>{children}</tbody>
  </table>
);
const Td = ({ children, right, cls = "" }) => (
  <td className={`border-b border-slate-100 px-2.5 py-1 ${right ? "text-right tabular-nums" : ""} ${cls}`}>{children}</td>
);
const Hint = ({ children }) => <p className="mb-1.5 text-[11px] text-slate-600 normal-case">{children}</p>;
const iconBtn = "inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40";

const Modal = ({ title, icon: Icon, onClose, busy, children, footer, width = "max-w-lg" }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className={`flex max-h-[92vh] w-full ${width} flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl`}>
      <div className="flex flex-shrink-0 items-center justify-between gap-3 bg-[#0B3B2E] px-4 py-2.5 text-white">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-black uppercase tracking-wide">
          {Icon && <Icon size={12} />}<span className="truncate">{title}</span>
        </h3>
        <button type="button" onClick={() => !busy && onClose()} disabled={busy} className="text-white/70 hover:text-white"><FaTimes size={13} /></button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50/60 p-3">{children}</div>
      <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-2.5">{footer}</div>
    </div>
  </div>
);
const CancelButton = ({ onClick, busy }) => (
  <button type="button" onClick={onClick} disabled={busy} className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
);
const PrimaryButton = ({ children, danger, ...props }) => (
  <button type="button" {...props} className={`inline-flex h-8 items-center gap-1.5 px-4 text-xs font-black text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${danger ? "bg-red-700 hover:bg-red-800" : "bg-[#0B3B2E] hover:bg-[#0A3127]"}`}>{children}</button>
);
const Section = ({ title, children }) => (
  <div className="border border-slate-200 bg-white">
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5"><h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3></div>
    <div className="p-2.5">{children}</div>
  </div>
);

// ─── Fix an unbalanced journal group ─────────────────────────────────────────
function BalanceGroupModal({ group, accounts, healthRunId, onClose, onDone, navigate }) {
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    let live = true;
    getGlGroupEntries(group.journalGroupId)
      .then((d) => {
        if (!live) return;
        const loaded = d?.entries ?? [];
        setEntries(loaded);
        // a deleted source: preselect the account of the leg left without a partner
        if (group.sourceOrphaned) {
          const active = loaded.filter((e) => e.status !== "reversed");
          const leg = group.difference > 0 ? active.find((e) => e.debit > 0) : active.find((e) => e.credit > 0);
          if (leg?.accountId) setAccountId(String(leg.accountId));
        }
      })
      .catch(() => live && setEntries([]));
    return () => { live = false; };
  }, [group]);

  const direction = group.difference > 0 ? "Credit" : "Debit";
  const amount = Math.abs(group.difference);
  const sourceUrl = sourceNavUrl(group.sourceType, group.sourceId);
  const active = (entries || []).filter((e) => e.status !== "reversed");

  const post = async () => {
    setBusy(true);
    try {
      await apiRepairBalanceGroup(group.journalGroupId, { accountId, notes, healthRunId });
      toast.success("Correcting entry posted. The group is balanced.");
      onDone();
    } catch (err) {
      toast.error(errorText(err, "Repair failed"));
    } finally {
      setBusy(false);
    }
  };
  const voidAll = async () => {
    setBusy(true);
    try {
      const res = await apiVoidOrphanedJournalGroup(group.journalGroupId, {});
      toast.success(`${res.voidedCount} orphaned entr${res.voidedCount === 1 ? "y" : "ies"} voided`);
      onDone();
    } catch (err) {
      toast.error(errorText(err, "Void failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Unbalanced journal group" icon={FaWrench} onClose={onClose} busy={busy} width="max-w-xl"
      footer={<>
        <CancelButton onClick={onClose} busy={busy} />
        {group.sourceOrphaned && <PrimaryButton danger onClick={voidAll} disabled={busy}>Void all entries</PrimaryButton>}
        <PrimaryButton onClick={post} disabled={busy || !accountId}><FaWrench size={10} /> Post correction</PrimaryButton>
      </>}
    >
      {group.sourceOrphaned ? (
        <div className="flex gap-2 border border-red-300 bg-red-50 p-2.5 text-xs text-red-800">
          <FaExclamationCircle className="mt-0.5 shrink-0" />
          <span>The source {group.sourceType} was deleted, so these entries are orphaned. Void them, or post a correction to balance them.</span>
        </div>
      ) : sourceUrl ? (
        <div className="flex items-start justify-between gap-2 border border-slate-200 bg-white p-2.5 text-xs text-slate-700">
          <span>Best fix: correct the original {group.sourceType} itself, so the audit trail stays clean.</span>
          <button type="button" onClick={() => { onClose(); navigate(sourceUrl); }} className="inline-flex shrink-0 items-center gap-1 font-bold text-[#0B3B2E] hover:underline">
            Open {group.sourceRef || "source"} <FaExternalLinkAlt size={9} />
          </button>
        </div>
      ) : null}

      <Section title={`Entries · Dr ${fmtNum(group.debit)} / Cr ${fmtNum(group.credit)}`}>
        {entries === null ? (
          <p className="text-xs text-slate-500">Loading entries…</p>
        ) : (
          <SubTable head={[{ label: "Account" }, { label: "Debit", right: true }, { label: "Credit", right: true }, { label: "Source" }]}>
            {active.map((e) => (
              <tr key={String(e._id)}>
                <Td>{e.accountCode} {e.accountName}</Td>
                <Td right>{e.debit > 0 ? fmtNum(e.debit) : ""}</Td>
                <Td right>{e.credit > 0 ? fmtNum(e.credit) : ""}</Td>
                <Td cls={e.sourceTransactionType === "manual_adjustment" ? "font-semibold text-amber-800" : "text-slate-500"}>
                  {e.sourceTransactionType === "manual_adjustment" ? "correction" : e.sourceTransactionType || "—"}
                </Td>
              </tr>
            ))}
          </SubTable>
        )}
        <p className="mt-1.5 text-xs font-bold text-red-700">Missing: {direction} of KES {fmtNum(amount)}</p>
      </Section>

      <Section title="Correcting entry (last resort)">
        <div className="grid grid-cols-1 gap-2">
          <div>
            <span className={labelClass}>Account to post the {direction.toLowerCase()} to<Required /></span>
            <AppSelect
              value={accountId} onChange={(v) => setAccountId(v ?? "")} searchable size="sm" placeholder="Select account"
              options={accounts.map((a) => ({ value: String(a._id), label: `${a.code} – ${a.name}` }))}
            />
            <p className="mt-1 text-[11px] text-slate-500">Unsure? Use a suspense account and investigate before the period closes.</p>
          </div>
          <label><span className={labelClass}>Notes</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why is this correction posted?" className={inputClass} />
          </label>
        </div>
      </Section>
    </Modal>
  );
}

// ─── Clear an abnormal balance ───────────────────────────────────────────────
function AbnormalBalanceModal({ row, accounts, healthRunId, onClose, onDone }) {
  const [offsetId, setOffsetId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const postSide = row.side === "Dr" ? "credit" : "debit";

  const post = async () => {
    setBusy(true);
    try {
      const res = await apiRepairAbnormal({ accountId: String(row.accountId), offsetAccountId: offsetId, notes: notes.trim(), healthRunId });
      toast.success(`Correction posted: KES ${fmtNum(res.amount)} ${res.direction}`);
      onDone();
    } catch (err) {
      toast.error(errorText(err, "Repair failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Clear ${row.code} ${row.name}`} icon={FaWrench} onClose={onClose} busy={busy}
      footer={<><CancelButton onClick={onClose} busy={busy} /><PrimaryButton onClick={post} disabled={busy || !offsetId || notes.trim().length < 5}>Post correction</PrimaryButton></>}
    >
      <div className="flex gap-2 border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
        <FaExclamationTriangle className="mt-0.5 shrink-0" />
        <span>
          This {row.type} account has a <strong>{row.side === "Dr" ? "debit" : "credit"} balance of KES {fmtNum(row.amount)}</strong>. Clearing posts a {postSide} of that amount here and the opposite to the offset account, bringing it to zero.
          Only do this once you know why the balance is there: open its ledger first. A wrong-side balance is usually a mis-posted entry that should be corrected at source.
        </span>
      </div>
      <Section title="Correction">
        <div className="grid grid-cols-1 gap-2">
          <div>
            <span className={labelClass}>Offset account<Required /></span>
            <AppSelect
              value={offsetId} onChange={(v) => setOffsetId(v ?? "")} searchable size="sm" placeholder="Select account"
              options={accounts.filter((a) => String(a._id) !== String(row.accountId)).map((a) => ({ value: String(a._id), label: `${a.code} – ${a.name}` }))}
            />
          </div>
          <label><span className={labelClass}>Reason<Required /></span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Reversal posted without its original in March" className={inputClass} />
          </label>
        </div>
      </Section>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function GLIntegrityReport() {
  const company = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const businessId = company?._id;
  const confirm = useConfirm();
  const navigate = useNavigate();
  // the repair endpoints are guarded by ledger.repair
  const canRepair = hasCompanyPermission(currentUser, company, "ledger", "repair", "accounts");

  const [view, setView] = useTabState("/accounts/gl-integrity:view", "checks");
  const [report, setReport] = useTabState("/accounts/gl-integrity:report", null);
  const [history, setHistory] = useTabState("/accounts/gl-integrity:history", []);
  const [corrections, setCorrections] = useTabState("/accounts/gl-integrity:corrections", []);
  const [loading, setLoading] = useState(false);
  const [histLoading, setHistLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy] = useState(new Set());
  const [groupModal, setGroupModal] = useState(null);
  const [abnormalModal, setAbnormalModal] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const healthRunId = report?.healthRunId;
  const start = (k) => setBusy((s) => new Set(s).add(k));
  const end = (k) => setBusy((s) => { const n = new Set(s); n.delete(k); return n; });

  const loadHistory = useCallback(async () => {
    if (!businessId) return;
    setHistLoading(true);
    try { setHistory(await getGLHealthHistory()); } catch { /* history is secondary */ } finally { setHistLoading(false); }
  }, [businessId, setHistory]);

  const loadCorrections = useCallback(async () => {
    if (!businessId) return;
    try { setCorrections((await getActiveGlCorrections())?.corrections ?? []); } catch { /* secondary */ }
  }, [businessId, setCorrections]);

  const runCheck = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      setReport(await runGLIntegrityReport());
      setView("checks");
      loadCorrections();
    } catch (err) {
      toast.error(errorText(err, "Health check failed"));
    } finally {
      setLoading(false);
    }
  }, [businessId, setReport, setView, loadCorrections]);

  useEffect(() => {
    if (!businessId) return;
    getChartOfAccounts({ limit: 500 })
      .then((res) => setAccounts((res?.data ?? res ?? []).filter((a) => a.isPosting !== false && !a.isHeader)))
      .catch(() => {});
    loadCorrections();
  }, [businessId, loadCorrections]);
  useEffect(() => { if (view === "history") loadHistory(); }, [view, loadHistory]);

  const afterRepair = () => { setGroupModal(null); setAbnormalModal(null); runCheck().then(loadHistory); };

  const runMaintenance = async (key) => {
    setMenuOpen(false);
    const isRecompute = key === "recompute";
    const ok = await confirm({
      title: isRecompute ? "Recompute account balances" : "Repost missing invoice ledger",
      message: isRecompute
        ? "Rebuilds every account's stored balance from the ledger. Posts nothing, safe at any time."
        : "Posts the missing receivable and income lines for tenant invoices that have none. Invoices that already have entries are skipped.",
      confirmText: isRecompute ? "Recompute" : "Repost",
    });
    if (!ok) return;
    start(key);
    try {
      const res = isRecompute ? await apiRepairRecompute({ healthRunId }) : await apiRepairRepost({ healthRunId });
      toast.success(isRecompute ? `${res.accountsUpdated} account balances recomputed` : `${res.posted} invoice(s) reposted, ${res.skipped} skipped`);
      if (!isRecompute && res.errors?.length) toast.warn(`${res.errors.length} invoice(s) could not be reposted`);
      runCheck().then(loadHistory);
    } catch (err) {
      toast.error(errorText(err, "Maintenance failed"));
    } finally {
      end(key);
    }
  };

  const undoCorrection = async (groupId, entryIds = []) => {
    const ok = await confirm({
      title: "Undo GL correction",
      message: "Reverses the manual correcting entry so the ledger is back to how it was before it. Fix the original transaction afterwards.",
      confirmText: "Undo",
    });
    if (!ok) return;
    const key = `undo-${groupId}`;
    start(key);
    try {
      const res = await apiReverseGlCorrection(groupId, { healthRunId, entryIds });
      toast.success(`Correction undone: ${res.reversedCount} entr${res.reversedCount === 1 ? "y" : "ies"} reversed`);
      runCheck().then(loadHistory);
    } catch (err) {
      toast.error(errorText(err, "Undo failed"));
    } finally {
      end(key);
    }
  };

  // ── One row per check ──────────────────────────────────────────────────────
  const checks = useMemo(() => {
    if (!report) return [];
    const d = report.detail || {};
    const gl = d.glBalance || {};
    const groups = d.unbalancedGroups || [];
    const abnormal = d.abnormalBalances || [];
    const mismatches = d.storedBalanceMismatches || [];
    const late = d.closedPeriodPostings || [];
    const journals = d.journalsWithNoLedger || [];
    const ungrouped = d.ungroupedEntries || [];
    const recs = d.reconciliations || [];
    const lateCount = late.reduce((s, p) => s + p.entries, 0);

    return [
      { key: "gl", label: "Debits equal credits", status: gl.balanced ? "pass" : "fail",
        result: gl.balanced ? "Balanced" : `Out by KES ${fmtNum(Math.abs(gl.difference))}`,
        detail: `Dr ${fmtNum(gl.totalDebit)} · Cr ${fmtNum(gl.totalCredit)}` },
      { key: "groups", label: "Every transaction balances", status: groups.length ? "fail" : "pass",
        result: groups.length ? `${groups.length} unbalanced` : "All balanced", detail: "Each journal group's debits equal its credits", expand: groups.length > 0 },
      { key: "orphaned", label: "Entries on deleted accounts", status: d.orphanedEntriesCount ? "fail" : "pass",
        result: d.orphanedEntriesCount ? `${d.orphanedEntriesCount} entries` : "None", detail: "Entries whose account no longer exists", expand: d.orphanedEntriesCount > 0 },
      ...recs.map((r) => ({
        key: r.key, label: r.label, status: Math.abs(r.difference) >= 0.01 ? "review" : "pass", rec: r,
        result: Math.abs(r.difference) >= 0.01 ? `Off by KES ${fmtNum(Math.abs(r.difference))}` : "Agrees",
        detail: `${r.account ? `${r.account.code} ${r.account.name}: ` : ""}GL ${fmtNum(r.gl)} · sub-ledger ${fmtNum(r.subledger)}`,
        expand: Math.abs(r.difference) >= 0.01,
      })),
      { key: "abnormal", label: "Balances on the expected side", status: abnormal.length ? "review" : "pass",
        result: abnormal.length ? `${abnormal.length} to review` : "All normal", detail: "Contra accounts such as accumulated depreciation are expected on the other side and skipped", expand: abnormal.length > 0 },
      { key: "stored", label: "Stored balances match the ledger", status: mismatches.length ? "review" : "pass",
        result: mismatches.length ? `${mismatches.length} out of date` : "Up to date", detail: "Chart of Accounts balances against the ledger", expand: mismatches.length > 0 },
      { key: "late", label: "No postings into closed periods", status: late.length ? "review" : "pass",
        result: late.length ? `${lateCount} entries in ${late.length} period(s)` : "None", detail: "Entries created after their period closed, including posting windows", expand: late.length > 0 },
      { key: "inactive", label: "Entries on inactive accounts", status: d.inactiveAccountEntries ? "review" : "pass",
        result: d.inactiveAccountEntries ? `${d.inactiveAccountEntries} entries` : "None", detail: "Reactivate the accounts or reclassify the entries", expand: d.inactiveAccountEntries > 0 },
      { key: "journals", label: "Posted journals have ledger lines", status: journals.length ? "review" : "pass",
        result: journals.length ? `${journals.length} without lines` : "All posted", detail: "Journals marked posted with nothing in the ledger", expand: journals.length > 0 },
      { key: "ungrouped", label: "Corrections are grouped", status: ungrouped.length ? "review" : "pass",
        result: ungrouped.length ? `${ungrouped.length} ungrouped` : "All grouped", detail: "Correction entries without a journal group can't be checked as a pair", expand: ungrouped.length > 0 },
      { key: "corrections", label: "Manual GL corrections", status: "info",
        result: corrections.length ? `${corrections.length} active` : "None", detail: "Correcting entries posted from this page, which can be undone", expand: corrections.length > 0 },
    ];
  }, [report, corrections]);

  // open every failing check when a new report arrives
  useEffect(() => {
    setExpanded(new Set(checks.filter((c) => c.expand && c.status !== "info").map((c) => c.key)));
  }, [report]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => checks.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] || 0) + 1 }), {}), [checks]);
  const runStatus = RUN_STATUS[report?.overallStatus];

  const renderCheckDetail = (c) => {
    const d = report?.detail || {};
    switch (c.key) {
      case "groups":
        return (
          <SubTable head={[{ label: "Source" }, { label: "Date" }, { label: "Debit", right: true }, { label: "Credit", right: true }, { label: "Difference", right: true }, { label: "" }]}>
            {(d.unbalancedGroups || []).map((g) => {
              const url = sourceNavUrl(g.sourceType, g.sourceId);
              return (
                <tr key={g.journalGroupId}>
                  <Td>
                    <span className="font-semibold text-slate-900">{g.sourceType || "Journal"}</span>
                    {g.sourceOrphaned ? <span className="ml-1.5 font-semibold text-red-700">source deleted</span>
                      : url ? <button type="button" onClick={() => navigate(url)} className="ml-1.5 text-[#0B3B2E] hover:underline">{g.sourceRef || "open"} <FaExternalLinkAlt size={8} className="inline" /></button>
                        : <span className="ml-1.5 text-slate-500">{g.sourceRef || ""}</span>}
                  </Td>
                  <Td>{fmtDate(g.date)}</Td>
                  <Td right>{fmtNum(g.debit)}</Td>
                  <Td right>{fmtNum(g.credit)}</Td>
                  <Td right cls="font-bold text-red-700">{fmtNum(g.difference)}</Td>
                  <Td right>
                    {canRepair && g.hasCorrectionEntry && (
                      <button type="button" className={iconBtn} disabled={busy.has(`undo-${g.journalGroupId}`)} onClick={() => undoCorrection(g.journalGroupId)}><FaUndo size={10} /> Undo</button>
                    )}
                    {canRepair && <button type="button" className={iconBtn} onClick={() => setGroupModal(g)}><FaWrench size={10} /> Fix</button>}
                  </Td>
                </tr>
              );
            })}
          </SubTable>
        );
      case "abnormal":
        return (
          <>
            <Hint>A balance on the wrong side usually means an entry was posted to the wrong account, or a reversal has no original. Open the ledger and correct the transaction at source; clearing the balance is the last resort.</Hint>
            <SubTable head={[{ label: "Account" }, { label: "Type" }, { label: "Balance", right: true }, { label: "" }]}>
              {(d.abnormalBalances || []).map((row) => (
                <tr key={row.accountId}>
                  <Td>
                    <span className="font-semibold text-slate-900">{row.code}</span> <span className="text-slate-700">{row.name}</span>
                    {row.isClearing && <span className="ml-1.5 text-slate-500">· clearing account: should net to zero</span>}
                  </Td>
                  <Td cls="capitalize">{row.type}</Td>
                  <Td right cls="font-bold text-amber-800">{row.side} {fmtNum(row.amount)}</Td>
                  <Td right>
                    <button type="button" className={iconBtn} onClick={() => navigate(accountActivityUrl(row.accountId))}><FaListUl size={10} /> Ledger</button>
                    {canRepair && <button type="button" className={iconBtn} onClick={() => setAbnormalModal(row)}><FaWrench size={10} /> Clear</button>}
                  </Td>
                </tr>
              ))}
            </SubTable>
          </>
        );
      case "stored":
        return (
          <>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Hint>Only the stored figure is stale; the ledger is right. Recompute refreshes it and posts nothing.</Hint>
              {canRepair && <ListToolbar.Button variant="outline" icon={FaSyncAlt} disabled={busy.has("recompute")} onClick={() => runMaintenance("recompute")}>Recompute balances</ListToolbar.Button>}
            </div>
            <SubTable head={[{ label: "Account" }, { label: "Stored", right: true }, { label: "Ledger", right: true }, { label: "Difference", right: true }]}>
              {(d.storedBalanceMismatches || []).map((m) => (
                <tr key={m.accountId}>
                  <Td><span className="font-semibold text-slate-900">{m.code}</span> {m.name}</Td>
                  <Td right>{fmtNum(m.stored)}</Td>
                  <Td right>{fmtNum(m.ledger)}</Td>
                  <Td right cls="font-bold text-amber-800">{fmtNum(m.difference)}</Td>
                </tr>
              ))}
            </SubTable>
          </>
        );
      case "late":
        return (
          <>
            <Hint>Usually entries posted through a posting window, or by a module that wrote to the ledger directly. Check each was intended.</Hint>
            <SubTable head={[{ label: "Period" }, { label: "Status" }, { label: "Closed" }, { label: "Entries", right: true }, { label: "Debits", right: true }]}>
              {(d.closedPeriodPostings || []).map((p) => (
                <tr key={p.periodId}>
                  <Td cls="font-semibold text-slate-900">{p.name}</Td>
                  <Td cls="capitalize">{p.status}</Td>
                  <Td>{fmtTs(p.closedAt)}</Td>
                  <Td right>{p.entries}</Td>
                  <Td right>{fmtNum(p.debit)}</Td>
                </tr>
              ))}
            </SubTable>
          </>
        );
      case "orphaned":
        return <Hint>These entries point to accounts that were deleted from the Chart of Accounts. Recreate the accounts (or ask your administrator), then run the check again.</Hint>;
      case "inactive":
        return <Hint>Entries sit on accounts that are now inactive. They still count in the totals; reactivate the accounts in the Chart of Accounts or reclassify the entries.</Hint>;
      case "journals":
        return (
          <>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Hint>Journals marked posted with no ledger lines. Tenant invoices missing their ledger can be reposted.</Hint>
              {canRepair && <ListToolbar.Button variant="outline" icon={FaTools} disabled={busy.has("invoices")} onClick={() => runMaintenance("invoices")}>Repost invoice ledger</ListToolbar.Button>}
            </div>
            <div className="flex flex-wrap gap-1.5 normal-case">
              {(d.journalsWithNoLedger || []).map((j) => (
                <span key={j.id} className="border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700">{j.journalNo || "Journal"} · {fmtDate(j.date)}</span>
              ))}
            </div>
          </>
        );
      case "ungrouped":
        return (
          <SubTable head={[{ label: "Source" }, { label: "Date" }, { label: "Debit", right: true }, { label: "Credit", right: true }]}>
            {(d.ungroupedEntries || []).map((e) => (
              <tr key={e.id}>
                <Td>{e.sourceType} <span className="text-slate-500">…{String(e.sourceId || "").slice(-8)}</span></Td>
                <Td>{fmtDate(e.date)}</Td>
                <Td right>{e.debit ? fmtNum(e.debit) : ""}</Td>
                <Td right>{e.credit ? fmtNum(e.credit) : ""}</Td>
              </tr>
            ))}
          </SubTable>
        );
      case "corrections":
        return (
          <SubTable head={[{ label: "Posted" }, { label: "Lines" }, { label: "" }]}>
            {corrections.map((c2) => (
              <tr key={c2.journalGroupId}>
                <Td cls="whitespace-nowrap">{fmtTs(c2.postedAt)}</Td>
                <Td>
                  {c2.entries.map((e) => (
                    <span key={String(e._id)} className="block">
                      <span className="font-bold">{e.direction === "credit" ? "Cr" : "Dr"}</span> {fmtNum(e.direction === "credit" ? e.credit : e.debit)} · {e.accountCode} {e.accountName}
                      {e.notes && <span className="text-slate-500"> · {e.notes}</span>}
                    </span>
                  ))}
                </Td>
                <Td right>
                  {canRepair && (
                    <button type="button" className={iconBtn} disabled={busy.has(`undo-${c2.journalGroupId}`)} onClick={() => undoCorrection(c2.journalGroupId, c2.entries.map((e) => e._id))}>
                      <FaUndo size={10} /> Undo
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </SubTable>
        );
      default:
        if (c.rec) {
          return (
            <div className="flex items-center justify-between gap-2">
              <Hint>The sub-ledger and its GL account should be equal. A difference usually means an entry was posted to this account by hand, or a sub-ledger record was changed without its posting.</Hint>
              <ListToolbar.Button variant="outline" icon={FaExternalLinkAlt} onClick={() => navigate(c.rec.link)}>Open</ListToolbar.Button>
            </div>
          );
        }
        return null;
    }
  };

  const checkColumns = [
    { label: "Check", width: "30%" },
    { label: "Result", width: "18%" },
    { label: "Detail", width: "52%" },
  ];
  const historyColumns = [
    { label: "Date & time", width: "22%" },
    { label: "Ran by", width: "26%" },
    { label: "Status", width: "14%" },
    { label: "Issues", width: "12%", align: "right" },
    { label: "Repairs", width: "12%", align: "right" },
  ];
  const cell = "px-3 py-1.5 border-r border-gray-100 normal-case";

  return (
    <DashboardLayout>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-1 sm:p-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white">
          <ListToolbar>
            {[{ key: "checks", label: "Checks" }, { key: "history", label: "History" }].map((t) => (
              <ListToolbar.Button key={t.key} variant={view === t.key ? "primary" : "outline"} onClick={() => setView(t.key)}>{t.label}</ListToolbar.Button>
            ))}
            <ListToolbar.Divider />
            {report && view === "checks" && (
              <>
                {runStatus && <span className={`shrink-0 border px-1.5 py-0.5 text-[10px] font-bold ${runStatus.cls}`}>{runStatus.label}</span>}
                <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Checked: <span className="font-normal">{fmtTs(report.runAt)}</span></span>
                <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Fail: {counts.fail || 0}</span>
                <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Review: {counts.review || 0}</span>
                <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Pass: {counts.pass || 0}</span>
              </>
            )}
            {view === "history" && history.length > 0 && (
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Runs: {history.length}</span>
            )}
            <div className="ml-auto" />
            {canRepair && (
              <>
                <ListToolbar.Button ref={menuRef} variant="outline" icon={FaTools} onClick={() => setMenuOpen((o) => !o)}>Maintenance</ListToolbar.Button>
                <ListToolbar.Menu open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={menuRef} width="w-64">
                  <ListToolbar.MenuItem icon={FaSyncAlt} disabled={busy.has("recompute")} onClick={() => runMaintenance("recompute")}>Recompute account balances</ListToolbar.MenuItem>
                  <ListToolbar.MenuItem icon={FaTools} disabled={busy.has("invoices")} onClick={() => runMaintenance("invoices")}>Repost missing invoice ledger</ListToolbar.MenuItem>
                </ListToolbar.Menu>
                <ListToolbar.Divider />
              </>
            )}
            <ListToolbar.Button icon={FaSyncAlt} onClick={runCheck} disabled={loading}>{loading ? "Running…" : "Run Check"}</ListToolbar.Button>
          </ListToolbar>

          {view === "checks" ? (
            <MilikTable
              columns={checkColumns}
              rows={checks}
              rowKey="key"
              loading={loading && !report}
              tableFixed
              minWidth={800}
              empty="Run Check to audit the general ledger: totals, every transaction, sub-ledgers, closed periods and more."
              expandedKeys={expanded}
              onExpandedKeysChange={setExpanded}
              renderRow={(c) => {
                const r = RESULT[c.status];
                const Icon = r.icon;
                return (
                  <>
                    <td className={`${cell} font-semibold text-slate-900`}>{c.label}</td>
                    <td className={`${cell} font-bold ${r.cls}`}><Icon size={10} className="mr-1 inline" />{r.label}<span className="ml-1.5 font-normal text-slate-600">{c.result}</span></td>
                    <td className="px-3 py-1.5 normal-case text-slate-600">{c.detail}</td>
                  </>
                );
              }}
              renderExpanded={(c) => (c.expand ? renderCheckDetail(c) : <p className="text-[11px] normal-case text-slate-500">Nothing to show.</p>)}
            />
          ) : (
            <MilikTable
              columns={historyColumns}
              rows={history}
              loading={histLoading && history.length === 0}
              tableFixed
              minWidth={700}
              empty="No checks run yet."
              renderRow={(run) => {
                const s = RUN_STATUS[run.overallStatus];
                const ranBy = [run.ranBy?.surname, run.ranBy?.otherNames].filter(Boolean).join(" ") || run.ranByName || "—";
                return (
                  <>
                    <td className={`${cell} text-slate-700`}>{fmtTs(run.runAt)}</td>
                    <td className={`${cell} text-slate-700`}>{ranBy}</td>
                    <td className={cell}>{s && <span className={`border px-1.5 py-0.5 text-[9px] font-bold ${s.cls}`}>{s.label}</span>}</td>
                    <td className={`${cell} text-right tabular-nums`}>{run.issueCount}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{run.repairs?.length || 0}</td>
                  </>
                );
              }}
              renderExpanded={(run) => (
                <div className="space-y-2 normal-case">
                  <div>
                    <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Issues found</div>
                    {run.issues?.length ? run.issues.map((iss, i) => (
                      <p key={i} className="text-[11px] text-slate-700"><span className={`font-bold ${iss.severity === "critical" ? "text-red-700" : "text-amber-800"}`}>{iss.severity}</span> · {iss.issue}</p>
                    )) : <p className="text-[11px] text-slate-500">None</p>}
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Repairs applied</div>
                    {run.repairs?.length ? (
                      <SubTable head={[{ label: "When" }, { label: "Repair" }, { label: "Outcome" }, { label: "Records", right: true }]}>
                        {run.repairs.map((rep, i) => (
                          <tr key={i}>
                            <Td cls="whitespace-nowrap">{fmtTs(rep.appliedAt)}</Td>
                            <Td>{rep.description}{rep.errorMessage && <span className="block text-red-700">{rep.errorMessage.slice(0, 160)}</span>}</Td>
                            <Td cls={rep.outcome === "failed" ? "font-bold text-red-700" : "font-bold text-emerald-700"}>{rep.outcome}</Td>
                            <Td right>{rep.recordsAffected}</Td>
                          </tr>
                        ))}
                      </SubTable>
                    ) : <p className="text-[11px] text-slate-500">None</p>}
                  </div>
                </div>
              )}
            />
          )}
        </div>
      </div>

      {groupModal && <BalanceGroupModal group={groupModal} accounts={accounts} healthRunId={healthRunId} onClose={() => setGroupModal(null)} onDone={afterRepair} navigate={navigate} />}
      {abnormalModal && <AbnormalBalanceModal row={abnormalModal} accounts={accounts} healthRunId={healthRunId} onClose={() => setAbnormalModal(null)} onDone={afterRepair} />}
    </DashboardLayout>
  );
}

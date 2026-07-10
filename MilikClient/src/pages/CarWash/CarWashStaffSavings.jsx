import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import {
  FaChevronDown,
  FaChevronUp,
  FaClock,
  FaHandHoldingUsd,
  FaFlag,
  FaPiggyBank,
  FaPrint,
  FaRedoAlt,
  FaTimes,
  FaTrash,
  FaUndo,
  FaUsers,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import { useTabState } from "../../hooks/useTabState";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ic  = "h-7 border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const icc = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const lc  = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const localISO = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const todayISO = () => localISO(new Date());

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

// Avatar
const AVATAR_PALETTES = [
  { bg: "#D4EAE0", fg: "#0B3B2E" }, { bg: "#dbeafe", fg: "#1e3a5f" },
  { bg: "#ffedd5", fg: "#7c2d12" }, { bg: "#ede9fe", fg: "#4c1d95" },
  { bg: "#dcfce7", fg: "#14532d" }, { bg: "#fee2e2", fg: "#7f1d1d" },
  { bg: "#fef9c3", fg: "#713f12" }, { bg: "#e0f2fe", fg: "#0c4a6e" },
];
const avatarPalette = (name = "") => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTES[Math.abs(h) % AVATAR_PALETTES.length];
};
const getInitials = (name = "") => {
  const p = name.trim().split(/\s+/);
  return (p.length >= 2 ? p[0][0] + p[1][0] : name.slice(0, 2)).toUpperCase();
};

// Type pill
const typePillClass = (type) =>
  type === "disbursement" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
  : type === "deduction"  ? "border-orange-200 bg-orange-50 text-[#C8511A]"
  :                         "border-slate-200 bg-slate-50 text-slate-400";

const DETAIL_LIMIT = 30;

// ─── Sub-components ────────────────────────────────────────────────────────────

// Stacked progress bar: deducted (green) + pending (amber) + disbursed (red) over totalAccrued
function SavingsBar({ deducted, pending, disbursed }) {
  const total = round2(deducted + pending + disbursed);
  if (total <= 0) return <div className="h-1 w-full rounded-full bg-slate-100" />;
  const dPct = round2(deducted / total * 100);
  const pPct = round2(pending  / total * 100);
  const sPct = round2(disbursed / total * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 flex">
      <div style={{ width: `${dPct}%` }}  className="h-full bg-[#0B3B2E] transition-all" />
      <div style={{ width: `${pPct}%` }}  className="h-full bg-amber-400 transition-all" />
      <div style={{ width: `${sPct}%` }}  className="h-full bg-emerald-400 transition-all" />
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
const CarWashStaffSavings = () => {
  const currentCompany = useSelector(selectCurrentCompany);
  const canPay    = useCarWashPermission("carwash-commissions", "pay");
  const canManage = useCarWashPermission("carwash-commissions", "manage");

  const [balances,        setBalances]        = useState([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [selectedStaff,   setSelectedStaff]   = useTabState("/carwash/commissions/savings:selectedStaff", null);
  const [records,         setRecords]         = useState([]);
  const [recordsTotal,    setRecordsTotal]    = useState(0);
  const [recordsLoading,  setRecordsLoading]  = useState(false);
  const [detailFrom,      setDetailFrom]      = useTabState("/carwash/commissions/savings:detailFrom", "");
  const [detailTo,        setDetailTo]        = useTabState("/carwash/commissions/savings:detailTo", todayISO());
  const [detailPage,      setDetailPage]      = useTabState("/carwash/commissions/savings:detailPage", 1);
  const detailRef   = useRef(null);
  const prevStaffId = useRef(null);

  const { data: cashbooksRaw } = useQuery({
    queryKey: ["cw-savings-cashbooks", currentCompany?._id],
    queryFn: () => carWashApi.listChartOfAccounts({ type: "asset", moduleScope: "carwash" }),
    enabled: !!currentCompany?._id,
    staleTime: 5 * 60_000,
    select: (data) => Array.isArray(data) ? data : normalizeListPayload(data, "accounts"),
  });
  const cashbooks = cashbooksRaw ?? [];

  const { data: settingsRaw } = useQuery({
    queryKey: ["cw-savings-settings", currentCompany?._id],
    queryFn: () => carWashApi.getCarWashSettings(),
    enabled: !!currentCompany?._id,
    staleTime: 5 * 60_000,
  });
  const savingsEnabled = settingsRaw?.savingsEnabled !== false;

  const [showDisburse,  setShowDisburse]  = useState(false);
  const [disburseStaff, setDisburseStaff] = useState(null);
  const [dForm,         setDForm]         = useState({ amount: "", cashbookAccount: "", notes: "" });
  const [disbursing,    setDisbursing]    = useState(false);
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reverseNotes,  setReverseNotes]  = useState("");
  const [reversing,     setReversing]     = useState(false);
  const [resetConfirm,  setResetConfirm]  = useState(false);
  const [resetting,     setResetting]     = useState(false);
  const [printing,      setPrinting]      = useState(false);
  const [initializing,    setInitializing]    = useState(false);
  const [showInitModal,   setShowInitModal]   = useState(false);
  const [initStartDate,   setInitStartDate]   = useState(todayISO());


  const syncSelected = useCallback((newBals) => {
    setSelectedStaff(prev => {
      if (!prev || !newBals?.length) return prev;
      return newBals.find(b => String(b.staffId) === String(prev.staffId)) ?? prev;
    });
  }, []);

  const loadBalances = useCallback(async () => {
    setBalancesLoading(true);
    try {
      const r = await carWashApi.listSavingsBalances();
      const newBals = r?.balances || [];
      setBalances(newBals);
      syncSelected(newBals);
    } catch { /* best-effort */ }
    finally { setBalancesLoading(false); }
  }, [syncSelected]);

  const loadRecords = useCallback(async (staffId, from, to, page) => {
    setRecordsLoading(true);
    try {
      const res = await carWashApi.listSavings({ staff: staffId, dateFrom: from || undefined, dateTo: to, page, limit: DETAIL_LIMIT });
      setRecords(normalizeListPayload(res, "records"));
      setRecordsTotal(res?.pagination?.total ?? 0);
    } catch { setRecords([]); setRecordsTotal(0); }
    finally { setRecordsLoading(false); }
  }, []);

  useEffect(() => { loadBalances(); }, [loadBalances]);
  useEffect(() => {
    if (!selectedStaff) return;
    loadRecords(selectedStaff.staffId, detailFrom, detailTo, detailPage);
  }, [selectedStaff, detailFrom, detailTo, detailPage, loadRecords]);
  useEffect(() => {
    prevStaffId.current = selectedStaff?.staffId ?? null;
  }, [selectedStaff]);

  const initializeSavings = async () => {
    setInitializing(true);
    try {
      const r = await carWashApi.initializeSavings(initStartDate);
      toast.success(r?.initialized > 0
        ? `Savings tracking started for ${r.initialized} staff member${r.initialized !== 1 ? "s" : ""} — accruing from ${fmtDate(initStartDate)}`
        : "All staff already have savings tracking active");
      setShowInitModal(false);
      await loadBalances();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to initialize savings");
    } finally {
      setInitializing(false);
    }
  };

  const handleToggleStaff = (b) => {
    if (selectedStaff?.staffId === b.staffId) { setSelectedStaff(null); }
    else { setSelectedStaff(b); setDetailPage(1); }
  };
  const handleDetailDateChange = (field, val) => {
    if (field === "from") setDetailFrom(val); else setDetailTo(val);
    setDetailPage(1);
  };

  const openDisburse = (b) => {
    const preferred = cashbooks.find((cb) =>
      /cash|hand|safe/.test(`${cb?.name || ""} ${cb?.code || ""}`.toLowerCase())
    )?._id ?? cashbooks[0]?._id ?? "";
    setDisburseStaff(b);
    setDForm({ amount: String(b.balance), cashbookAccount: preferred, notes: "" });
    setShowDisburse(true);
  };

  const confirmReset = async () => {
    setResetConfirm(false); setResetting(true);
    try {
      const r = await carWashApi.resetSavings();
      toast.success(`Deleted ${r?.deleted ?? 0} savings records`);
      setBalances([]); setSelectedStaff(null);
    } catch (err) { toast.error(err?.response?.data?.message || "Reset failed"); }
    finally { setResetting(false); }
  };

  const printStatement = async () => {
    if (!selectedStaff) return;
    setPrinting(true);
    try {
      const [savingsRes, payoutsRes] = await Promise.all([
        carWashApi.listSavings({ staff: selectedStaff.staffId, dateFrom: detailFrom || undefined, dateTo: detailTo, limit: 200, page: 1 }),
        carWashApi.listCommissionPayouts({ staff: selectedStaff.staffId, dateFrom: detailFrom || undefined, dateTo: detailTo, limit: 200 }),
      ]);
      const savings  = normalizeListPayload(savingsRes,  "records");
      const payouts  = normalizeListPayload(payoutsRes,  "payouts");
      const business = currentCompany?.name || currentCompany?.companyName || "Milik Car Wash";
      const fmt  = (v) => `KES ${Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const fmtD = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
      const period = detailFrom ? `${fmtD(detailFrom)} – ${fmtD(detailTo)}` : `Up to ${fmtD(detailTo)}`;
      const totalDeducted  = savings.filter((r) => r.type === "deduction" && !r.isReversed).reduce((s, r) => s + Number(r.amount || 0), 0);
      const totalDisbursed = savings.filter((r) => r.type === "disbursement").reduce((s, r) => s + Number(r.amount || 0), 0);
      const netBalance     = selectedStaff.balance;
      const savingsRows = savings.map((r) => `
        <tr>
          <td>${fmtD(r.savingsDate || r.date)}</td>
          <td><span class="pill ${r.type === 'disbursement' ? 'pill-green' : r.type === 'deduction' ? 'pill-orange' : 'pill-grey'}">${r.isReversed ? 'REVERSED' : r.type === 'deduction' ? 'DEDUCTION' : r.type.toUpperCase()}</span></td>
          <td class="amount ${r.type === 'disbursement' ? 'neg' : 'pos'}">${r.type === 'disbursement' ? '−' : '+'}${fmt(r.amount)}</td>
          <td>${r.type === 'deduction' && r.coveredFrom && r.coveredTo ? `${fmtD(r.coveredFrom)} – ${fmtD(r.coveredTo)}${r.daysCount ? ` · ${r.daysCount}d` : ''}` : (r.savingsPayoutNumber || r.notes || '—')}</td>
          <td>${fmtD(r.date)}</td>
        </tr>`).join("") || `<tr><td colspan="5" class="empty">No savings records in this period.</td></tr>`;
      const payoutRows = payouts.map((p) => `
        <tr>
          <td>${p.payoutNumber || '—'}</td><td>${fmtD(p.payoutDate)}</td>
          <td class="amount">${fmt(p.amount)}</td><td class="amount neg">−${fmt(p.savingsHeld || 0)}</td>
          <td class="amount pos">${fmt(p.netCash ?? p.amount)}</td><td>${(p.method || 'cash').toUpperCase()}</td>
        </tr>`).join("") || `<tr><td colspan="6" class="empty">No commission payouts in this period.</td></tr>`;
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
        <title>Statement — ${selectedStaff.staffName}</title>
        <style>
          *{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:28px 32px}
          .header{border-bottom:3px solid #0B3B2E;padding-bottom:12px;margin-bottom:16px}
          .header h1{font-size:18px;font-weight:900;color:#0B3B2E;text-transform:uppercase;letter-spacing:1px}
          .header h2{font-size:13px;font-weight:700;color:#444;margin-top:3px}
          .meta{display:flex;gap:32px;margin-bottom:16px;font-size:10px;color:#555}.meta span strong{color:#0B3B2E;font-weight:800}
          .summary{display:flex;gap:10px;margin-bottom:20px}
          .card{flex:1;border:1.5px solid #B7C9C0;padding:10px 14px;background:#F1F6F3}
          .card .label{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:#666;margin-bottom:4px}
          .card .val{font-size:15px;font-weight:900;color:#0B3B2E}.card.hl .val{color:#C8511A}
          section{margin-bottom:22px}
          section h3{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.8px;color:#0B3B2E;background:#EDF5F1;border:1px solid #B7C9C0;padding:5px 8px;margin-bottom:0}
          table{width:100%;border-collapse:collapse;font-size:10px}
          th{background:#0B3B2E;color:#fff;font-weight:700;text-transform:uppercase;font-size:9px;letter-spacing:.5px;padding:5px 7px;text-align:left}
          td{padding:4px 7px;border-bottom:1px solid #e5e7eb;vertical-align:middle}tr:nth-child(even) td{background:#f9fbfa}
          .amount{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}.pos{color:#15803d}.neg{color:#C8511A}
          .pill{display:inline-block;padding:1px 6px;border-radius:2px;font-size:8px;font-weight:800;letter-spacing:.5px}
          .pill-orange{background:#ffedd5;color:#7c2d12;border:1px solid #fed7aa}
          .pill-green{background:#d1fae5;color:#065f46;border:1px solid #6ee7b7}
          .pill-grey{background:#f3f4f6;color:#9ca3af;border:1px solid #e5e7eb}
          .empty{text-align:center;color:#9ca3af;padding:14px;font-style:italic}
          .footer{margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px;font-size:9px;color:#9ca3af;display:flex;justify-content:space-between}
          @media print{body{padding:10px 16px}@page{margin:15mm 12mm}}
        </style></head><body>
        <div class="header"><h1>${business}</h1><h2>Staff Savings &amp; Commissions Statement</h2></div>
        <div class="meta"><span><strong>Staff:</strong> ${selectedStaff.staffName}</span><span><strong>Period:</strong> ${period}</span><span><strong>Printed:</strong> ${new Date().toLocaleString("en-KE")}</span></div>
        <div class="summary">
          <div class="card hl"><div class="label">Total Deducted</div><div class="val">${fmt(totalDeducted)}</div></div>
          <div class="card"><div class="label">Paid Out</div><div class="val">${fmt(totalDisbursed)}</div></div>
          <div class="card"><div class="label">In Savings Pot</div><div class="val">${fmt(netBalance)}</div></div>
        </div>
        <section><h3>Savings Transactions</h3>
          <table><thead><tr><th>Date</th><th>Type</th><th style="text-align:right">Amount</th><th>Period / Notes</th><th>Recorded On</th></tr></thead>
          <tbody>${savingsRows}</tbody></table></section>
        <section><h3>Commission Payouts</h3>
          <table><thead><tr><th>Payout #</th><th>Date</th><th style="text-align:right">Gross</th><th style="text-align:right">Savings</th><th style="text-align:right">Net Cash</th><th>Method</th></tr></thead>
          <tbody>${payoutRows}</tbody></table></section>
        <div class="footer"><span>Generated by Milik · ${business}</span><span>${new Date().toLocaleString("en-KE")}</span></div>
      </body></html>`;
      const win = window.open("", "_blank", "width=900,height=700");
      win.document.write(html); win.document.close(); win.focus();
      setTimeout(() => { win.print(); }, 400);
    } catch { toast.error("Failed to generate statement"); }
    finally { setPrinting(false); }
  };

  const saveDisbursement = async (e) => {
    e.preventDefault();
    if (!disburseStaff || !dForm.amount || !dForm.cashbookAccount) return;
    setDisbursing(true);
    try {
      await carWashApi.createSavingsPayout({ staff: disburseStaff.staffId, cashbookAccount: dForm.cashbookAccount, amount: Number(dForm.amount), notes: dForm.notes });
      toast.success(`Savings disbursed to ${disburseStaff.staffName}`);
      setShowDisburse(false);
      loadBalances();
      if (selectedStaff?.staffId === disburseStaff.staffId) loadRecords(selectedStaff.staffId, detailFrom, detailTo, detailPage);
    } catch (err) { toast.error(err?.response?.data?.message || "Disbursement failed"); }
    finally { setDisbursing(false); }
  };

  const confirmReverse = async () => {
    if (!reverseTarget) return;
    setReversing(true);
    try {
      await carWashApi.reverseSavingsPayout(reverseTarget._id, reverseNotes);
      toast.success("Savings payout reversed");
      setReverseTarget(null); setReverseNotes("");
      loadBalances();
      loadRecords(selectedStaff.staffId, detailFrom, detailTo, detailPage);
    } catch (err) { toast.error(err?.response?.data?.message || "Reversal failed"); }
    finally { setReversing(false); }
  };

  const totalPages = Math.max(Math.ceil(recordsTotal / DETAIL_LIMIT), 1);

  return (
    <CarWashShell
      title="Staff Savings"
      action={
        <>
          {savingsEnabled && canManage && (
            <button
              type="button"
              onClick={() => { setInitStartDate(todayISO()); setShowInitModal(true); }}
              className="inline-flex h-7 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0a3127]"
              title="Set a savings start date for all staff with no prior deduction history"
            >
              <FaFlag size={9} /> Set Savings Start Date
            </button>
          )}
          <button
            type="button"
            onClick={loadBalances}
            disabled={balancesLoading}
            className="inline-flex h-7 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-50"
          >
            <FaRedoAlt size={9} className={balancesLoading ? "animate-spin" : ""} /> Refresh
          </button>
        </>
      }
    >
      <div className="flex flex-col min-h-0 h-full gap-2">

        {/* ── Savings disabled banner ────────────────────────────────────────── */}
        {!savingsEnabled && (
          <div className="flex-shrink-0 flex items-center gap-2 border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-700">
            <FaClock size={10} />
            Savings are disabled. Enable them in Car Wash Settings to resume deductions at commission payouts.
          </div>
        )}

        {/* ── Staff Balances Table ──────────────────────────────────────────── */}
        <div className={`flex flex-col min-h-0 overflow-hidden border border-slate-200 bg-white shadow-sm transition-all duration-200 ${selectedStaff ? "flex-[0_0_42%]" : "flex-1"}`}>

          {/* Section header */}
          <div className="flex-shrink-0 flex items-center justify-between gap-2 border-b border-slate-200 bg-[#0B3B2E] px-3 py-2">
            <div className="flex items-center gap-2">
              <FaPiggyBank size={11} className="text-white/70" />
              <h2 className="text-[10px] font-black uppercase tracking-widest text-white">Staff Savings Balances</h2>
            </div>
            <div className="flex items-center gap-2 text-white/50">
              <FaUsers size={10} />
              <span className="text-[10px] font-semibold">{balances.length} staff</span>
            </div>
          </div>

          {/* Legend */}
          <div className="flex-shrink-0 flex items-center gap-4 border-b border-slate-100 bg-slate-50 px-3 py-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Legend:</span>
            <span className="flex items-center gap-1 text-[9px] text-slate-500"><span className="inline-block h-2 w-3 rounded-sm bg-[#0B3B2E]" /> Deducted from payouts</span>
            <span className="flex items-center gap-1 text-[9px] text-slate-500"><span className="inline-block h-2 w-3 rounded-sm bg-amber-400" /> Pending deduction</span>
            <span className="flex items-center gap-1 text-[9px] text-slate-500"><span className="inline-block h-2 w-3 rounded-sm bg-emerald-400" /> Paid out to staff</span>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left text-[9px] font-extrabold uppercase tracking-wider">Staff</th>
                  <th className="px-3 py-2 text-right text-[9px] font-extrabold uppercase tracking-wider">Total Accrued</th>
                  <th className="px-3 py-2 text-right text-[9px] font-extrabold uppercase tracking-wider">Deducted</th>
                  <th className="px-3 py-2 text-right text-[9px] font-extrabold uppercase tracking-wider">Pending</th>
                  <th className="px-3 py-2 text-right text-[9px] font-extrabold uppercase tracking-wider">Paid Out</th>
                  <th className="px-3 py-2 text-right text-[9px] font-extrabold uppercase tracking-wider">Balance</th>
                  <th className="px-3 py-2 text-right text-[9px] font-extrabold uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {balancesLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 animate-pulse rounded-full bg-slate-200" />
                          <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
                        </div>
                      </td>
                      {[...Array(5)].map((_, j) => (
                        <td key={j} className="px-3 py-3 text-right">
                          <div className="ml-auto h-3 w-14 animate-pulse rounded bg-slate-200" />
                        </td>
                      ))}
                      <td className="px-3 py-3" />
                    </tr>
                  ))
                ) : balances.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-14 text-center">
                      <FaPiggyBank size={28} className="mx-auto mb-3 text-slate-200" />
                      <p className="text-xs font-semibold text-slate-400">No savings data yet</p>
                      <p className="mt-1 text-[10px] text-slate-400">Deductions are captured automatically on each commission payout.</p>
                    </td>
                  </tr>
                ) : balances.map((b) => {
                  const isOpen    = selectedStaff?.staffId === b.staffId;
                  const palette   = avatarPalette(b.staffName);
                  const hasBalance = b.balance > 0;
                  return (
                    <tr
                      key={b.staffId}
                      className={`border-b border-slate-100 transition-colors ${isOpen ? "bg-[#EDF5F1]" : "hover:bg-slate-50/80"}`}
                    >
                      {/* Staff column */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-black"
                            style={{ backgroundColor: palette.bg, color: palette.fg }}
                          >
                            {getInitials(b.staffName)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-extrabold text-slate-900 truncate">{b.staffName}</p>
                            {b.lastCoveredTo
                              ? <p className="text-[9px] text-slate-400">Last deduction: {fmtDate(b.lastCoveredTo)}</p>
                              : <p className="text-[9px] text-slate-300 italic">No deductions yet</p>}
                            <div className="mt-1 w-28">
                              <SavingsBar deducted={b.deducted} pending={b.pending} disbursed={b.disbursed} />
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Total accrued */}
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-bold tabular-nums text-[#C8511A]">
                          {b.totalAccrued > 0 ? formatMoney(b.totalAccrued) : <span className="text-slate-300">—</span>}
                        </span>
                      </td>

                      {/* Deducted */}
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-semibold tabular-nums text-[#0B3B2E]">
                          {b.deducted > 0 ? formatMoney(b.deducted) : <span className="text-slate-300">—</span>}
                        </span>
                      </td>

                      {/* Pending */}
                      <td className="px-3 py-2.5 text-right">
                        {(b.pending || 0) > 0
                          ? <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 font-bold tabular-nums text-amber-700 border border-amber-200">
                              <FaClock size={7} />{formatMoney(b.pending)}
                            </span>
                          : <span className="text-slate-300">—</span>}
                      </td>

                      {/* Paid out */}
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-semibold tabular-nums text-emerald-600">
                          {b.disbursed > 0 ? formatMoney(b.disbursed) : <span className="text-slate-300">—</span>}
                        </span>
                      </td>

                      {/* Balance */}
                      <td className="px-3 py-2.5 text-right">
                        <span className={`font-extrabold tabular-nums text-base ${hasBalance ? "text-slate-900" : "text-slate-300"}`}>
                          {formatMoney(b.balance)}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {hasBalance && canPay && (
                            <button
                              type="button"
                              onClick={() => openDisburse(b)}
                              className="inline-flex items-center gap-1 bg-[#C8511A] px-2.5 py-1 text-[10px] font-bold text-white hover:bg-[#b04616] transition-colors"
                            >
                              <FaHandHoldingUsd size={8} /> Pay Out
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleToggleStaff(b)}
                            className={`inline-flex items-center gap-1 border px-2 py-1 text-[10px] font-bold transition-colors ${
                              isOpen
                                ? "border-[#0B3B2E] bg-[#0B3B2E] text-white"
                                : "border-slate-200 text-slate-500 hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
                            }`}
                          >
                            {isOpen ? <FaChevronUp size={7} /> : <FaChevronDown size={7} />}
                            {isOpen ? "Hide" : "History"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canManage && (
            <div className="flex-shrink-0 flex items-center justify-between border-t border-slate-100 bg-slate-50/80 px-4 py-1.5">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await carWashApi.cleanupLegacySavings();
                    toast.success(r?.message || "Legacy records removed");
                    loadBalances();
                    if (selectedStaff) loadRecords(selectedStaff.staffId, detailFrom, detailTo, detailPage);
                  } catch (err) {
                    toast.error(err?.response?.data?.message || "Cleanup failed");
                  }
                }}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-300 hover:text-amber-600 transition-colors"
                title="Delete all legacy 'daily' records from the old cron system — keeps deductions and disbursements"
              >
                <FaTrash size={8} /> Remove legacy records
              </button>
              <button
                type="button"
                onClick={() => setResetConfirm(true)}
                disabled={resetting}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-300 hover:text-red-500 disabled:opacity-50 transition-colors"
              >
                <FaTrash size={8} />
                {resetting ? "Resetting…" : "Reset all savings data"}
              </button>
            </div>
          )}
        </div>

        {/* ── Detail Panel ──────────────────────────────────────────────────── */}
        {selectedStaff && (
          <div ref={detailRef} className="flex flex-col min-h-0 flex-1 border border-slate-200 bg-white shadow-lg overflow-hidden animate-fade-in">

            {/* Header */}
            <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-2.5">
              <div className="flex items-center justify-between gap-3">
                {/* Identity */}
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-black"
                    style={{ backgroundColor: avatarPalette(selectedStaff.staffName).bg, color: avatarPalette(selectedStaff.staffName).fg }}
                  >
                    {getInitials(selectedStaff.staffName)}
                  </div>
                  <div>
                    <p className="text-[8px] font-semibold uppercase tracking-widest text-white/40">Savings History</p>
                    <p className="text-xs font-extrabold text-white leading-tight">{selectedStaff.staffName}</p>
                  </div>
                </div>

                {/* Stat chips — inline row */}
                <div className="flex items-center gap-px flex-1 mx-4">
                  <div className="flex flex-col px-3 py-1.5 bg-white/5 border-r border-white/10 min-w-[80px]">
                    <span className="text-[7px] font-bold uppercase tracking-wider text-white/40">In Pot</span>
                    <span className="text-sm font-black text-white tabular-nums">{formatMoney(selectedStaff.balance)}</span>
                  </div>
                  <div className="flex flex-col px-3 py-1.5 bg-[#C8511A]/15 border-r border-white/10 min-w-[80px]">
                    <span className="text-[7px] font-bold uppercase tracking-wider text-[#C8511A]/70">Deducted</span>
                    <span className="text-sm font-black text-[#C8511A] tabular-nums">{formatMoney(selectedStaff.deducted)}</span>
                  </div>
                  <div className="flex flex-col px-3 py-1.5 bg-amber-400/10 border-r border-white/10 min-w-[80px]">
                    <span className="text-[7px] font-bold uppercase tracking-wider text-amber-300/70">Pending</span>
                    <span className="text-sm font-black text-amber-300 tabular-nums">{formatMoney(selectedStaff.pending || 0)}</span>
                  </div>
                  <div className="flex flex-col px-3 py-1.5 bg-emerald-400/10 min-w-[80px]">
                    <span className="text-[7px] font-bold uppercase tracking-wider text-emerald-300/70">Paid Out</span>
                    <span className="text-sm font-black text-emerald-300 tabular-nums">{formatMoney(selectedStaff.disbursed || 0)}</span>
                  </div>
                  <div className="flex-1 px-3 py-1.5">
                    <SavingsBar deducted={selectedStaff.deducted} pending={selectedStaff.pending} disbursed={selectedStaff.disbursed} />
                    <p className="mt-1 text-[7px] text-white/30">{formatMoney(selectedStaff.totalAccrued)} total accrued</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={printStatement}
                    disabled={printing}
                    className="inline-flex items-center gap-1.5 border border-white/20 bg-white/10 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-white/20 disabled:opacity-50 transition-colors"
                  >
                    <FaPrint size={9} /> {printing ? "…" : "Print"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedStaff(null)}
                    className="p-1.5 text-white/40 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <FaTimes size={12} />
                  </button>
                </div>
              </div>
            </div>

            {/* Date filter bar */}
            <div className="flex-shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">From</span>
              <input type="date" className={ic} value={detailFrom} onChange={(e) => handleDetailDateChange("from", e.target.value)} />
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">To</span>
              <input type="date" className={ic} value={detailTo} onChange={(e) => handleDetailDateChange("to", e.target.value)} />
              {detailFrom && (
                <button type="button" onClick={() => { setDetailFrom(""); setDetailPage(1); }}
                  className="text-[10px] font-semibold text-slate-400 hover:text-[#0B3B2E]">
                  Clear filter
                </button>
              )}
              <span className="ml-auto text-[10px] text-slate-400">{recordsTotal} record{recordsTotal !== 1 ? "s" : ""}</span>
            </div>

            {/* Records table */}
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full min-w-[600px] text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-500">
                    <th className="px-3 py-2 text-left text-[9px] font-extrabold uppercase tracking-wider">Date</th>
                    <th className="px-3 py-2 text-left text-[9px] font-extrabold uppercase tracking-wider">Type</th>
                    <th className="px-3 py-2 text-right text-[9px] font-extrabold uppercase tracking-wider">Amount</th>
                    <th className="px-3 py-2 text-left text-[9px] font-extrabold uppercase tracking-wider">Period / Notes</th>
                    <th className="px-3 py-2 text-left text-[9px] font-extrabold uppercase tracking-wider">Recorded On</th>
                    {canPay && <th className="px-3 py-2 text-center text-[9px] font-extrabold uppercase tracking-wider">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {recordsLoading ? (
                    [...Array(4)].map((_, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        {[...Array(canPay ? 6 : 5)].map((_, j) => (
                          <td key={j} className="px-3 py-2.5">
                            <div className="h-3 animate-pulse rounded bg-slate-100" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : records.length === 0 ? (
                    <tr>
                      <td colSpan={canPay ? 6 : 5} className="px-3 py-10 text-center text-[10px] text-slate-400">
                        No records{detailFrom ? " in this date range" : " yet"}.
                      </td>
                    </tr>
                  ) : records.map((r) => (
                    <tr key={r._id} className={`border-b border-slate-100 transition-colors hover:bg-slate-50 ${r.isReversed ? "opacity-40" : ""}`}>
                      <td className="px-3 py-2 font-semibold text-slate-700">
                        {fmtDate(r.savingsDate || r.date)}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`border px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-wider ${r.isReversed ? "border-red-200 bg-red-50 text-red-400" : typePillClass(r.type)}`}>
                          {r.isReversed ? "REVERSED" : r.type === "deduction" ? "DEDUCTION" : r.type === "disbursement" ? "PAYOUT" : "LEGACY"}
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-right font-extrabold tabular-nums ${r.isReversed ? "text-slate-300 line-through" : r.type === "disbursement" ? "text-emerald-600" : "text-[#C8511A]"}`}>
                        {r.type === "disbursement" ? "−" : "+"}{formatMoney(r.amount)}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {r.type === "deduction" ? (
                          <span>
                            {r.coveredFrom && r.coveredTo
                              ? <span className="font-semibold">{fmtDate(r.coveredFrom)} – {fmtDate(r.coveredTo)}</span>
                              : r.notes || "—"}
                            {r.daysCount && r.dailyRate
                              ? <span className="ml-1.5 text-[9px] text-slate-400">{r.daysCount}d × {formatMoney(r.dailyRate)}</span>
                              : null}
                          </span>
                        ) : (
                          <span className="truncate text-slate-500">{r.savingsPayoutNumber || r.notes || "—"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-400">{fmtDate(r.date)}</td>
                      {canPay && (
                        <td className="px-3 py-2 text-center">
                          {r.type === "disbursement" && !r.isReversed ? (
                            <button
                              type="button"
                              onClick={() => { setReverseTarget(r); setReverseNotes(""); }}
                              className="inline-flex items-center gap-1 border border-rose-200 bg-rose-50 px-2 py-0.5 text-[9px] font-bold text-rose-600 hover:bg-rose-100 transition-colors"
                            >
                              <FaUndo size={7} /> Reverse
                            </button>
                          ) : <span className="text-slate-200">—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex-shrink-0 flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2">
                <span className="text-[10px] text-slate-400">Page {detailPage} of {totalPages}</span>
                <div className="flex gap-1">
                  <button disabled={detailPage <= 1} onClick={() => setDetailPage((p) => p - 1)}
                    className="h-6 border border-slate-200 px-2.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40">← Prev</button>
                  <button disabled={detailPage >= totalPages} onClick={() => setDetailPage((p) => p + 1)}
                    className="h-6 border border-slate-200 px-2.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40">Next →</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Pay Out Modal ──────────────────────────────────────────────────────── */}
      {showDisburse && disburseStaff && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/50 px-4 py-8 backdrop-blur-[2px] sm:items-center">
          <form onSubmit={saveDisbursement} className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 bg-[#0B3B2E] px-4 py-3 text-white">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-black"
                  style={{ backgroundColor: avatarPalette(disburseStaff.staffName).bg, color: avatarPalette(disburseStaff.staffName).fg }}
                >
                  {getInitials(disburseStaff.staffName)}
                </div>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-white/50">Pay Out Savings</p>
                  <h2 className="text-sm font-extrabold">{disburseStaff.staffName}</h2>
                </div>
              </div>
              <button type="button" onClick={() => setShowDisburse(false)} className="p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
                <FaTimes size={13} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Balance breakdown */}
              <div className="grid grid-cols-2 gap-2">
                <div className="border border-[#B7C9C0] bg-[#EDF5F1] px-3 py-3">
                  <p className="text-[9px] font-extrabold uppercase tracking-wider text-[#0B3B2E]/50">In Savings Pot</p>
                  <p className="mt-1 text-2xl font-black text-[#0B3B2E]">{formatMoney(disburseStaff.balance)}</p>
                </div>
                <div className={`border px-3 py-3 ${(disburseStaff.pending || 0) > 0 ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                  <p className="text-[9px] font-extrabold uppercase tracking-wider text-amber-700/60">Pending (not yet in pot)</p>
                  <p className="mt-1 text-2xl font-black text-amber-700">{formatMoney(disburseStaff.pending || 0)}</p>
                </div>
              </div>
              <div className="px-0.5">
                <SavingsBar deducted={disburseStaff.deducted} pending={disburseStaff.pending} disbursed={disburseStaff.disbursed} />
                <p className="mt-1 text-[9px] text-slate-400">{formatMoney(disburseStaff.totalAccrued)} total accrued · {formatMoney(disburseStaff.disbursed || 0)} previously paid out</p>
              </div>

              <div>
                <label className={lc}>Amount to Pay Out (KES) *</label>
                <input
                  type="number" min={1} max={disburseStaff.balance} step="any" required
                  className={icc}
                  value={dForm.amount}
                  onChange={(e) => setDForm((p) => ({ ...p, amount: e.target.value }))}
                />
              </div>
              <div>
                <label className={lc}>Cashbook / Account *</label>
                <select required className={icc} value={dForm.cashbookAccount} onChange={(e) => setDForm((p) => ({ ...p, cashbookAccount: e.target.value }))}>
                  <option value="">Select cashbook…</option>
                  {cashbooks.map((cb) => (
                    <option key={cb._id} value={cb._id}>{cb.name}{cb.code ? ` — ${cb.code}` : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={lc}>Notes (optional)</label>
                <input type="text" className={icc} placeholder="e.g. Annual savings payout June 2026"
                  value={dForm.notes} onChange={(e) => setDForm((p) => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setShowDisburse(false)}
                className="h-8 border border-slate-300 px-4 text-xs font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
              <button type="submit" disabled={disbursing}
                className="h-8 bg-[#C8511A] px-5 text-xs font-bold text-white hover:bg-[#b04616] disabled:opacity-50">
                {disbursing ? "Processing…" : `Pay Out ${dForm.amount ? formatMoney(Number(dForm.amount)) : ""}`}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Reverse Payout Confirmation ──────────────────────────────────────── */}
      {reverseTarget && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 bg-rose-700 px-4 py-3 text-white">
              <div>
                <h2 className="text-sm font-extrabold uppercase tracking-wide">Reverse Savings Payout</h2>
                <p className="mt-0.5 text-xs text-rose-200">{formatMoney(reverseTarget.amount)}</p>
              </div>
              <button type="button" onClick={() => setReverseTarget(null)} className="p-1 text-white/70 hover:bg-white/10"><FaTimes size={12} /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-600">
                This will reverse the savings payout of <strong>{formatMoney(reverseTarget.amount)}</strong>
                {reverseTarget.savingsPayoutNumber ? ` (${reverseTarget.savingsPayoutNumber})` : ""} and unwind the accounting entries.
              </p>
              <div>
                <label className={lc}>Reason (optional)</label>
                <input type="text" className={icc} placeholder="Reason for reversal…" value={reverseNotes}
                  onChange={(e) => setReverseNotes(e.target.value)} autoFocus />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setReverseTarget(null)}
                className="h-8 border border-slate-300 px-4 text-xs font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={confirmReverse} disabled={reversing}
                className="h-8 bg-rose-600 px-4 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50">
                {reversing ? "Reversing…" : "Confirm Reverse"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Initialize Savings Modal ─────────────────────────────────────────── */}
      {showInitModal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 bg-[#0B3B2E] px-4 py-3 text-white">
              <div>
                <h2 className="text-sm font-extrabold uppercase tracking-wide">Set Savings Start Date</h2>
                <p className="mt-0.5 text-xs text-white/50">Applies to staff with no prior deductions</p>
              </div>
              <button type="button" onClick={() => setShowInitModal(false)} className="p-1 text-white/50 hover:bg-white/10 hover:text-white">
                <FaTimes size={12} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="rounded border border-[#B7C9C0] bg-[#EDF5F1] px-3 py-2.5 text-xs text-[#0B3B2E]">
                <p className="font-bold">How this works</p>
                <p className="mt-1 text-[#0B3B2E]/70 leading-relaxed">
                  Each staff member with no savings history gets a zero-amount anchor on the chosen date.
                  Pending deductions immediately begin accruing from that date — and are captured in full at their next commission payout.
                  Staff who already have deductions are unaffected.
                </p>
              </div>

              <div>
                <label className={lc}>Start Date *</label>
                <input
                  type="date"
                  className={icc}
                  value={initStartDate}
                  max={todayISO()}
                  onChange={(e) => setInitStartDate(e.target.value)}
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  {initStartDate
                    ? initStartDate === todayISO()
                      ? "Savings accrue from today"
                      : `Savings accrue from ${fmtDate(initStartDate)} — all missed days will be captured at first payout`
                    : "Pick a date"}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setShowInitModal(false)}
                className="h-8 border border-slate-300 px-4 text-xs font-bold text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button
                type="button"
                onClick={initializeSavings}
                disabled={!initStartDate || initializing}
                className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-5 text-xs font-bold text-white hover:bg-[#0a3127] disabled:opacity-50"
              >
                <FaFlag size={9} /> {initializing ? "Initializing…" : "Set Start Date"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset Confirmation ─────────────────────────────────────────────── */}
      {resetConfirm && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 bg-red-700 px-4 py-3 text-white">
              <h2 className="text-sm font-extrabold uppercase tracking-wide">Reset All Savings Data</h2>
              <button type="button" onClick={() => setResetConfirm(false)} className="p-1 text-white/70 hover:bg-white/10"><FaTimes size={12} /></button>
            </div>
            <div className="p-4">
              <p className="text-xs text-slate-700">
                This will permanently delete <strong>ALL savings records</strong> for this business. This action <strong>cannot be undone</strong>.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setResetConfirm(false)}
                className="h-8 border border-slate-300 px-4 text-xs font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={confirmReset} disabled={resetting}
                className="h-8 bg-red-600 px-4 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50">
                {resetting ? "Deleting…" : "Yes, Delete All"}
              </button>
            </div>
          </div>
        </div>
      )}
    </CarWashShell>
  );
};

export default CarWashStaffSavings;

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import {
  FaCalendarCheck,
  FaChevronDown,
  FaChevronUp,
  FaPiggyBank,
  FaPrint,
  FaRedoAlt,
  FaTimes,
  FaTrash,
  FaUndo,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";

// Backend returns: { staffId, staffName, daily, disbursed, balance }
const ic  = "h-7 border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const icc = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const lc  = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const localISO = (d) => {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const monthStart = () => { const n = new Date(); return localISO(new Date(n.getFullYear(), n.getMonth(), 1)); };
const todayISO  = () => localISO(new Date());

const typePill = (type) =>
  type === "disbursement"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700";

const DETAIL_LIMIT = 30;

const CarWashStaffSavings = () => {
  const currentCompany = useSelector(selectCurrentCompany);
  const canPay    = useCarWashPermission("carwash-commissions", "pay");
  const canManage = useCarWashPermission("carwash-commissions", "manage");

  // ── Balances ────────────────────────────────────────────────────────────────
  const [balances,        setBalances]        = useState([]);
  const [balancesLoading, setBalancesLoading] = useState(false);

  // ── Detail panel — selectedStaff shape: { staffId, staffName, balance } ────
  const [selectedStaff,  setSelectedStaff]  = useState(null);
  const [records,        setRecords]        = useState([]);
  const [recordsTotal,   setRecordsTotal]   = useState(0);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [detailFrom,     setDetailFrom]     = useState(monthStart());
  const [detailTo,       setDetailTo]       = useState(todayISO());
  const [detailPage,     setDetailPage]     = useState(1);
  const detailRef  = useRef(null);
  const prevStaffId = useRef(null);

  // ── Reference data (cached) ──────────────────────────────────────────────────
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

  // ── Disbursement modal ──────────────────────────────────────────────────────
  const [showDisburse,  setShowDisburse]  = useState(false);
  const [disburseStaff, setDisburseStaff] = useState(null);
  const [dForm,         setDForm]         = useState({ amount: "", cashbookAccount: "", notes: "" });
  const [disbursing,    setDisbursing]    = useState(false);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const [processing, setProcessing] = useState(false);
  const [resetting,  setResetting]  = useState(false);

  // ── Data loaders ────────────────────────────────────────────────────────────
  const loadBalances = useCallback(async () => {
    setBalancesLoading(true);
    try {
      // Single request: write any missed days then read balances in the same
      // server-side call. Eliminates the replica-lag race between two requests.
      const r = await carWashApi.processDailySavings();
      setBalances(r?.balances || []);
    } catch { /* balances reload is best-effort */ }
    finally { setBalancesLoading(false); }
  }, []);

  const loadRecords = useCallback(async (staffId, from, to, page) => {
    setRecordsLoading(true);
    try {
      const res = await carWashApi.listSavings({ staff: staffId, dateFrom: from, dateTo: to, page, limit: DETAIL_LIMIT });
      setRecords(normalizeListPayload(res, "records"));
      setRecordsTotal(res?.pagination?.total ?? 0);
    } catch {
      setRecords([]);
      setRecordsTotal(0);
    } finally {
      setRecordsLoading(false);
    }
  }, []);

  useEffect(() => { loadBalances(); }, [loadBalances]);

  useEffect(() => {
    if (!selectedStaff) return;
    loadRecords(selectedStaff.staffId, detailFrom, detailTo, detailPage);
  }, [selectedStaff, detailFrom, detailTo, detailPage, loadRecords]);

  // Scroll detail panel into view on first open
  useEffect(() => {
    if (selectedStaff && selectedStaff.staffId !== prevStaffId.current) {
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
    prevStaffId.current = selectedStaff?.staffId ?? null;
  }, [selectedStaff]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleToggleStaff = (b) => {
    if (selectedStaff?.staffId === b.staffId) {
      setSelectedStaff(null);
    } else {
      setSelectedStaff(b);
      setDetailPage(1);
    }
  };

  const handleDetailDateChange = (field, val) => {
    if (field === "from") setDetailFrom(val); else setDetailTo(val);
    setDetailPage(1);
  };

  const processToday = async () => {
    setProcessing(true);
    try {
      const r = await carWashApi.processDailySavings();
      setBalances(r?.balances || []);
      if (selectedStaff) await loadRecords(selectedStaff.staffId, detailFrom, detailTo, detailPage);
      toast.success(r?.posted > 0
        ? `Caught up ${r.posted} missing day${r.posted !== 1 ? "s" : ""} of savings`
        : `All savings are up to date (${r?.skipped ?? 0} already posted)`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to process daily savings");
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("Delete ALL savings records for this business? This cannot be undone.")) return;
    setResetting(true);
    try {
      const r = await carWashApi.resetSavings();
      toast.success(`Deleted ${r?.deleted ?? 0} savings records`);
      setBalances([]);
      setSelectedStaff(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const openDisburse = (b) => {
    const preferred = cashbooks.find((cb) =>
      /cash|hand|safe/.test(`${cb?.name || ""} ${cb?.code || ""}`.toLowerCase())
    )?._id ?? cashbooks[0]?._id ?? "";
    setDisburseStaff(b);
    setDForm({ amount: String(b.balance), cashbookAccount: preferred, notes: "" });
    setShowDisburse(true);
  };

  const [printing, setPrinting] = useState(false);

  const printStatement = async () => {
    if (!selectedStaff) return;
    setPrinting(true);
    try {
      const [savingsRes, payoutsRes] = await Promise.all([
        carWashApi.listSavings({ staff: selectedStaff.staffId, dateFrom: detailFrom, dateTo: detailTo, limit: 200, page: 1 }),
        carWashApi.listCommissionPayouts({ staff: selectedStaff.staffId, dateFrom: detailFrom, dateTo: detailTo, limit: 200 }),
      ]);

      const savings  = normalizeListPayload(savingsRes,  "records");
      const payouts  = normalizeListPayload(payoutsRes,  "payouts");
      const business = currentCompany?.name || currentCompany?.companyName || "Milik Car Wash";
      const fmt = (v) => `KES ${Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const fmtD = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
      const period = `${fmtD(detailFrom)} – ${fmtD(detailTo)}`;

      const totalDeducted   = savings.filter((r) => r.type !== "disbursement").reduce((s, r) => s + Number(r.amount || 0), 0);
      const totalDisbursed  = savings.filter((r) => r.type === "disbursement").reduce((s, r) => s + Number(r.amount || 0), 0);
      const netBalance      = selectedStaff.balance;

      const savingsRows = savings.map((r) => `
        <tr>
          <td>${fmtD(r.savingsDate || r.date)}</td>
          <td><span class="pill ${r.type === 'disbursement' ? 'pill-green' : 'pill-amber'}">${r.type.toUpperCase()}</span></td>
          <td class="amount ${r.type === 'disbursement' ? 'neg' : 'pos'}">${r.type === 'disbursement' ? '−' : '+'}${fmt(r.amount)}</td>
          <td>${r.savingsPayoutNumber || r.notes || '—'}</td>
          <td>${fmtD(r.date)}</td>
        </tr>`).join("") || `<tr><td colspan="5" class="empty">No savings records in this period.</td></tr>`;

      const payoutRows = payouts.map((p) => `
        <tr>
          <td>${p.payoutNumber || '—'}</td>
          <td>${fmtD(p.payoutDate)}</td>
          <td class="amount">${fmt(p.amount)}</td>
          <td class="amount neg">−${fmt(p.savingsHeld || 0)}</td>
          <td class="amount pos">${fmt(p.netCash ?? p.amount)}</td>
          <td>${(p.method || 'cash').toUpperCase()}</td>
        </tr>`).join("") || `<tr><td colspan="6" class="empty">No commission payouts in this period.</td></tr>`;

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
        <title>Statement — ${selectedStaff.staffName}</title>
        <style>
          *{margin:0;padding:0;box-sizing:border-box}
          body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:28px 32px}
          .header{border-bottom:3px solid #0B3B2E;padding-bottom:12px;margin-bottom:16px}
          .header h1{font-size:18px;font-weight:900;color:#0B3B2E;text-transform:uppercase;letter-spacing:1px}
          .header h2{font-size:13px;font-weight:700;color:#444;margin-top:3px}
          .meta{display:flex;gap:32px;margin-bottom:16px;font-size:10px;color:#555}
          .meta span strong{color:#0B3B2E;font-weight:800}
          .summary{display:flex;gap:12px;margin-bottom:20px}
          .card{flex:1;border:1.5px solid #B7C9C0;padding:10px 14px;background:#F1F6F3}
          .card .label{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:#666;margin-bottom:4px}
          .card .val{font-size:15px;font-weight:900;color:#0B3B2E}
          .card.highlight .val{color:#C8511A}
          section{margin-bottom:22px}
          section h3{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.8px;color:#0B3B2E;background:#EDF5F1;border:1px solid #B7C9C0;padding:5px 8px;margin-bottom:0}
          table{width:100%;border-collapse:collapse;font-size:10px}
          th{background:#0B3B2E;color:#fff;font-weight:700;text-transform:uppercase;font-size:9px;letter-spacing:.5px;padding:5px 7px;text-align:left}
          td{padding:4px 7px;border-bottom:1px solid #e5e7eb;vertical-align:middle}
          tr:nth-child(even) td{background:#f9fbfa}
          .amount{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
          .pos{color:#15803d}.neg{color:#C8511A}
          .pill{display:inline-block;padding:1px 6px;border-radius:2px;font-size:8px;font-weight:800;letter-spacing:.5px}
          .pill-amber{background:#fef3c7;color:#92400e;border:1px solid #fcd34d}
          .pill-green{background:#d1fae5;color:#065f46;border:1px solid #6ee7b7}
          .empty{text-align:center;color:#9ca3af;padding:14px;font-style:italic}
          .footer{margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px;font-size:9px;color:#9ca3af;display:flex;justify-content:space-between}
          @media print{body{padding:10px 16px}@page{margin:15mm 12mm}}
        </style></head><body>
        <div class="header">
          <h1>${business}</h1>
          <h2>Staff Savings &amp; Commissions Statement</h2>
        </div>
        <div class="meta">
          <span><strong>Staff:</strong> ${selectedStaff.staffName}</span>
          <span><strong>Period:</strong> ${period}</span>
          <span><strong>Printed:</strong> ${new Date().toLocaleString("en-KE")}</span>
        </div>
        <div class="summary">
          <div class="card highlight">
            <div class="label">Total Saved (Period)</div>
            <div class="val">${fmt(totalDeducted)}</div>
          </div>
          <div class="card">
            <div class="label">Total Disbursed (Period)</div>
            <div class="val">${fmt(totalDisbursed)}</div>
          </div>
          <div class="card">
            <div class="label">Current Balance (All-Time)</div>
            <div class="val">${fmt(netBalance)}</div>
          </div>
        </div>
        <section>
          <h3>Savings Transactions</h3>
          <table><thead><tr>
            <th>Savings Date</th><th>Type</th><th style="text-align:right">Amount</th><th>Reference / Notes</th><th>Recorded On</th>
          </tr></thead><tbody>${savingsRows}</tbody></table>
        </section>
        <section>
          <h3>Commission Payouts</h3>
          <table><thead><tr>
            <th>Payout #</th><th>Date</th><th style="text-align:right">Gross Comm.</th><th style="text-align:right">Savings Held</th><th style="text-align:right">Net Cash</th><th>Method</th>
          </tr></thead><tbody>${payoutRows}</tbody></table>
        </section>
        <div class="footer">
          <span>Generated by Milik · ${business}</span>
          <span>${new Date().toLocaleString("en-KE")}</span>
        </div>
      </body></html>`;

      const win = window.open("", "_blank", "width=900,height=700");
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => { win.print(); }, 400);
    } catch {
      toast.error("Failed to generate statement");
    } finally {
      setPrinting(false);
    }
  };

  const saveDisbursement = async (e) => {
    e.preventDefault();
    if (!disburseStaff || !dForm.amount || !dForm.cashbookAccount) return;
    setDisbursing(true);
    try {
      await carWashApi.createSavingsPayout({
        staff:           disburseStaff.staffId,   // backend reads req.body.staff
        cashbookAccount: dForm.cashbookAccount,
        amount:          Number(dForm.amount),
        notes:           dForm.notes,
      });
      toast.success(`Savings disbursed to ${disburseStaff.staffName}`);
      setShowDisburse(false);
      loadBalances();
      if (selectedStaff?.staffId === disburseStaff.staffId) {
        loadRecords(selectedStaff.staffId, detailFrom, detailTo, detailPage);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Disbursement failed");
    } finally {
      setDisbursing(false);
    }
  };

  const totalPages = Math.max(Math.ceil(recordsTotal / DETAIL_LIMIT), 1);

  return (
    <CarWashShell
      title="Staff Savings"
      action={
        <>
          <button
            type="button"
            onClick={loadBalances}
            className="inline-flex h-7 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt size={9} /> Refresh
          </button>
          {savingsEnabled && canPay && (
            <button
              type="button"
              onClick={processToday}
              disabled={processing}
              className="inline-flex h-7 items-center gap-1.5 bg-[#C8511A] px-3 text-xs font-bold text-white hover:bg-[#b04616] disabled:opacity-50"
            >
              <FaCalendarCheck size={9} /> {processing ? "Processing…" : "Process Today"}
            </button>
          )}
        </>
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto">

        {/* ── Staff Balances Table ──────────────────────────────────────────── */}
        <div className="border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
            <h2 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">
              <FaPiggyBank size={11} /> Staff Savings Balances
            </h2>
            <span className="text-[10px] text-slate-400">{balances.length} staff</span>
          </div>

          {!savingsEnabled && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700">
              Savings are disabled. Enable them in Car Wash Settings to resume daily deductions.
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                <tr>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Staff</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Total Saved</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Disbursed</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Balance</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {balancesLoading ? (
                  <tr><td colSpan={5} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">Loading…</td></tr>
                ) : balances.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">
                      No savings data yet. Click <strong>Process Today</strong> to begin.
                    </td>
                  </tr>
                ) : balances.map((b) => {
                  const isOpen = selectedStaff?.staffId === b.staffId;
                  return (
                    <tr
                      key={b.staffId}
                      className={`border-b border-slate-200 transition-colors ${isOpen ? "bg-[#EDF5F1]" : "hover:bg-slate-50"}`}
                    >
                      <td className="px-2 py-1 font-extrabold text-slate-900">{b.staffName}</td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums text-[#C8511A]">
                        {formatMoney(b.daily)}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums text-emerald-600">
                        {formatMoney(b.disbursed)}
                      </td>
                      <td className="px-2 py-1 text-right font-extrabold tabular-nums text-slate-900">
                        {formatMoney(b.balance)}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {b.balance > 0 && canPay && (
                            <button
                              type="button"
                              onClick={() => openDisburse(b)}
                              className="border border-[#C8511A] px-2 py-0.5 text-[11px] font-bold text-[#C8511A] transition-colors hover:bg-[#C8511A] hover:text-white"
                            >
                              Pay Out
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleToggleStaff(b)}
                            className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-bold transition-colors ${
                              isOpen
                                ? "border-[#0B3B2E] bg-[#0B3B2E] text-white"
                                : "border-slate-300 text-slate-600 hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
                            }`}
                          >
                            {isOpen ? <FaChevronUp size={8} /> : <FaChevronDown size={8} />}
                            {isOpen ? "Hide" : "Details"}
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
          <div className="flex items-center justify-end border-t border-slate-100 bg-slate-50 px-4 py-1.5">
            <button
              type="button"
              onClick={handleReset}
              disabled={resetting}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-red-500 disabled:opacity-50"
            >
              <FaTrash size={8} />
              {resetting ? "Resetting…" : "Reset all savings data"}
            </button>
          </div>
          )}
        </div>

        {/* ── Detail Panel ─────────────────────────────────────────────────── */}
        {selectedStaff && (
          <div ref={detailRef} className="mt-3 border border-slate-200 bg-white shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between gap-2 bg-[#0B3B2E] px-3 py-2.5">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/60">Savings History</p>
                <p className="text-sm font-extrabold text-white">{selectedStaff.staffName}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-white/60">Balance</p>
                  <p className="text-base font-black text-white">{formatMoney(selectedStaff.balance)}</p>
                </div>
                <button
                  type="button"
                  onClick={printStatement}
                  disabled={printing}
                  title="Print savings & commissions statement"
                  className="inline-flex items-center gap-1.5 border border-white/30 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-white/10 disabled:opacity-50"
                >
                  <FaPrint size={10} /> {printing ? "Printing…" : "Print"}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStaff(null)}
                  className="p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
                >
                  <FaTimes size={12} />
                </button>
              </div>
            </div>

            {/* Date filter bar */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">From</span>
              <input
                type="date"
                className={ic}
                value={detailFrom}
                onChange={(e) => handleDetailDateChange("from", e.target.value)}
              />
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">To</span>
              <input
                type="date"
                className={ic}
                value={detailTo}
                onChange={(e) => handleDetailDateChange("to", e.target.value)}
              />
              <span className="ml-1 text-[10px] text-slate-400">
                {recordsTotal} record{recordsTotal !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Records table */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[580px] text-xs">
                <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Savings Date</th>
                    <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Type</th>
                    <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
                    <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Reference / Notes</th>
                    <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Recorded On</th>
                    {canPay && <th className="px-2 py-1.5 text-center font-bold uppercase tracking-wide">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {recordsLoading ? (
                    <tr><td colSpan={canPay ? 6 : 5} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">Loading…</td></tr>
                  ) : records.length === 0 ? (
                    <tr><td colSpan={canPay ? 6 : 5} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">No records in this date range.</td></tr>
                  ) : records.map((r) => (
                    <tr key={r._id} className={`border-b border-slate-200 hover:bg-slate-50 ${r.isReversed ? "opacity-50" : ""}`}>
                      <td className="px-2 py-1 font-semibold text-slate-800">
                        {r.savingsDate ? fmtDate(r.savingsDate) : "—"}
                      </td>
                      <td className="px-2 py-1">
                        <span className={`border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider ${r.isReversed ? "border-red-200 bg-red-50 text-red-500" : typePill(r.type)}`}>
                          {r.isReversed ? "REVERSED" : r.type}
                        </span>
                      </td>
                      <td className={`px-2 py-1 text-right font-extrabold tabular-nums ${r.isReversed ? "text-slate-400 line-through" : r.type === "disbursement" ? "text-emerald-600" : "text-[#C8511A]"}`}>
                        {r.type === "disbursement" ? "−" : "+"}{formatMoney(r.amount)}
                      </td>
                      <td className="max-w-xs truncate px-2 py-1 text-slate-600">
                        {r.savingsPayoutNumber || r.notes || "—"}
                      </td>
                      <td className="px-2 py-1 text-slate-400">{fmtDate(r.date)}</td>
                      {canPay && (
                        <td className="px-2 py-1 text-center">
                          {r.type === "disbursement" && !r.isReversed ? (
                            <button
                              type="button"
                              onClick={async () => {
                                const reason = window.prompt(`Reason for reversing savings payout of ${formatMoney(r.amount)}?`, "");
                                if (reason === null) return;
                                try {
                                  await carWashApi.reverseSavingsPayout(r._id, reason);
                                  toast.success("Savings payout reversed");
                                  loadBalances();
                                  loadRecords(selectedStaff.staffId, detailFrom, detailTo, detailPage);
                                } catch (err) {
                                  toast.error(err?.response?.data?.message || "Reversal failed");
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 hover:bg-rose-100"
                              title="Reverse this savings payout"
                            >
                              <FaUndo size={8} /> Reverse
                            </button>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2">
                <span className="text-[10px] text-slate-500">Page {detailPage} of {totalPages}</span>
                <div className="flex gap-1">
                  <button
                    disabled={detailPage <= 1}
                    onClick={() => setDetailPage((p) => p - 1)}
                    className="h-6 border border-slate-200 px-2.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    ← Prev
                  </button>
                  <button
                    disabled={detailPage >= totalPages}
                    onClick={() => setDetailPage((p) => p + 1)}
                    className="h-6 border border-slate-200 px-2.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Pay Out Modal ─────────────────────────────────────────────────────── */}
      {showDisburse && disburseStaff && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/40 px-4 py-8 backdrop-blur-[2px] sm:items-center">
          <form
            onSubmit={saveDisbursement}
            className="w-full max-w-md border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 bg-[#0B3B2E] px-4 py-3 text-white">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/60">Pay Out Savings</p>
                <h2 className="text-sm font-extrabold">{disburseStaff.staffName}</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowDisburse(false)}
                className="p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
              >
                <FaTimes size={13} />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div className="border border-[#B7C9C0] bg-[#EDF5F1] px-3 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#0B3B2E]/60">Available Balance</p>
                <p className="mt-0.5 text-2xl font-black text-[#0B3B2E]">{formatMoney(disburseStaff.balance)}</p>
              </div>

              <div>
                <label className={lc}>Amount to Disburse (KES) *</label>
                <input
                  type="number" min={1} max={disburseStaff.balance} step="any" required
                  className={icc}
                  value={dForm.amount}
                  onChange={(e) => setDForm((p) => ({ ...p, amount: e.target.value }))}
                />
              </div>

              <div>
                <label className={lc}>Cashbook / Account *</label>
                <select
                  required className={icc}
                  value={dForm.cashbookAccount}
                  onChange={(e) => setDForm((p) => ({ ...p, cashbookAccount: e.target.value }))}
                >
                  <option value="">Select cashbook…</option>
                  {cashbooks.map((cb) => (
                    <option key={cb._id} value={cb._id}>
                      {cb.name}{cb.code ? ` — ${cb.code}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={lc}>Notes (optional)</label>
                <input
                  type="text" className={icc}
                  placeholder="e.g. Annual savings payout June 2026"
                  value={dForm.notes}
                  onChange={(e) => setDForm((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button
                type="button"
                onClick={() => setShowDisburse(false)}
                className="h-8 border border-slate-300 px-4 text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit" disabled={disbursing}
                className="h-8 bg-[#0B3B2E] px-5 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"
              >
                {disbursing ? "Processing…" : `Disburse ${dForm.amount ? formatMoney(Number(dForm.amount)) : ""}`}
              </button>
            </div>
          </form>
        </div>
      )}
    </CarWashShell>
  );
};

export default CarWashStaffSavings;

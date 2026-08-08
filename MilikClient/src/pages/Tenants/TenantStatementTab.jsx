/**
 * TenantStatementTab
 * ──────────────────
 * A clean, standalone statement view. Accepts pre-computed data from
 * TenantStatement.jsx (no API calls here — all data flows in via props).
 *
 * Props:
 *  statementData       – { transactions, totalCharges, totalPayments,
 *                          operationalOutstanding, unappliedCredits, currentBalance }
 *  tenant              – tenant document (name, rent, unit, etc.)
 *  tenantLease         – lease document (rentAmount)
 *  onOpenAllocationTrace – fn({ kind, id }) called when user traces a row
 *  onOpenReceiptWorkspace – fn(receiptId?) — opens receipt allocation page
 *  allocationTracePanel  – JSX to render below the table (from parent)
 */

import React, { useState, useMemo } from "react";
import AppSelect from "../../components/common/AppSelect";
import { FaLink } from "react-icons/fa";

// ── Helpers ────────────────────────────────────────────────────────────────────
const formatInputDate = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt)) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

const fmtMoney = (n) =>
  `KES ${Math.abs(Number(n || 0)).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const balSuffix = (n) => (n > 0.005 ? " DR" : n < -0.005 ? " CR" : "");

const TYPE_META = {
  CHARGE:      { label: "Invoice",    cls: "text-red-700 bg-red-50 ring-1 ring-red-200"          },
  DEBIT_NOTE:  { label: "Debit Note", cls: "text-rose-700 bg-rose-50 ring-1 ring-rose-200"       },
  CREDIT_NOTE: { label: "Credit",     cls: "text-sky-700 bg-sky-50 ring-1 ring-sky-200"          },
  PAYMENT:     { label: "Receipt",    cls: "text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200" },
};

const now     = () => new Date();
const todayStr   = () => formatInputDate(now());
const monthStart = () => {
  const d = now();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const ytdStart = () => `${now().getFullYear()}-01-01`;
const ago3m    = () => {
  const d = now();
  d.setMonth(d.getMonth() - 3);
  return formatInputDate(d);
};

// ── Component ──────────────────────────────────────────────────────────────────
export default function TenantStatementTab({
  statementData,
  tenant,
  tenantLease,
  onOpenAllocationTrace,
  onOpenReceiptWorkspace,
  allocationTracePanel,
}) {
  const [from,     setFrom]    = useState(ytdStart);
  const [to,       setTo]      = useState(todayStr);
  const [typeFilter, setTypeFilter] = useState("ALL");

  // ── Derived ────────────────────────────────────────────────────────────────
  const allTx = statementData?.transactions || [];

  const fromBoundary = from ? new Date(`${from}T00:00:00`) : null;
  const toBoundary   = to   ? new Date(`${to}T23:59:59`)   : null;

  // Balance brought forward (sum of transactions before the from-date)
  const bbf = fromBoundary
    ? allTx.filter((t) => new Date(t.date) < fromBoundary).reduce((s, t) => s + t.amount, 0)
    : 0;
  const hasBbf = fromBoundary !== null && allTx.some((t) => new Date(t.date) < fromBoundary);

  const visibleTx = useMemo(() =>
    allTx
      .filter((t) => typeFilter === "ALL" || t.type === typeFilter)
      .filter((t) => {
        const d = new Date(t.date);
        return (!fromBoundary || d >= fromBoundary) && (!toBoundary || d <= toBoundary);
      })
      .map((t) => ({ ...t, balance: t.balance + bbf })),
    [allTx, from, to, typeFilter, bbf]
  );

  const openingBalance  = hasBbf ? bbf : null;
  const closingBalance  = visibleTx.length > 0
    ? visibleTx[visibleTx.length - 1].balance
    : hasBbf ? bbf : null;

  const periodDebits  = visibleTx.reduce((s, t) => ["CHARGE","DEBIT_NOTE"].includes(t.type)  ? s + Math.abs(t.amount) : s, 0);
  const periodCredits = visibleTx.reduce((s, t) => ["PAYMENT","CREDIT_NOTE"].includes(t.type) ? s + Math.abs(t.amount) : s, 0);

  // Balance hero values (all-time, not period-filtered)
  const netBalance   = statementData?.currentBalance ?? 0;
  const unapplied    = statementData?.unappliedCredits ?? 0;
  const outstanding  = statementData?.operationalOutstanding ?? 0;
  const isSettled    = Math.abs(netBalance) < 0.01;
  const isInCredit   = netBalance < -0.005;
  const hasUnapplied = unapplied > 0.005;

  const rent = tenantLease?.rentAmount || tenant?.rent || 0;

  // Active preset detection
  const _today = todayStr();
  const activePreset =
    from === _today       && to === _today  ? "Today"      :
    from === monthStart() && to === _today  ? "This Month" :
    from === ago3m()      && to === _today  ? "3 Months"   :
    from === ytdStart()   && to === _today  ? "YTD"        :
    from === "2000-01-01" && to === _today  ? "All Time"   : null;

  const isFiltered = from !== ytdStart() || to !== _today || typeFilter !== "ALL";

  const presets = [
    { label: "Today",      fn: () => { setFrom(_today);       setTo(_today); } },
    { label: "This Month", fn: () => { setFrom(monthStart()); setTo(_today); } },
    { label: "3 Months",   fn: () => { setFrom(ago3m());      setTo(_today); } },
    { label: "YTD",        fn: () => { setFrom(ytdStart());   setTo(_today); } },
    { label: "All Time",   fn: () => { setFrom("2000-01-01"); setTo(_today); } },
  ];

  const heroVariant = isSettled
    ? { bg: "bg-emerald-700", label: "Account Settled", valueColor: "text-white", subColor: "text-emerald-200" }
    : isInCredit
    ? { bg: "bg-sky-700",     label: "In Credit",        valueColor: "text-white", subColor: "text-sky-200"   }
    : { bg: "bg-[#0B3B2E]",   label: "Balance Due",      valueColor: "text-white", subColor: "text-emerald-300" };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <div className={`flex-none ${heroVariant.bg} px-5 py-1`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Balance */}
          <div className="flex items-baseline gap-2.5">
            <div>
              <p className={`text-[8px] font-bold uppercase tracking-widest ${heroVariant.subColor}`}>
                {heroVariant.label}
              </p>
              <p className={`text-[16px] font-black tabular-nums leading-tight ${heroVariant.valueColor}`}>
                {isSettled ? "KES 0.00" : fmtMoney(netBalance)}
              </p>
            </div>
            {!isSettled && (
              <span className={`text-[10px] font-medium ${heroVariant.subColor} hidden sm:inline`}>
                {isInCredit ? "Credit balance — overpaid" : "Amount owed as of today"}
              </span>
            )}
          </div>

          {/* KPI strip */}
          <div className="flex items-center gap-3">
            {[
              { label: "Monthly Rent",   value: fmtMoney(rent),                              color: "text-white"       },
              { label: "Total Invoiced", value: fmtMoney(statementData?.totalCharges || 0),  color: "text-white"       },
              { label: "Total Received", value: fmtMoney(statementData?.totalPayments || 0), color: "text-emerald-300" },
              ...(outstanding > 0.009 ? [{ label: "Outstanding", value: fmtMoney(outstanding), color: "text-amber-300" }] : []),
            ].map((kpi) => (
              <div key={kpi.label} className="flex flex-col items-end border-l border-white/15 pl-3">
                <p className="text-[8px] font-bold uppercase tracking-wider text-white/50">{kpi.label}</p>
                <p className={`text-xs font-black tabular-nums ${kpi.color}`}>{kpi.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Unapplied credit callout ────────────────────────────────────────── */}
      {hasUnapplied && (
        <div className="flex-none flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-white text-xs font-black">!</div>
            <p className="text-[12px] font-semibold text-amber-900">
              <strong>{fmtMoney(unapplied)}</strong> has been received but not yet allocated to any invoice.
              This credit is reducing the balance but is not linked to a specific charge.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenReceiptWorkspace?.()}
            className="shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-[11px] font-black text-white hover:bg-amber-600 transition-colors"
          >
            Allocate Now →
          </button>
        </div>
      )}

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="flex-none sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5">
          {/* Date inputs */}
          <input
            type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="h-7 w-28 shrink-0 border border-slate-200 px-2 text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          />
          <span className="text-[10px] text-slate-400 font-bold">TO</span>
          <input
            type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="h-7 w-28 shrink-0 border border-slate-200 px-2 text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          />

          <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />

          {/* Presets */}
          {presets.map(({ label, fn }) => (
            <button key={label} type="button" onClick={fn}
              className={`h-7 shrink-0 border px-2.5 text-[10px] font-bold transition-colors ${
                activePreset === label
                  ? "border-[#0B3B2E] bg-[#0B3B2E] text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
              }`}
            >{label}</button>
          ))}

          <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />

          {/* Type filter */}
          <div className="w-36 shrink-0">
            <AppSelect
              value={typeFilter}
              onChange={(v) => setTypeFilter(v ?? "ALL")}
              options={[
                { value: "CHARGE",      label: "Invoices"     },
                { value: "DEBIT_NOTE",  label: "Debit Notes"  },
                { value: "CREDIT_NOTE", label: "Credit Notes" },
                { value: "PAYMENT",     label: "Receipts"     },
              ]}
              placeholder="All Types"
              clearable
              size="sm"
            />
          </div>

          {isFiltered && (
            <button
              type="button"
              onClick={() => { setFrom(ytdStart()); setTo(todayStr()); setTypeFilter("ALL"); }}
              className="h-7 shrink-0 border border-red-200 bg-red-50 px-2.5 text-[10px] font-bold text-red-600 hover:bg-red-100 transition-colors"
            >↺ Reset</button>
          )}

          <span className="ml-auto shrink-0 bg-slate-100 px-2.5 py-0.5 text-[10px] font-black text-slate-500">
            {visibleTx.length} rows
          </span>
        </div>

        {/* Period summary bar — only when filtered */}
        {isFiltered && (periodDebits > 0 || periodCredits > 0 || hasBbf) && (
          <div className="flex items-center divide-x divide-slate-100 border-t border-slate-100 bg-slate-50/70">
            {hasBbf && (
              <span className="shrink-0 flex flex-col items-start px-4 py-1.5">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Opening Balance</span>
                <span className={`text-[11px] font-black ${bbf > 0 ? "text-red-700" : bbf < 0 ? "text-emerald-700" : "text-slate-500"}`}>
                  {fmtMoney(bbf)}{balSuffix(bbf)}
                </span>
              </span>
            )}
            <span className="shrink-0 flex flex-col items-start px-4 py-1.5">
              <span className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Period Debits</span>
              <span className="text-[11px] font-black text-red-700">{fmtMoney(periodDebits)}</span>
            </span>
            <span className="shrink-0 flex flex-col items-start px-4 py-1.5">
              <span className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Period Credits</span>
              <span className="text-[11px] font-black text-emerald-700">{fmtMoney(periodCredits)}</span>
            </span>
            {closingBalance !== null && (
              <span className="shrink-0 flex flex-col items-start px-4 py-1.5">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Closing Balance</span>
                <span className={`text-[11px] font-black ${closingBalance > 0 ? "text-red-700" : closingBalance < 0 ? "text-emerald-700" : "text-slate-500"}`}>
                  {fmtMoney(closingBalance)}{balSuffix(closingBalance)}
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Statement table ──────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full text-[11.5px] border-collapse">
          <colgroup>
            <col style={{ width: "9%" }} />
            <col style={{ width: "31%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#0B3B2E]">
              {[
                { label: "Date",       align: "left"  },
                { label: "Description",align: "left"  },
                { label: "Type",       align: "left"  },
                { label: "Reference",  align: "left"  },
                { label: "Debit (Dr)", align: "right" },
                { label: "Credit (Cr)",align: "right" },
                { label: "Balance",    align: "right" },
              ].map(({ label, align }) => (
                <th key={label} className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.16em] text-white/80 text-${align} whitespace-nowrap`}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>

            {/* Opening balance row */}
            {hasBbf && (
              <tr className="border-b border-[#0B3B2E]/15 bg-[#0B3B2E]/[0.04]">
                <td className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]/30">—</td>
                <td className="px-3 py-1 text-[10px] font-black uppercase tracking-wide text-[#0B3B2E]" colSpan={3}>
                  Opening Balance
                </td>
                <td className="px-3 py-1 text-right font-black text-red-700">
                  {bbf > 0.005 ? fmtMoney(bbf) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-1 text-right font-black text-emerald-700">
                  {bbf < -0.005 ? fmtMoney(bbf) : <span className="text-slate-300">—</span>}
                </td>
                <td className={`px-3 py-1 text-right font-black ${bbf > 0 ? "text-red-700" : bbf < 0 ? "text-emerald-700" : "text-slate-400"}`}>
                  {fmtMoney(bbf)}{balSuffix(bbf)}
                </td>
              </tr>
            )}

            {/* Transaction rows */}
            {visibleTx.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-16 text-center">
                  <div className="mx-auto max-w-sm">
                    <p className="text-[28px] leading-none">📄</p>
                    <p className="mt-3 text-sm font-bold text-slate-500">
                      {allTx.length === 0
                        ? "No transactions recorded yet."
                        : "No transactions match your filter."}
                    </p>
                    <p className="mt-1 text-[12px] text-slate-400">
                      {typeFilter !== "ALL"
                        ? `No ${TYPE_META[typeFilter]?.label ?? typeFilter} entries in this period. Try switching to "All Types".`
                        : allTx.length === 0
                        ? "Invoices and receipts will appear here once they are created."
                        : "Try widening the date range — click 'All Time' to see everything."}
                    </p>
                  </div>
                </td>
              </tr>
            )}

            {visibleTx.map((tx, idx) => {
              const isDebit  = ["CHARGE", "DEBIT_NOTE"].includes(tx.type);
              const isCredit = ["PAYMENT", "CREDIT_NOTE"].includes(tx.type);
              const meta     = TYPE_META[tx.type] || { label: tx.type, cls: "bg-slate-100 text-slate-600" };
              const canTrace = ["invoice", "receipt", "note"].includes(String(tx.sourceKind || ""));
              const balColor = tx.balance > 0.005 ? "text-red-700" : tx.balance < -0.005 ? "text-emerald-700" : "text-slate-400";

              return (
                <tr
                  key={tx.id}
                  className={`group border-b transition-colors ${
                    idx % 2 === 0 ? "border-slate-100 bg-white" : "border-slate-100 bg-slate-50/40"
                  } hover:bg-[#EDF5F1]`}
                >
                  {/* Date */}
                  <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-600 whitespace-nowrap">
                    {fmtDate(tx.date)}
                  </td>

                  {/* Description */}
                  <td className="px-3 py-1.5 text-[10px] text-slate-700 max-w-0 truncate" title={tx.description}>
                    {tx.description}
                  </td>

                  {/* Type badge */}
                  <td className="px-3 py-1.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black ${meta.cls}`}>
                      {meta.label}
                    </span>
                  </td>

                  {/* Reference + trace */}
                  <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span>{tx.transactionCode}</span>
                      {canTrace && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenAllocationTrace?.({
                              kind: tx.sourceKind === "receipt" ? "receipt" : "invoice",
                              id:   tx.sourceId,
                            })
                          }
                          title="Trace this transaction's allocation"
                          className="shrink-0 opacity-0 group-hover:opacity-100 inline-flex items-center gap-0.5 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-bold text-slate-500 hover:border-[#0B3B2E] hover:text-[#0B3B2E] transition"
                        >
                          <FaLink size={7} /> Trace
                        </button>
                      )}
                    </div>
                  </td>

                  {/* Debit */}
                  <td className="px-3 py-1.5 text-right font-black tabular-nums whitespace-nowrap text-[10px]">
                    {isDebit
                      ? <span className="text-red-600">{fmtMoney(tx.amount)}</span>
                      : <span className="text-slate-300 font-normal">—</span>
                    }
                  </td>

                  {/* Credit */}
                  <td className="px-3 py-1.5 text-right font-black tabular-nums whitespace-nowrap text-[10px]">
                    {isCredit
                      ? <span className="text-emerald-600">{fmtMoney(tx.amount)}</span>
                      : <span className="text-slate-300 font-normal">—</span>
                    }
                  </td>

                  {/* Running balance */}
                  <td className={`px-3 py-1.5 text-right font-black tabular-nums whitespace-nowrap text-[10px] ${balColor}`}>
                    {fmtMoney(tx.balance)}{balSuffix(tx.balance)}
                  </td>
                </tr>
              );
            })}

            {/* Closing balance row */}
            {closingBalance !== null && visibleTx.length > 0 && (
              <tr className="border-t-2 border-[#0B3B2E]/20 bg-[#0B3B2E]/[0.04]">
                <td className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]/30">—</td>
                <td className="px-3 py-1 text-[10px] font-black uppercase tracking-wide text-[#0B3B2E]" colSpan={5}>
                  Closing Balance
                </td>
                <td className={`px-3 py-1 text-right font-black text-[11px] ${
                  closingBalance > 0 ? "text-red-700" : closingBalance < 0 ? "text-emerald-700" : "text-slate-400"
                }`}>
                  {fmtMoney(closingBalance)}{balSuffix(closingBalance)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div className="flex-none border-t border-slate-200 bg-slate-50 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-1 text-[11px] text-slate-500">
          <span>
            <strong className="text-slate-700">{visibleTx.length}</strong> transaction{visibleTx.length !== 1 ? "s" : ""} in view
            {isFiltered && <span className="ml-1 text-[10px] text-slate-400">(filtered)</span>}
          </span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-0.5 font-semibold">
            <span>Invoiced: <strong className="text-red-600">{fmtMoney(statementData?.totalCharges || 0)}</strong></span>
            <span>Received: <strong className="text-emerald-700">{fmtMoney(statementData?.totalPayments || 0)}</strong></span>
            {hasUnapplied && <span>Unapplied credit: <strong className="text-amber-600">{fmtMoney(unapplied)}</strong></span>}
            <span className={`font-black ${isSettled ? "text-emerald-700" : isInCredit ? "text-sky-700" : "text-red-700"}`}>
              Net balance: {isSettled ? "Settled" : `${fmtMoney(netBalance)}${balSuffix(netBalance)}`}
            </span>
          </div>
        </div>
      </div>

      {/* ── Allocation trace panel (rendered by parent) ──────────────────────── */}
      {allocationTracePanel}
    </div>
  );
}

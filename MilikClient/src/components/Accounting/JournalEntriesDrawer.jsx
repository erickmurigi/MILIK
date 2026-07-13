import React, { useEffect, useState } from "react";
import { FaTimes, FaBook, FaCalendarAlt, FaExclamationTriangle } from "react-icons/fa";
import { adminRequests } from "../../utils/requestMethods";

const fmt = (v) =>
  Number(v || 0) === 0
    ? "—"
    : Number(v).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB") : "—";

const STATUS_BADGE = {
  posted:   "bg-emerald-100 text-emerald-700 border-emerald-200",
  reversed: "bg-amber-100 text-amber-700 border-amber-200",
  draft:    "bg-slate-100  text-slate-700  border-slate-200",
  void:     "bg-rose-100   text-rose-700   border-rose-200",
};

const CATEGORY_SHORT = {
  COMMISSION_CHARGE:        "Commission",
  LANDLORD_PAYABLE:         "Payable",
  EXPENSE_DEDUCTION:        "Expense",
  RECURRING_DEDUCTION:      "Standing Order",
  ADVANCE_TO_LANDLORD:      "Advance",
  ADVANCE_RECOVERY:         "Recovery",
  ADJUSTMENT:               "Adjustment",
  RENT_INVOICE:             "Invoice",
  RENT_RECEIPT_MANAGER:     "Receipt",
  RENT_RECEIPT_LANDLORD:    "Receipt",
  UTILITY_INVOICE:          "Utility",
  DEPOSIT_CHARGE:           "Deposit",
  DEPOSIT_RECEIVED:         "Deposit",
  PETTY_CASH_EXPENSE:       "Petty Cash",
  PETTY_CASH_REPLENISHMENT: "Replenishment",
  DEPRECIATION:             "Depreciation",
  DISPOSAL:                 "Disposal",
  JOURNAL_ENTRY:            "Journal",
};

/**
 * Reusable GL Journal Entries drawer.
 *
 * Props:
 *   open          — bool
 *   onClose       — fn
 *   title         — "Payment Voucher" | "Petty Cash" | ...
 *   transactionRef — "PV00001"
 *   date          — formatted date string
 *   amount        — number
 *   status        — "paid" | "draft" | "reversed" | ...
 *   statusColors  — optional className override for status badge
 *   contextFields — [{ label: "Payee", value: "REXX OMOLE" }, ...]
 *   businessId    — string (for fetching)
 *   sourceType    — "payment_voucher" | "advance" | ...
 *   sourceId      — string (_id of the source doc)
 *   schedule      — optional array of row objects for the schedule tab
 *   scheduleTitle — label for the schedule tab ("Recovery Schedule", ...)
 *   scheduleColumns — [{ key, label, align? }]
 *   scheduleSummary — optional [{ label, value, color? }] stats chips
 */
const JournalEntriesDrawer = ({
  open,
  onClose,
  title         = "Transaction",
  transactionRef = "",
  date,
  amount,
  status,
  statusColors  = "bg-slate-100 text-slate-700 border-slate-200",
  contextFields = [],
  businessId,
  sourceType,
  sourceId,
  schedule,
  scheduleTitle  = "Schedule",
  scheduleColumns = [],
  scheduleSummary = [],
}) => {
  const [tab,     setTab]     = useState("gl");
  const [entries, setEntries] = useState([]);
  const [totals,  setTotals]  = useState({ totalDebit: 0, totalCredit: 0 });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!open || !businessId || !sourceType || !sourceId) return;
    setEntries([]); setTotals({ totalDebit: 0, totalCredit: 0 }); setError(null); setTab("gl");
    setLoading(true);
    adminRequests
      .get("/ledger/entries", { params: { businessId, sourceType, sourceId } })
      .then(({ data }) => {
        setEntries(data.entries || []);
        setTotals({ totalDebit: data.totalDebit || 0, totalCredit: data.totalCredit || 0 });
      })
      .catch((err) => setError(err?.response?.data?.error || err.message || "Failed to load GL entries"))
      .finally(() => setLoading(false));
  }, [open, businessId, sourceType, sourceId]);

  if (!open) return null;

  const hasSchedule = Array.isArray(schedule) && schedule.length > 0;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[70]" onClick={onClose} />
      <aside className="fixed top-0 right-0 h-full w-full max-w-3xl bg-white shadow-2xl border-l border-slate-200 z-[80] flex flex-col">

        {/* ── Dark header ── */}
        <div className="bg-[#0B3B2E] px-5 py-4 flex items-start justify-between shrink-0">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">{title}</p>
            <h3 className="mt-0.5 text-lg font-black text-white">{transactionRef || "—"}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {date   && <span className="text-[11px] text-emerald-100/70">{date}</span>}
              {amount != null && (
                <span className="text-[11px] font-bold text-white">
                  KES {Number(amount || 0).toLocaleString()}
                </span>
              )}
              {status && (
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusColors}`}>
                  {status}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="mt-0.5 text-white/50 hover:text-white transition">
            <FaTimes size={14} />
          </button>
        </div>

        {/* ── Context metadata ── */}
        {contextFields.length > 0 && (
          <div className="border-b border-slate-200 px-5 py-3 bg-slate-50 shrink-0">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
              {contextFields.map(({ label, value }) => (
                <React.Fragment key={label}>
                  <span className="text-slate-400 font-medium">{label}</span>
                  <span className="font-semibold text-slate-900 truncate">{value || "—"}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* ── Tabs (only when schedule tab is available) ── */}
        {hasSchedule && (
          <div className="flex border-b border-slate-200 bg-white shrink-0">
            <button
              onClick={() => setTab("gl")}
              className={`flex items-center gap-1.5 px-5 py-2.5 text-[11px] font-bold border-b-2 transition ${tab === "gl" ? "border-[#0B3B2E] text-[#0B3B2E]" : "border-transparent text-slate-500 hover:text-slate-700"}`}
            >
              <FaBook size={10} /> GL Journal Entries
            </button>
            <button
              onClick={() => setTab("schedule")}
              className={`flex items-center gap-1.5 px-5 py-2.5 text-[11px] font-bold border-b-2 transition ${tab === "schedule" ? "border-[#0B3B2E] text-[#0B3B2E]" : "border-transparent text-slate-500 hover:text-slate-700"}`}
            >
              <FaCalendarAlt size={10} /> {scheduleTitle}
            </button>
          </div>
        )}

        {/* ── Body ── */}
        <div className="flex-1 min-h-0 overflow-auto">

          {/* GL Entries tab */}
          {tab === "gl" && (
            <div className="p-4">
              {loading ? (
                <div className="flex items-center justify-center h-40 text-slate-400 text-[12px]">
                  Loading GL entries…
                </div>
              ) : error ? (
                <div className="flex items-center gap-2 p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12px]">
                  <FaExclamationTriangle size={12} /> {error}
                </div>
              ) : entries.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-slate-400 text-[12px]">
                  No GL entries have been posted for this transaction yet.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full min-w-[680px] text-[11px] border-collapse">
                    <thead className="bg-[#0B3B2E] text-white sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-bold border-r border-white/10">Date</th>
                        <th className="px-3 py-2 text-left font-bold border-r border-white/10">Account</th>
                        <th className="px-3 py-2 text-left font-bold border-r border-white/10">Category</th>
                        <th className="px-3 py-2 text-right font-bold border-r border-white/10">Debit</th>
                        <th className="px-3 py-2 text-right font-bold border-r border-white/10">Credit</th>
                        <th className="px-3 py-2 text-center font-bold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e, idx) => (
                        <tr
                          key={String(e._id)}
                          className={`border-b border-gray-100 ${e.reversalOf ? "opacity-60 line-through" : ""} ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}
                          title={e.notes || undefined}
                        >
                          <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700 whitespace-nowrap">{fmtDate(e.transactionDate)}</td>
                          <td className="px-3 py-1.5 border-r border-gray-100">
                            <span className="font-mono font-bold text-slate-400 mr-1 text-[10px]">{e.accountCode}</span>
                            <span className="text-slate-900">{e.accountName}</span>
                          </td>
                          <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">{CATEGORY_SHORT[e.category] || e.category}</td>
                          <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono text-slate-900">{e.debit  ? fmt(e.debit)  : "—"}</td>
                          <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono text-slate-900">{e.credit ? fmt(e.credit) : "—"}</td>
                          <td className="px-3 py-1.5 text-center">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold ${STATUS_BADGE[e.status] || STATUS_BADGE.draft}`}>
                              {e.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-slate-100 font-bold text-[11px]">
                        <td colSpan={3} className="px-3 py-1.5 text-slate-700">Totals</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-900">{fmt(totals.totalDebit)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-900">{fmt(totals.totalCredit)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {entries.length > 0 && (
                <p className="mt-2 text-[10px] text-slate-400">
                  {entries.length} entr{entries.length === 1 ? "y" : "ies"} • Hover a row to see narration
                </p>
              )}
            </div>
          )}

          {/* Schedule / History tab */}
          {tab === "schedule" && (
            <div className="p-4">
              {/* Summary chips */}
              {scheduleSummary.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {scheduleSummary.map(({ label, value, color = "blue" }) => (
                    <span
                      key={label}
                      className={`rounded border border-${color}-200 bg-${color}-50 px-2.5 py-1 text-[11px] font-bold text-${color}-700`}
                    >
                      {label}: {value}
                    </span>
                  ))}
                </div>
              )}

              {schedule.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-slate-400 text-[12px]">
                  No schedule entries found.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="bg-[#0B3B2E] text-white">
                      <tr>
                        {scheduleColumns.map((col) => (
                          <th
                            key={col.key}
                            className={`px-3 py-2 font-bold border-r border-white/10 ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}`}
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.map((row, idx) => (
                        <tr key={row._id || idx} className={`border-b border-gray-100 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"} ${row._rowClass || ""}`}>
                          {scheduleColumns.map((col) => (
                            <td
                              key={col.key}
                              className={`px-3 py-1.5 border-r border-gray-100 ${col.align === "right" ? "text-right font-mono" : col.align === "center" ? "text-center" : ""} ${col.bold ? "font-bold text-slate-900" : "text-slate-700"}`}
                            >
                              {row[col.key] ?? "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

export default JournalEntriesDrawer;

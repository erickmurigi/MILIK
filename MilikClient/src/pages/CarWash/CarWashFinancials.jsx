import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  FaBook,
  FaCalendarAlt,
  FaExternalLinkAlt,
  FaLayerGroup,
  FaMoneyBillWave,
  FaRedoAlt,
  FaSearch,
  FaTimes,
  FaWallet,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { hasCompanyModule } from "../../utils/companyModules";
import useDebounce from "../../hooks/useDebounce";
import { carWashApi, formatMoney } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

// ── constants ─────────────────────────────────────────────────────────────────
const firstOfMonthISO = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };
const todayISO = () => new Date().toISOString().slice(0, 10);

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SOURCE_LABELS = {
  carwash_payment:           "Payment",
  carwash_expense:           "Expense",
  carwash_commission:        "Commission",
  carwash_commission_payout: "Commission Payout",
};

const entryTypeLabel = (e) => {
  if (e.category === "REVERSAL") return "Reversal";
  return SOURCE_LABELS[e.sourceTransactionType] || e.sourceTransactionType || "—";
};

const DIRECTION_BADGE = {
  debit:  "bg-rose-50 text-rose-700 border-rose-200",
  credit: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const STATUS_BADGE = {
  approved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  reversed: "bg-amber-100 text-amber-700 border-amber-200",
  draft:    "bg-slate-100 text-slate-600 border-slate-200",
  void:     "bg-red-100 text-red-700 border-red-200",
};

// ── sub-components ────────────────────────────────────────────────────────────
const KpiCard = ({ icon: Icon, label, value, sub, bg = "#174D3A" }) => (
  <div className="flex items-center gap-3 border border-slate-200 bg-white px-4 py-3 shadow-sm">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: bg }}>
      <Icon className="text-sm" />
    </div>
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
      <div className="text-sm font-extrabold leading-tight text-slate-900">{value ?? "—"}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-400">{sub}</div>}
    </div>
  </div>
);

const EmptyState = ({ message }) => (
  <div className="flex h-52 flex-col items-center justify-center gap-3 text-slate-400">
    <FaBook size={28} className="opacity-40" />
    <p className="max-w-xs text-center text-xs leading-5">{message}</p>
  </div>
);

// ── main component ────────────────────────────────────────────────────────────
export default function CarWashFinancials() {
  const navigate = useNavigate();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const hasFullAccounts = hasCompanyModule(currentCompany, "accounts");

  // ── state ──────────────────────────────────────────────────────────────────
  const [entries, setEntries]         = useState([]);
  const [loading, setLoading]         = useState(false);
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter]   = useState("approved");
  const [sourceFilter, setSourceFilter]   = useState("all");
  const [directionFilter, setDirFilter]   = useState("all");
  const [startDate, setStartDate]     = useState(firstOfMonthISO());
  const [endDate, setEndDate]         = useState(todayISO());

  const debouncedSearch = useDebounce(search, 350);

  // ── load ledger entries ───────────────────────────────────────────────────
  const loadLedger = useCallback(async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const params = {
        startDate:  startDate  || undefined,
        endDate:    endDate    || undefined,
        status:     statusFilter  !== "all" ? statusFilter  : undefined,
        direction:  directionFilter !== "all" ? directionFilter : undefined,
        sourceType: sourceFilter  !== "all" ? sourceFilter  : undefined,
        limit: 500,
      };
      const payload = await carWashApi.listLedgerEntries(params);
      const rows = payload?.entries || payload?.data?.entries || [];
      setEntries(Array.isArray(rows) ? rows : []);
    } catch {
      toast.error("Failed to load Car Wash ledger entries");
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id, statusFilter, sourceFilter, directionFilter, startDate, endDate]);

  useEffect(() => {
    // Silently seed accounts + backfill any missing entries on every page load
    carWashApi.seedAccounts().catch(() => {});
    carWashApi.backfillPaymentLedger().catch(() => {});
    loadLedger();
  }, [loadLedger]);

  // ── derived KPIs ──────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    let revenue = 0, expenses = 0, commissions = 0, count = 0;
    entries.forEach((e) => {
      if (e.status === "reversed") return;
      count++;
      if (e.category === "CARWASH_PAYMENT"            && e.direction === "credit") revenue     += Number(e.amount || 0);
      if (e.category === "CARWASH_EXPENSE"             && e.direction === "debit")  expenses    += Number(e.amount || 0);
      if (e.category === "CARWASH_COMMISSION_ACCRUAL"  && e.direction === "debit")  commissions += Number(e.amount || 0);
    });
    return { count, revenue, expenses, commissions, net: revenue - expenses - commissions };
  }, [entries]);

  // ── client-side search filter ─────────────────────────────────────────────
  const filteredEntries = useMemo(() => {
    if (!debouncedSearch) return entries;
    const term = debouncedSearch.toLowerCase();
    return entries.filter((e) =>
      (e.notes || "").toLowerCase().includes(term) ||
      (e.sourceTransactionId || "").toLowerCase().includes(term) ||
      (e.accountId?.code || "").toLowerCase().includes(term) ||
      (e.accountId?.name || "").toLowerCase().includes(term)
    );
  }, [entries, debouncedSearch]);

  const headerAction = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
        <FaCalendarAlt size={10} className="shrink-0 text-slate-400" />
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
          className="border-0 bg-transparent text-xs text-slate-700 outline-none min-w-0" />
        <span className="text-slate-300">—</span>
        <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)}
          className="border-0 bg-transparent text-xs text-slate-700 outline-none min-w-0" />
      </div>
      <button onClick={loadLedger}
        className="inline-flex items-center gap-1.5 border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors">
        <FaRedoAlt size={10} /> Refresh
      </button>
      {hasFullAccounts && (
        <button onClick={() => navigate("/financial/journals")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-black text-white transition-colors"
          style={{ backgroundColor: "#174D3A" }}>
          <FaExternalLinkAlt size={9} /> Full Accounts
        </button>
      )}
    </div>
  );

  return (
    <CarWashShell title="Financials" action={headerAction}>
      <div className="flex min-h-0 flex-col gap-3">

        {/* ── KPI strip ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiCard icon={FaBook}          label="Total Entries"      value={kpis.count.toLocaleString()}        sub="active ledger lines"        bg="#374151" />
          <KpiCard icon={FaMoneyBillWave} label="Service Revenue"    value={formatMoney(kpis.revenue)}          sub="credit-side payment entries" bg="#174D3A" />
          <KpiCard icon={FaWallet}        label="Operating Expenses" value={formatMoney(kpis.expenses)}         sub="debit-side expense entries"  bg="#E65F1A" />
          <KpiCard icon={FaLayerGroup}    label="Net Position"       value={formatMoney(kpis.net)}              sub={kpis.net >= 0 ? "surplus" : "deficit"} bg={kpis.net >= 0 ? "#174D3A" : "#DC2626"} />
        </div>

        {/* ── GL Ledger ─────────────────────────────────────────────────────── */}
        <div className="rounded border border-slate-200 bg-white shadow-sm">
          {/* filter bar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
            <div className="relative min-w-0 flex-1 max-w-xs">
              <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={10} />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search account, notes…"
                className="w-full rounded border border-slate-200 py-1.5 pl-8 pr-8 text-xs text-slate-700 placeholder-slate-400 focus:border-[#174D3A] focus:outline-none" />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                  <FaTimes size={10} />
                </button>
              )}
            </div>

            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
              className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-[#174D3A] focus:outline-none">
              <option value="all">All Types</option>
              <option value="carwash_payment">Payments</option>
              <option value="carwash_expense">Expenses</option>
              <option value="carwash_commission">Commissions</option>
              <option value="carwash_commission_payout">Commission Payouts</option>
            </select>

            <select value={directionFilter} onChange={(e) => setDirFilter(e.target.value)}
              className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-[#174D3A] focus:outline-none">
              <option value="all">Dr + Cr</option>
              <option value="debit">Debit only</option>
              <option value="credit">Credit only</option>
            </select>

            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-[#174D3A] focus:outline-none">
              <option value="all">All Status</option>
              <option value="approved">Approved</option>
              <option value="reversed">Reversed</option>
              <option value="draft">Draft</option>
            </select>

            {(search || statusFilter !== "all" || sourceFilter !== "all" || directionFilter !== "all") && (
              <button onClick={() => { setSearch(""); setStatusFilter("all"); setSourceFilter("all"); setDirFilter("all"); }}
                className="text-[10px] font-bold text-slate-500 hover:text-rose-600 transition-colors">
                Clear
              </button>
            )}

            <span className="ml-auto text-[10px] font-bold text-slate-400">
              {filteredEntries.length.toLocaleString()} {filteredEntries.length === 1 ? "entry" : "entries"}
            </span>
          </div>

          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-[#174D3A]" />
            </div>
          ) : filteredEntries.length === 0 ? (
            <EmptyState message="No Car Wash ledger entries found. Entries are posted automatically when payments and expenses are processed." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse text-xs">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    {["Date", "Type", "Account", "Notes", "Debit (KES)", "Credit (KES)", "Status"].map((col) => (
                      <th key={col} className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEntries.map((e) => (
                    <tr key={e._id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDate(e.transactionDate)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${DIRECTION_BADGE[e.direction] || ""}`}>
                          {e.direction === "debit" ? "Dr" : "Cr"}
                        </span>
                        <span className="ml-1.5 text-[10px] font-semibold text-slate-500">
                          {entryTypeLabel(e)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700 max-w-[180px]">
                        {e.accountId ? (
                          <span className="font-semibold">
                            <span className="font-mono text-slate-500">{e.accountId.code}</span>
                            {" "}{e.accountId.name}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-500 max-w-[220px] truncate">{e.notes || "—"}</td>
                      <td className="px-3 py-2 text-right font-mono font-black text-rose-700 whitespace-nowrap">
                        {e.direction === "debit" ? formatMoney(e.amount) : ""}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-black text-emerald-700 whitespace-nowrap">
                        {e.direction === "credit" ? formatMoney(e.amount) : ""}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black capitalize ${STATUS_BADGE[e.status] || "bg-slate-100 text-slate-500 border-slate-200"}`}>
                          {e.status || "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </CarWashShell>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaCarSide, FaClock, FaExclamationTriangle, FaIdCard, FaPhone,
  FaRedoAlt, FaSearch, FaStar, FaTimes, FaUser,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const GRN = "#0B3B2E";
const fmt = formatMoney;
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const acctTypePill = {
  credit:  "bg-purple-100 text-purple-700 border-purple-200",
  monthly: "bg-blue-100 text-blue-700 border-blue-200",
};

// ─── Loyalty stamp progress bar ───────────────────────────────────────────────
const StampBar = ({ card, program }) => {
  if (!card) return <span className="text-slate-400 text-xs">No card</span>;
  const required = program?.stampsRequired || card?.program?.stampsRequired || 10;
  const current = card.currentStamps || 0;
  const pct = Math.min(100, Math.round((current / required) * 100));
  const pending = card.pendingRewards || 0;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-20 flex-shrink-0 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-amber-400 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-semibold tabular-nums text-slate-600">
        {current}/{required}
      </span>
      {pending > 0 && (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 border border-amber-200">
          {pending} reward{pending > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
};

// ─── Customer detail drawer (expanded row) ────────────────────────────────────
const CustomerDetail = ({ customer, onClose }) => {
  const card = customer.loyaltyCard;
  const acc = customer.creditAccount;
  return (
    <tr>
      <td colSpan={8} className="bg-slate-50 px-6 py-4 border-b border-slate-200">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Contact & plates */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Contact & Plates</p>
            <div className="flex items-center gap-1.5 mb-1.5">
              <FaPhone size={10} className="text-slate-400" />
              <span className="text-xs text-slate-700">{customer.phone || "—"}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(customer.plates || []).map((p) => (
                <span key={p} className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-mono font-semibold text-slate-700">
                  {p}
                </span>
              ))}
            </div>
          </div>
          {/* Financial summary */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Financials</p>
            <div className="space-y-1">
              {[
                { label: "Total Invoiced", val: fmt(customer.totalInvoiced), cls: "text-slate-700" },
                { label: "Total Paid", val: fmt(customer.totalPaid), cls: "text-emerald-700" },
                { label: "Outstanding", val: fmt(customer.outstanding), cls: customer.outstanding > 0 ? "text-red-600 font-semibold" : "text-slate-400" },
              ].map(({ label, val, cls }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">{label}</span>
                  <span className={`text-xs tabular-nums ${cls}`}>{val}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Loyalty & credit */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Loyalty & Account</p>
            {card ? (
              <div className="mb-2">
                <StampBar card={card} />
                <p className="mt-1 text-[10px] text-slate-500">
                  {card.totalStampsEarned || 0} stamps earned · {card.totalRewardsEarned || 0} rewards earned
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-400 mb-2">Not enrolled in loyalty</p>
            )}
            {acc ? (
              <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-semibold ${acctTypePill[acc.accountType] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                <FaIdCard size={9} /> {acc.accountNumber} · {acc.accountType}
              </span>
            ) : (
              <p className="text-[10px] text-slate-400">No credit account</p>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────
export default function CarWashCustomers() {
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(30);
  const [search, setSearch] = useState("");
  const [filterOutstanding, setFilterOutstanding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  const load = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const result = await carWashApi.listCustomersEnriched({
        page: params.page ?? page,
        limit,
        search: params.search ?? search,
      });
      const data = result?.data || result?.customers || [];
      setCustomers(data);
      setTotal(result?.total || 0);
    } catch (err) {
      toast.error(err?.message || "Failed to load customers");
    } finally {
      setLoading(false);
    }
  }, [page, limit, search]);

  useEffect(() => { load(); }, [page]);

  // Debounced search
  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      load({ page: 1, search: val });
    }, 350);
  };

  const displayed = useMemo(() => {
    if (!filterOutstanding) return customers;
    return customers.filter((c) => c.outstanding > 0.01);
  }, [customers, filterOutstanding]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const withOutstanding = displayed.filter((c) => c.outstanding > 0.01).length;
    const totalOutstanding = displayed.reduce((s, c) => s + (c.outstanding || 0), 0);
    const withCredit = displayed.filter((c) => c.creditAccount).length;
    const withLoyalty = displayed.filter((c) => c.loyaltyCard).length;
    return { withOutstanding, totalOutstanding, withCredit, withLoyalty };
  }, [displayed]);

  const pages = Math.max(Math.ceil(total / limit), 1);

  return (
    <CarWashShell>
      <div className="flex h-full flex-col overflow-hidden bg-white">
        {/* ── Header ── */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Car Wash</p>
              <h2 className="text-sm font-bold text-slate-800">Customers</h2>
            </div>
            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative">
                <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={10} />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Name / phone / plate..."
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="h-8 rounded-md border border-slate-300 bg-white pl-7 pr-3 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] w-52"
                />
                {search && (
                  <button type="button" onClick={() => handleSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <FaTimes size={9} />
                  </button>
                )}
              </div>
              {/* Outstanding filter */}
              <button
                type="button"
                onClick={() => setFilterOutstanding((v) => !v)}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  filterOutstanding
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <FaExclamationTriangle size={9} />
                Outstanding only
              </button>
              <button
                type="button"
                onClick={() => load()}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                <FaRedoAlt size={9} className={loading ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
          </div>

          {/* ── Summary strip ── */}
          <div className="mt-2.5 flex flex-wrap items-center gap-4 text-[10px] text-slate-500">
            <span className="font-semibold text-slate-700">{total} customers</span>
            {summaryStats.withOutstanding > 0 && (
              <span className="flex items-center gap-1 text-red-600">
                <FaExclamationTriangle size={9} />
                {summaryStats.withOutstanding} with outstanding · {fmt(summaryStats.totalOutstanding)}
              </span>
            )}
            {summaryStats.withCredit > 0 && (
              <span className="text-purple-600">{summaryStats.withCredit} credit accounts</span>
            )}
            {summaryStats.withLoyalty > 0 && (
              <span className="text-amber-600">{summaryStats.withLoyalty} loyalty members</span>
            )}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="min-w-max w-full whitespace-nowrap text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#0B3B2E]">
                <th className="w-8 px-3 py-2.5" />
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-white/80">Customer</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-white/80">Plates</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-white/80">Visits</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-white/80">Last Visit</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-white/80">Lifetime Spend</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-red-300/80">Outstanding</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-white/80">Loyalty</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-white/80">Account</th>
              </tr>
            </thead>
            <tbody>
              {loading && !customers.length ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-sm text-slate-400">
                    Loading customers...
                  </td>
                </tr>
              ) : !displayed.length ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center">
                    <FaUser className="mx-auto mb-2 text-slate-300" size={24} />
                    <p className="text-sm font-semibold text-slate-500">
                      {search ? "No customers match your search" : "No customers yet"}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Customers are auto-created when jobs are opened
                    </p>
                  </td>
                </tr>
              ) : (
                displayed.map((c, idx) => {
                  const isExpanded = expandedId === String(c._id);
                  const isOdd = idx % 2 !== 0;
                  const rowBg = isOdd ? "bg-slate-50" : "bg-white";
                  const hasOutstanding = c.outstanding > 0.01;
                  const card = c.loyaltyCard;
                  const acc = c.creditAccount;
                  return (
                    <React.Fragment key={String(c._id)}>
                      <tr
                        className={`${rowBg} border-b border-slate-100 transition-colors hover:bg-blue-50/20 cursor-pointer`}
                        onClick={() => setExpandedId(isExpanded ? null : String(c._id))}
                      >
                        {/* Expand chevron */}
                        <td className={`px-3 py-2.5 ${hasOutstanding ? "border-l-2 border-red-400" : "border-l-2 border-transparent"}`}>
                          <span className="text-slate-400 text-[10px]">{isExpanded ? "▾" : "▸"}</span>
                        </td>
                        {/* Name + phone */}
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-800">{c.name || "—"}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{c.phone || "—"}</div>
                        </td>
                        {/* Plates */}
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {(c.plates || []).slice(0, 3).map((p) => (
                              <span key={p} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-mono font-bold text-slate-700">
                                {p}
                              </span>
                            ))}
                            {(c.plates || []).length > 3 && (
                              <span className="text-[9px] text-slate-400">+{c.plates.length - 3}</span>
                            )}
                          </div>
                        </td>
                        {/* Total jobs */}
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <FaCarSide size={9} className="text-slate-400" />
                            <span className="font-semibold text-slate-700 tabular-nums">{c.totalJobs || 0}</span>
                          </div>
                        </td>
                        {/* Last visit */}
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1 text-slate-500">
                            <FaClock size={9} />
                            <span className="tabular-nums">{fmtDate(c.lastVisit)}</span>
                          </div>
                        </td>
                        {/* Lifetime spend */}
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-slate-700">
                          {c.totalPaid > 0 ? fmt(c.totalPaid) : "—"}
                        </td>
                        {/* Outstanding */}
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {hasOutstanding ? (
                            <span className="font-semibold text-red-600">{fmt(c.outstanding)}</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        {/* Loyalty */}
                        <td className="px-4 py-2.5">
                          {card ? (
                            <StampBar card={card} />
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </td>
                        {/* Credit account */}
                        <td className="px-4 py-2.5">
                          {acc ? (
                            <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold ${acctTypePill[acc.accountType] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                              <FaIdCard size={8} />
                              {acc.accountType}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && <CustomerDetail customer={c} onClose={() => setExpandedId(null)} />}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {pages > 1 && (
          <div className="flex-shrink-0 flex items-center justify-between border-t border-slate-200 bg-white px-5 py-2.5">
            <span className="text-xs text-slate-500">
              Showing {((page - 1) * limit) + 1}–{Math.min(page * limit, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 disabled:opacity-40 hover:bg-slate-50"
              >
                Previous
              </button>
              <span className="px-2 text-xs text-slate-500">Page {page} of {pages}</span>
              <button
                type="button"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 disabled:opacity-40 hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </CarWashShell>
  );
}

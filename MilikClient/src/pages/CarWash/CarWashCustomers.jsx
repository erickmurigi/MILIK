import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FaCar, FaCarSide, FaClock, FaCommentDots, FaEdit,
  FaExclamationTriangle, FaIdCard, FaMobileAlt, FaMoneyBillWave,
  FaPhone, FaRedoAlt, FaSearch, FaTimes, FaUser,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { FaBalanceScale } from "react-icons/fa";
import { carWashApi, formatMoney, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import CwSmsModal from "./CwSmsModal";
import useCarWashPermission from "../../hooks/useCarWashPermission";

const GRN = "#0B3B2E";
const fmt = formatMoney;
const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const acctTypePill = {
  credit:  "bg-purple-100 text-purple-700 border-purple-200",
  monthly: "bg-blue-100 text-blue-700 border-blue-200",
};

const inputCls = "h-9 w-full border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20";
const labelCls = "mb-1 block text-[10px] font-extrabold uppercase tracking-widest text-slate-500";

// ─── Inline modal ──────────────────────────────────────────────────────────────
const Modal = ({ title, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
    <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-lg sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[88vh] rounded-t-2xl sm:rounded-none">
      <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white rounded">
          <FaTimes />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
      {footer && (
        <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
      )}
    </div>
  </div>
);

// ─── Compact stamp dots — mirrors CarWashLoyalty StampDots ────────────────────
const StampBar = ({ card, program }) => {
  if (!card) return <span className="text-slate-300 text-[10px]">—</span>;
  const required = program?.stampsRequired || card?.program?.stampsRequired || 10;
  const current = card.currentStamps || 0;
  const pending = card.pendingRewards || 0;
  if (required > 12) {
    const pct = Math.min(100, Math.round((current / required) * 100));
    return (
      <div className="flex items-center gap-1.5">
        <div className="relative h-1.5 w-14 flex-shrink-0 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[9px] font-bold tabular-nums text-slate-500">{current}/{required}</span>
        {pending > 0 && <span className="rounded-full bg-amber-100 px-1 py-0.5 text-[8px] font-bold text-amber-700 border border-amber-200">{pending}×</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {Array.from({ length: required }, (_, i) => (
        <div key={i} className={`flex h-3 w-3 items-center justify-center rounded-full border-[1.5px] transition-all ${i < current ? "border-amber-500 bg-amber-500" : "border-slate-200 bg-white"}`}>
          {i < current && <div className="h-1 w-1 rounded-full bg-white" />}
        </div>
      ))}
      <span className="ml-0.5 text-[9px] font-bold tabular-nums text-slate-500">{current}/{required}</span>
      {pending > 0 && <span className="ml-0.5 rounded-full bg-amber-100 px-1 py-0.5 text-[8px] font-bold text-amber-700 border border-amber-200">{pending}×</span>}
    </div>
  );
};

// ─── Expanded detail row ───────────────────────────────────────────────────────
const CustomerDetail = ({ customer, program, colSpan = 10 }) => {
  const card = customer.loyaltyCard;
  const acc = customer.creditAccount;
  return (
    <tr>
      <td colSpan={colSpan} className="bg-[#F4F7F5]/60 px-4 py-3 border-b border-slate-200">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
          {/* Contact & plates */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Contact & Plates</p>
            <div className="flex items-center gap-1.5 mb-2">
              <FaPhone size={9} className="text-slate-400 flex-shrink-0" />
              <span className="text-slate-700">{customer.phone || "No phone on record"}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(customer.plates || []).map((p) => (
                <span key={p} className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-mono font-bold text-slate-700">
                  {p}
                </span>
              ))}
            </div>
          </div>
          {/* Financial summary */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Financials</p>
            <div className="space-y-1.5">
              {[
                { label: "Total Invoiced", val: fmt(customer.totalInvoiced), cls: "text-slate-700" },
                { label: "Total Paid", val: fmt(customer.totalPaid), cls: "text-emerald-700 font-semibold" },
                { label: "Outstanding", val: fmt(customer.outstanding), cls: customer.outstanding > 0 ? "text-red-600 font-bold" : "text-slate-400" },
              ].map(({ label, val, cls }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">{label}</span>
                  <span className={`tabular-nums ${cls}`}>{val}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Loyalty & credit */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Loyalty & Account</p>
            {card ? (
              <div className="mb-2 space-y-1">
                <StampBar card={card} program={program} />
                <p className="text-[10px] text-slate-500">
                  {card.totalStampsEarned || 0} stamps earned · {card.totalRewardsEarned || 0} rewards
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-slate-400 mb-2">Not enrolled in loyalty</p>
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

// ─── Row action icon button ────────────────────────────────────────────────────
const ActionBtn = ({ icon: Icon, title, onClick, color = "slate" }) => {
  const colors = {
    slate:  "border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700 hover:bg-slate-50",
    green:  "border-slate-200 text-slate-500 hover:border-[#0B3B2E] hover:text-[#0B3B2E] hover:bg-[#F1F6F3]",
    amber:  "border-slate-200 text-slate-500 hover:border-amber-400 hover:text-amber-700 hover:bg-amber-50",
    blue:   "border-slate-200 text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50",
    red:    "border-red-200 text-red-400 hover:border-red-400 hover:text-red-700 hover:bg-red-50",
  };
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`h-6 w-6 flex-shrink-0 flex items-center justify-center rounded border text-[10px] transition-colors ${colors[color] || colors.slate}`}
    >
      <Icon size={10} />
    </button>
  );
};

// ─── Main component ────────────────────────────────────────────────────────────
export default function CarWashCustomers() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = useCarWashPermission("carwash-loyalty", "manage");

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterOutstanding, setFilterOutstanding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  // ── Edit modal ──
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", phone: "" });
  const [editSaving, setEditSaving] = useState(false);

  // ── SMS modal ──
  const [smsTarget, setSmsTarget] = useState(null);
  const [smsSending, setSmsSending] = useState(false);

  // ── Settle / payment modal ──
  const [payTarget, setPayTarget] = useState(null);
  const [payJobs, setPayJobs] = useState([]);
  const [payJobsLoading, setPayJobsLoading] = useState(false);
  const [payForm, setPayForm] = useState({ job: "", amount: "", method: "cash", cashbookAccount: "", paymentDate: todayISO(), reference: "", phone: "" });
  const [paying, setPaying] = useState(false);
  const [stkPushing, setStkPushing] = useState(false);

  const customerQueryKey = ["cw-customers", page, limit, debouncedSearch];

  const { data: customersData, isLoading: loading, error } = useQuery({
    queryKey: customerQueryKey,
    queryFn: async () => {
      try {
        return await carWashApi.listCustomersEnriched({ page, limit, search: debouncedSearch });
      } catch {
        return carWashApi.listLoyaltyCustomers({ page, limit, search: debouncedSearch });
      }
    },
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  useEffect(() => { if (error) toast.error(error?.message || "Failed to load customers"); }, [error]);

  const customers = useMemo(() => {
    const raw = customersData;
    return Array.isArray(raw) ? raw : (raw?.data ?? []);
  }, [customersData]);
  const total = Array.isArray(customersData) ? customersData.length : (customersData?.total ?? customers.length);
  const loyaltyProgram = Array.isArray(customersData) ? null : (customersData?.loyaltyProgram ?? null);

  const { data: cashbooksRaw } = useQuery({
    queryKey: ["cw-customer-cashbooks"],
    queryFn: () => carWashApi.listCashbooks(),
    staleTime: 5 * 60_000,
  });
  const cashbooks = cashbooksRaw ?? [];

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setDebouncedSearch(val);
    }, 350);
  };

  const displayed = useMemo(() => {
    if (!filterOutstanding) return customers;
    return customers.filter((c) => c.outstanding > 0.01);
  }, [customers, filterOutstanding]);

  const summaryStats = useMemo(() => {
    const withOutstanding = displayed.filter((c) => c.outstanding > 0.01).length;
    const totalOutstanding = displayed.reduce((s, c) => s + (c.outstanding || 0), 0);
    const withCredit = displayed.filter((c) => c.creditAccount).length;
    const withLoyalty = displayed.filter((c) => c.loyaltyCard).length;
    return { withOutstanding, totalOutstanding, withCredit, withLoyalty };
  }, [displayed]);

  const pages = Math.max(Math.ceil(total / limit), 1);

  // ── Edit save ──
  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editTarget) return;
    setEditSaving(true);
    try {
      await carWashApi.updateLoyaltyCustomer(editTarget._id, {
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
      });
      queryClient.invalidateQueries({ queryKey: ["cw-customers"] });
      toast.success("Customer updated");
      setEditTarget(null);
    } catch (err) {
      toast.error(err?.message || "Failed to update customer");
    } finally {
      setEditSaving(false);
    }
  };

  // ── SMS send ──
  const sendSms = async (payload) => {
    if (!smsTarget) return;
    setSmsSending(true);
    try {
      await carWashApi.sendCustomerSms(smsTarget._id, payload);
      toast.success("SMS sent");
      setSmsTarget(null);
    } catch (err) {
      toast.error(err?.message || "Failed to send SMS");
    } finally {
      setSmsSending(false);
    }
  };

  const sendStkPush = async () => {
    const phone = payForm.phone?.trim();
    const amount = Number(payForm.amount || 0);
    if (!phone) { toast.error("Enter customer phone number first"); return; }
    if (amount <= 0) { toast.error("Enter payment amount first"); return; }
    if (!payForm.job) { toast.error("Select a job first"); return; }
    setStkPushing(true);
    try {
      const job = payJobs.find((j) => j._id === payForm.job);
      await carWashApi.initiateStkPush({
        phone,
        amount,
        jobId: payForm.job,
        accountRef: job?.plateNumber || job?.jobNumber || "CarWash",
      });
      toast.success(`M-Pesa prompt sent to ${phone} — ask customer to check their phone`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "M-Pesa push failed");
    } finally {
      setStkPushing(false);
    }
  };

  const openEdit = (e, c) => {
    e.stopPropagation();
    setEditTarget(c);
    setEditForm({ name: c.name || "", phone: c.phone || "" });
  };

  const openSms = (e, c) => {
    e.stopPropagation();
    setSmsTarget(c);
  };

  const viewJobs = (e, c) => {
    e.stopPropagation();
    const plate = (c.plates || [])[0] || "";
    navigate(plate ? `/carwash/jobs?plate=${encodeURIComponent(plate)}` : "/carwash/jobs");
  };

  const openSettle = async (e, c) => {
    e.stopPropagation();
    setPayTarget(c);
    setPayJobs([]);
    setPayForm({ job: "", amount: "", method: "cash", cashbookAccount: cashbooks[0]?._id || "", paymentDate: todayISO(), reference: "", phone: c.phone || "" });
    setPayJobsLoading(true);
    try {
      const plate = (c.plates || [])[0] || "";
      const res = await carWashApi.listJobs({ search: plate || c.name, limit: 100 });
      const all = normalizeListPayload(res, "jobs");
      const unpaid = all.filter((j) => j.paymentStatus !== "paid");
      setPayJobs(unpaid);
      if (unpaid.length === 1) {
        const j = unpaid[0];
        const outstanding = Math.max(0, Number(j.price || 0) - Number(j.discountAmount || 0));
        setPayForm((f) => ({ ...f, job: j._id, amount: String(outstanding) }));
      }
    } catch (err) {
      toast.error("Could not load unpaid jobs");
    } finally {
      setPayJobsLoading(false);
    }
  };

  const submitPayment = async (e) => {
    e.preventDefault();
    if (!payForm.job) { toast.error("Select a job"); return; }
    if (!payForm.cashbookAccount) { toast.error("Select a cashbook"); return; }
    setPaying(true);
    try {
      await carWashApi.recordPayment({
        job: payForm.job,
        amount: Number(payForm.amount || 0),
        method: payForm.method,
        cashbookAccount: payForm.cashbookAccount,
        paymentDate: payForm.paymentDate,
        reference: payForm.reference,
        discountAmount: 0,
      });
      toast.success("Payment recorded successfully");
      setPayTarget(null);
      queryClient.invalidateQueries({ queryKey: ["cw-customers"] });
    } catch (err) {
      toast.error(err?.message || err?.response?.data?.message || "Failed to record payment");
    } finally {
      setPaying(false);
    }
  };

  return (
    <CarWashShell>
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-white">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-2 py-1">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Car Wash</p>
              <h2 className="text-sm font-bold text-slate-800 truncate leading-tight">Customers</h2>
            </div>

            {/* Actions toolbar */}
            <div className="flex flex-wrap items-center gap-1">
              {/* Search */}
              <div className="relative">
                <FaSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={9} />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Name / phone / plate..."
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="h-7 w-36 rounded border border-slate-300 bg-white pl-6 pr-6 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20 sm:w-48 transition-all"
                />
                {search && (
                  <button type="button" onClick={() => handleSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <FaTimes size={9} />
                  </button>
                )}
              </div>

              {/* Outstanding filter toggle */}
              <button
                type="button"
                onClick={() => setFilterOutstanding((v) => !v)}
                className={`flex items-center gap-1 h-7 rounded border px-2 text-xs font-semibold transition-colors ${
                  filterOutstanding
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <FaExclamationTriangle size={9} />
                <span className="hidden sm:inline">Outstanding only</span>
                <span className="sm:hidden">Unpaid</span>
              </button>

              {/* Opening Balances */}
              <button
                type="button"
                onClick={() => navigate("/carwash/customers/opening-balances")}
                className="flex items-center gap-1 h-7 rounded border border-amber-300 bg-amber-50 px-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
                title="Record pre-existing customer balances"
              >
                <FaBalanceScale size={9} />
                <span className="hidden sm:inline">Opening Balances</span>
              </button>

              {/* Sync */}
              {canManage && (
              <button
                type="button"
                onClick={async () => {
                  setSyncing(true);
                  try {
                    const r = await carWashApi.backfillCustomersAndStamps();
                    toast.success(`Sync done — ${r?.customersCreated ?? 0} created, ${r?.stampsAwarded ?? 0} stamps`);
                    queryClient.invalidateQueries({ queryKey: ["cw-customers"] });
                  } catch (err) {
                    toast.error(err?.message || "Sync failed");
                  } finally { setSyncing(false); }
                }}
                disabled={syncing || loading}
                className="flex items-center gap-1 h-7 rounded border border-emerald-300 bg-emerald-50 px-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
              >
                <FaRedoAlt size={9} className={syncing ? "animate-spin" : ""} />
                <span className="hidden sm:inline">{syncing ? "Syncing..." : "Sync Jobs"}</span>
              </button>
              )}

              {/* Refresh */}
              <button
                type="button"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["cw-customers"] })}
                disabled={loading}
                className="flex items-center gap-1 h-7 rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <FaRedoAlt size={9} className={loading ? "animate-spin" : ""} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>

          {/* Summary strip */}
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
            <span className="font-semibold text-slate-700">{total} customer{total !== 1 ? "s" : ""}</span>
            {summaryStats.withOutstanding > 0 && (
              <span className="flex items-center gap-1 text-red-600">
                <FaExclamationTriangle size={8} />
                {summaryStats.withOutstanding} with outstanding · <strong>{fmt(summaryStats.totalOutstanding)}</strong>
              </span>
            )}
            {summaryStats.withCredit > 0 && (
              <span className="text-purple-600">{summaryStats.withCredit} credit account{summaryStats.withCredit !== 1 ? "s" : ""}</span>
            )}
            {summaryStats.withLoyalty > 0 && (
              <span className="text-amber-600">{summaryStats.withLoyalty} loyalty member{summaryStats.withLoyalty !== 1 ? "s" : ""}</span>
            )}
          </div>
        </div>

        {/* ── Data area ──────────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-auto">

          {/* Mobile cards (< sm) */}
          <div className="sm:hidden divide-y divide-slate-100">
            {loading && !customers.length ? (
              <p className="py-16 text-center text-sm text-slate-400">Loading…</p>
            ) : !displayed.length ? (
              <div className="py-16 text-center px-6">
                <FaUser className="mx-auto mb-2 text-slate-300" size={28} />
                <p className="text-sm font-semibold text-slate-500">{search ? "No customers match" : "No customers yet"}</p>
                <p className="text-xs text-slate-400 mt-1">Customers are created automatically when jobs are opened</p>
              </div>
            ) : displayed.map((c) => {
              const isExpanded = expandedId === String(c._id);
              const hasOutstanding = c.outstanding > 0.01;
              const card = c.loyaltyCard;
              const acc = c.creditAccount;
              return (
                <div key={String(c._id)} className={`p-3 space-y-2${hasOutstanding ? " border-l-[3px] border-red-400" : ""}`}>
                  {/* Row top: name + outstanding */}
                  <div
                    className="flex items-start justify-between gap-2 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : String(c._id))}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{c.name || <span className="text-slate-400 italic">Unnamed</span>}</p>
                      <p className="text-[10px] text-slate-400">{c.phone || "—"}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {hasOutstanding && (
                        <span className="text-xs font-bold text-red-600">{fmt(c.outstanding)}</span>
                      )}
                      <span className="text-slate-400 text-[10px]">{isExpanded ? "▾" : "▸"}</span>
                    </div>
                  </div>

                  {/* Plates */}
                  <div className="flex flex-wrap gap-1">
                    {(c.plates || []).map((p) => (
                      <span key={p} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-mono font-bold text-slate-700">{p}</span>
                    ))}
                  </div>

                  {/* Stats row */}
                  <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1"><FaCarSide size={9} className="text-slate-400" />{c.totalJobs || 0} visits</span>
                    {c.lastVisit && <span className="flex items-center gap-1"><FaClock size={9} />{fmtDate(c.lastVisit)}</span>}
                    {card && <StampBar card={card} program={loyaltyProgram} />}
                    {acc && (
                      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold ${acctTypePill[acc.accountType] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        <FaIdCard size={8} />{acc.accountType}
                      </span>
                    )}
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="rounded border border-slate-200 bg-slate-50 p-3 space-y-3 text-xs">
                      <div className="space-y-1">
                        {[
                          { label: "Total Invoiced", val: fmt(c.totalInvoiced), cls: "text-slate-700" },
                          { label: "Total Paid", val: fmt(c.totalPaid), cls: "text-emerald-700 font-semibold" },
                          { label: "Outstanding", val: fmt(c.outstanding), cls: c.outstanding > 0 ? "text-red-600 font-bold" : "text-slate-400" },
                        ].map(({ label, val, cls }) => (
                          <div key={label} className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">{label}</span>
                            <span className={`tabular-nums ${cls}`}>{val}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Mobile action buttons */}
                  <div className="flex items-center gap-1.5 pt-1">
                    <ActionBtn icon={FaCar} title="View Jobs" color="green" onClick={(e) => viewJobs(e, c)} />
                    {canManage && <ActionBtn icon={FaEdit} title="Edit customer" color="amber" onClick={(e) => openEdit(e, c)} />}
                    {c.phone && <ActionBtn icon={FaCommentDots} title="Send SMS" color="blue" onClick={(e) => openSms(e, c)} />}
                    {hasOutstanding && canManage && <ActionBtn icon={FaMoneyBillWave} title="Settle outstanding" color="red" onClick={(e) => openSettle(e, c)} />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table (sm+) */}
          <div className="hidden sm:block min-w-full">
            <table className="w-full text-xs">
              <colgroup>
                <col className="w-8" />
                <col className="min-w-[160px]" />
                <col className="hidden md:table-column min-w-[120px]" />
                <col className="hidden md:table-column w-16" />
                <col className="hidden lg:table-column w-28" />
                <col className="hidden xl:table-column w-28" />
                <col className="w-24" />
                <col className="hidden xl:table-column min-w-[130px]" />
                <col className="hidden xl:table-column w-24" />
                <col className="w-28" />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-3 py-1.5 w-8" />
                  <th className="px-4 py-1.5 text-left font-bold uppercase tracking-wide">Customer</th>
                  <th className="hidden md:table-cell px-4 py-1.5 text-left font-bold uppercase tracking-wide">Plates</th>
                  <th className="hidden md:table-cell px-4 py-1.5 text-center font-bold uppercase tracking-wide">Visits</th>
                  <th className="hidden lg:table-cell px-4 py-1.5 text-right font-bold uppercase tracking-wide">Last Visit</th>
                  <th className="hidden xl:table-cell px-4 py-1.5 text-right font-bold uppercase tracking-wide">Lifetime Spend</th>
                  <th className="px-4 py-1.5 text-right font-bold uppercase tracking-wide text-red-300">Outstanding</th>
                  <th className="hidden xl:table-cell px-4 py-1.5 text-left font-bold uppercase tracking-wide">Loyalty</th>
                  <th className="hidden xl:table-cell px-4 py-1.5 text-left font-bold uppercase tracking-wide">Account</th>
                  <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide text-white/70">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && !customers.length ? (
                  <tr>
                    <td colSpan={10} className="py-16 text-center text-sm text-slate-400">Loading customers…</td>
                  </tr>
                ) : !displayed.length ? (
                  <tr>
                    <td colSpan={10} className="py-16 text-center">
                      <FaUser className="mx-auto mb-2 text-slate-300" size={24} />
                      <p className="text-sm font-semibold text-slate-500">{search ? "No customers match your search" : "No customers yet"}</p>
                      <p className="text-xs text-slate-400 mt-1">Customers are auto-created when jobs are opened</p>
                    </td>
                  </tr>
                ) : displayed.map((c, idx) => {
                  const isExpanded = expandedId === String(c._id);
                  const rowBg = idx % 2 === 0 ? "bg-white" : "bg-slate-50/60";
                  const hasOutstanding = c.outstanding > 0.01;
                  const card = c.loyaltyCard;
                  const acc = c.creditAccount;
                  return (
                    <React.Fragment key={String(c._id)}>
                      <tr
                        className={`${rowBg} transition-colors hover:bg-emerald-50/30 cursor-pointer group`}
                        onClick={() => setExpandedId(isExpanded ? null : String(c._id))}
                      >
                        {/* Expand */}
                        <td className={`px-3 py-2 ${hasOutstanding ? "border-l-[3px] border-red-400" : "border-l-[3px] border-transparent"}`}>
                          <span className="text-slate-300 group-hover:text-slate-500 text-[10px] transition-colors">
                            {isExpanded ? "▾" : "▸"}
                          </span>
                        </td>

                        {/* Customer */}
                        <td className="px-4 py-2">
                          <div className="font-semibold text-slate-800 truncate max-w-[180px]">
                            {c.name || <span className="italic text-slate-400 font-normal">Unnamed</span>}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                            {c.phone ? (
                              <><FaPhone size={8} className="text-slate-300" /> {c.phone}</>
                            ) : (
                              <span className="italic">No phone</span>
                            )}
                          </div>
                        </td>

                        {/* Plates */}
                        <td className="hidden md:table-cell px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {(c.plates || []).slice(0, 2).map((p) => (
                              <span key={p} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-mono font-bold text-slate-700">
                                {p}
                              </span>
                            ))}
                            {(c.plates || []).length > 2 && (
                              <span className="text-[9px] text-slate-400">+{c.plates.length - 2}</span>
                            )}
                          </div>
                        </td>

                        {/* Visits */}
                        <td className="hidden md:table-cell px-4 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <FaCarSide size={9} className="text-slate-300" />
                            <span className="font-semibold tabular-nums text-slate-700">{c.totalJobs || 0}</span>
                          </div>
                        </td>

                        {/* Last visit */}
                        <td className="hidden lg:table-cell px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-1 text-slate-500">
                            <FaClock size={8} className="text-slate-300" />
                            <span className="tabular-nums text-[11px]">{fmtDate(c.lastVisit)}</span>
                          </div>
                        </td>

                        {/* Lifetime spend */}
                        <td className="hidden xl:table-cell px-4 py-2 text-right tabular-nums font-medium text-slate-700 text-[11px]">
                          {c.totalPaid > 0 ? fmt(c.totalPaid) : <span className="text-slate-300">—</span>}
                        </td>

                        {/* Outstanding */}
                        <td className="px-4 py-2 text-right tabular-nums text-[11px]">
                          {hasOutstanding ? (
                            <span className="font-bold text-red-600">{fmt(c.outstanding)}</span>
                          ) : (
                            <span className="text-slate-200">—</span>
                          )}
                        </td>

                        {/* Loyalty */}
                        <td className="hidden xl:table-cell px-4 py-2">
                          <StampBar card={card} program={loyaltyProgram} />
                        </td>

                        {/* Account */}
                        <td className="hidden xl:table-cell px-4 py-2">
                          {acc ? (
                            <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold ${acctTypePill[acc.accountType] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                              <FaIdCard size={8} />{acc.accountType}
                            </span>
                          ) : (
                            <span className="text-slate-200 text-[10px]">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <ActionBtn icon={FaCar} title="View jobs" color="green" onClick={(e) => viewJobs(e, c)} />
                            {canManage && <ActionBtn icon={FaEdit} title="Edit customer" color="amber" onClick={(e) => openEdit(e, c)} />}
                            {c.phone && <ActionBtn icon={FaCommentDots} title="Send SMS" color="blue" onClick={(e) => openSms(e, c)} />}
                            {hasOutstanding && canManage && (
                              <ActionBtn icon={FaMoneyBillWave} title={`Settle ${fmt(c.outstanding)} outstanding`} color="red" onClick={(e) => openSettle(e, c)} />
                            )}
                          </div>
                        </td>
                      </tr>

                      {isExpanded && <CustomerDetail customer={c} program={loyaltyProgram} colSpan={10} />}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Pagination ─────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex min-h-8 items-center justify-between border-t border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-500 normal-case">Per page:</span>
            <select
              value={limit}
              onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
              className="h-7 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 focus:border-emerald-400 focus:outline-none transition normal-case"
            >
              {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page <= 1}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Previous
            </button>
            <span>Page {page} of {pages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(p + 1, pages))}
              disabled={page >= pages}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── Settle / payment modal ─────────────────────────────────────────── */}
      {payTarget && (() => {
        const selectedJob = payJobs.find((j) => j._id === payForm.job);
        const outstanding = selectedJob
          ? Math.max(0, Number(selectedJob.price || 0) - Number(selectedJob.discountAmount || 0))
          : 0;
        const paying_amt = Number(payForm.amount || 0);
        const remaining = Math.max(0, outstanding - paying_amt);
        const overPay = paying_amt > outstanding + 0.01 && outstanding > 0;
        return (
          <Modal
            title={`Record Payment — ${payTarget.name || "Customer"}`}
            onClose={() => setPayTarget(null)}
            footer={
              <>
                <button type="button" onClick={() => setPayTarget(null)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  type="submit"
                  form="cw-settle-form"
                  disabled={paying || payJobsLoading || !payForm.job || !payForm.cashbookAccount}
                  className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"
                >
                  {paying ? "Recording…" : "Record Payment"}
                </button>
              </>
            }
          >
            {/* Customer context */}
            <div className="mb-4 flex items-start gap-3 rounded border border-slate-200 bg-slate-50 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-800">{payTarget.name || "Unknown Customer"}</p>
                <p className="text-[10px] text-slate-400">{payTarget.phone || "No phone"}</p>
              </div>
              {payTarget.outstanding > 0 && (
                <div className="flex-shrink-0 text-right">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Total Outstanding</p>
                  <p className="text-sm font-black text-red-600">{fmt(payTarget.outstanding)}</p>
                </div>
              )}
            </div>

            {payJobsLoading ? (
              <p className="py-6 text-center text-xs text-slate-400">Loading unpaid jobs…</p>
            ) : payJobs.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm font-semibold text-slate-500">No unpaid jobs found</p>
                <p className="mt-1 text-xs text-slate-400">All jobs for this customer are marked as paid</p>
              </div>
            ) : (
              <form id="cw-settle-form" onSubmit={submitPayment} className="space-y-3">
                {/* Job selector */}
                <div>
                  <label className={labelCls}>Select Job *</label>
                  <select
                    className={inputCls}
                    value={payForm.job}
                    onChange={(e) => {
                      const j = payJobs.find((x) => x._id === e.target.value);
                      const amt = j ? Math.max(0, Number(j.price || 0) - Number(j.discountAmount || 0)) : 0;
                      setPayForm((f) => ({ ...f, job: e.target.value, amount: String(amt) }));
                    }}
                    required
                  >
                    <option value="">— Select unpaid job —</option>
                    {payJobs.map((j) => (
                      <option key={j._id} value={j._id}>
                        {j.jobNumber} · {j.plateNumber || j.itemDescription || "—"} · {fmt(j.price)}
                        {j.paymentStatus === "partial" ? " (partial)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Outstanding summary for selected job */}
                {selectedJob && (
                  <div className="flex flex-wrap gap-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px]">
                    <div><span className="text-slate-500">Price: </span><strong className="text-slate-700">{fmt(selectedJob.price)}</strong></div>
                    {selectedJob.discountAmount > 0 && <div><span className="text-slate-500">Discount: </span><strong className="text-slate-700">{fmt(selectedJob.discountAmount)}</strong></div>}
                    <div><span className="text-slate-500">Outstanding: </span><strong className="text-red-600">{fmt(outstanding)}</strong></div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {/* Amount */}
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className={labelCls} style={{ marginBottom: 0 }}>Amount *</label>
                      {outstanding > 0 && (
                        <button type="button" onClick={() => setPayForm((f) => ({ ...f, amount: String(outstanding) }))}
                          className="text-[9px] font-black text-[#0B3B2E] underline hover:text-orange-500">
                          Pay in full
                        </button>
                      )}
                    </div>
                    <input
                      className={inputCls}
                      type="number"
                      min="1"
                      step="1"
                      value={payForm.amount}
                      onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                      required
                    />
                    {selectedJob && paying_amt > 0 && (
                      overPay
                        ? <p className="mt-0.5 text-[10px] font-bold text-red-600">Exceeds outstanding by {fmt(paying_amt - outstanding)}</p>
                        : remaining === 0
                          ? <p className="mt-0.5 text-[10px] font-bold text-emerald-700">Job will be fully settled ✓</p>
                          : <p className="mt-0.5 text-[10px] text-slate-500">Remaining: <strong>{fmt(remaining)}</strong></p>
                    )}
                  </div>

                  {/* Method */}
                  <div>
                    <label className={labelCls}>Method</label>
                    <select className={inputCls} value={payForm.method} onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}>
                      {["cash", "mpesa", "bank", "card", "other"].map((m) => (
                        <option key={m} value={m}>{m.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>

                  {/* Cashbook */}
                  <div>
                    <label className={labelCls}>Cashbook *</label>
                    <select className={inputCls} value={payForm.cashbookAccount} onChange={(e) => setPayForm((f) => ({ ...f, cashbookAccount: e.target.value }))} required>
                      <option value="">— Select —</option>
                      {cashbooks.map((cb) => (
                        <option key={cb._id} value={cb._id}>{cb.code ? `${cb.code} - ` : ""}{cb.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Date */}
                  <div>
                    <label className={labelCls}>Payment Date *</label>
                    <input className={inputCls} type="date" value={payForm.paymentDate} onChange={(e) => setPayForm((f) => ({ ...f, paymentDate: e.target.value }))} required />
                  </div>
                </div>

                {/* Reference / M-Pesa section */}
                {payForm.method === "mpesa" ? (
                  <div className="space-y-3">
                    {/* STK Push phone + button */}
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <label className={labelCls} style={{ marginBottom: 0 }}>
                          Customer Phone
                          <span className="ml-1 font-normal normal-case text-emerald-700">(STK push)</span>
                        </label>
                        {payTarget?.phone && payForm.phone === payTarget.phone && (
                          <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">From customer</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          className={`${inputCls} flex-1`}
                          type="tel"
                          value={payForm.phone}
                          onChange={(e) => setPayForm((f) => ({ ...f, phone: e.target.value }))}
                          placeholder="e.g. 0712345678"
                        />
                        <button
                          type="button"
                          onClick={sendStkPush}
                          disabled={stkPushing || !payForm.phone?.trim() || !Number(payForm.amount) || !payForm.job}
                          className="inline-flex shrink-0 items-center gap-1.5 border border-emerald-300 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          title="Send M-Pesa STK push to customer's phone"
                        >
                          <FaMobileAlt size={11} />
                          {stkPushing ? "Sending…" : "Push"}
                        </button>
                      </div>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {payForm.phone?.trim()
                          ? `Sends a KES ${Number(payForm.amount || 0).toLocaleString()} M-Pesa prompt to ${payForm.phone.trim()} — customer pays on their phone.`
                          : "Enter phone to enable STK push — customer gets a payment prompt instantly."}
                      </p>
                    </div>
                    {/* Transaction code after customer pays */}
                    <div>
                      <label className={labelCls}>M-Pesa Transaction Code</label>
                      <input
                        className={inputCls}
                        value={payForm.reference}
                        onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                        placeholder="e.g. QJK1234ABC — enter after customer pays"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className={labelCls}>Reference</label>
                    <input
                      className={inputCls}
                      value={payForm.reference}
                      onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                      placeholder={payForm.method === "cash" ? "Receipt note (optional)" : "Bank / card reference"}
                    />
                  </div>
                )}
              </form>
            )}
          </Modal>
        );
      })()}

      {/* ── Edit customer modal ─────────────────────────────────────────────── */}
      {editTarget && (
        <Modal
          title="Edit Customer"
          onClose={() => setEditTarget(null)}
          footer={
            <>
              <button type="button" onClick={() => setEditTarget(null)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="submit"
                form="cw-edit-customer-form"
                disabled={editSaving}
                className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"
              >
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
            </>
          }
        >
          <form id="cw-edit-customer-form" onSubmit={saveEdit} className="space-y-4">
            {/* Context: plates */}
            {(editTarget.plates || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {editTarget.plates.map((p) => (
                  <span key={p} className="rounded border border-slate-200 bg-[#F4F7F5] px-2.5 py-1 text-[10px] font-mono font-bold text-slate-700">
                    {p}
                  </span>
                ))}
              </div>
            )}
            <div>
              <label className={labelCls}>Full Name</label>
              <input
                className={inputCls}
                value={editForm.name}
                onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. John Kamau"
                autoFocus
              />
            </div>
            <div>
              <label className={labelCls}>Phone Number</label>
              <input
                className={inputCls}
                value={editForm.phone}
                onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))}
                placeholder="e.g. 0712345678"
                type="tel"
              />
              <p className="mt-1 text-[10px] text-slate-400">Used for SMS notifications and customer lookup</p>
            </div>
          </form>
        </Modal>
      )}

      {/* ── SMS modal ───────────────────────────────────────────────────────── */}
      {smsTarget && (
        <CwSmsModal
          target={{ _id: smsTarget._id, name: smsTarget.name, phone: smsTarget.phone || "" }}
          context="customer"
          onSend={sendSms}
          onClose={() => setSmsTarget(null)}
          sending={smsSending}
        />
      )}
    </CarWashShell>
  );
}

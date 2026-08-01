import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import { FaChevronDown, FaChevronRight, FaRedoAlt, FaSearch, FaSms, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, getActiveBranchId, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import CwSmsModal from "./CwSmsModal";
import AppSelect from "../../components/common/AppSelect";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import PaginationBar from "../../components/PaginationBar";
import { useTabState } from "../../hooks/useTabState";

// ─── Date helpers ─────────────────────────────────────────────────────────────
const isoDate = (d) => d.toISOString().slice(0, 10);

const quickRanges = () => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // Monday

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  return {
    today:     { dateFrom: isoDate(today),      dateTo: isoDate(today) },
    yesterday: { dateFrom: isoDate(yesterday),  dateTo: isoDate(yesterday) },
    week:      { dateFrom: isoDate(weekStart),  dateTo: isoDate(today) },
    month:     { dateFrom: isoDate(monthStart), dateTo: isoDate(today) },
  };
};

const defaultFilters = () => {
  const t = todayISO();
  return { dateFrom: t, dateTo: t, method: "", cashbookAccount: "", reference: "", reconciliationStatus: "" };
};

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 25;
const reconciliationStatuses = ["pending", "reconciled", "flagged"];
const paymentMethods = ["cash", "mpesa", "bank", "card", "other"];

const reconciliationBadgeClass = {
  pending:    "border-orange-200 bg-orange-50 text-orange-700",
  reconciled: "border-emerald-200 bg-emerald-50 text-emerald-700",
  flagged:    "border-red-200 bg-red-50 text-red-700",
};

// ─── Date range label ─────────────────────────────────────────────────────────
const formatDateRange = (dateFrom, dateTo) => {
  if (!dateFrom && !dateTo) return "All dates";
  const fmt = (s) => s ? new Date(s + "T00:00:00").toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "?";
  return dateFrom === dateTo ? fmt(dateFrom) : `${fmt(dateFrom)} → ${fmt(dateTo)}`;
};

// ─── Main component ───────────────────────────────────────────────────────────
const CarWashPayments = () => {
  const queryClient   = useQueryClient();
  const currentCompany = useSelector(selectCurrentCompany);
  const isConsolidated = !getActiveBranchId();
  const canReconcile   = useCarWashPermission("carwash-payments", "reconcile");

  const [filters,        setFilters]        = useTabState("/carwash/payments:filters", defaultFilters);
  const [appliedFilters, setAppliedFilters] = useTabState("/carwash/payments:appliedFilters", defaultFilters);
  const [expandedIds,    setExpandedIds]    = useState([]);
  const [page,           setPage]           = useTabState("/carwash/payments:page", 1);
  const [pageSize,       setPageSize]       = useTabState("/carwash/payments:pageSize", DEFAULT_PAGE_SIZE);
  const [smsTarget,      setSmsTarget]      = useState(null);
  const [smsBody,        setSmsBody]        = useState("");
  const [smsSending,     setSmsSending]     = useState(false);
  const reconcilingRef = useRef(new Set());

  // ── Payments query ────────────────────────────────────────────────────────
  const { data: paymentsData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ["cw-payments", appliedFilters, page, pageSize],
    queryFn:  () => carWashApi.listPayments({ ...appliedFilters, limit: pageSize, page }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  // ── Cashbooks reference query ─────────────────────────────────────────────
  const { data: cashbooksRaw } = useQuery({
    queryKey: ["cw-payment-cashbooks", currentCompany?._id],
    queryFn:  async () => {
      const accounts = await carWashApi.listChartOfAccounts({
        business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks",
      });
      return Array.isArray(accounts) ? accounts : [];
    },
    enabled:   !!currentCompany?._id,
    staleTime: 5 * 60_000,
  });

  useEffect(() => { if (error) toast.error("Failed to load payments"); }, [error]);
  useEffect(() => { setExpandedIds([]); }, [paymentsData]);

  const rows       = useMemo(() => normalizeListPayload(paymentsData, "payments"), [paymentsData]);
  const pagination = paymentsData?.pagination || { page, limit: pageSize, total: rows.length, pages: 1, totalAmount: 0 };
  const cashbooks  = cashbooksRaw ?? [];

  // Page-level stats (current page only)
  const pageStats = useMemo(() => {
    let pageTotal = 0, pendingCount = 0, reconciledCount = 0, flaggedCount = 0;
    for (const row of rows) {
      pageTotal += Number(row.amount || 0);
      const s = row.reconciliationStatus || "pending";
      if (s === "pending")    pendingCount++;
      else if (s === "reconciled") reconciledCount++;
      else if (s === "flagged")    flaggedCount++;
    }
    return { pageTotal, pendingCount, reconciledCount, flaggedCount };
  }, [rows]);

  const periodTotal = pagination.totalAmount ?? 0;

  // ── Filter helpers ────────────────────────────────────────────────────────
  const setF = useCallback((key, val) => setFilters(prev => ({ ...prev, [key]: val })), []);

  const applyQuickRange = useCallback((rangeKey) => {
    const ranges = quickRanges();
    const r = ranges[rangeKey];
    setFilters(prev => ({ ...prev, ...r }));
    setPage(1);
    setAppliedFilters(prev => ({ ...prev, ...r }));
  }, []);

  const applyFilters = (e) => {
    e.preventDefault();
    setPage(1);
    setAppliedFilters({ ...filters });
  };

  const resetFilters = () => {
    const d = defaultFilters();
    setFilters(d);
    setPage(1);
    setAppliedFilters(d);
  };

  // ── Row interactions ──────────────────────────────────────────────────────
  const toggleExpanded = useCallback((id) => {
    setExpandedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const updateReconciliation = async (row, status) => {
    const paymentId = row._id;
    if (reconcilingRef.current.has(paymentId)) return;
    reconcilingRef.current.add(paymentId);
    const note = status === "flagged"
      ? window.prompt("Reason for flagging this payment?", row.reconciliationNote || "") || ""
      : row.reconciliationNote || "";
    try {
      await carWashApi.updatePaymentReconciliation(paymentId, { reconciliationStatus: status, reconciliationNote: note });
      await queryClient.invalidateQueries({ queryKey: ["cw-payments"] });
      toast.success("Reconciliation updated");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Unable to update reconciliation");
    } finally {
      reconcilingRef.current.delete(paymentId);
    }
  };

  // ── SMS ───────────────────────────────────────────────────────────────────
  const resolvePhone = (row) => row.receivedFromPhone || row.job?.phone || "";

  const buildTemplates = useCallback((row) => {
    const name   = row.job?.customerName || "Customer";
    const amount = Number(row.amount || 0).toLocaleString();
    const num    = row.job?.jobNumber || "";
    const plate  = row.job?.plateNumber || "";
    return [
      { label: "Payment Confirmed", color: "green",  body: `Hi ${name}! Payment of KES ${amount} received for ${plate || num} wash. Thank you!` },
      { label: "Receipt",           color: "blue",   body: `Hi ${name}, your payment of KES ${amount} for car wash job ${num} has been received. Balance cleared. Thank you!` },
      { label: "Partial Payment",   color: "amber",  body: `Hi ${name}, we received KES ${amount} toward job ${num}. Please pay the remaining balance. Thank you!` },
    ];
  }, []);

  const openSmsModal = useCallback((row) => {
    setSmsTarget(row);
    const name   = row.job?.customerName || "Customer";
    const amount = Number(row.amount || 0).toLocaleString();
    const plate  = row.job?.plateNumber || "";
    const num    = row.job?.jobNumber || "";
    setSmsBody(`Hi ${name}! Payment of KES ${amount} received for ${plate || num} wash. Thank you!`);
  }, []);

  const sendSms = async (phone, body) => {
    if (!smsTarget) return;
    if (!phone) { toast.error("No phone number available for this payment"); return; }
    setSmsSending(true);
    try {
      await carWashApi.sendPaymentSms(smsTarget._id, { phone, body });
      toast.success("SMS sent successfully");
      setSmsTarget(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send SMS");
    } finally {
      setSmsSending(false);
    }
  };

  // ── Quick-pick active state ────────────────────────────────────────────────
  const ranges = quickRanges();
  const activeQuick = useMemo(() => {
    const { dateFrom: af, dateTo: at } = appliedFilters;
    return Object.entries(ranges).find(([, r]) => r.dateFrom === af && r.dateTo === at)?.[0] || null;
  }, [appliedFilters]);

  const quickBtn = (key, label) => (
    <button
      key={key}
      type="button"
      onClick={() => applyQuickRange(key)}
      className={`h-8 px-2.5 text-[11px] font-bold border transition ${
        activeQuick === key
          ? "border-[#0B3B2E] bg-[#0B3B2E] text-white"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );

  const colCount = isConsolidated ? 10 : 9;

  return (
    <CarWashShell
      title="Payments Register"
      action={
        <button type="button" onClick={() => refetch()} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
          <FaRedoAlt className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      }
    >
      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <form
        onSubmit={applyFilters}
        className="mb-2 flex-shrink-0 space-y-1.5 border border-slate-200 bg-white p-2 shadow-sm"
      >
        {/* Row 1: date range + quick picks */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500 whitespace-nowrap">From</span>
            <input
              type="date"
              className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
              value={filters.dateFrom}
              onChange={e => setF("dateFrom", e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500 whitespace-nowrap">To</span>
            <input
              type="date"
              className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
              value={filters.dateTo}
              min={filters.dateFrom}
              onChange={e => setF("dateTo", e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1">
            {quickBtn("today",     "Today")}
            {quickBtn("yesterday", "Yesterday")}
            {quickBtn("week",      "This Week")}
            {quickBtn("month",     "This Month")}
          </div>
          {(filters.dateFrom !== appliedFilters.dateFrom || filters.dateTo !== appliedFilters.dateTo) && (
            <span className="text-[10px] font-semibold text-amber-600">— press Search to apply</span>
          )}
        </div>

        {/* Row 2: method, cashbook, reconciliation, reference, actions */}
        <div className="flex flex-wrap items-center gap-1.5">
          <AppSelect
            size="sm"
            clearable
            placeholder="All methods"
            value={filters.method}
            onChange={(v) => setF("method", v ?? "")}
            options={paymentMethods.map(m => ({ value: m, label: m.toUpperCase() }))}
          />
          <AppSelect
            size="sm"
            clearable
            searchable
            placeholder="All cashbooks"
            value={filters.cashbookAccount}
            onChange={(v) => setF("cashbookAccount", v ?? "")}
            options={cashbooks.map(a => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
          />
          <AppSelect
            size="sm"
            clearable
            placeholder="All reconciliation"
            value={filters.reconciliationStatus}
            onChange={(v) => setF("reconciliationStatus", v ?? "")}
            options={reconciliationStatuses.map(s => ({ value: s, label: s.toUpperCase() }))}
          />
          <input
            className="h-8 flex-1 min-w-[140px] border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
            placeholder="Reference / receipt code"
            value={filters.reference}
            onChange={e => setF("reference", e.target.value)}
          />
          <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00] whitespace-nowrap">
            <FaSearch /> Search
          </button>
          <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127] whitespace-nowrap">
            <FaTimes /> Reset
          </button>
        </div>
      </form>

      <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">

        {/* ── Info bar ─────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex flex-wrap min-h-8 items-center gap-x-4 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing: <strong className="text-[#0B3B2E]">{rows.length}</strong> / {pagination.total}</span>
          <span>Page: <strong className="text-[#0B3B2E]">{pagination.page}</strong> / {pagination.pages}</span>
          <span className="border-l border-slate-300 pl-4">
            Page total: <strong className="text-[#0B3B2E]">{formatMoney(pageStats.pageTotal)}</strong>
          </span>
          {pagination.pages > 1 && (
            <span>Period total: <strong className="text-emerald-700">{formatMoney(periodTotal)}</strong></span>
          )}
          <span className="border-l border-slate-300 pl-4">
            Date: <strong className="normal-case text-slate-900">{formatDateRange(appliedFilters.dateFrom, appliedFilters.dateTo)}</strong>
          </span>
          <span className="ml-auto flex items-center gap-3">
            {pageStats.pendingCount > 0    && <span>Pending: <strong className="text-[#FF8C00]">{pageStats.pendingCount}</strong></span>}
            {pageStats.reconciledCount > 0 && <span>Reconciled: <strong className="text-emerald-700">{pageStats.reconciledCount}</strong></span>}
            {pageStats.flaggedCount > 0    && <span>Flagged: <strong className="text-red-700">{pageStats.flaggedCount}</strong></span>}
          </span>
        </div>

        {/* ── Mobile list ───────────────────────────────────────────────────── */}
        <div className="sm:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-200">
          {rows.length ? rows.map((row) => {
            const expanded = expandedIds.includes(row._id);
            const phone    = resolvePhone(row);
            const status   = row.reconciliationStatus || "pending";
            return (
              <React.Fragment key={row._id}>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-extrabold text-slate-900">{row.job?.jobNumber || "-"}</span>
                        <span className="font-bold uppercase text-slate-700">{row.method || "-"}</span>
                        <span className={`inline-flex border px-1.5 py-0.5 text-[10px] font-bold uppercase ${reconciliationBadgeClass[status] || reconciliationBadgeClass.pending}`}>{status}</span>
                      </div>
                      <div className="mt-0.5 font-bold uppercase text-slate-800">{row.job?.plateNumber || "-"}</div>
                      {row.job?.customerName && <div className="text-xs text-slate-500">{row.job.customerName}</div>}
                      {row.paymentDate && <div className="text-[10px] text-slate-400">{new Date(row.paymentDate).toLocaleDateString("en-GB")}</div>}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className="font-extrabold text-slate-900">{formatMoney(row.amount)}</div>
                      {canReconcile ? (
                        <AppSelect
                          size="sm"
                          value={status}
                          onChange={(v) => updateReconciliation(row, v ?? "pending")}
                          className={`mt-1 ${reconciliationBadgeClass[status] || reconciliationBadgeClass.pending}`}
                          options={reconciliationStatuses.map(s => ({ value: s, label: s.toUpperCase() }))}
                        />
                      ) : (
                        <span className={`mt-1 inline-flex border px-1.5 py-0.5 text-[10px] font-bold uppercase ${reconciliationBadgeClass[status] || reconciliationBadgeClass.pending}`}>{status}</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {phone && (
                      <button type="button" onClick={() => openSmsModal(row)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-xs font-bold text-[#0B3B2E]">
                        <FaSms /> SMS
                      </button>
                    )}
                    <button type="button" onClick={() => toggleExpanded(row._id)} className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">
                      {expanded ? <FaChevronDown className="text-[9px]" /> : <FaChevronRight className="text-[9px]" />} Details
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-2 space-y-1 rounded border border-slate-200 bg-[#F8FBF9] p-2 text-[11px] text-slate-600">
                      <div><span className="font-extrabold uppercase text-slate-500">Time:</span> {row.paymentDate ? new Date(row.paymentDate).toLocaleString("en-KE") : "-"}</div>
                      <div><span className="font-extrabold uppercase text-slate-500">Reference:</span> {row.reference || "-"}</div>
                      <div><span className="font-extrabold uppercase text-slate-500">Cashbook:</span> {row.cashbookAccount ? `${row.cashbookAccount.code} - ${row.cashbookAccount.name}` : "-"}</div>
                      {row.receivedFromPhone && <div><span className="font-extrabold uppercase text-slate-500">M-Pesa Phone:</span> {row.receivedFromPhone}</div>}
                      {row.reconciliationNote && <div><span className="font-extrabold uppercase text-slate-500">Note:</span> {row.reconciliationNote}</div>}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          }) : (
            <div className="py-10 text-center text-xs font-semibold text-slate-500">No payments found for the selected filters.</div>
          )}
        </div>

        {/* ── Desktop table ─────────────────────────────────────────────────── */}
        <div className="hidden sm:flex sm:flex-col sm:flex-1 sm:min-h-0 sm:overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <table className="w-full min-w-[1100px] text-xs">
              <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                <tr>
                  <th className="w-8 px-2 py-1.5 text-left" />
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Date</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Job</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Plate</th>
                  {isConsolidated && <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Branch</th>}
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Method</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Cashbook</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Reference</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Reconciliation</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((row) => {
                  const expanded = expandedIds.includes(row._id);
                  const status   = row.reconciliationStatus || "pending";
                  const phone    = resolvePhone(row);
                  return (
                    <React.Fragment key={row._id}>
                      <tr className="border-b border-slate-200 hover:bg-slate-50">
                        <td className="px-2 py-1">
                          <button type="button" onClick={() => toggleExpanded(row._id)} className="text-[#0B3B2E] hover:text-[#FF8C00]">
                            {expanded ? <FaChevronDown /> : <FaChevronRight />}
                          </button>
                        </td>
                        <td className="px-2 py-1 text-slate-700 whitespace-nowrap">
                          {row.paymentDate ? new Date(row.paymentDate).toLocaleDateString("en-GB") : "-"}
                        </td>
                        <td className="px-2 py-1 font-extrabold text-slate-900">{row.job?.jobNumber || "-"}</td>
                        <td className="px-2 py-1 font-bold uppercase text-slate-800">{row.job?.plateNumber || "-"}</td>
                        {isConsolidated && (
                          <td className="px-2 py-1 text-slate-600">{row.branch?.name || <span className="text-slate-400">—</span>}</td>
                        )}
                        <td className="px-2 py-1 font-bold text-slate-700">{row.method?.toUpperCase() || "-"}</td>
                        <td className="px-2 py-1 font-semibold text-slate-700">{row.cashbookAccount ? `${row.cashbookAccount.code} - ${row.cashbookAccount.name}` : "-"}</td>
                        <td className="px-2 py-1 text-slate-600">{row.reference || "-"}</td>
                        <td className="px-2 py-1">
                          {canReconcile ? (
                            <AppSelect
                              size="sm"
                              value={status}
                              onChange={(v) => updateReconciliation(row, v ?? "pending")}
                              className={reconciliationBadgeClass[status] || reconciliationBadgeClass.pending}
                              options={reconciliationStatuses.map(s => ({ value: s, label: s.toUpperCase() }))}
                            />
                          ) : (
                            <span className={`inline-flex border px-2 py-0.5 text-[11px] font-bold uppercase ${reconciliationBadgeClass[status] || reconciliationBadgeClass.pending}`}>
                              {status}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right font-extrabold tabular-nums text-slate-900">{formatMoney(row.amount)}</td>
                      </tr>

                      {expanded && (
                        <tr className="border-b border-slate-200 bg-[#F8FBF9]">
                          <td colSpan={colCount} className="px-10 py-3 text-[11px] text-slate-600">
                            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                              <div>
                                <span className="font-extrabold uppercase text-slate-400">Time</span>
                                <div className="mt-0.5 font-semibold">{row.paymentDate ? new Date(row.paymentDate).toLocaleString("en-KE") : "-"}</div>
                              </div>
                              <div>
                                <span className="font-extrabold uppercase text-slate-400">Customer</span>
                                <div className="mt-0.5 flex items-center gap-2">
                                  <span className="font-semibold">{row.job?.customerName || "-"}</span>
                                  {phone && (
                                    <button
                                      type="button"
                                      onClick={() => openSmsModal(row)}
                                      className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
                                    >
                                      <FaSms /> SMS
                                      {row.receivedFromPhone && (
                                        <span className="rounded bg-emerald-100 px-1 text-[9px] font-black text-emerald-700">M-Pesa</span>
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div>
                                <span className="font-extrabold uppercase text-slate-400">Service</span>
                                <div className="mt-0.5 font-semibold">{row.job?.serviceName || "-"}</div>
                              </div>
                              <div>
                                <span className="font-extrabold uppercase text-slate-400">Job Status</span>
                                <div className="mt-0.5 font-semibold capitalize">{row.job?.status || "-"}</div>
                              </div>
                              <div>
                                <span className="font-extrabold uppercase text-slate-400">Received By</span>
                                <div className="mt-0.5 font-semibold">{row.receivedBy?.name || row.receivedBy?.username || row.receivedBy?.email || "-"}</div>
                              </div>
                              <div>
                                <span className="font-extrabold uppercase text-slate-400">Cashbook</span>
                                <div className="mt-0.5 font-semibold">{row.cashbookAccount ? `${row.cashbookAccount.code} - ${row.cashbookAccount.name}` : "-"}</div>
                              </div>
                              {row.receivedFromPhone && (
                                <div>
                                  <span className="font-extrabold uppercase text-slate-400">M-Pesa Phone</span>
                                  <div className="mt-0.5 font-semibold">{row.receivedFromPhone}</div>
                                </div>
                              )}
                              <div>
                                <span className="font-extrabold uppercase text-slate-400">Reviewed By</span>
                                <div className="mt-0.5 font-semibold">{row.reconciledBy?.name || row.reconciledBy?.username || row.reconciledBy?.email || "-"}</div>
                              </div>
                              <div>
                                <span className="font-extrabold uppercase text-slate-400">Reviewed At</span>
                                <div className="mt-0.5 font-semibold">{row.reconciledAt ? new Date(row.reconciledAt).toLocaleString("en-KE") : "-"}</div>
                              </div>
                              {row.reconciliationNote && (
                                <div className="sm:col-span-3 lg:col-span-5">
                                  <span className="font-extrabold uppercase text-slate-400">Reconciliation Note</span>
                                  <div className="mt-0.5 font-semibold">{row.reconciliationNote}</div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                }) : (
                  <tr>
                    <td colSpan={colCount} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">
                      No payments found for the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <PaginationBar
          page={pagination.page}
          pages={pagination.pages}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          loading={loading}
        />
      </div>

      {smsTarget && (
        <CwSmsModal
          target={{ _id: smsTarget._id, name: smsTarget.job?.customerName, phone: resolvePhone(smsTarget) }}
          defaultBody={smsBody}
          templates={buildTemplates(smsTarget)}
          context={`Payment · ${smsTarget.job?.jobNumber || ""}${smsTarget.receivedFromPhone ? ` · M-Pesa: ${smsTarget.receivedFromPhone}` : ""}`}
          onSend={sendSms}
          onClose={() => setSmsTarget(null)}
          sending={smsSending}
        />
      )}
    </CarWashShell>
  );
};

export default CarWashPayments;

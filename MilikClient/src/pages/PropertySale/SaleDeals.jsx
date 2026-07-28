import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import {
  FaBan, FaBuilding, FaCalendarAlt, FaCheck, FaEdit, FaEnvelope, FaFileAlt, FaHandshake, FaLink, FaMoneyBillWave,
  FaPlus, FaPrint, FaRedoAlt, FaSearch, FaSms, FaTimes, FaTrash, FaUser,
} from "react-icons/fa";
import CwSmsModal from "../CarWash/CwSmsModal";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch, FilterSelect, FilterDateRange } from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import { saleApi, fmtKES, todayISO } from "../../services/propertySaleApi";
import AmountInput from "./AmountInput";
import { useConfirm } from "../../context/ConfirmContext";
import { useTabState } from "../../hooks/useTabState";

const PAGE_SIZE = 25;

const statusBadge = (status) => ({
  active:    "border-[#B7C9C0] bg-[#F1F6F3] text-[#0B3B2E]",
  closed:    "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-slate-200 bg-slate-50 text-slate-500",
}[status] || "border-slate-200 bg-slate-50 text-slate-500");

const blankDealForm = {
  listing: "", buyer: "", agent: "", agreedPrice: "",
  dealDate: todayISO(), expectedClosingDate: "", notes: "",
  commOverrideEnabled: false, commissionRateOverride: "", commissionTypeOverride: "", commissionAmountOverride: "",
};

const PAYMENT_TYPES   = ["deposit", "installment", "final_payment", "other"];
const PAYMENT_METHODS = ["cash", "mpesa", "bank_transfer", "cheque", "other"];
const fmtLabel        = (s) => (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const blankPayForm    = { amount: "", paymentType: "installment", paymentMethod: "bank_transfer", reference: "", paymentDate: todayISO(), notes: "" };

const Modal = ({ title, subtitle, headerCls = "bg-[#0B3B2E]", children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
    <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-2xl sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
      <div className={`flex-shrink-0 flex items-start justify-between gap-3 border-b border-slate-200 ${headerCls} px-4 py-3 text-white rounded-t-2xl sm:rounded-none`}>
        <div>
          <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs font-semibold text-white/70">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
      {footer && <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>}
    </div>
  </div>
);

const inputCls = "h-8 w-full border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:border-[#0B3B2E] focus:outline-none";
const labelCls = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

const SaleDeals = () => {
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const currentUser    = useSelector((s) => s.auth?.currentUser);

  const [saving,         setSaving]         = useState(false);
  const [actionKey,      setActionKey]      = useState("");
  const [showModal,      setShowModal]      = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showCancelModal,setShowCancelModal]= useState(false);
  const [editingId,      setEditingId]      = useState("");
  const [form,           setForm]           = useState(blankDealForm);
  const [closingDeal,    setClosingDeal]    = useState(null);
  const [closeForm,      setCloseForm]      = useState({ actualClosingDate: todayISO(), titleTransferDate: "", handoverNotes: "" });
  const [cancellingDeal, setCancellingDeal] = useState(null);
  const [cancelReason,   setCancelReason]   = useState("");
  const [search,         setSearch]         = useTabState("/sale/deals:search", "");
  const [appliedSearch,  setAppliedSearch]  = useTabState("/sale/deals:appliedSearch", "");
  const [statusFilter,   setStatusFilter]   = useTabState("/sale/deals:statusFilter", "");
  const [agentFilt,      setAgentFilt]      = useTabState("/sale/deals:agentFilt", "");
  const [buyerFilt,      setBuyerFilt]      = useTabState("/sale/deals:buyerFilt", "");
  const [listingFilt,    setListingFilt]    = useTabState("/sale/deals:listingFilt", "");
  const [dateFrom,       setDateFrom]       = useTabState("/sale/deals:dateFrom", "");
  const [dateTo,         setDateTo]         = useTabState("/sale/deals:dateTo", "");
  const [page,           setPage]           = useTabState("/sale/deals:page", 1);
  const [pageSize,       setPageSize]       = useTabState("/sale/deals:pageSize", PAGE_SIZE);

  const [showPayModal,   setShowPayModal]   = useState(false);
  const [payingDeal,     setPayingDeal]     = useState(null);
  const [payForm,        setPayForm]        = useState(blankPayForm);
  const [payingSave,     setPayingSave]     = useState(false);
  const [selected,       setSelected]       = useTabState("/sale/deals:selected", null);
  const [smsTarget,      setSmsTarget]      = useState(null);
  const [smsSending,     setSmsSending]     = useState(false);
  const [emailTarget,    setEmailTarget]    = useState(null);
  const [emailForm,      setEmailForm]      = useState({ subject: "", body: "" });
  const [emailSending,   setEmailSending]   = useState(false);

  const [showScheduleBuilder, setShowScheduleBuilder] = useState(false);
  const [scheduleItems,       setScheduleItems]       = useState([]);
  const [scheduleSaving,      setScheduleSaving]      = useState(false);
  const [linkingInstallment,  setLinkingInstallment]  = useState(null);

  const biz = currentCompany?._id;

  const { data: dealsData, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-deals", biz, appliedSearch, statusFilter, agentFilt, buyerFilt, listingFilt, dateFrom, dateTo, page, pageSize],
    queryFn:  () => saleApi.listDeals({ business: biz, search: appliedSearch, status: statusFilter, agentId: agentFilt, buyerId: buyerFilt, listingId: listingFilt, dateFrom, dateTo, page, limit: pageSize }),
    enabled:  !!biz,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const { data: listingsData } = useQuery({
    queryKey: ["sale-listings-ref", biz],
    queryFn:  () => saleApi.listListings({ business: biz, limit: 500 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });
  const { data: buyersData } = useQuery({
    queryKey: ["sale-buyers-ref", biz],
    queryFn:  () => saleApi.listBuyers({ business: biz, limit: 500 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });
  const { data: agentsData } = useQuery({
    queryKey: ["sale-agents-ref", biz],
    queryFn:  () => saleApi.listAgents({ business: biz, status: "active", limit: 500 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });

  const { data: dealPmtsData, isLoading: loadingDealPmts } = useQuery({
    queryKey: ["deal-detail-payments", selected?._id],
    queryFn:  () => saleApi.listPayments({ deal: selected._id, limit: 200 }),
    enabled:  !!selected?._id,
    staleTime: 30_000,
  });
  const { data: dealCommData } = useQuery({
    queryKey: ["deal-detail-commission", selected?._id],
    queryFn:  () => saleApi.listCommissions({ business: biz, deal: selected._id }),
    enabled:  !!selected?._id,
    staleTime: 30_000,
  });

  const { data: dealScheduleData } = useQuery({
    queryKey: ["deal-detail-schedule", selected?._id],
    queryFn:  () => saleApi.listSchedule({ dealId: selected._id }),
    enabled:  !!selected?._id,
    staleTime: 30_000,
  });

  const deals      = dealsData?.data ?? [];
  const total      = dealsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const listings   = listingsData?.data ?? [];
  const buyers     = buyersData?.data   ?? [];
  const agents     = agentsData?.data   ?? [];

  const dealPmts    = (dealPmtsData?.data ?? []).filter((p) => p.status === "paid");
  const dealComm    = (dealCommData?.data ?? [])[0] ?? null;
  const dealSchedule= dealScheduleData?.data ?? [];
  const fmtDate    = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sale-deals", biz] });
    queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] });
  };

  const openScheduleBuilder = (deal) => {
    const existing = dealScheduleData?.data ?? [];
    if (existing.length > 0) {
      setScheduleItems(existing.map((i) => ({
        dueDate:        i.dueDate ? new Date(i.dueDate).toISOString().slice(0, 10) : "",
        expectedAmount: String(i.expectedAmount),
        description:    i.description || "",
      })));
    } else {
      setScheduleItems([{ dueDate: "", expectedAmount: "", description: "Deposit" }]);
    }
    setShowScheduleBuilder(true);
  };

  const handleSaveSchedule = async () => {
    if (!selected) return;
    const items = scheduleItems.filter((i) => i.dueDate && Number(i.expectedAmount) > 0);
    if (items.length === 0) return toast.warning("Add at least one installment with a date and amount");
    setScheduleSaving(true);
    try {
      await saleApi.setSchedule({ dealId: selected._id, items });
      queryClient.invalidateQueries({ queryKey: ["deal-detail-schedule", selected._id] });
      setShowScheduleBuilder(false);
      toast.success("Payment schedule saved");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save schedule");
    } finally {
      setScheduleSaving(false);
    }
  };

  const handleLinkPayment = async (scheduleItemId, paymentId) => {
    try {
      await saleApi.linkPaymentToSchedule(scheduleItemId, { paymentId });
      queryClient.invalidateQueries({ queryKey: ["deal-detail-schedule", selected._id] });
      setLinkingInstallment(null);
      toast.success("Payment linked to installment");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to link payment");
    }
  };

  const openCreate = () => { setEditingId(""); setForm(blankDealForm); setShowModal(true); };
  const openEdit   = (row) => {
    setEditingId(row._id);
    setForm({
      listing: row.listing?._id || row.listing || "",
      buyer:   row.buyer?._id   || row.buyer   || "",
      agent:   row.agent?._id   || row.agent   || "",
      agreedPrice:         row.agreedPrice || "",
      dealDate:            row.dealDate ? new Date(row.dealDate).toISOString().split("T")[0] : todayISO(),
      expectedClosingDate: row.expectedClosingDate ? new Date(row.expectedClosingDate).toISOString().split("T")[0] : "",
      notes:               row.notes || "",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.listing) return toast.warning("Select a listing");
    if (!form.buyer)   return toast.warning("Select a buyer");
    if (!form.agreedPrice || Number(form.agreedPrice) <= 0) return toast.warning("Valid agreed price required");
    setSaving(true);
    try {
      const { commOverrideEnabled, commissionRateOverride, commissionTypeOverride, commissionAmountOverride, ...baseForm } = form;
      const payload = { ...baseForm, business: biz, agreedPrice: Number(form.agreedPrice), agent: form.agent || undefined, expectedClosingDate: form.expectedClosingDate || undefined };
      if (!editingId && form.agent && commOverrideEnabled) {
        if (commissionRateOverride !== "") payload.commissionRateOverride = Number(commissionRateOverride);
        if (commissionTypeOverride !== "") payload.commissionTypeOverride = commissionTypeOverride;
        if (commissionAmountOverride !== "") payload.commissionAmountOverride = Number(commissionAmountOverride);
      }
      if (editingId) await saleApi.updateDeal(editingId, payload);
      else await saleApi.createDeal(payload);
      invalidate();
      setShowModal(false);
      toast.success(`Deal ${editingId ? "updated" : "created"}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save deal");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = async () => {
    if (!closingDeal) return;
    setActionKey(`${closingDeal._id}:close`);
    try {
      await saleApi.closeDeal(closingDeal._id, { ...closeForm, business: biz });
      invalidate();
      setShowCloseModal(false);
      setClosingDeal(null);
      toast.success("Deal closed");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to close deal");
    } finally {
      setActionKey("");
    }
  };

  const handleCancel = async () => {
    if (!cancellingDeal) return;
    setActionKey(`${cancellingDeal._id}:cancel`);
    try {
      await saleApi.cancelDeal(cancellingDeal._id, { cancellationReason: cancelReason, business: biz });
      invalidate();
      setShowCancelModal(false);
      setCancellingDeal(null);
      toast.success("Deal cancelled");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to cancel deal");
    } finally {
      setActionKey("");
    }
  };

  const handleDelete = async (row) => {
    if (!await confirm({ title: "Delete Deal", message: `Permanently delete deal ${row.dealNumber}? All associated pending payments and commissions will also be removed.`, confirmText: "Delete", isDangerous: true })) return;
    setActionKey(`${row._id}:delete`);
    try {
      await saleApi.deleteDeal(row._id);
      invalidate();
      toast.success("Deal deleted");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to delete deal");
    } finally {
      setActionKey("");
    }
  };

  const handleRecordPayment = async () => {
    if (!payingDeal) return;
    if (!payForm.amount || Number(payForm.amount) <= 0) return toast.warning("Valid amount required");
    setPayingSave(true);
    try {
      const payment = await saleApi.createPayment({
        ...payForm, deal: payingDeal._id, business: biz, amount: Number(payForm.amount),
      });
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-payments", biz] });
      queryClient.invalidateQueries({ queryKey: ["deal-detail-payments", payingDeal._id] });
      setShowPayModal(false);
      setPayForm(blankPayForm);
      toast.success("Payment recorded");
      window.open(`/sale/payments/${payment._id}/receipt`, "_blank");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record payment");
    } finally {
      setPayingSave(false);
    }
  };

  const handleSendSms = async (phone, body) => {
    if (!smsTarget) return;
    setSmsSending(true);
    try {
      await saleApi.sendDealSms(smsTarget._id, { phone, body });
      toast.success("SMS sent");
      setSmsTarget(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send SMS");
    } finally {
      setSmsSending(false);
    }
  };

  const handleSendDealEmail = async () => {
    if (!emailTarget?.buyer?.email) { toast.warn("Buyer has no email address"); return; }
    if (!emailForm.subject.trim() || !emailForm.body.trim()) { toast.warn("Subject and message are required"); return; }
    setEmailSending(true);
    try {
      await saleApi.sendDealEmail(emailTarget._id, { to: emailTarget.buyer.email, ...emailForm });
      toast.success("Email sent");
      setEmailTarget(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send email");
    } finally {
      setEmailSending(false);
    }
  };


  const applySearch = (e) => { e.preventDefault(); setAppliedSearch(search); setPage(1); };
  const resetFilters = () => { setSearch(""); setAppliedSearch(""); setStatusFilter(""); setAgentFilt(""); setBuyerFilt(""); setListingFilt(""); setDateFrom(""); setDateTo(""); setPage(1); };

  return (
    <PropertySaleShell
      title="Deals & Transactions"
      subtitle={`${total} deal(s)`}
      action={
        <>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-deals", biz] })}
            className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt size={9} className={isFetching ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]"
          >
            <FaPlus size={9} /> New Deal
          </button>
        </>
      }
    >
      <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <SaleFilterBar
        onSubmit={applySearch}
        onReset={resetFilters}
        activeCount={[appliedSearch, statusFilter, agentFilt, buyerFilt, listingFilt, dateFrom, dateTo].filter(Boolean).length}
      >
        <FilterSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Deal no. / property / buyer"
        />
        <button type="submit" className="inline-flex h-8 shrink-0 items-center gap-1.5 border border-[#C8511A] bg-[#C8511A] px-3 text-xs font-bold text-white hover:bg-[#a84115]">
          <FaSearch size={9} /> Search
        </button>
        <FilterSelect value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
          <option value="cancelled">Cancelled</option>
        </FilterSelect>
        <FilterSelect value={agentFilt} onChange={(e) => { setAgentFilt(e.target.value); setPage(1); }}>
          <option value="">All Agents</option>
          {agents.map((a) => <option key={a._id} value={a._id}>{a.fullName}{a.agentNumber ? ` (${a.agentNumber})` : ""}</option>)}
        </FilterSelect>
        <FilterSelect value={buyerFilt} onChange={(e) => { setBuyerFilt(e.target.value); setPage(1); }}>
          <option value="">All Buyers</option>
          {buyers.map((b) => <option key={b._id} value={b._id}>{b.fullName}{b.buyerNumber ? ` (${b.buyerNumber})` : ""}</option>)}
        </FilterSelect>
        <FilterSelect value={listingFilt} onChange={(e) => { setListingFilt(e.target.value); setPage(1); }}>
          <option value="">All Listings</option>
          {listings.map((l) => <option key={l._id} value={l._id}>{l.listingNumber} — {l.title}</option>)}
        </FilterSelect>
        <FilterDateRange
          from={dateFrom} to={dateTo}
          onFromChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          onToChange={(e) => { setDateTo(e.target.value); setPage(1); }}
        />
      </SaleFilterBar>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className={`flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm transition-all ${selected ? "mr-[364px]" : ""}`}>
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full min-w-[780px] text-xs">
            <thead>
              <tr className="bg-[#0B3B2E]">
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Deal No.</th>
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Property</th>
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Buyer</th>
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Agent</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Agreed Price</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Paid</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Balance</th>
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Status</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-xs font-semibold text-slate-400">Loading deals…</td></tr>
              ) : deals.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-xs font-semibold text-slate-400">No deals found.</td></tr>
              ) : deals.map((row) => {
                const balance = row.agreedPrice - (row.totalPaid || 0);
                const pct = row.agreedPrice > 0 ? Math.min(100, Math.round(((row.totalPaid || 0) / row.agreedPrice) * 100)) : 0;
                return (
                  <tr
                    key={row._id}
                    onClick={() => setSelected(selected?._id === row._id ? null : row)}
                    className={`border-b border-slate-100 cursor-pointer ${selected?._id === row._id ? "bg-[#F1F6F3] border-l-2 border-l-[#0B3B2E]" : "hover:bg-[#F1F6F3]"}`}
                  >
                    <td className="px-3 py-2 font-mono font-bold text-[#0B3B2E]">{row.dealNumber}</td>
                    <td className="px-3 py-2">
                      <div className="max-w-[140px] truncate font-semibold text-slate-800">{row.listing?.title || "—"}</div>
                      <div className="text-[10px] text-slate-400">{row.listing?.listingNumber}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-800">{row.buyer?.fullName || "—"}</div>
                      <div className="text-[10px] text-slate-400">{row.buyer?.buyerNumber}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{row.agent?.fullName || <span className="italic text-slate-400">None</span>}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="font-bold text-slate-900">{fmtKES(row.agreedPrice)}</div>
                      <div className="mt-0.5 h-1 w-full overflow-hidden bg-slate-100">
                        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-700">{fmtKES(row.totalPaid || 0)}</td>
                    <td className={`px-3 py-2 text-right font-black ${balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>{fmtKES(balance)}</td>
                    <td className="px-3 py-2">
                      <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${statusBadge(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-1">
                        <button type="button" onClick={() => window.open(`/sale/deals/${row._id}/summary`, "_blank")} title="Print Agreement Cover" className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                          <FaPrint className="text-[9px]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => window.open(`/sale/deals/${row._id}/statement`, "_blank")}
                          title="Statement of Account"
                          className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
                        >
                          <FaFileAlt className="text-[9px]" />
                        </button>
                        {row.status === "active" && (
                          <>
                            <button
                              type="button"
                              onClick={() => { setPayingDeal(row); setPayForm(blankPayForm); setShowPayModal(true); }}
                              className="border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                            >
                              <FaMoneyBillWave className="text-[9px]" /> Pay
                            </button>
                            <button type="button" onClick={() => openEdit(row)} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                              <FaEdit className="text-[9px]" />
                            </button>
                            <button
                              type="button"
                              onClick={() => { setClosingDeal(row); setCloseForm({ actualClosingDate: todayISO(), titleTransferDate: "", handoverNotes: "" }); setShowCloseModal(true); }}
                              className="border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                            >
                              <FaCheck className="text-[9px]" /> Close
                            </button>
                            <button
                              type="button"
                              onClick={() => { setCancellingDeal(row); setCancelReason(""); setShowCancelModal(true); }}
                              className="border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600 hover:bg-rose-100"
                            >
                              <FaBan className="text-[9px]" />
                            </button>
                          </>
                        )}
                        {row.status === "cancelled" && (
                          <button type="button" onClick={() => handleDelete(row)} disabled={!!actionKey} className="border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">
                            <FaTimes className="text-[9px]" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <PaginationBar page={page} pages={totalPages} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} />
      </div>

      {selected && (
        <div className="absolute inset-0 z-[5]" onClick={() => setSelected(null)} />
      )}

      {/* ── Deal Detail Panel ─────────────────────────────────────────────── */}
      {selected && (
        <div className="absolute right-0 top-0 bottom-0 w-[360px] flex flex-col bg-white border-l border-slate-200 shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex-shrink-0 flex items-start justify-between gap-2 bg-[#0B3B2E] px-4 py-3 text-white">
            <div className="min-w-0">
              <div className="font-black text-sm leading-tight font-mono">{selected.dealNumber}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${statusBadge(selected.status)}`}>{selected.status}</span>
                <span className="text-[10px] text-white/60">{fmtDate(selected.dealDate)}</span>
              </div>
            </div>
            <button onClick={() => setSelected(null)} className="flex-shrink-0 p-1 text-white/70 hover:bg-white/10 hover:text-white"><FaTimes size={13} /></button>
          </div>

          {/* Buyer + Property */}
          <div className="flex-shrink-0 border-b border-slate-100 px-4 py-3 space-y-1.5 text-xs">
            <div className="flex items-center gap-2 text-slate-700">
              <FaUser size={9} className="text-slate-400 flex-shrink-0" />
              <span className="font-semibold">{selected.buyer?.fullName || "—"}</span>
              {selected.buyer?.buyerNumber && <span className="text-slate-400 font-mono text-[10px]">{selected.buyer.buyerNumber}</span>}
            </div>
            {selected.buyer?.phone && <div className="pl-4 text-[10px] text-slate-500">{selected.buyer.phone}</div>}
            <div className="flex items-center gap-2 text-slate-700 mt-1">
              <FaBuilding size={9} className="text-slate-400 flex-shrink-0" />
              <span className="font-semibold truncate">{selected.listing?.title || "—"}</span>
            </div>
            {selected.listing?.listingNumber && <div className="pl-4 text-[10px] font-mono text-slate-400">{selected.listing.listingNumber}</div>}
            {selected.agent && <div className="text-[10px] text-slate-500 pt-0.5">Agent: <span className="font-semibold text-slate-700">{selected.agent.fullName}</span></div>}
          </div>

          {/* Financial summary */}
          <div className="flex-shrink-0 border-b border-slate-100">
            <div className="grid grid-cols-3 border-b border-slate-100">
              {[
                { label: "Agreed", value: fmtKES(selected.agreedPrice), cls: "text-slate-800" },
                { label: "Paid", value: fmtKES(selected.totalPaid || 0), cls: "text-emerald-700" },
                { label: "Balance", value: fmtKES((selected.agreedPrice || 0) - (selected.totalPaid || 0)), cls: (selected.agreedPrice - (selected.totalPaid || 0)) > 0 ? "text-rose-700" : "text-emerald-700" },
              ].map(({ label, value, cls }) => (
                <div key={label} className="px-3 py-2 text-center text-[10px] border-r border-slate-100 last:border-r-0">
                  <div className="font-black uppercase tracking-wide text-slate-400">{label}</div>
                  <div className={`mt-0.5 font-black text-xs ${cls}`}>{value}</div>
                </div>
              ))}
            </div>
            <div className="px-4 py-2">
              {(() => {
                const pct = selected.agreedPrice > 0 ? Math.min(100, Math.round(((selected.totalPaid || 0) / selected.agreedPrice) * 100)) : 0;
                return (
                  <div>
                    <div className="mb-1 flex justify-between text-[9px] text-slate-400"><span>Collected</span><span>{pct}%</span></div>
                    <div className="h-1.5 w-full bg-slate-100"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Dates */}
          {(selected.expectedClosingDate || selected.actualClosingDate || selected.titleTransferDate) && (
            <div className="flex-shrink-0 border-b border-slate-100 px-4 py-2 grid grid-cols-2 gap-1 text-[10px]">
              {selected.expectedClosingDate && <div><span className="text-slate-400">Expected Close: </span><span className="font-semibold text-slate-700">{fmtDate(selected.expectedClosingDate)}</span></div>}
              {selected.actualClosingDate && <div><span className="text-slate-400">Closed: </span><span className="font-semibold text-emerald-700">{fmtDate(selected.actualClosingDate)}</span></div>}
              {selected.titleTransferDate && <div><span className="text-slate-400">Title Transfer: </span><span className="font-semibold text-slate-700">{fmtDate(selected.titleTransferDate)}</span></div>}
            </div>
          )}

          {/* Payments */}
          <div className="flex-shrink-0 flex items-center justify-between border-b border-slate-100 px-4 py-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Payments</span>
            {selected.status === "active" && (
              <button
                onClick={() => { setPayingDeal(selected); setPayForm(blankPayForm); setShowPayModal(true); }}
                className="inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100"
              >
                <FaMoneyBillWave size={8} /> Record
              </button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {loadingDealPmts ? (
              <div className="py-6 text-center text-[10px] text-slate-400">Loading…</div>
            ) : dealPmts.length === 0 ? (
              <div className="py-6 text-center text-[10px] text-slate-400">No payments recorded yet.</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {dealPmts.map((p) => (
                  <div key={p._id} className="flex items-center gap-2 px-4 py-2 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] font-bold text-[#0B3B2E]">{p.paymentNumber}</span>
                        <span className="border border-slate-200 bg-slate-50 px-1 py-0 text-[8px] font-bold uppercase text-slate-500">{(p.paymentType || "").replace(/_/g, " ")}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{fmtDate(p.paymentDate)} · {(p.paymentMethod || "").replace(/_/g, " ")}{p.reference ? ` · ${p.reference}` : ""}</div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="font-black text-xs text-slate-900">{fmtKES(p.amount)}</span>
                      <button
                        onClick={() => window.open(`/sale/payments/${p._id}/receipt`, "_blank")}
                        className="border border-[#B7C9C0] bg-white p-0.5 text-[#0B3B2E] hover:bg-[#F1F6F3]"
                        title="Print Receipt"
                      >
                        <FaPrint size={8} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Commission */}
            {dealComm && (
              <>
                <div className="flex-shrink-0 flex items-center border-t border-slate-200 px-4 py-1.5 mt-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Commission</span>
                </div>
                <div className="px-4 py-2 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">{dealComm.agent?.fullName || "—"}</span>
                    <span className="font-black text-slate-900">{fmtKES(dealComm.commissionAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-slate-400">Rate: {dealComm.commissionRate}{dealComm.commissionType === "percentage" ? "%" : " KES flat"}</span>
                    <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                      dealComm.status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : dealComm.status === "approved" ? "border-[#B7C9C0] bg-[#F1F6F3] text-[#0B3B2E]"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}>{dealComm.status}</span>
                  </div>
                  {dealComm.payoutDate && <div className="text-[10px] text-slate-400">Paid: {fmtDate(dealComm.payoutDate)}</div>}
                </div>
              </>
            )}

            {/* Payment Schedule */}
            <div className="flex-shrink-0 flex items-center justify-between border-t border-slate-200 px-4 py-1.5 mt-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Payment Schedule</span>
              {selected.status === "active" && (
                <button type="button" onClick={() => openScheduleBuilder(selected)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-[#F1F6F3] px-2 py-0.5 text-[9px] font-black uppercase text-[#0B3B2E] hover:bg-[#B7C9C0]/40">
                  <FaCalendarAlt size={8} /> {dealSchedule.length > 0 ? "Edit" : "Set"} Schedule
                </button>
              )}
            </div>
            {dealSchedule.length === 0 ? (
              <div className="px-4 pb-3 text-[11px] text-slate-400">No schedule defined.</div>
            ) : (
              <div className="px-4 pb-3 space-y-1.5">
                {dealSchedule.map((item) => {
                  const paidPmts = dealPmts.filter((p) => p._id === (item.linkedPayment?._id || item.linkedPayment));
                  return (
                    <div key={item._id} className={`border px-3 py-2 text-xs ${
                      item.status === "paid"    ? "border-emerald-200 bg-emerald-50"
                      : item.status === "overdue" ? "border-rose-200 bg-rose-50"
                      : item.status === "waived"  ? "border-slate-200 bg-slate-50 opacity-60"
                      : "border-slate-200 bg-white"
                    }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-black text-slate-900">#{item.installmentNumber} · {fmtKES(item.expectedAmount)}</div>
                          <div className="text-[10px] text-slate-500">{fmtDate(item.dueDate)} · {item.description || `Installment ${item.installmentNumber}`}</div>
                          {item.linkedPayment && (
                            <div className="text-[10px] text-emerald-700 mt-0.5">
                              <FaCheck className="inline mr-0.5" size={8} />
                              Linked: {item.linkedPayment.paymentNumber}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={`border px-1 py-0.5 text-[8px] font-black uppercase ${
                            item.status === "paid" ? "border-emerald-300 text-emerald-700"
                            : item.status === "overdue" ? "border-rose-300 text-rose-700"
                            : item.status === "waived" ? "border-slate-300 text-slate-400"
                            : "border-slate-300 text-slate-500"
                          }`}>{item.status}</span>
                          {item.status !== "paid" && item.status !== "waived" && dealPmts.length > 0 && (
                            <button type="button" onClick={() => setLinkingInstallment(item)} className="inline-flex items-center gap-0.5 text-[9px] font-bold text-[#0B3B2E] hover:underline">
                              <FaLink size={7} /> Link
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Panel footer actions */}
          <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-2 flex items-center gap-1.5">
            <button onClick={() => window.open(`/sale/deals/${selected._id}/summary`, "_blank")} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
              <FaPrint size={8} /> Agreement
            </button>
            <button onClick={() => window.open(`/sale/deals/${selected._id}/statement`, "_blank")} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
              <FaFileAlt size={8} /> Statement
            </button>
            {selected.buyer?.phone && (
              <button onClick={() => setSmsTarget(selected)} className="inline-flex items-center gap-1 border border-teal-200 bg-teal-50 px-2.5 py-1 text-[10px] font-bold text-teal-700 hover:bg-teal-100">
                <FaSms size={8} /> SMS Buyer
              </button>
            )}
            {selected.buyer?.email && (
              <button onClick={() => { setEmailTarget(selected); setEmailForm({ subject: `Re: Deal ${selected.dealNumber}`, body: `Dear ${selected.buyer?.fullName || "Client"},\n\n` }); }} className="inline-flex items-center gap-1 border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-100">
                <FaEnvelope size={8} /> Email Buyer
              </button>
            )}
            {selected.status === "active" && (
              <>
                <button onClick={() => openEdit(selected)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                  <FaEdit size={8} /> Edit
                </button>
                <button
                  onClick={() => { setClosingDeal(selected); setCloseForm({ actualClosingDate: todayISO(), titleTransferDate: "", handoverNotes: "" }); setShowCloseModal(true); }}
                  className="inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100"
                >
                  <FaCheck size={8} /> Close
                </button>
              </>
            )}
          </div>
        </div>
      )}

      </div>{/* end relative wrapper */}

      {/* New / Edit Deal Modal */}
      {showModal && (
        <Modal
          title={editingId ? "Edit Deal" : "New Sale Deal"}
          subtitle="Property Sale Module"
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowModal(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleSave} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {saving ? "Saving…" : editingId ? "Update Deal" : "Create Deal"}
              </button>
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={labelCls}>Listing / Property</label>
              <select value={form.listing} onChange={(e) => setForm((p) => ({ ...p, listing: e.target.value }))} className={inputCls}>
                <option value="">Select listing…</option>
                {listings.filter((l) => ["available", "reserved", "under_contract"].includes(l.status)).map((l) => (
                  <option key={l._id} value={l._id}>{l.listingNumber} — {l.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Buyer</label>
              <select value={form.buyer} onChange={(e) => setForm((p) => ({ ...p, buyer: e.target.value }))} className={inputCls}>
                <option value="">Select buyer…</option>
                {buyers.map((b) => <option key={b._id} value={b._id}>{b.fullName} ({b.buyerNumber})</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Sales Agent (Optional)</label>
              <select value={form.agent} onChange={(e) => setForm((p) => ({ ...p, agent: e.target.value, commOverrideEnabled: false, commissionRateOverride: "", commissionTypeOverride: "", commissionAmountOverride: "" }))} className={inputCls}>
                <option value="">No agent</option>
                {agents.map((a) => <option key={a._id} value={a._id}>{a.fullName} ({a.agentNumber})</option>)}
              </select>
            </div>
            {!editingId && form.agent && (() => {
              const selAgent = agents.find((a) => a._id === form.agent);
              return (
                <div className="md:col-span-2 border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!form.commOverrideEnabled} onChange={(e) => setForm((p) => ({ ...p, commOverrideEnabled: e.target.checked }))} className="h-3.5 w-3.5 accent-[#0B3B2E]" />
                    <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-600">Override Commission</span>
                    {selAgent && !form.commOverrideEnabled && (
                      <span className="ml-1 text-[11px] text-slate-400">
                        (Default: {selAgent.commissionType === "percentage" ? `${selAgent.commissionRate}%` : `KES ${Number(selAgent.commissionRate).toLocaleString()}`} — {selAgent.commissionType})
                      </span>
                    )}
                  </label>
                  {form.commOverrideEnabled && (
                    <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className={labelCls}>Commission Type</label>
                        <select value={form.commissionTypeOverride || selAgent?.commissionType || "percentage"} onChange={(e) => setForm((p) => ({ ...p, commissionTypeOverride: e.target.value, commissionAmountOverride: "" }))} className={inputCls}>
                          <option value="percentage">Percentage (%)</option>
                          <option value="fixed">Fixed Amount (KES)</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>{(form.commissionTypeOverride || selAgent?.commissionType) === "fixed" ? "Commission Amount (KES)" : "Commission Rate (%)"}</label>
                        <input type="number" min="0" step="0.01" value={form.commissionRateOverride} onChange={(e) => setForm((p) => ({ ...p, commissionRateOverride: e.target.value, commissionAmountOverride: "" }))} className={inputCls} placeholder={selAgent ? String(selAgent.commissionRate) : ""} />
                      </div>
                      <div>
                        <label className={labelCls}>Direct Amount Override (KES)</label>
                        <input type="number" min="0" step="0.01" value={form.commissionAmountOverride} onChange={(e) => setForm((p) => ({ ...p, commissionAmountOverride: e.target.value }))} className={inputCls} placeholder="Skip rate — set exact amount" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            <div>
              <label className={labelCls}>Agreed Price (KES)</label>
              <AmountInput value={form.agreedPrice} onChange={(v) => setForm((p) => ({ ...p, agreedPrice: v }))} className={inputCls} placeholder="e.g. 8,500,000" />
            </div>
            <div>
              <label className={labelCls}>Deal Date</label>
              <input type="date" value={form.dealDate} onChange={(e) => setForm((p) => ({ ...p, dealDate: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Expected Closing Date</label>
              <input type="date" value={form.expectedClosingDate} onChange={(e) => setForm((p) => ({ ...p, expectedClosingDate: e.target.value }))} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
            </div>
          </div>
        </Modal>
      )}

      {/* Cancel Deal Modal */}
      {showCancelModal && cancellingDeal && (
        <Modal
          title={`Cancel Deal — ${cancellingDeal.dealNumber}`}
          subtitle="This will revert the listing to Available"
          headerCls="bg-rose-700"
          onClose={() => setShowCancelModal(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowCancelModal(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Back</button>
              <button type="button" onClick={handleCancel} disabled={!!actionKey} className="bg-rose-700 px-4 py-1.5 text-xs font-black text-white hover:bg-rose-800 disabled:opacity-60">
                {actionKey ? "Cancelling…" : "Cancel Deal"}
              </button>
            </>
          }
        >
          <div className="mb-3 border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            Cancelling will revert the listing to <strong>Available</strong> and cancel any pending commissions.
          </div>
          <label className={labelCls}>Reason for Cancellation</label>
          <textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Optional — e.g. buyer withdrew, financing fell through…" className="w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-rose-500 focus:outline-none" />
        </Modal>
      )}

      {/* SMS Modal */}
      {smsTarget && (
        <CwSmsModal
          target={{ name: smsTarget.buyer?.fullName, phone: smsTarget.buyer?.phone }}
          context={smsTarget.dealNumber}
          defaultBody={`Dear ${smsTarget.buyer?.fullName || "Client"}, `}
          templates={[
            { label: "Payment Reminder", color: "amber",  body: `Dear ${smsTarget.buyer?.fullName || "Client"}, this is a friendly reminder that your next installment for deal ${smsTarget.dealNumber} is due. Kindly settle the outstanding balance to avoid delays. Contact us for assistance.` },
            { label: "Deal Update",      color: "green",  body: `Dear ${smsTarget.buyer?.fullName || "Client"}, there is an update on your property purchase (${smsTarget.dealNumber}). Please contact us at your earliest convenience.` },
            { label: "Closing Notice",   color: "violet", body: `Dear ${smsTarget.buyer?.fullName || "Client"}, congratulations! Your property deal ${smsTarget.dealNumber} is ready for closing. Please contact us to schedule the final handover.` },
            { label: "Document Request", color: "slate",  body: `Dear ${smsTarget.buyer?.fullName || "Client"}, kindly submit the required documents for your property transaction (${smsTarget.dealNumber}) at your earliest convenience. Contact us for details.` },
          ]}
          onSend={handleSendSms}
          onClose={() => setSmsTarget(null)}
          sending={smsSending}
        />
      )}

      {/* Email Modal */}
      {emailTarget && (
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
          <div className="flex w-full max-w-md flex-col bg-white shadow-2xl sm:border sm:border-slate-200 rounded-t-2xl sm:rounded-none">
            <div className="flex-shrink-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-[#1a4069] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
              <div>
                <div className="text-sm font-extrabold uppercase tracking-wide">Email Buyer</div>
                <div className="text-xs font-semibold text-white/70">To: {emailTarget.buyer?.email} · {emailTarget.dealNumber}</div>
              </div>
              <button type="button" onClick={() => setEmailTarget(null)} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="flex flex-col gap-3 p-4">
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Subject</label>
                <input value={emailForm.subject} onChange={(e) => setEmailForm((f) => ({ ...f, subject: e.target.value }))} className="h-8 w-full border border-slate-200 bg-white px-3 text-xs focus:border-[#1a4069] focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Message</label>
                <textarea rows={7} value={emailForm.body} onChange={(e) => setEmailForm((f) => ({ ...f, body: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#1a4069] focus:outline-none" />
              </div>
            </div>
            <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setEmailTarget(null)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleSendDealEmail} disabled={emailSending} className="bg-[#1a4069] px-4 py-1.5 text-xs font-black text-white hover:bg-[#143354] disabled:opacity-60">
                {emailSending ? "Sending…" : "Send Email"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Deal Modal */}
      {showCloseModal && closingDeal && (
        <Modal
          title={`Close Deal — ${closingDeal.dealNumber}`}
          subtitle={`Balance: ${fmtKES(closingDeal.agreedPrice - (closingDeal.totalPaid || 0))}`}
          onClose={() => setShowCloseModal(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowCloseModal(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleClose} disabled={!!actionKey} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                <FaCheck className="inline mr-1 text-[9px]" />{actionKey ? "Closing…" : "Confirm Close"}
              </button>
            </>
          }
        >
          <div className="grid gap-3">
            <div>
              <label className={labelCls}>Actual Closing Date</label>
              <input type="date" value={closeForm.actualClosingDate} onChange={(e) => setCloseForm((p) => ({ ...p, actualClosingDate: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Title Transfer Date</label>
              <input type="date" value={closeForm.titleTransferDate} onChange={(e) => setCloseForm((p) => ({ ...p, titleTransferDate: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Handover Notes</label>
              <textarea rows={3} value={closeForm.handoverNotes} onChange={(e) => setCloseForm((p) => ({ ...p, handoverNotes: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
            </div>
          </div>
        </Modal>
      )}
      {/* Record Payment Modal */}
      {showPayModal && payingDeal && (
        <Modal
          title={`Record Payment — ${payingDeal.dealNumber}`}
          subtitle={`${payingDeal.buyer?.fullName || ""} • Balance: KES ${((payingDeal.agreedPrice || 0) - (payingDeal.totalPaid || 0)).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`}
          onClose={() => setShowPayModal(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowPayModal(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleRecordPayment} disabled={payingSave} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {payingSave ? "Saving…" : "Record & Print Receipt"}
              </button>
            </>
          }
        >
          {/* Balance summary */}
          <div className="mb-3 grid grid-cols-3 border border-slate-200">
            <div className="border-r border-slate-200 px-3 py-2 text-center text-[10px]">
              <div className="font-black uppercase tracking-wide text-slate-400">Agreed</div>
              <div className="mt-0.5 font-black text-slate-800">{fmtKES(payingDeal.agreedPrice)}</div>
            </div>
            <div className="border-r border-slate-200 px-3 py-2 text-center text-[10px]">
              <div className="font-black uppercase tracking-wide text-slate-400">Paid</div>
              <div className="mt-0.5 font-black text-emerald-700">{fmtKES(payingDeal.totalPaid || 0)}</div>
            </div>
            <div className="px-3 py-2 text-center text-[10px]">
              <div className="font-black uppercase tracking-wide text-slate-400">Balance</div>
              <div className="mt-0.5 font-black text-rose-700">{fmtKES((payingDeal.agreedPrice || 0) - (payingDeal.totalPaid || 0))}</div>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mb-3">
            {(() => {
              const pct = payingDeal.agreedPrice > 0 ? Math.min(100, Math.round(((payingDeal.totalPaid || 0) / payingDeal.agreedPrice) * 100)) : 0;
              return (
                <>
                  <div className="mb-1 flex justify-between text-[9px] text-slate-400"><span>Payment Progress</span><span>{pct}% paid</span></div>
                  <div className="h-1.5 w-full overflow-hidden bg-slate-200"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                </>
              );
            })()}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={labelCls}>Payment Type</label>
              <select value={payForm.paymentType} onChange={(e) => setPayForm((f) => ({ ...f, paymentType: e.target.value }))} className={inputCls}>
                {PAYMENT_TYPES.map((t) => <option key={t} value={t}>{fmtLabel(t)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Method</label>
              <select value={payForm.paymentMethod} onChange={(e) => setPayForm((f) => ({ ...f, paymentMethod: e.target.value }))} className={inputCls}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{fmtLabel(m)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Amount (KES)</label>
              <AmountInput value={payForm.amount} onChange={(v) => setPayForm((f) => ({ ...f, amount: v }))} className={inputCls} placeholder="e.g. 500,000" />
            </div>
            <div>
              <label className={labelCls}>Payment Date</label>
              <input type="date" value={payForm.paymentDate} onChange={(e) => setPayForm((f) => ({ ...f, paymentDate: e.target.value }))} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>
                {payForm.paymentMethod === "mpesa" ? "M-Pesa Code" : payForm.paymentMethod === "cheque" ? "Cheque No." : payForm.paymentMethod === "bank_transfer" ? "EFT / Ref No." : "Reference (Optional)"}
              </label>
              <input
                type="text"
                value={payForm.reference}
                onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                className={`${inputCls} font-mono ${["mpesa", "cheque", "bank_transfer"].includes(payForm.paymentMethod) ? "border-amber-300 bg-amber-50 focus:border-amber-500" : ""}`}
                placeholder={payForm.paymentMethod === "mpesa" ? "e.g. QJ1X23ABC4D" : "Optional…"}
              />
              {["mpesa", "cheque", "bank_transfer"].includes(payForm.paymentMethod) && (
                <div className="mt-1 text-[10px] font-semibold text-amber-600">Reference required for {fmtLabel(payForm.paymentMethod)} — used for reconciliation</div>
              )}
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea rows={2} value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
            </div>
          </div>
        </Modal>
      )}

      {/* Schedule Builder Modal */}
      {showScheduleBuilder && selected && (
        <Modal
          title="Payment Schedule"
          subtitle={`${selected.dealNumber} — ${fmtKES(selected.agreedPrice)} total`}
          onClose={() => setShowScheduleBuilder(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowScheduleBuilder(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleSaveSchedule} disabled={scheduleSaving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {scheduleSaving ? "Saving…" : "Save Schedule"}
              </button>
            </>
          }
        >
          <div className="space-y-2">
            {scheduleItems.map((item, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end border border-slate-200 bg-slate-50 px-3 py-2">
                <div>
                  <label className={labelCls}>Due Date</label>
                  <input type="date" value={item.dueDate} onChange={(e) => setScheduleItems((prev) => prev.map((x, i) => i === idx ? { ...x, dueDate: e.target.value } : x))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Amount (KES)</label>
                  <input type="number" min="0" value={item.expectedAmount} onChange={(e) => setScheduleItems((prev) => prev.map((x, i) => i === idx ? { ...x, expectedAmount: e.target.value } : x))} className={inputCls} placeholder="0.00" />
                </div>
                <div>
                  <label className={labelCls}>Description</label>
                  <input type="text" value={item.description} onChange={(e) => setScheduleItems((prev) => prev.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} className={inputCls} placeholder={`Installment ${idx + 1}`} />
                </div>
                <div>
                  <button type="button" onClick={() => setScheduleItems((prev) => prev.filter((_, i) => i !== idx))} className="h-8 w-8 border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center justify-center">
                    <FaTrash size={9} />
                  </button>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setScheduleItems((prev) => [...prev, { dueDate: "", expectedAmount: "", description: `Installment ${prev.length + 1}` }])} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-[#F1F6F3] px-3 py-1.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#B7C9C0]/40">
              <FaPlus size={8} /> Add Installment
            </button>
            {scheduleItems.length > 0 && (
              <div className="mt-2 text-right text-xs">
                <span className="text-slate-500">Schedule total: </span>
                <span className={`font-black ${Math.abs(scheduleItems.reduce((s, i) => s + Number(i.expectedAmount || 0), 0) - selected.agreedPrice) < 1 ? "text-emerald-700" : "text-rose-600"}`}>
                  {fmtKES(scheduleItems.reduce((s, i) => s + Number(i.expectedAmount || 0), 0))}
                </span>
                <span className="text-slate-400"> / {fmtKES(selected.agreedPrice)}</span>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Link Payment to Installment Modal */}
      {linkingInstallment && selected && (
        <Modal
          title="Link Payment to Installment"
          subtitle={`#${linkingInstallment.installmentNumber} · ${fmtKES(linkingInstallment.expectedAmount)}`}
          onClose={() => setLinkingInstallment(null)}
        >
          {dealPmts.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">No confirmed payments to link.</div>
          ) : (
            <div className="space-y-2">
              <div className="mb-3 text-xs text-slate-500">Select the payment that fulfils installment #{linkingInstallment.installmentNumber}:</div>
              {dealPmts.map((p) => (
                <button
                  key={p._id}
                  type="button"
                  onClick={() => handleLinkPayment(linkingInstallment._id, p._id)}
                  className="w-full border border-slate-200 px-3 py-2.5 text-left hover:bg-[#F1F6F3] text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-black text-[#0B3B2E]">{p.paymentNumber}</span>
                    <span className="font-black text-slate-900">{fmtKES(p.amount)}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{fmtDate(p.paymentDate)} · {String(p.paymentMethod || "").replace(/_/g, " ")}</div>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
    </PropertySaleShell>
  );
};

export default SaleDeals;

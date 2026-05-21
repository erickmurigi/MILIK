import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { FaEdit, FaMoneyBillWave, FaPlus, FaRedoAlt, FaSave, FaSearch, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const emptyRule = { name: "", service: "", staff: "", commissionType: "fixed", rate: "", active: true, priority: 0, notes: "" };
const emptyPayout = { staff: "", commissionIds: [], method: "cash", cashbookAccount: "", payoutDate: todayISO(), reference: "", notes: "" };
const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const statuses = ["earned", "payable", "paid", "cancelled"];
const methods = ["cash", "mpesa", "bank", "card", "other"];
const defaultFilters = { status: "payable", staff: "", date: "" };
const PAGE_SIZE = 30;
const statusLabels = {
  earned: "Earned",
  payable: "Payable",
  paid: "Paid",
  cancelled: "Cancelled",
};

const Modal = ({ title, subtitle, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-4xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <div>
          <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs font-semibold text-emerald-50">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white" title="Close">
          <FaTimes />
        </button>
      </div>
      <div className="p-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>}
    </div>
  </div>
);

const statusClass = (status) => {
  if (status === "paid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "payable") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "cancelled") return "border-red-200 bg-red-50 text-red-700";
  return "border-orange-200 bg-orange-50 text-orange-700";
};

const preferredCashbookForMethod = (cashbooks = [], method = "cash") => {
  const haystack = (item) => `${item?.name || ""} ${item?.code || ""}`.toLowerCase();
  if (method === "mpesa") return cashbooks.find((item) => /m-?pesa|mpesa/.test(haystack(item)))?._id || "";
  if (method === "bank" || method === "card") return cashbooks.find((item) => /bank/.test(haystack(item)))?._id || "";
  if (method === "cash") return cashbooks.find((item) => /cash|hand|safe/.test(haystack(item)))?._id || "";
  return cashbooks[0]?._id || "";
};

const CarWashCommissions = () => {
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const [rules, setRules] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [payableCommissions, setPayableCommissions] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [cashbooks, setCashbooks] = useState([]);
  const [ruleForm, setRuleForm] = useState(emptyRule);
  const [payoutForm, setPayoutForm] = useState(emptyPayout);
  const [editingRuleId, setEditingRuleId] = useState("");
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [showPayoutHistoryModal, setShowPayoutHistoryModal] = useState(false);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [filters, setFilters] = useState(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
  const [summary, setSummary] = useState({ total: { amount: 0, count: 0 } });
  const [loading, setLoading] = useState(false);

  const selectedStaffPayable = useMemo(
    () => payableCommissions.filter((item) => item.status === "payable" && (!payoutForm.staff || String(item.staff?._id || item.staff) === String(payoutForm.staff))),
    [payableCommissions, payoutForm.staff]
  );
  const selectedPayoutTotal = useMemo(
    () => selectedStaffPayable
      .filter((item) => payoutForm.commissionIds.includes(item._id))
      .reduce((sum, item) => sum + Number(item.commissionAmount || 0), 0),
    [payoutForm.commissionIds, selectedStaffPayable]
  );

  const load = async () => {
    setLoading(true);
    try {
      const [rulePayload, commissionPayload, payoutPayload, servicePayload, staffPayload, cashbookPayload] = await Promise.all([
        carWashApi.listCommissionRules(),
        carWashApi.listCommissions({
          status: appliedFilters.status || undefined,
          staff: appliedFilters.staff || undefined,
          date: appliedFilters.date || undefined,
          page,
          limit: PAGE_SIZE,
        }),
        carWashApi.listCommissionPayouts({ limit: 50 }),
        carWashApi.listServices({ active: true }),
        carWashApi.listStaff({ active: true }),
        currentCompany?._id
          ? carWashApi.listChartOfAccounts({ business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks" })
          : Promise.resolve([]),
      ]);
      setRules(normalizeListPayload(rulePayload, "rules"));
      const commissionRows = normalizeListPayload(commissionPayload, "commissions");
      setCommissions(commissionRows);
      setPagination(commissionPayload?.pagination || { page, limit: PAGE_SIZE, total: commissionRows.length, pages: 1 });
      setSummary(commissionPayload?.summary || { total: { amount: 0, count: commissionRows.length } });
      setPayouts(normalizeListPayload(payoutPayload, "payouts"));
      setServices(normalizeListPayload(servicePayload, "services"));
      setStaff(normalizeListPayload(staffPayload, "staff"));
      setCashbooks(Array.isArray(cashbookPayload) ? cashbookPayload : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => toast.error("Failed to load commissions"));
  }, [appliedFilters, page, currentCompany?._id]);

  useEffect(() => {
    if (!cashbooks.length || payoutForm.cashbookAccount) return;
    setPayoutForm((prev) => ({ ...prev, cashbookAccount: preferredCashbookForMethod(cashbooks, prev.method) }));
  }, [cashbooks, payoutForm.cashbookAccount]);

  const openRule = (rule = null) => {
    setShowRulesModal(false);
    setEditingRuleId(rule?._id || "");
    setRuleForm(rule ? {
      name: rule.name || "",
      service: rule.service?._id || rule.service || "",
      staff: rule.staff?._id || rule.staff || "",
      commissionType: rule.commissionType || "fixed",
      rate: rule.rate ?? "",
      active: rule.active !== false,
      priority: rule.priority || 0,
      notes: rule.notes || "",
    } : emptyRule);
    setShowRuleModal(true);
  };

  const saveRule = async (event) => {
    event.preventDefault();
    const payload = { ...ruleForm, rate: Number(ruleForm.rate || 0), priority: Number(ruleForm.priority || 0), service: ruleForm.service || null, staff: ruleForm.staff || null };
    try {
      if (editingRuleId) await carWashApi.updateCommissionRule(editingRuleId, payload);
      else await carWashApi.createCommissionRule(payload);
      setShowRuleModal(false);
      setShowRulesModal(false);
      setRuleForm(emptyRule);
      setEditingRuleId("");
      await load();
      toast.success("Commission rule saved");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to save commission rule");
    }
  };

  const openPayout = async () => {
    let payableRows = [];
    try {
      const payload = await carWashApi.listCommissions({
        status: "payable",
        staff: appliedFilters.staff || undefined,
        date: appliedFilters.date || undefined,
        limit: 200,
      });
      payableRows = normalizeListPayload(payload, "commissions");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to load payable commissions");
      return;
    }
    const firstStaff = payableRows[0]?.staff?._id || "";
    const firstStaffRows = firstStaff ? payableRows.filter((item) => String(item.staff?._id || item.staff) === String(firstStaff)) : [];
    setPayableCommissions(payableRows);
    setPayoutForm({
      ...emptyPayout,
      staff: firstStaff,
      commissionIds: firstStaffRows.map((item) => item._id),
      cashbookAccount: preferredCashbookForMethod(cashbooks, "cash"),
    });
    setShowPayoutModal(true);
  };

  const setPayoutStaff = (staffId) => {
    const rows = payableCommissions.filter((item) => item.status === "payable" && String(item.staff?._id || item.staff) === String(staffId));
    setPayoutForm((prev) => ({ ...prev, staff: staffId, commissionIds: rows.map((item) => item._id) }));
  };

  const togglePayoutCommission = (id) => {
    setPayoutForm((prev) => ({
      ...prev,
      commissionIds: prev.commissionIds.includes(id) ? prev.commissionIds.filter((item) => item !== id) : [...prev.commissionIds, id],
    }));
  };

  const savePayout = async (event) => {
    event.preventDefault();
    try {
      await carWashApi.createCommissionPayout(payoutForm);
      setShowPayoutModal(false);
      setPayoutForm(emptyPayout);
      await load();
      toast.success("Commission payout recorded");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to record payout");
    }
  };

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilters({ ...filters });
  };

  const resetFilters = () => {
    setFilters(defaultFilters);
    setPage(1);
    setAppliedFilters(defaultFilters);
  };

  const pageTotal = useMemo(
    () => commissions.reduce((sum, row) => sum + Number(row.commissionAmount || 0), 0),
    [commissions]
  );

  return (
    <CarWashShell
      title="Staff Commissions"
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button type="button" onClick={() => setShowRulesModal(true)} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-3 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaEdit />
            Rules
          </button>
          <button type="button" onClick={() => openRule()} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-3 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaPlus />
            New Rule
          </button>
          <button type="button" onClick={() => setShowPayoutHistoryModal(true)} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-3 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaMoneyBillWave />
            Payouts
          </button>
          <button type="button" onClick={openPayout} disabled={!summary?.payable?.count} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-50">
            <FaMoneyBillWave />
            Payout
          </button>
        </>
      }
    >
      <form onSubmit={applyFilters} className="mb-2 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 sm:grid-cols-2 xl:grid-cols-[180px_240px_170px_1fr_auto_auto]">
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
          <option value="">All status</option>
          {statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
        </select>
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none" value={filters.staff} onChange={(event) => setFilters((prev) => ({ ...prev, staff: event.target.value }))}>
          <option value="">All staff</option>
          {staff.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
        </select>
        <input type="date" className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none" value={filters.date} onChange={(event) => setFilters((prev) => ({ ...prev, date: event.target.value }))} />
        <div className="hidden xl:block" />
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]"><FaSearch /> Search</button>
        <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]"><FaRedoAlt /> Reset</button>
      </form>

      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing: <strong className="text-[#0B3B2E]">{commissions.length}</strong> / {pagination.total}</span>
          <span>Page: <strong className="text-[#0B3B2E]">{pagination.page}</strong> / {pagination.pages}</span>
          <span>Page Total: <strong className="text-[#0B3B2E]">{formatMoney(pageTotal)}</strong></span>
          <span>Status: <strong className="text-slate-900">{appliedFilters.status ? statusLabels[appliedFilters.status] : "All"}</strong></span>
          <span>Earned: <strong className="text-[#FF8C00]">{summary?.earned?.count || 0}</strong></span>
          <span>Payable: <strong className="text-[#0B3B2E]">{summary?.payable?.count || 0}</strong></span>
          <span>Paid: <strong className="text-emerald-700">{summary?.paid?.count || 0}</strong></span>
          <span>Cancelled: <strong className="text-red-700">{summary?.cancelled?.count || 0}</strong></span>
        </div>
        <table className="w-full min-w-[1120px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Staff</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Job</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Service</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Base</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Rate</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Commission</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Earned</th>
            </tr>
          </thead>
          <tbody>
            {commissions.length ? commissions.map((row) => (
              <tr key={row._id} className="border-b border-slate-200 hover:bg-slate-50">
                <td className="px-2 py-1 font-extrabold text-slate-900">{row.staff?.name || "Staff"}</td>
                <td className="px-2 py-1 text-slate-700">{row.jobNumber || row.job?.jobNumber || "-"}</td>
                <td className="px-2 py-1 text-slate-700">{row.serviceName || row.service?.name || "-"}</td>
                <td className="px-2 py-1 text-right">{formatMoney(row.baseAmount)}</td>
                <td className="px-2 py-1 text-right">{row.commissionType === "percentage" ? `${row.commissionRate}%` : formatMoney(row.commissionRate)}</td>
                <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.commissionAmount)}</td>
                <td className="px-2 py-1"><span className={`border px-2 py-0.5 text-[11px] font-bold uppercase ${statusClass(row.status)}`}>{row.status}</span></td>
                <td className="px-2 py-1 text-slate-600">{row.earnedAt ? new Date(row.earnedAt).toLocaleDateString("en-KE") : "-"}</td>
              </tr>
            )) : (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">No Car Wash commissions found for the selected filters.</td></tr>
            )}
          </tbody>
        </table>
        <div className="flex min-h-9 items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Rows per page: {PAGE_SIZE}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((prev) => Math.max(prev - 1, 1))} disabled={page <= 1 || loading} className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45">Previous</button>
            <span>Page {pagination.page} of {pagination.pages}</span>
            <button type="button" onClick={() => setPage((prev) => Math.min(prev + 1, pagination.pages))} disabled={page >= pagination.pages || loading} className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45">Next</button>
          </div>
        </div>
      </div>

      {showRulesModal && (
        <Modal
          title="Commission Rules"
          subtitle="Review and edit the rules used when jobs are completed."
          onClose={() => setShowRulesModal(false)}
          footer={<button type="button" onClick={() => openRule()} className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white"><FaPlus /> New Rule</button>}
        >
          <div className="overflow-x-auto border border-slate-200">
            <table className="w-full min-w-[820px] text-xs">
              <thead className="bg-[#0B3B2E] text-white">
                <tr>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Rule</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Service</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Staff</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Rate</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Action</th>
                </tr>
              </thead>
              <tbody>
                {rules.length ? rules.map((rule) => (
                  <tr key={rule._id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-2 py-1 font-extrabold text-slate-900">{rule.name}</td>
                    <td className="px-2 py-1 text-slate-700">{rule.service?.name || "All services"}</td>
                    <td className="px-2 py-1 text-slate-700">{rule.staff?.name || "All staff"}</td>
                    <td className="px-2 py-1 text-right font-bold text-slate-900">{rule.commissionType === "percentage" ? `${rule.rate}%` : formatMoney(rule.rate)}</td>
                    <td className="px-2 py-1 text-slate-700">{rule.active === false ? "Inactive" : "Active"}</td>
                    <td className="px-2 py-1 text-right">
                      <button type="button" onClick={() => openRule(rule)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"><FaEdit /> Edit</button>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-xs font-semibold text-slate-500">No commission rules yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {showPayoutHistoryModal && (
        <Modal
          title="Commission Payouts"
          subtitle="Audit payouts posted to staff commission payable."
          onClose={() => setShowPayoutHistoryModal(false)}
        >
          <div className="overflow-x-auto border border-slate-200">
            <table className="w-full min-w-[860px] text-xs">
              <thead className="bg-[#0B3B2E] text-white">
                <tr>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Payout No.</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Staff</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Method</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Cashbook</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Date</th>
                </tr>
              </thead>
              <tbody>
                {payouts.length ? payouts.map((row) => (
                  <tr key={row._id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-2 py-1 font-extrabold text-slate-900">{row.payoutNumber}</td>
                    <td className="px-2 py-1">{row.staff?.name || "Staff"}</td>
                    <td className="px-2 py-1 uppercase">{row.method}</td>
                    <td className="px-2 py-1">{row.cashbookAccount?.code} {row.cashbookAccount?.name}</td>
                    <td className="px-2 py-1 text-right font-extrabold">{formatMoney(row.amount)}</td>
                    <td className="px-2 py-1">{row.payoutDate ? new Date(row.payoutDate).toLocaleDateString("en-KE") : "-"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-xs font-semibold text-slate-500">No commission payouts found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {showRuleModal && (
        <Modal
          title={editingRuleId ? "Edit Commission Rule" : "New Commission Rule"}
          subtitle="Rules are applied when a job is completed."
          onClose={() => setShowRuleModal(false)}
          footer={<><button type="button" onClick={() => setShowRuleModal(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700">Cancel</button><button type="submit" form="commission-rule-form" className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white"><FaSave /> Save Rule</button></>}
        >
          <form id="commission-rule-form" onSubmit={saveRule} className="grid gap-3 md:grid-cols-2">
            <label><span className={labelClass}>Rule name</span><input className={inputClass} value={ruleForm.name} onChange={(e) => setRuleForm((p) => ({ ...p, name: e.target.value }))} required /></label>
            <label><span className={labelClass}>Type</span><select className={inputClass} value={ruleForm.commissionType} onChange={(e) => setRuleForm((p) => ({ ...p, commissionType: e.target.value }))}><option value="fixed">Fixed amount</option><option value="percentage">Percentage of job price</option></select></label>
            <label><span className={labelClass}>Rate</span><input type="number" min="0" step="0.01" className={inputClass} value={ruleForm.rate} onChange={(e) => setRuleForm((p) => ({ ...p, rate: e.target.value }))} required /></label>
            <label><span className={labelClass}>Priority</span><input type="number" className={inputClass} value={ruleForm.priority} onChange={(e) => setRuleForm((p) => ({ ...p, priority: e.target.value }))} /></label>
            <label><span className={labelClass}>Service</span><select className={inputClass} value={ruleForm.service} onChange={(e) => setRuleForm((p) => ({ ...p, service: e.target.value }))}><option value="">All services</option>{services.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label>
            <label><span className={labelClass}>Staff</span><select className={inputClass} value={ruleForm.staff} onChange={(e) => setRuleForm((p) => ({ ...p, staff: e.target.value }))}><option value="">All staff</option>{staff.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label>
            <label className="flex items-center gap-2 pt-6 text-sm font-bold text-slate-700"><input type="checkbox" checked={ruleForm.active} onChange={(e) => setRuleForm((p) => ({ ...p, active: e.target.checked }))} /> Active</label>
            <label className="md:col-span-2"><span className={labelClass}>Notes</span><textarea className="min-h-20 w-full border border-slate-300 px-2 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none" value={ruleForm.notes} onChange={(e) => setRuleForm((p) => ({ ...p, notes: e.target.value }))} /></label>
          </form>
        </Modal>
      )}

      {showPayoutModal && (
        <Modal
          title="Pay Staff Commissions"
          subtitle="Only payable commissions for the selected staff member can be paid."
          onClose={() => setShowPayoutModal(false)}
          footer={<><button type="button" onClick={() => setShowPayoutModal(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700">Cancel</button><button type="submit" form="commission-payout-form" className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white"><FaMoneyBillWave /> Pay {formatMoney(selectedPayoutTotal)}</button></>}
        >
          <form id="commission-payout-form" onSubmit={savePayout} className="grid gap-3 md:grid-cols-2">
            <label><span className={labelClass}>Staff</span><select className={inputClass} value={payoutForm.staff} onChange={(e) => setPayoutStaff(e.target.value)} required><option value="">Select staff</option>{staff.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label>
            <label><span className={labelClass}>Method</span><select className={inputClass} value={payoutForm.method} onChange={(e) => setPayoutForm((p) => ({ ...p, method: e.target.value, cashbookAccount: preferredCashbookForMethod(cashbooks, e.target.value) }))}>{methods.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
            <label><span className={labelClass}>Cashbook</span><select className={inputClass} value={payoutForm.cashbookAccount} onChange={(e) => setPayoutForm((p) => ({ ...p, cashbookAccount: e.target.value }))} required><option value="">Select cashbook</option>{cashbooks.map((item) => <option key={item._id} value={item._id}>{item.code} {item.name}</option>)}</select></label>
            <label><span className={labelClass}>Payout date</span><input type="date" className={inputClass} value={payoutForm.payoutDate} onChange={(e) => setPayoutForm((p) => ({ ...p, payoutDate: e.target.value }))} /></label>
            <label><span className={labelClass}>Reference</span><input className={inputClass} value={payoutForm.reference} onChange={(e) => setPayoutForm((p) => ({ ...p, reference: e.target.value }))} /></label>
            <label><span className={labelClass}>Notes</span><input className={inputClass} value={payoutForm.notes} onChange={(e) => setPayoutForm((p) => ({ ...p, notes: e.target.value }))} /></label>
            <div className="md:col-span-2">
              <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">Payable rows</div>
              <div className="max-h-60 overflow-auto border border-slate-200">
                {selectedStaffPayable.length ? selectedStaffPayable.map((item) => (
                  <label key={item._id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-xs hover:bg-slate-50">
                    <span className="flex items-center gap-2"><input type="checkbox" checked={payoutForm.commissionIds.includes(item._id)} onChange={() => togglePayoutCommission(item._id)} /> {item.jobNumber || item.job?.jobNumber} - {item.serviceName || item.service?.name}</span>
                    <span className="font-extrabold">{formatMoney(item.commissionAmount)}</span>
                  </label>
                )) : <div className="px-3 py-8 text-center text-xs font-semibold text-slate-500">No payable commissions for this staff member.</div>}
              </div>
            </div>
          </form>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashCommissions;

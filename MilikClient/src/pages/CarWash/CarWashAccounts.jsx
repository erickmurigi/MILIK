import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import {
  FaCalendarAlt, FaCheckCircle, FaChevronDown, FaChevronRight,
  FaFileInvoice, FaMoneyBillWave, FaPlus, FaRedoAlt, FaSms,
  FaTimes, FaUser, FaExclamationTriangle, FaWallet, FaHistory,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import CwSmsModal from "./CwSmsModal";

const GRN = "#0B3B2E";
const ORG = "#FF8C00";

const fmt = formatMoney;
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-KE") : "—";
const fmtMonth = (v) => v ? new Date(v).toLocaleString("en-KE", { month: "long", year: "numeric" }) : "—";

const statusPill = {
  active:    "bg-emerald-100 text-emerald-700 border-emerald-200",
  suspended: "bg-amber-100 text-amber-700 border-amber-200",
  closed:    "bg-slate-100 text-slate-500 border-slate-200",
};

const stmtPill = {
  draft:   "bg-slate-100 text-slate-600",
  sent:    "bg-blue-100 text-blue-700",
  partial: "bg-amber-100 text-amber-700",
  paid:    "bg-emerald-100 text-emerald-700",
};

const paymentMethods = ["cash", "mpesa", "bank", "card", "other"];

// ─── Create/edit account modal ────────────────────────────────────────────────
const AccountModal = ({ customers, onSave, onClose }) => {
  const [form, setForm] = useState({
    customerId: "", accountType: "credit", creditLimit: "", billingCycle: "monthly",
    billingDay: "1", notes: "", plates: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.customerId) return toast.warning("Select a customer");
    setSaving(true);
    try {
      const payload = {
        customerId: form.customerId,
        accountType: form.accountType,
        creditLimit: Number(form.creditLimit || 0),
        billingCycle: form.billingCycle,
        billingDay: Number(form.billingDay || 1),
        notes: form.notes,
        plates: form.plates.split(",").map((p) => p.trim()).filter(Boolean),
      };
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  const labelCls = "mb-1 block text-[11px] font-extrabold uppercase tracking-widest text-slate-500";
  const inputCls = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/50 px-4">
      <div className="w-full max-w-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#0B3B2E] px-4 py-3 text-white">
          <h2 className="text-sm font-extrabold uppercase tracking-wide">New Credit Account</h2>
          <button onClick={onClose}><FaTimes /></button>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className={labelCls}>Customer *</label>
            <select className={inputCls} value={form.customerId} onChange={(e) => set("customerId", e.target.value)}>
              <option value="">Select customer</option>
              {customers.map((c) => (
                <option key={c._id} value={c._id}>{c.name} {c.phone ? `· ${c.phone}` : ""}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Account Type *</label>
              <select className={inputCls} value={form.accountType} onChange={(e) => set("accountType", e.target.value)}>
                <option value="credit">Credit (Pay-later)</option>
                <option value="monthly">Monthly Billing</option>
                <option value="prepaid">Prepaid (Wallet)</option>
              </select>
            </div>
            {form.accountType !== "prepaid" && (
              <div>
                <label className={labelCls}>Credit Limit (KES)</label>
                <input className={inputCls} type="number" min="0" value={form.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} placeholder="0 = no limit" />
              </div>
            )}
          </div>
          {form.accountType === "prepaid" && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <FaWallet className="inline mr-1.5" />
              Prepaid wallets are topped up in advance. When a job is created for a plate on this account, the balance is automatically deducted.
            </div>
          )}
          {form.accountType === "monthly" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Billing Cycle</label>
                <select className={inputCls} value={form.billingCycle} onChange={(e) => set("billingCycle", e.target.value)}>
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Billing Day (1–28)</label>
                <input className={inputCls} type="number" min="1" max="28" value={form.billingDay} onChange={(e) => set("billingDay", e.target.value)} />
              </div>
            </div>
          )}
          <div>
            <label className={labelCls}>Extra Plates (comma-separated)</label>
            <input className={inputCls} value={form.plates} onChange={(e) => set("plates", e.target.value)} placeholder="KCA123A, KCB456B" />
            <p className="mt-0.5 text-[10px] text-slate-400">Customer's existing plates are included automatically</p>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea className="w-full border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:outline-none" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button onClick={onClose} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
            {saving ? "Saving…" : "Create Account"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Record payment modal ─────────────────────────────────────────────────────
const PaymentModal = ({ account, cashbooks, onSave, onClose }) => {
  const [form, setForm] = useState({ amount: "", method: "cash", cashbookAccount: "", reference: "", receivedFromPhone: "", paymentDate: todayISO() });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.amount || Number(form.amount) <= 0) return toast.warning("Enter a valid amount");
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const lc = "mb-1 block text-[11px] font-extrabold uppercase tracking-widest text-slate-500";
  const ic = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";

  const balance = Number(account.currentBalance || 0);

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/50 px-4">
      <div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#0B3B2E] px-4 py-3 text-white">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wide">Record Payment</h2>
            <p className="mt-0.5 text-xs text-emerald-100">{account.accountNumber} · Balance: {fmt(balance)}</p>
          </div>
          <button onClick={onClose}><FaTimes /></button>
        </div>
        <div className="space-y-3 p-4">
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <strong>FIFO:</strong> Payment will be applied to oldest unpaid jobs first automatically.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>Amount (KES) *</label>
              <input className={ic} type="number" min="0" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder={`Max: ${fmt(balance)}`} />
            </div>
            <div>
              <label className={lc}>Method</label>
              <select className={ic} value={form.method} onChange={(e) => set("method", e.target.value)}>
                {paymentMethods.map((m) => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>{form.method === "mpesa" ? "M-Pesa Code" : "Reference"}</label>
              <input className={ic} value={form.reference} onChange={(e) => set("reference", e.target.value)} placeholder={form.method === "mpesa" ? "e.g. QJK1234ABC" : "Optional"} />
            </div>
            <div>
              <label className={lc}>Payment Date</label>
              <input className={ic} type="date" value={form.paymentDate} onChange={(e) => set("paymentDate", e.target.value)} />
            </div>
          </div>
          {form.method === "mpesa" && (
            <div>
              <label className={lc}>M-Pesa Sender Phone <span className="font-normal normal-case text-emerald-700">(SMS target)</span></label>
              <input className={ic} type="tel" value={form.receivedFromPhone} onChange={(e) => set("receivedFromPhone", e.target.value)} placeholder="e.g. 0712345678" />
            </div>
          )}
          <div>
            <label className={lc}>Cashbook Account</label>
            <select className={ic} value={form.cashbookAccount} onChange={(e) => set("cashbookAccount", e.target.value)}>
              <option value="">Select cashbook</option>
              {cashbooks.map((cb) => <option key={cb._id} value={cb._id}>{cb.code} - {cb.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button onClick={onClose} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 bg-[#FF8C00] px-4 py-2 text-xs font-bold text-white hover:bg-[#e67e00] disabled:opacity-50">
            <FaMoneyBillWave /> {saving ? "Applying…" : "Record Payment"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Top-up modal ─────────────────────────────────────────────────────────────
const TopUpModal = ({ account, cashbooks, onSave, onClose }) => {
  const [form, setForm] = useState({ amount: "", method: "cash", cashbookAccount: "", reference: "", paymentDate: todayISO(), notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.amount || Number(form.amount) <= 0) return toast.warning("Enter a valid top-up amount");
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const lc = "mb-1 block text-[11px] font-extrabold uppercase tracking-widest text-slate-500";
  const ic = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
  const credit = Number(account.accountCredit || 0);

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/50 px-4">
      <div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-emerald-700 px-4 py-3 text-white">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2">
              <FaWallet /> Top Up Prepaid Wallet
            </h2>
            <p className="mt-0.5 text-xs text-emerald-100">{account.accountNumber} · Current balance: KES {fmt(credit)}</p>
          </div>
          <button onClick={onClose}><FaTimes /></button>
        </div>
        <div className="space-y-3 p-4">
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            The amount entered will be added to the customer's wallet and automatically deducted when their next job is created.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>Amount (KES) *</label>
              <input className={ic} type="number" min="0" step="0.01" autoFocus value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="e.g. 500" />
            </div>
            <div>
              <label className={lc}>Method</label>
              <select className={ic} value={form.method} onChange={(e) => set("method", e.target.value)}>
                {paymentMethods.map((m) => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>{form.method === "mpesa" ? "M-Pesa Code" : "Reference"}</label>
              <input className={ic} value={form.reference} onChange={(e) => set("reference", e.target.value)} placeholder={form.method === "mpesa" ? "e.g. QJK1234ABC" : "Optional"} />
            </div>
            <div>
              <label className={lc}>Payment Date</label>
              <input className={ic} type="date" value={form.paymentDate} onChange={(e) => set("paymentDate", e.target.value)} />
            </div>
          </div>
          <div>
            <label className={lc}>Cashbook Account</label>
            <select className={ic} value={form.cashbookAccount} onChange={(e) => set("cashbookAccount", e.target.value)}>
              <option value="">Select cashbook</option>
              {cashbooks.map((cb) => <option key={cb._id} value={cb._id}>{cb.code} - {cb.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lc}>Notes</label>
            <input className={ic} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button onClick={onClose} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
            <FaWallet /> {saving ? "Adding…" : "Add to Wallet"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────
const CarWashAccounts = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const businessId = currentCompany?._id;

  const [accounts, setAccounts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [cashbooks, setCashbooks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedStatements, setExpandedStatements] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [payTarget, setPayTarget] = useState(null);
  const [topupTarget, setTopupTarget] = useState(null);
  const [expandedTopups, setExpandedTopups] = useState({});
  const [topupsLoading, setTopupsLoading] = useState({});
  const [smsTarget, setSmsTarget] = useState(null);
  const [smsBody, setSmsBody] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [stmtLoading, setStmtLoading] = useState({});
  const [filterStatus, setFilterStatus] = useState("active");
  const [filterType, setFilterType] = useState("");

  const loadAccounts = async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      if (filterType) params.accountType = filterType;
      const data = await carWashApi.listCreditAccounts(params);
      setAccounts(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Failed to load credit accounts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!businessId) return;
    Promise.all([
      carWashApi.listLoyaltyCustomers({}).catch(() => []),
      carWashApi.listChartOfAccounts({ type: "asset" }).catch(() => []),
    ]).then(([c, cb]) => {
      setCustomers(Array.isArray(c) ? c : []);
      setCashbooks(Array.isArray(cb) ? cb.filter((a) => a.isPosting !== false) : []);
    });
  }, [businessId]);

  useEffect(() => { loadAccounts(); }, [businessId, filterStatus, filterType]);

  const toggleExpand = async (acc) => {
    if (expandedId === acc._id) { setExpandedId(null); return; }
    setExpandedId(acc._id);
  };

  const loadStatements = async (accId) => {
    setStmtLoading((p) => ({ ...p, [accId]: true }));
    try {
      const data = await carWashApi.listStatements(accId);
      setExpandedStatements((p) => ({ ...p, [accId]: Array.isArray(data) ? data : [] }));
    } catch { toast.error("Failed to load statements"); }
    finally { setStmtLoading((p) => ({ ...p, [accId]: false })); }
  };

  const handleCreate = async (payload) => {
    await carWashApi.createCreditAccount(payload);
    toast.success("Credit account created");
    setShowCreate(false);
    loadAccounts();
  };

  const handlePayment = async (form) => {
    const res = await carWashApi.recordAccountPayment(payTarget._id, {
      ...form,
      amount: Number(form.amount),
    });
    toast.success(res?.message || "Payment applied");
    setPayTarget(null);
    loadAccounts();
    if (expandedId === payTarget._id) loadStatements(payTarget._id);
  };

  const handleTopup = async (form) => {
    const res = await carWashApi.recordAccountTopup(topupTarget._id, {
      ...form,
      amount: Number(form.amount),
    });
    toast.success(res?.message || "Wallet topped up");
    setTopupTarget(null);
    loadAccounts();
    if (expandedId === topupTarget._id) loadTopups(topupTarget._id);
  };

  const loadTopups = async (accId) => {
    setTopupsLoading((p) => ({ ...p, [accId]: true }));
    try {
      const data = await carWashApi.listAccountTopups(accId);
      setExpandedTopups((p) => ({ ...p, [accId]: Array.isArray(data) ? data : [] }));
    } catch { toast.error("Failed to load top-up history"); }
    finally { setTopupsLoading((p) => ({ ...p, [accId]: false })); }
  };

  const handleGenerateStatement = async (acc) => {
    try {
      const res = await carWashApi.generateStatement(acc._id, {});
      toast.success(`Statement ${res?.statementNumber || ""} generated`);
      loadAccounts();
      loadStatements(acc._id);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to generate statement");
    }
  };

  const openStatementSms = (acc, stmt) => {
    setSmsTarget({ _id: stmt._id, _accId: acc._id, name: acc.customer?.name, phone: acc.customer?.phone });
    const period = fmtMonth(stmt.periodStart);
    setSmsBody(`Hi ${acc.customer?.name || "Customer"}, your car wash statement for ${period} is KES ${Number(stmt.totalOutstanding || 0).toLocaleString()} for ${stmt.totalJobs} wash(es). Ref: ${stmt.statementNumber}. Thank you!`);
  };

  const sendStatementSms = async (phone, body) => {
    if (!smsTarget) return;
    setSmsSending(true);
    try {
      await carWashApi.sendStatementSms(smsTarget._accId, smsTarget._id, { phone, body });
      toast.success("Statement SMS sent");
      setSmsTarget(null);
      loadStatements(smsTarget._accId);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send SMS");
    } finally { setSmsSending(false); }
  };

  // Summary stats
  const stats = useMemo(() => {
    const total = accounts.length;
    const totalOwed = accounts.reduce((s, a) => a.accountType !== "prepaid" ? s + Math.max(0, Number(a.currentBalance || 0)) : s, 0);
    const totalPrepaidCredit = accounts.reduce((s, a) => a.accountType === "prepaid" ? s + Number(a.accountCredit || 0) : s, 0);
    const overLimit = accounts.filter((a) => a.accountType !== "prepaid" && a.creditLimit > 0 && a.currentBalance > a.creditLimit).length;
    return { total, totalOwed, totalPrepaidCredit, overLimit };
  }, [accounts]);

  return (
    <CarWashShell activePage="accounts">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* ── Header ── */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-2 py-1">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Car Wash</div>
              <h1 className="text-sm font-bold text-slate-900 leading-tight">Credit Accounts</h1>
            </div>
            <div className="flex items-center gap-1">
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="h-7 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:border-[#0B3B2E]">
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="closed">Closed</option>
              </select>
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="h-7 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:border-[#0B3B2E]">
                <option value="">All Types</option>
                <option value="credit">Credit</option>
                <option value="monthly">Monthly</option>
              </select>
              <button onClick={loadAccounts} className="flex h-7 items-center gap-1 border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:bg-slate-50"><FaRedoAlt size={9} className={loading ? "animate-spin" : ""} /></button>
              <button onClick={() => setShowCreate(true)} className="flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]">
                <FaPlus size={9} /> New Account
              </button>
            </div>
          </div>

          {/* KPI strip */}
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="font-semibold text-slate-700">{stats.total} accounts</span>
            <span className="text-slate-300">·</span>
            <span className="font-bold text-red-600">Credit owed: {fmt(stats.totalOwed)}</span>
            {stats.totalPrepaidCredit > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="font-semibold text-emerald-700">
                  <FaWallet className="mr-1 inline" size={8} />Prepaid float: {fmt(stats.totalPrepaidCredit)}
                </span>
              </>
            )}
            {stats.overLimit > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="font-bold text-amber-700">
                  <FaExclamationTriangle className="mr-1 inline" size={8} />{stats.overLimit} over limit
                </span>
              </>
            )}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#0B3B2E] text-white">
                <th className="w-6 px-3 py-1.5" />
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Account</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Customer / Plates</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Type</th>
                <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Balance</th>
                <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Limit</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
                <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-10 text-center text-slate-400">Loading…</td></tr>
              ) : accounts.length === 0 ? (
                <tr><td colSpan={8} className="py-14 text-center">
                  <FaUser className="mx-auto mb-2 text-2xl text-slate-200" />
                  <div className="text-sm font-semibold text-slate-400">No credit accounts yet</div>
                  <div className="mt-1 text-xs text-slate-400">Create an account to start tracking credit customers</div>
                </td></tr>
              ) : accounts.map((acc) => {
                const balance = Number(acc.currentBalance || 0);
                const overLimit = acc.creditLimit > 0 && balance > acc.creditLimit;
                const expanded = expandedId === acc._id;
                return (
                  <React.Fragment key={acc._id}>
                    <tr className={`border-b border-slate-100 ${overLimit ? "bg-amber-50/60" : "bg-white hover:bg-slate-50"} cursor-pointer`} onClick={() => toggleExpand(acc)}>
                      <td className="px-3 py-2 text-slate-400">
                        {expanded ? <FaChevronDown className="text-[10px]" /> : <FaChevronRight className="text-[10px]" />}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-black text-slate-900">{acc.accountNumber}</div>
                        {acc.lastStatementAt && <div className="text-[10px] text-slate-400">Last stmt: {fmtDate(acc.lastStatementAt)}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">{acc.customer?.name || "—"}</div>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {(acc.plates || []).map((p) => (
                            <span key={p} className="rounded bg-slate-100 px-1.5 py-0 text-[10px] font-bold text-slate-600">{p}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-bold uppercase ${acc.accountType === "monthly" ? "bg-violet-100 text-violet-700" : acc.accountType === "prepaid" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
                          {acc.accountType}
                        </span>
                        {acc.accountType === "monthly" && (
                          <div className="text-[10px] text-slate-400 mt-0.5">Bills day {acc.billingDay}</div>
                        )}
                        {acc.accountType === "prepaid" && (
                          <div className="text-[10px] text-slate-400 mt-0.5">Wallet</div>
                        )}
                      </td>
                      {acc.accountType === "prepaid" ? (
                        <td className="px-3 py-2 text-right font-black text-emerald-700">
                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Available</div>
                          {fmt(Number(acc.accountCredit || 0))}
                        </td>
                      ) : (
                        <td className={`px-3 py-2 text-right font-black ${balance > 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {fmt(balance)}
                          {overLimit && <div className="text-[10px] font-bold text-amber-600">Over limit</div>}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right text-slate-600">
                        {acc.accountType === "prepaid"
                          ? <span className="text-[10px] text-slate-400">—</span>
                          : acc.creditLimit > 0 ? fmt(acc.creditLimit) : <span className="text-slate-300">None</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${statusPill[acc.status] || statusPill.active}`}>
                          {acc.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
                          {acc.accountType === "prepaid" && acc.status === "active" && (
                            <button onClick={() => setTopupTarget(acc)} className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100">
                              <FaWallet /> Top Up
                            </button>
                          )}
                          {acc.accountType !== "prepaid" && balance > 0 && acc.status === "active" && (
                            <button onClick={() => setPayTarget(acc)} className="inline-flex items-center gap-1 border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700 hover:bg-orange-100">
                              <FaMoneyBillWave /> Pay
                            </button>
                          )}
                          {acc.accountType === "monthly" && acc.status === "active" && (
                            <button onClick={() => handleGenerateStatement(acc)} className="inline-flex items-center gap-1 border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 hover:bg-violet-100">
                              <FaFileInvoice /> Statement
                            </button>
                          )}
                          <button
                            onClick={() => {
                              toggleExpand(acc);
                              if (!expanded) {
                                if (acc.accountType === "prepaid") loadTopups(acc._id);
                                else loadStatements(acc._id);
                              }
                            }}
                            className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50">
                            {expanded ? "Hide" : "View"}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* ── Expanded detail ── */}
                    {expanded && (
                      <tr className="border-b border-slate-100 bg-slate-50/70">
                        <td colSpan={8} className="px-6 py-3">
                          {acc.accountType === "prepaid" ? (
                            /* Prepaid: show wallet summary + top-up history */
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Wallet Summary</div>
                                <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] text-slate-500 font-semibold">Available Balance</span>
                                    <span className="font-black text-emerald-700 text-base">{fmt(Number(acc.accountCredit || 0))}</span>
                                  </div>
                                  <div className="mt-2 text-[10px] text-slate-500">
                                    Balance is automatically deducted when a new job is created for any plate on this account.
                                  </div>
                                </div>
                                <div className="mt-3 text-[11px] font-black uppercase tracking-wide text-slate-500">Recent Jobs</div>
                                <div className="mt-1"><AccountJobsList accId={acc._id} /></div>
                              </div>
                              <div>
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="text-[11px] font-black uppercase tracking-wide text-slate-500 flex items-center gap-1"><FaHistory size={9} /> Top-up History</span>
                                  <button onClick={() => loadTopups(acc._id)} className="text-[10px] text-slate-400 hover:text-slate-600"><FaRedoAlt size={9} /></button>
                                </div>
                                {topupsLoading[acc._id] ? (
                                  <div className="text-[11px] text-slate-400">Loading…</div>
                                ) : (expandedTopups[acc._id] || []).length === 0 ? (
                                  <div className="text-[11px] text-slate-400">No top-ups yet</div>
                                ) : (expandedTopups[acc._id] || []).map((t) => (
                                  <div key={t._id} className="mb-1.5 flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2">
                                    <div>
                                      <div className="font-black text-emerald-700 text-[11px]">+{fmt(t.amount)}</div>
                                      <div className="text-[10px] text-slate-500">{t.method} {t.reference ? `· ${t.reference}` : ""} · {fmtDate(t.paymentDate)}</div>
                                    </div>
                                    {t.notes && <div className="text-[10px] text-slate-400 italic max-w-[120px] truncate">{t.notes}</div>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            /* Credit / Monthly: existing jobs + statements view */
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Unpaid Jobs</div>
                                <AccountJobsList accId={acc._id} />
                              </div>
                              <div>
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">Statements</span>
                                  {acc.accountType === "monthly" && (
                                    <button onClick={() => handleGenerateStatement(acc)} className="text-[10px] font-bold text-violet-700 hover:underline">
                                      + Generate
                                    </button>
                                  )}
                                </div>
                                {stmtLoading[acc._id] ? (
                                  <div className="text-[11px] text-slate-400">Loading…</div>
                                ) : (expandedStatements[acc._id] || []).length === 0 ? (
                                  <div className="text-[11px] text-slate-400">No statements yet</div>
                                ) : (expandedStatements[acc._id] || []).map((s) => (
                                  <div key={s._id} className="mb-1.5 flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2">
                                    <div>
                                      <div className="font-black text-slate-900 text-[11px]">{s.statementNumber}</div>
                                      <div className="text-[10px] text-slate-500">{fmtMonth(s.periodStart)} · {s.totalJobs} jobs</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${stmtPill[s.status] || stmtPill.draft}`}>{s.status}</span>
                                      <span className="font-black text-slate-900 text-[11px]">{fmt(s.totalOutstanding)}</span>
                                      {acc.customer?.phone && s.status !== "paid" && (
                                        <button onClick={() => openStatementSms(acc, s)} className="text-[10px] text-emerald-700 hover:underline">
                                          <FaSms />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <AccountModal customers={customers} onSave={handleCreate} onClose={() => setShowCreate(false)} />
      )}

      {payTarget && (
        <PaymentModal account={payTarget} cashbooks={cashbooks} onSave={handlePayment} onClose={() => setPayTarget(null)} />
      )}

      {topupTarget && (
        <TopUpModal account={topupTarget} cashbooks={cashbooks} onSave={handleTopup} onClose={() => setTopupTarget(null)} />
      )}

      {smsTarget && (
        <CwSmsModal
          target={{ _id: smsTarget._id, name: smsTarget.name, phone: smsTarget.phone || "" }}
          defaultBody={smsBody}
          templates={[]}
          context="Statement"
          onSend={sendStatementSms}
          onClose={() => setSmsTarget(null)}
          sending={smsSending}
        />
      )}
    </CarWashShell>
  );
};

// ─── Lazy job list for expanded row ──────────────────────────────────────────
const AccountJobsList = ({ accId }) => {
  const [jobs, setJobs] = useState(null);
  useEffect(() => {
    carWashApi.getCreditAccount(accId)
      .then((d) => setJobs((d?.jobs || []).filter((j) => j.paymentStatus !== "paid")))
      .catch(() => setJobs([]));
  }, [accId]);

  if (!jobs) return <div className="text-[11px] text-slate-400">Loading…</div>;
  if (!jobs.length) return <div className="text-[11px] text-emerald-600 font-semibold">All jobs paid ✓</div>;

  return (
    <div className="space-y-1 max-h-48 overflow-y-auto">
      {jobs.map((j) => (
        <div key={j._id} className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-1.5">
          <div>
            <div className="font-bold text-slate-900 text-[11px]">{j.jobNumber}</div>
            <div className="text-[10px] text-slate-500">{j.plateNumber} · {j.serviceName} · {fmtDate(j.jobDate || j.createdAt)}</div>
          </div>
          <div className="text-right">
            <div className="font-black text-red-600 text-[11px]">{formatMoney(j.outstanding)}</div>
            <div className={`text-[10px] font-bold ${j.paymentStatus === "partial" ? "text-amber-600" : "text-slate-500"}`}>{j.paymentStatus}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default CarWashAccounts;

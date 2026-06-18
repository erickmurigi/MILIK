import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import {
  FaCalendarAlt, FaCheckCircle, FaChevronDown, FaChevronRight,
  FaEnvelope, FaFileInvoice, FaMoneyBillWave, FaPlus, FaPrint, FaRedoAlt, FaSms,
  FaTimes, FaUndo, FaUser, FaExclamationTriangle, FaWallet, FaHistory,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import CwSmsModal from "./CwSmsModal";
import useCarWashPermission from "../../hooks/useCarWashPermission";

const GRN = "#0B3B2E";
const ORG = "#FF8C00";

const fmt = formatMoney;
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-KE") : "—";
const fmtMonth = (v) => v ? new Date(v).toLocaleString("en-KE", { month: "long", year: "numeric" }) : "—";

const printCreditStatement = (acc, s) => {
  const fa  = (n) => `KES ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;
  const fd  = (d) => new Date(d).toLocaleDateString("en-KE");
  const per = fmtMonth(s.periodStart);
  const who = acc.contactPerson || acc.customer?.name || "Customer";
  const rows = (s.jobs || []).map((j) => `
    <tr>
      <td>${fd(j.jobDate)}</td><td>${j.jobNumber || "—"}</td><td>${j.plateNumber || "—"}</td>
      <td>${j.serviceName || "—"}</td>
      <td class="r">${fa(j.price)}</td><td class="r">${fa(j.paidAmount)}</td>
      <td class="r" style="color:${j.outstanding > 0 ? "#dc2626" : "#16a34a"}">${fa(j.outstanding)}</td>
    </tr>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${s.statementNumber}</title>
    <style>
      body{font-family:Arial,sans-serif;color:#1e293b;max-width:760px;margin:0 auto;padding:24px;font-size:13px}
      .hdr{background:#0B3B2E;color:#fff;padding:16px 20px}
      .hdr h2{margin:0;font-size:17px} .hdr p{margin:4px 0 0;opacity:.75;font-size:12px}
      .bdy{border:1px solid #e2e8f0;border-top:none;padding:20px}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      th{background:#f1f5f9;padding:7px 8px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
      td{padding:6px 8px;border-bottom:1px solid #e2e8f0} .r{text-align:right}
      .tot td{font-weight:bold;background:#f8fafc}
      .due td{background:#0B3B2E;color:#fff;font-weight:bold;font-size:14px}
      @media print{button{display:none}}
    </style></head><body>
    <div class="hdr"><h2>Car Wash Account Statement</h2><p>${per} · Ref: ${s.statementNumber}</p></div>
    <div class="bdy">
      <p><strong>To:</strong> ${who}</p>
      <p><strong>Account:</strong> ${acc.accountNumber || ""}</p>
      <p><strong>Period:</strong> ${per}</p>
      <table>
        <thead><tr><th>Date</th><th>Job #</th><th>Plate</th><th>Service</th><th class="r">Amount</th><th class="r">Paid</th><th class="r">Balance</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="tot"><td colspan="4">Opening Balance</td><td colspan="3" class="r">${fa(s.openingBalance)}</td></tr>
          <tr class="tot"><td colspan="4">Total Invoiced</td><td colspan="3" class="r">${fa(s.totalInvoiced)}</td></tr>
          <tr class="tot"><td colspan="4">Total Paid</td><td colspan="3" class="r">${fa(s.totalPaid)}</td></tr>
          <tr class="due"><td colspan="4">Amount Due</td><td colspan="3" class="r">${fa(s.totalOutstanding)}</td></tr>
        </tfoot>
      </table>
      <p style="margin-top:16px;font-size:11px;color:#64748b">This is an automatically generated statement. Please contact us if you have any queries.</p>
    </div>
    <script>window.onload=()=>window.print();</script>
  </body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
};

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
const PLATE_RE = /^[A-Z]{2,3}\d{3}[A-Z]$/i;

// ─── Create/edit account modal ────────────────────────────────────────────────
const AccountModal = ({ customers, onSave, onClose }) => {
  const [query, setQuery]                   = useState("");
  const [dropdownOpen, setDropdownOpen]     = useState(false);
  const [selectedCustomer, setSelected]     = useState(null);
  const [isNew, setIsNew]                   = useState(false);
  const [newPhone, setNewPhone]             = useState("");
  const [form, setForm] = useState({
    accountType: "credit", contactPerson: "", billingEmail: "",
    creditLimit: "", billingCycle: "monthly", billingDay: "1", notes: "", plates: "",
  });
  const [saving, setSaving] = useState(false);
  const comboRef = useRef(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const handler = (e) => {
      if (comboRef.current && !comboRef.current.contains(e.target)) setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers.slice(0, 20);
    return customers.filter((c) =>
      c.name?.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      (c.plates || []).some((p) => p.toLowerCase().includes(q))
    ).slice(0, 15);
  }, [customers, query]);

  const pickCustomer = (c) => { setSelected(c); setQuery(c.name); setDropdownOpen(false); setIsNew(false); };
  const pickNew      = () => { setSelected(null); setIsNew(true); setDropdownOpen(false); };
  const clearPick    = () => { setSelected(null); setIsNew(false); setQuery(""); setNewPhone(""); };

  const handleSave = async () => {
    if (!selectedCustomer && !isNew) return toast.warning("Select or create a customer");
    if (isNew && !query.trim()) return toast.warning("Enter a customer name");
    setSaving(true);
    try {
      let customerId = selectedCustomer?._id;
      if (isNew) {
        const created = await carWashApi.registerLoyaltyCustomer({
          name: query.trim(),
          ...(newPhone.trim() && { phone: newPhone.trim() }),
        });
        customerId = created?._id;
        if (!customerId) throw new Error("Failed to create customer");
      }
      await onSave({
        customerId,
        accountType: form.accountType,
        contactPerson: form.contactPerson.trim(),
        billingEmail: form.billingEmail.trim().toLowerCase(),
        creditLimit: Number(form.creditLimit || 0),
        billingCycle: form.billingCycle,
        billingDay: Number(form.billingDay || 1),
        notes: form.notes,
        plates: form.plates.split(",").map((p) => p.trim()).filter(Boolean),
      });
    } finally {
      setSaving(false);
    }
  };

  const lc = "mb-1 block text-[11px] font-extrabold uppercase tracking-widest text-slate-500";
  const ic = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/50 px-4">
      <div className="w-full max-w-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#0B3B2E] px-4 py-3 text-white">
          <h2 className="text-sm font-extrabold uppercase tracking-wide">New Credit Account</h2>
          <button onClick={onClose}><FaTimes /></button>
        </div>
        <div className="space-y-3 p-4">

          {/* ── Customer combobox ── */}
          <div>
            <label className={lc}>Customer *</label>
            {selectedCustomer ? (
              <div className="flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-3 h-9">
                <FaUser size={9} className="text-emerald-600 flex-shrink-0" />
                <span className="flex-1 text-sm font-semibold text-emerald-800 truncate">{selectedCustomer.name}</span>
                {selectedCustomer.phone && <span className="text-[10px] text-emerald-600 flex-shrink-0">{selectedCustomer.phone}</span>}
                <button type="button" onClick={clearPick} className="text-emerald-400 hover:text-red-500 flex-shrink-0"><FaTimes size={10} /></button>
              </div>
            ) : isNew ? (
              <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">New customer: <span className="normal-case">{query}</span></p>
                  <button type="button" onClick={clearPick} className="text-[10px] text-slate-400 hover:text-slate-600">← Back</button>
                </div>
                <input className={ic} type="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone (optional, e.g. 0712345678)" />
              </div>
            ) : (
              <div ref={comboRef} className="relative">
                <input
                  className={ic}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true); }}
                  onFocus={() => setDropdownOpen(true)}
                  placeholder="Search name, phone, or plate…"
                  autoComplete="new-password"
                />
                {dropdownOpen && (
                  <div className="absolute left-0 right-0 top-full z-50 max-h-52 overflow-y-auto border border-slate-200 bg-white shadow-xl">
                    {filtered.length === 0 && !query.trim() ? (
                      <p className="px-3 py-2 text-[11px] text-slate-400">Start typing to search customers…</p>
                    ) : filtered.length === 0 ? null : (
                      filtered.map((c) => (
                        <button key={c._id} type="button" onMouseDown={() => pickCustomer(c)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 border-b border-slate-50 last:border-0">
                          <FaUser size={9} className="text-slate-300 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-800 truncate">{c.name}</div>
                            {(c.phone || (c.plates || []).length > 0) && (
                              <div className="text-[10px] text-slate-400 truncate">
                                {[c.phone, ...(c.plates || [])].filter(Boolean).join(" · ")}
                              </div>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                    {query.trim() && (
                      <button type="button" onMouseDown={pickNew}
                        className="flex w-full items-center gap-2 border-t border-slate-200 bg-emerald-50 px-3 py-2 text-left hover:bg-emerald-100">
                        <FaPlus size={9} className="text-emerald-600 flex-shrink-0" />
                        <span className="text-sm text-emerald-700">Create new: <b>{query.trim()}</b></span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Account type + limit ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>Account Type *</label>
              <select className={ic} value={form.accountType} onChange={(e) => set("accountType", e.target.value)}>
                <option value="credit">Credit (Pay-later)</option>
                <option value="monthly">Monthly Billing</option>
                <option value="prepaid">Prepaid (Wallet)</option>
              </select>
            </div>
            {form.accountType !== "prepaid" && (
              <div>
                <label className={lc}>Credit Limit (KES)</label>
                <input className={ic} type="number" min="0" value={form.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} placeholder="0 = no limit" />
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
                <label className={lc}>Billing Cycle</label>
                <select className={ic} value={form.billingCycle} onChange={(e) => set("billingCycle", e.target.value)}>
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div>
                <label className={lc}>Billing Day (1–28)</label>
                <input className={ic} type="number" min="1" max="28" value={form.billingDay} onChange={(e) => set("billingDay", e.target.value)} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>Contact Person</label>
              <input className={ic} value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} placeholder="e.g. John Kamau (Fleet Mgr)" />
            </div>
            <div>
              <label className={lc}>Billing Email</label>
              <input className={ic} type="email" value={form.billingEmail} onChange={(e) => set("billingEmail", e.target.value)} placeholder="accounts@company.com" />
            </div>
          </div>
          <div>
            <label className={lc}>Plates (comma-separated)</label>
            <input className={ic} value={form.plates} onChange={(e) => set("plates", e.target.value)} placeholder="KCA123A, KCB456B, KCC789C" />
            <p className="mt-0.5 text-[10px] text-slate-400">Jobs for these plates auto-link to this account</p>
          </div>
          <div>
            <label className={lc}>Notes</label>
            <textarea className="w-full border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:outline-none" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button onClick={onClose} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
            {saving ? "Saving…" : isNew ? "Create Customer & Account" : "Create Account"}
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
  const queryClient = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const businessId = currentCompany?._id;

  const canManage = useCarWashPermission("carwash-loyalty", "manage");
  const canRecord  = useCarWashPermission("carwash-payments", "record");

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
  const [emailSending, setEmailSending] = useState(null); // statementId being emailed
  const [stmtLoading, setStmtLoading] = useState({});
  const [filterStatus, setFilterStatus] = useState("active");
  const [filterType, setFilterType] = useState("");
  const [editTarget, setEditTarget] = useState(null);

  const { data: accountsData, isLoading: loading, error, refetch: refetchAccounts } = useQuery({
    queryKey: ["cw-credit-accounts", businessId, filterStatus, filterType],
    queryFn: async () => {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      if (filterType) params.accountType = filterType;
      return carWashApi.listCreditAccounts(params);
    },
    enabled: !!businessId,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const { data: refData } = useQuery({
    queryKey: ["cw-accounts-ref", businessId],
    queryFn: () => Promise.all([
      carWashApi.listLoyaltyCustomers({ limit: 500 }).catch(() => []),
      carWashApi.listChartOfAccounts({ type: "asset" }).catch(() => []),
    ]).then(([c, cb]) => ({
      customers: Array.isArray(c) ? c : [],
      cashbooks: Array.isArray(cb) ? cb.filter((a) => a.isPosting !== false) : [],
    })),
    enabled: !!businessId,
    staleTime: 5 * 60_000,
  });

  useEffect(() => { if (error) toast.error("Failed to load credit accounts"); }, [error]);

  const accounts  = useMemo(() => Array.isArray(accountsData) ? accountsData : [], [accountsData]);
  const customers = useMemo(() => (refData?.customers ?? []).filter((c) => c.name && !PLATE_RE.test(c.name.trim())), [refData]);
  const cashbooks = useMemo(() => refData?.cashbooks ?? [], [refData]);

  const toggleExpand = useCallback((acc) => {
    setExpandedId((prev) => (prev === acc._id ? null : acc._id));
  }, []);

  const loadStatements = useCallback(async (accId) => {
    setStmtLoading((p) => ({ ...p, [accId]: true }));
    try {
      const data = await carWashApi.listStatements(accId);
      setExpandedStatements((p) => ({ ...p, [accId]: Array.isArray(data) ? data : [] }));
    } catch { toast.error("Failed to load statements"); }
    finally { setStmtLoading((p) => ({ ...p, [accId]: false })); }
  }, []);

  const loadTopups = useCallback(async (accId) => {
    setTopupsLoading((p) => ({ ...p, [accId]: true }));
    try {
      const data = await carWashApi.listAccountTopups(accId);
      setExpandedTopups((p) => ({ ...p, [accId]: Array.isArray(data) ? data : [] }));
    } catch { toast.error("Failed to load top-up history"); }
    finally { setTopupsLoading((p) => ({ ...p, [accId]: false })); }
  }, []);

  const handleCreate = useCallback(async (payload) => {
    await carWashApi.createCreditAccount(payload);
    toast.success("Credit account created");
    setShowCreate(false);
    queryClient.invalidateQueries({ queryKey: ["cw-credit-accounts"] });
  }, [queryClient]);

  const handlePayment = useCallback(async (form) => {
    const res = await carWashApi.recordAccountPayment(payTarget._id, { ...form, amount: Number(form.amount) });
    toast.success(res?.message || "Payment applied");
    const targetId = payTarget._id;
    setPayTarget(null);
    queryClient.invalidateQueries({ queryKey: ["cw-credit-accounts"] });
    if (expandedId === targetId) loadStatements(targetId);
  }, [payTarget, expandedId, queryClient, loadStatements]);

  const handleEdit = useCallback(async (form) => {
    await carWashApi.updateCreditAccount(editTarget._id, form);
    toast.success("Account updated");
    setEditTarget(null);
    queryClient.invalidateQueries({ queryKey: ["cw-credit-accounts"] });
  }, [editTarget, queryClient]);

  const handleTopup = useCallback(async (form) => {
    const res = await carWashApi.recordAccountTopup(topupTarget._id, { ...form, amount: Number(form.amount) });
    toast.success(res?.message || "Wallet topped up");
    const targetId = topupTarget._id;
    setTopupTarget(null);
    queryClient.invalidateQueries({ queryKey: ["cw-credit-accounts"] });
    if (expandedId === targetId) loadTopups(targetId);
  }, [topupTarget, expandedId, queryClient, loadTopups]);

  const handleGenerateStatement = useCallback(async (acc) => {
    try {
      const res = await carWashApi.generateStatement(acc._id, {});
      toast.success(`Statement ${res?.statementNumber || ""} generated`);
      queryClient.invalidateQueries({ queryKey: ["cw-credit-accounts"] });
      loadStatements(acc._id);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to generate statement");
    }
  }, [queryClient, loadStatements]);

  const openStatementSms = useCallback((acc, stmt) => {
    setSmsTarget({ _id: stmt._id, _accId: acc._id, name: acc.customer?.name, phone: acc.customer?.phone });
    setSmsBody(`Hi ${acc.customer?.name || "Customer"}, your car wash statement for ${fmtMonth(stmt.periodStart)} is KES ${Number(stmt.totalOutstanding || 0).toLocaleString()} for ${stmt.totalJobs} wash(es). Ref: ${stmt.statementNumber}. Thank you!`);
  }, []);

  const sendStatementSms = useCallback(async (phone, body) => {
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
  }, [smsTarget, loadStatements]);

  const sendStatementEmail = useCallback(async (acc, stmt) => {
    const email = acc.billingEmail || "";
    if (!email) return toast.warning("No billing email on this account. Add one via Edit.");
    setEmailSending(stmt._id);
    try {
      const res = await carWashApi.sendStatementEmail(acc._id, stmt._id, { email });
      toast.success(res?.message || "Statement emailed");
      loadStatements(acc._id);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send email");
    } finally { setEmailSending(null); }
  }, [loadStatements]);

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
                <option value="prepaid">Prepaid</option>
              </select>
              <button onClick={() => refetchAccounts()} className="flex h-7 items-center gap-1 border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:bg-slate-50"><FaRedoAlt size={9} className={loading ? "animate-spin" : ""} /></button>
              {canManage && (
                <button onClick={() => setShowCreate(true)} className="flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]">
                  <FaPlus size={9} /> New Account
                </button>
              )}
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
                          {acc.accountType === "prepaid" && acc.status === "active" && canRecord && (
                            <button onClick={() => setTopupTarget(acc)} className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100">
                              <FaWallet /> Top Up
                            </button>
                          )}
                          {acc.accountType !== "prepaid" && balance > 0 && acc.status === "active" && canRecord && (
                            <button onClick={() => setPayTarget(acc)} className="inline-flex items-center gap-1 border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700 hover:bg-orange-100">
                              <FaMoneyBillWave /> Pay
                            </button>
                          )}
                          {acc.accountType !== "prepaid" && acc.status === "active" && (
                            <button onClick={() => handleGenerateStatement(acc)} className="inline-flex items-center gap-1 border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 hover:bg-violet-100">
                              <FaFileInvoice /> Statement
                            </button>
                          )}
                          {canManage && (
                            <button onClick={() => setEditTarget(acc)} className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50">
                              Edit
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
                                <div className="mt-1"><AccountJobsList accId={acc._id} accountType={acc.accountType} /></div>
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
                                  <div key={t._id} className={`mb-1.5 flex items-center justify-between rounded border px-3 py-2 ${t.isVoided ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
                                    <div className="min-w-0">
                                      <div className={`font-black text-[11px] ${t.isVoided ? "text-slate-400 line-through" : "text-emerald-700"}`}>+{fmt(t.amount)}</div>
                                      <div className="text-[10px] text-slate-500">{t.method} {t.reference ? `· ${t.reference}` : ""} · {fmtDate(t.paymentDate)}</div>
                                      {t.isVoided && <div className="text-[10px] text-red-500 font-bold">VOIDED{t.voidReason ? ` — ${t.voidReason}` : ""}</div>}
                                    </div>
                                    {!t.isVoided && canRecord && (
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          const reason = window.prompt(`Reason for voiding this top-up of ${fmt(t.amount)}?`, "");
                                          if (reason === null) return;
                                          try {
                                            await carWashApi.voidTopup(acc._id, t._id, reason);
                                            toast.success("Top-up voided and ledger reversed");
                                            loadTopups(acc._id);
                                            queryClient.invalidateQueries({ queryKey: ["cw-credit-accounts"] });
                                          } catch (err) {
                                            toast.error(err?.response?.data?.message || "Failed to void top-up");
                                          }
                                        }}
                                        className="ml-2 inline-flex shrink-0 items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-100"
                                        title="Void this top-up"
                                      >
                                        <FaUndo size={8} /> Void
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            /* Credit / Monthly: existing jobs + statements view */
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Unpaid Jobs</div>
                                <AccountJobsList accId={acc._id} accountType={acc.accountType} />
                              </div>
                              <div>
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">Statements</span>
                                  {acc.accountType !== "prepaid" && (
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
                                      <button onClick={() => printCreditStatement(acc, s)} title="Print / View" className="text-[10px] text-slate-400 hover:text-slate-700">
                                        <FaPrint />
                                      </button>
                                      {acc.customer?.phone && s.status !== "paid" && (
                                        <button onClick={() => openStatementSms(acc, s)} title="Send SMS" className="text-[10px] text-emerald-700 hover:text-emerald-900">
                                          <FaSms />
                                        </button>
                                      )}
                                      {s.status !== "paid" && (
                                        <button
                                          onClick={() => sendStatementEmail(acc, s)}
                                          disabled={emailSending === s._id}
                                          title={acc.billingEmail ? `Email to ${acc.billingEmail}` : "No billing email — add one via Edit"}
                                          className={`text-[10px] ${acc.billingEmail ? "text-blue-600 hover:text-blue-800" : "text-slate-300 cursor-not-allowed"}`}
                                        >
                                          {emailSending === s._id ? "…" : <FaEnvelope />}
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

      {editTarget && (
        <EditAccountModal account={editTarget} onSave={handleEdit} onClose={() => setEditTarget(null)} />
      )}
    </CarWashShell>
  );
};

// ─── Edit account modal ───────────────────────────────────────────────────────
const EditAccountModal = ({ account, onSave, onClose }) => {
  const [form, setForm] = useState({
    contactPerson: account.contactPerson || "",
    billingEmail: account.billingEmail || "",
    creditLimit: String(account.creditLimit || ""),
    billingCycle: account.billingCycle || "monthly",
    billingDay: String(account.billingDay || "1"),
    status: account.status || "active",
    notes: account.notes || "",
    plates: (account.plates || []).join(", "),
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        contactPerson: form.contactPerson.trim(),
        billingEmail: form.billingEmail.trim().toLowerCase(),
        creditLimit: Number(form.creditLimit || 0),
        billingCycle: form.billingCycle,
        billingDay: Number(form.billingDay || 1),
        status: form.status,
        notes: form.notes,
        plates: form.plates.split(",").map((p) => p.trim()).filter(Boolean),
      });
    } finally {
      setSaving(false);
    }
  };

  const lc = "mb-1 block text-[11px] font-extrabold uppercase tracking-widest text-slate-500";
  const ic = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/50 px-4">
      <div className="w-full max-w-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#0B3B2E] px-4 py-3 text-white">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wide">Edit Account</h2>
            <p className="mt-0.5 text-xs text-emerald-100">{account.accountNumber} · {account.customer?.name}</p>
          </div>
          <button onClick={onClose}><FaTimes /></button>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>Status</label>
              <select className={ic} value={form.status} onChange={(e) => set("status", e.target.value)}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            {account.accountType !== "prepaid" && (
              <div>
                <label className={lc}>Credit Limit (KES)</label>
                <input className={ic} type="number" min="0" value={form.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} placeholder="0 = no limit" />
              </div>
            )}
          </div>
          {account.accountType === "monthly" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lc}>Billing Cycle</label>
                <select className={ic} value={form.billingCycle} onChange={(e) => set("billingCycle", e.target.value)}>
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div>
                <label className={lc}>Billing Day (1–28)</label>
                <input className={ic} type="number" min="1" max="28" value={form.billingDay} onChange={(e) => set("billingDay", e.target.value)} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>Contact Person</label>
              <input className={ic} value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} placeholder="e.g. John Kamau" />
            </div>
            <div>
              <label className={lc}>Billing Email</label>
              <input className={ic} type="email" value={form.billingEmail} onChange={(e) => set("billingEmail", e.target.value)} placeholder="accounts@company.com" />
            </div>
          </div>
          <div>
            <label className={lc}>Plates (comma-separated)</label>
            <input className={ic} value={form.plates} onChange={(e) => set("plates", e.target.value)} placeholder="KCA123A, KCB456B" />
            <p className="mt-0.5 text-[10px] text-slate-400">Jobs for these plates auto-link to this account</p>
          </div>
          <div>
            <label className={lc}>Notes</label>
            <textarea className="w-full border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:outline-none" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button onClick={onClose} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Lazy job list for expanded row ──────────────────────────────────────────
const AccountJobsList = ({ accId, accountType }) => {
  const [jobs, setJobs] = useState(null);
  useEffect(() => {
    carWashApi.getCreditAccount(accId)
      .then((d) => {
        const all = d?.jobs || [];
        // Prepaid accounts: show all jobs (all auto-pay immediately — filtering to unpaid makes it always empty)
        // Credit/monthly accounts: show only unpaid/partial jobs
        setJobs(accountType === "prepaid" ? all : all.filter((j) => j.paymentStatus !== "paid"));
      })
      .catch(() => setJobs([]));
  }, [accId, accountType]);

  if (!jobs) return <div className="text-[11px] text-slate-400">Loading…</div>;
  if (!jobs.length) return (
    <div className="text-[11px] text-emerald-600 font-semibold">
      {accountType === "prepaid" ? "No jobs yet" : "All jobs paid ✓"}
    </div>
  );

  return (
    <div className="space-y-1 max-h-48 overflow-y-auto">
      {jobs.map((j) => (
        <div key={j._id} className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-1.5">
          <div>
            <div className="font-bold text-slate-900 text-[11px]">{j.jobNumber}</div>
            <div className="text-[10px] text-slate-500">{j.plateNumber} · {j.serviceName} · {fmtDate(j.jobDate || j.createdAt)}</div>
          </div>
          <div className="text-right">
            {accountType === "prepaid" ? (
              <div className="font-black text-emerald-700 text-[11px]">{formatMoney(j.paidAmount || 0)}</div>
            ) : (
              <div className="font-black text-red-600 text-[11px]">{formatMoney(j.outstanding)}</div>
            )}
            <div className={`text-[10px] font-bold ${j.paymentStatus === "paid" ? "text-emerald-600" : j.paymentStatus === "partial" ? "text-amber-600" : "text-slate-500"}`}>{j.paymentStatus}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default CarWashAccounts;

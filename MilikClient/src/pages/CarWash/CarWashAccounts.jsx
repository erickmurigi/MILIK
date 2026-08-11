import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import {
  FaCalendarAlt, FaCheckCircle, FaChevronDown, FaChevronRight,
  FaEnvelope, FaFileInvoice, FaMoneyBillWave, FaPlus, FaPrint, FaRedoAlt,
  FaTimes, FaUndo, FaUser, FaExclamationTriangle, FaWallet, FaHistory,
  FaSearch, FaSort, FaSortUp, FaSortDown, FaBell,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import CwSmsModal from "./CwSmsModal";
import AppSelect from "../../components/common/AppSelect";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import { useTabState } from "../../hooks/useTabState";
import { fmtDate } from "../../utils/dates";

const fmt = formatMoney;
const fmtMonth = (v) => v ? new Date(v).toLocaleString("en-KE", { month: "long", year: "numeric" }) : "—";

const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null;

const statusPill = {
  active:    "bg-emerald-100 text-emerald-700 border-emerald-200",
  suspended: "bg-amber-100 text-amber-700 border-amber-200",
  closed:    "bg-slate-100 text-slate-500 border-slate-200",
};
const typePill = {
  credit:  "bg-blue-100 text-blue-700",
  monthly: "bg-violet-100 text-violet-700",
  prepaid: "bg-emerald-100 text-emerald-700",
  voucher: "bg-amber-100 text-amber-700",
};
const stmtPill = {
  draft: "bg-slate-100 text-slate-600",
  sent:  "bg-blue-100 text-blue-700",
  partial: "bg-amber-100 text-amber-700",
  paid:  "bg-emerald-100 text-emerald-700",
};
const paymentMethods = ["cash", "mpesa", "bank", "card", "other"];
const PLATE_RE = /^[A-Z]{2,3}\d{3}[A-Z]$/i;

// ─── Sort header ───────────────────────────────────────────────────────────────
const SortTh = React.memo(({ label, field, sortBy, sortDir, onSort, className = "" }) => {
  const active = sortBy === field;
  return (
    <th className={`px-3 py-1.5 text-left font-bold uppercase tracking-wide cursor-pointer select-none group whitespace-nowrap ${className}`}
      onClick={() => onSort(field)}>
      <div className="flex items-center gap-1">
        {label}
        <span className={`transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-50"}`}>
          {active ? (sortDir === "asc" ? <FaSortUp size={9} /> : <FaSortDown size={9} />) : <FaSort size={9} />}
        </span>
      </div>
    </th>
  );
});

// ─── Aging badge ───────────────────────────────────────────────────────────────
const AgingBadge = ({ lastStatementAt, currentBalance }) => {
  if (!currentBalance || currentBalance <= 0) return null;
  const days = daysSince(lastStatementAt);
  if (days === null) return <span className="text-[10px] text-slate-400">No stmt</span>;
  const cls = days >= 90 ? "bg-red-100 text-red-700" : days >= 30 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500";
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold ${cls}`}>{days}d</span>;
};

// ─── Print statement ───────────────────────────────────────────────────────────
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
      <p style="margin-top:16px;font-size:11px;color:#64748b">Automatically generated statement. Contact us with any queries.</p>
    </div>
    <script>window.onload=()=>window.print();</script>
  </body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
};

// ─── Modals ────────────────────────────────────────────────────────────────────
const AccountModal = ({ customers, onSave, onClose }) => {
  const [query, setQuery]               = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedCustomer, setSelected] = useState(null);
  const [isNew, setIsNew]               = useState(false);
  const [newPhone, setNewPhone]         = useState("");
  const [form, setForm] = useState({
    accountType: "credit", contactPerson: "", billingEmail: "",
    creditLimit: "", billingCycle: "monthly", billingDay: "1", notes: "", plates: "",
  });
  const [saving, setSaving] = useState(false);
  const comboRef = useRef(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const h = (e) => { if (comboRef.current && !comboRef.current.contains(e.target)) setDropdownOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers.slice(0, 20);
    return customers.filter((c) =>
      c.name?.toLowerCase().includes(q) || c.phone?.includes(q) ||
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
        const created = await carWashApi.registerLoyaltyCustomer({ name: query.trim(), ...(newPhone.trim() && { phone: newPhone.trim() }) });
        customerId = created?._id;
        if (!customerId) throw new Error("Failed to create customer");
      }
      await onSave({
        customerId, accountType: form.accountType,
        contactPerson: form.contactPerson.trim(), billingEmail: form.billingEmail.trim().toLowerCase(),
        creditLimit: Number(form.creditLimit || 0), billingCycle: form.billingCycle,
        billingDay: Number(form.billingDay || 1), notes: form.notes,
        plates: form.plates.split(",").map((p) => p.trim()).filter(Boolean),
      });
    } finally { setSaving(false); }
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
        <div className="max-h-[80vh] overflow-y-auto space-y-3 p-4">
          <div>
            <label className={lc}>Customer *</label>
            {selectedCustomer ? (
              <div className="flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-3 h-9">
                <FaUser size={9} className="text-emerald-600 flex-shrink-0" />
                <span className="flex-1 text-sm font-semibold text-emerald-800 truncate">{selectedCustomer.name}</span>
                {selectedCustomer.phone && <span className="text-[10px] text-emerald-600 flex-shrink-0">{selectedCustomer.phone}</span>}
                <button type="button" onClick={clearPick} className="text-emerald-400 hover:text-red-500"><FaTimes size={10} /></button>
              </div>
            ) : isNew ? (
              <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">New: <span className="normal-case">{query}</span></p>
                  <button type="button" onClick={clearPick} className="text-[10px] text-slate-400 hover:text-slate-600">← Back</button>
                </div>
                <input className={ic} type="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone (optional)" />
              </div>
            ) : (
              <div ref={comboRef} className="relative">
                <input className={ic} value={query} onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true); }}
                  onFocus={() => setDropdownOpen(true)} placeholder="Search name, phone, or plate…" autoComplete="new-password" />
                {dropdownOpen && (
                  <div className="absolute left-0 right-0 top-full z-50 max-h-52 overflow-y-auto border border-slate-200 bg-white shadow-xl">
                    {filtered.length === 0 && !query.trim() ? (
                      <p className="px-3 py-2 text-[11px] text-slate-400">Start typing…</p>
                    ) : filtered.map((c) => (
                      <button key={c._id} type="button" onMouseDown={() => pickCustomer(c)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 border-b border-slate-50 last:border-0">
                        <FaUser size={9} className="text-slate-300" />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-800 truncate">{c.name}</div>
                          {(c.phone || (c.plates||[]).length > 0) && (
                            <div className="text-[10px] text-slate-400">{[c.phone, ...(c.plates||[])].filter(Boolean).join(" · ")}</div>
                          )}
                        </div>
                      </button>
                    ))}
                    {query.trim() && (
                      <button type="button" onMouseDown={pickNew}
                        className="flex w-full items-center gap-2 border-t border-slate-200 bg-emerald-50 px-3 py-2 text-left hover:bg-emerald-100">
                        <FaPlus size={9} className="text-emerald-600" />
                        <span className="text-sm text-emerald-700">Create new: <b>{query.trim()}</b></span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>Account Type *</label>
              <AppSelect
                value={form.accountType}
                onChange={(v) => set("accountType", v ?? "")}
                options={[
                  { value: "credit", label: "Credit (Pay-later)" },
                  { value: "monthly", label: "Monthly Billing" },
                  { value: "prepaid", label: "Prepaid (Wallet)" },
                  { value: "voucher", label: "Voucher" },
                ]}
                size="md"
              />
            </div>
            {!["prepaid","voucher"].includes(form.accountType) && (
              <div>
                <label className={lc}>Credit Limit (KES)</label>
                <input className={ic} type="number" min="0" value={form.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} placeholder="0 = no limit" />
              </div>
            )}
          </div>
          {form.accountType === "prepaid" && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <FaWallet className="inline mr-1.5" />Prepaid wallets are topped up in advance and deducted automatically on each job.
            </div>
          )}
          {form.accountType === "voucher" && (
            <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <strong>Voucher company account.</strong> No payment is collected from the customer. Jobs accumulate and are settled via statement.
            </div>
          )}
          {form.accountType === "monthly" && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lc}>Billing Cycle</label>
                <AppSelect
                  value={form.billingCycle}
                  onChange={(v) => set("billingCycle", v ?? "")}
                  options={[{ value: "monthly", label: "Monthly" }, { value: "weekly", label: "Weekly" }]}
                  size="md"
                />
              </div>
              <div><label className={lc}>Billing Day (1–28)</label>
                <input className={ic} type="number" min="1" max="28" value={form.billingDay} onChange={(e) => set("billingDay", e.target.value)} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lc}>Contact Person</label>
              <input className={ic} value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} placeholder="e.g. John Kamau" /></div>
            <div><label className={lc}>Billing Email</label>
              <input className={ic} type="email" value={form.billingEmail} onChange={(e) => set("billingEmail", e.target.value)} placeholder="accounts@company.com" /></div>
          </div>
          {form.accountType !== "voucher" && (
            <div>
              <label className={lc}>Plates (comma-separated)</label>
              <input className={ic} value={form.plates} onChange={(e) => set("plates", e.target.value)} placeholder="KCA123A, KCB456B" />
              <p className="mt-0.5 text-[10px] text-slate-400">Jobs for these plates auto-link to this account</p>
            </div>
          )}
          <div><label className={lc}>Notes</label>
            <textarea className="w-full border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:outline-none" rows={2}
              value={form.notes} onChange={(e) => set("notes", e.target.value)} />
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

const PaymentModal = ({ account, cashbooks, onSave, onClose }) => {
  const [form, setForm] = useState({ amount: "", method: "cash", cashbookAccount: cashbooks[0]?._id || "", reference: "", receivedFromPhone: "", paymentDate: todayISO() });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const handleSave = async () => {
    if (!form.amount || Number(form.amount) <= 0) return toast.warning("Enter a valid amount");
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };
  const lc = "mb-1 block text-[11px] font-extrabold uppercase tracking-widest text-slate-500";
  const ic = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/50 px-4">
      <div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#0B3B2E] px-4 py-3 text-white">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wide">Record Payment</h2>
            <p className="mt-0.5 text-xs text-emerald-100">{account.accountNumber} · Owed: {fmt(account.currentBalance)}</p>
          </div>
          <button onClick={onClose}><FaTimes /></button>
        </div>
        <div className="space-y-3 p-4">
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <strong>FIFO:</strong> Payment will be applied to oldest unpaid jobs first.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lc}>Amount (KES) *</label>
              <input className={ic} type="number" min="0" step="0.01" autoFocus value={form.amount} onChange={(e) => set("amount", e.target.value)} /></div>
            <div><label className={lc}>Method</label>
              <AppSelect
                value={form.method}
                onChange={(v) => set("method", v ?? "cash")}
                options={paymentMethods.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))}
                size="md"
              /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lc}>{form.method === "mpesa" ? "M-Pesa Code" : "Reference"}</label>
              <input className={ic} value={form.reference} onChange={(e) => set("reference", e.target.value)} placeholder={form.method === "mpesa" ? "QJK1234ABC" : "Optional"} /></div>
            <div><label className={lc}>Payment Date</label>
              <input className={ic} type="date" value={form.paymentDate} onChange={(e) => set("paymentDate", e.target.value)} /></div>
          </div>
          {form.method === "mpesa" && (
            <div><label className={lc}>M-Pesa Sender Phone</label>
              <input className={ic} type="tel" value={form.receivedFromPhone} onChange={(e) => set("receivedFromPhone", e.target.value)} placeholder="0712345678" /></div>
          )}
          <div><label className={lc}>Cashbook Account</label>
            <AppSelect
              value={form.cashbookAccount}
              onChange={(v) => set("cashbookAccount", v ?? "")}
              options={cashbooks.map((cb) => ({ value: cb._id, label: `${cb.code} - ${cb.name}` }))}
              placeholder="Select cashbook"
              searchable
              clearable
              size="md"
            /></div>
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

const TopUpModal = ({ account, cashbooks, onSave, onClose }) => {
  const [form, setForm] = useState({ amount: "", method: "cash", cashbookAccount: cashbooks[0]?._id || "", reference: "", paymentDate: todayISO(), notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const handleSave = async () => {
    if (!form.amount || Number(form.amount) <= 0) return toast.warning("Enter a valid top-up amount");
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };
  const lc = "mb-1 block text-[11px] font-extrabold uppercase tracking-widest text-slate-500";
  const ic = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/50 px-4">
      <div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-emerald-700 px-4 py-3 text-white">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2"><FaWallet /> Top Up Wallet</h2>
            <p className="mt-0.5 text-xs text-emerald-100">{account.accountNumber} · Balance: {fmt(account.accountCredit || 0)}</p>
          </div>
          <button onClick={onClose}><FaTimes /></button>
        </div>
        <div className="space-y-3 p-4">
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Amount will be added to the wallet and deducted automatically on the next job.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lc}>Amount (KES) *</label>
              <input className={ic} type="number" min="0" step="0.01" autoFocus value={form.amount} onChange={(e) => set("amount", e.target.value)} /></div>
            <div><label className={lc}>Method</label>
              <AppSelect
                value={form.method}
                onChange={(v) => set("method", v ?? "cash")}
                options={paymentMethods.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))}
                size="md"
              /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lc}>{form.method === "mpesa" ? "M-Pesa Code" : "Reference"}</label>
              <input className={ic} value={form.reference} onChange={(e) => set("reference", e.target.value)} placeholder={form.method === "mpesa" ? "QJK1234ABC" : "Optional"} /></div>
            <div><label className={lc}>Payment Date</label>
              <input className={ic} type="date" value={form.paymentDate} onChange={(e) => set("paymentDate", e.target.value)} /></div>
          </div>
          <div><label className={lc}>Cashbook Account</label>
            <AppSelect
              value={form.cashbookAccount}
              onChange={(v) => set("cashbookAccount", v ?? "")}
              options={cashbooks.map((cb) => ({ value: cb._id, label: `${cb.code} - ${cb.name}` }))}
              placeholder="Select cashbook"
              searchable
              clearable
              size="md"
            /></div>
          <div><label className={lc}>Notes</label>
            <input className={ic} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" /></div>
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

const EditAccountModal = ({ account, onSave, onClose }) => {
  const [form, setForm] = useState({
    contactPerson: account.contactPerson || "", billingEmail: account.billingEmail || "",
    creditLimit: String(account.creditLimit || ""), billingCycle: account.billingCycle || "monthly",
    billingDay: String(account.billingDay || "1"), status: account.status || "active",
    notes: account.notes || "", plates: (account.plates || []).join(", "),
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        contactPerson: form.contactPerson.trim(), billingEmail: form.billingEmail.trim().toLowerCase(),
        creditLimit: Number(form.creditLimit || 0), billingCycle: form.billingCycle,
        billingDay: Number(form.billingDay || 1), status: form.status, notes: form.notes,
        plates: form.plates.split(",").map((p) => p.trim()).filter(Boolean),
      });
    } finally { setSaving(false); }
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
            <div><label className={lc}>Status</label>
              <AppSelect
                value={form.status}
                onChange={(v) => set("status", v ?? "")}
                options={[
                  { value: "active", label: "Active" },
                  { value: "suspended", label: "Suspended" },
                  { value: "closed", label: "Closed" },
                ]}
                size="md"
              /></div>
            {!["prepaid","voucher"].includes(account.accountType) && (
              <div><label className={lc}>Credit Limit (KES)</label>
                <input className={ic} type="number" min="0" value={form.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} placeholder="0 = no limit" /></div>
            )}
          </div>
          {account.accountType === "monthly" && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lc}>Billing Cycle</label>
                <AppSelect
                  value={form.billingCycle}
                  onChange={(v) => set("billingCycle", v ?? "")}
                  options={[{ value: "monthly", label: "Monthly" }, { value: "weekly", label: "Weekly" }]}
                  size="md"
                /></div>
              <div><label className={lc}>Billing Day (1–28)</label>
                <input className={ic} type="number" min="1" max="28" value={form.billingDay} onChange={(e) => set("billingDay", e.target.value)} /></div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lc}>Contact Person</label>
              <input className={ic} value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} /></div>
            <div><label className={lc}>Billing Email</label>
              <input className={ic} type="email" value={form.billingEmail} onChange={(e) => set("billingEmail", e.target.value)} /></div>
          </div>
          {account.accountType !== "voucher" && (
            <div>
              <label className={lc}>Plates (comma-separated)</label>
              <input className={ic} value={form.plates} onChange={(e) => set("plates", e.target.value)} />
            </div>
          )}
          <div><label className={lc}>Notes</label>
            <textarea className="w-full border border-slate-300 px-2 py-2 text-sm text-slate-800 focus:outline-none" rows={2}
              value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
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

// ─── Lazy job list ─────────────────────────────────────────────────────────────
const AccountJobsList = ({ accId, accountType }) => {
  const [jobs, setJobs] = useState(null);
  useEffect(() => {
    carWashApi.getCreditAccount(accId)
      .then((d) => {
        const all = d?.jobs || [];
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
            {accountType === "prepaid"
              ? <div className="font-black text-emerald-700 text-[11px]">{formatMoney(j.paidAmount || 0)}</div>
              : <div className="font-black text-red-600 text-[11px]">{formatMoney(j.outstanding)}</div>}
            <div className={`text-[10px] font-bold ${j.paymentStatus === "paid" ? "text-emerald-600" : j.paymentStatus === "partial" ? "text-amber-600" : "text-slate-500"}`}>{j.paymentStatus}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────
const CarWashAccounts = () => {
  const queryClient  = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const businessId   = currentCompany?._id;
  const canManage    = useCarWashPermission("carwash-loyalty", "manage");
  const canRecord    = useCarWashPermission("carwash-payments", "record");

  // ── Filters / sort / pagination ──
  const [search, setSearch]         = useTabState("/carwash/accounts:search", "");
  const [debouncedSearch, setDebouncedSearch] = useTabState("/carwash/accounts:debouncedSearch", "");
  const debounceRef                 = useRef(null);
  const [filterStatus, setFilterStatus] = useTabState("/carwash/accounts:filterStatus", "active");
  const [filterType, setFilterType]     = useTabState("/carwash/accounts:filterType", "");
  const [sortBy, setSortBy]             = useTabState("/carwash/accounts:sortBy", "");
  const [sortDir, setSortDir]           = useTabState("/carwash/accounts:sortDir", "desc");
  const [page, setPage]                 = useTabState("/carwash/accounts:page", 1);
  const limit                           = 50;

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); setDebouncedSearch(val); }, 300);
  };

  const handleSort = useCallback((field) => {
    setSortDir((prev) => sortBy === field ? (prev === "asc" ? "desc" : "asc") : "desc");
    setSortBy(field);
    setPage(1);
  }, [sortBy]);

  // ── UI state ──
  const [expandedId, setExpandedId]               = useState(null);
  const [expandedStatements, setExpandedStatements] = useState({});
  const [expandedTopups, setExpandedTopups]         = useState({});
  const [topupsLoading, setTopupsLoading]           = useState({});
  const [stmtLoading, setStmtLoading]               = useState({});
  const [showCreate, setShowCreate]                 = useState(false);
  const [payTarget, setPayTarget]                   = useState(null);
  const [topupTarget, setTopupTarget]               = useState(null);
  const [editTarget, setEditTarget]                 = useState(null);
  const [remindTarget, setRemindTarget]             = useState(null);
  const [remindSending, setRemindSending]           = useState(false);
  const [emailSending, setEmailSending]             = useState(null);

  // ── Data ──
  const queryKey = ["cw-credit-accounts", businessId, filterStatus, filterType, debouncedSearch, sortBy, sortDir, page];
  const { data: accountsData, isLoading: loading, error, refetch } = useQuery({
    queryKey,
    queryFn: () => carWashApi.listCreditAccounts({
      status: filterStatus || undefined, accountType: filterType || undefined,
      search: debouncedSearch || undefined, sortBy: sortBy || undefined,
      sortDir, page, limit,
    }),
    enabled: !!businessId,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  useEffect(() => { if (error) toast.error("Failed to load credit accounts"); }, [error]);

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

  const accounts  = useMemo(() => (accountsData?.data ?? (Array.isArray(accountsData) ? accountsData : [])), [accountsData]);
  const total     = accountsData?.total ?? accounts.length;
  const pages     = accountsData?.pages ?? 1;
  const customers = useMemo(() => (refData?.customers ?? []).filter((c) => c.name && !PLATE_RE.test(c.name.trim())), [refData]);
  const cashbooks = useMemo(() => refData?.cashbooks ?? [], [refData]);

  const toggleExpand = useCallback((acc) => setExpandedId((prev) => prev === acc._id ? null : acc._id), []);

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

  const handleTopup = useCallback(async (form) => {
    const res = await carWashApi.recordAccountTopup(topupTarget._id, { ...form, amount: Number(form.amount) });
    toast.success(res?.message || "Wallet topped up");
    const targetId = topupTarget._id;
    setTopupTarget(null);
    queryClient.invalidateQueries({ queryKey: ["cw-credit-accounts"] });
    if (expandedId === targetId) loadTopups(targetId);
  }, [topupTarget, expandedId, queryClient, loadTopups]);

  const handleEdit = useCallback(async (form) => {
    await carWashApi.updateCreditAccount(editTarget._id, form);
    toast.success("Account updated");
    setEditTarget(null);
    queryClient.invalidateQueries({ queryKey: ["cw-credit-accounts"] });
  }, [editTarget, queryClient]);

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

  const sendStatementEmail = useCallback(async (acc, stmt) => {
    if (!acc.billingEmail) return toast.warning("No billing email — add one via Edit.");
    setEmailSending(stmt._id);
    try {
      const res = await carWashApi.sendStatementEmail(acc._id, stmt._id, { email: acc.billingEmail });
      toast.success(res?.message || "Statement emailed");
      loadStatements(acc._id);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send email");
    } finally { setEmailSending(null); }
  }, [loadStatements]);

  const sendStatementSms = useCallback(async (phone, body) => {
    if (!remindTarget) return;
    setRemindSending(true);
    try {
      if (remindTarget._stmtId) {
        await carWashApi.sendStatementSms(remindTarget._id, remindTarget._stmtId, { phone, body });
      } else {
        await carWashApi.sendCustomerSms(remindTarget._customerId, { phone, body });
      }
      toast.success("SMS sent");
      setRemindTarget(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send SMS");
    } finally { setRemindSending(false); }
  }, [remindTarget]);

  // Open reminder SMS (no statement required — direct balance nudge)
  const openRemind = useCallback((e, acc) => {
    e.stopPropagation();
    const name    = acc.customer?.name || "Customer";
    const balance = fmt(acc.currentBalance || 0);
    setRemindTarget({
      _id:        acc._id,
      _customerId: acc.customer?._id,
      name,
      phone: acc.customer?.phone || "",
    });
  }, []);

  // KPI strip
  const stats = useMemo(() => {
    const totalOwed         = accounts.reduce((s, a) => a.accountType !== "prepaid" ? s + Math.max(0, Number(a.currentBalance || 0)) : s, 0);
    const totalPrepaidFloat = accounts.reduce((s, a) => a.accountType === "prepaid" ? s + Number(a.accountCredit || 0) : s, 0);
    const overLimit         = accounts.filter((a) => a.accountType !== "prepaid" && a.creditLimit > 0 && a.currentBalance > a.creditLimit).length;
    return { totalOwed, totalPrepaidFloat, overLimit };
  }, [accounts]);

  return (
    <CarWashShell title="Credit Accounts">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-2 py-1">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Car Wash</div>
              <h1 className="text-sm font-bold text-slate-900 leading-tight">Credit Accounts</h1>
            </div>
            <div className="flex flex-wrap items-center gap-1">

              {/* Search */}
              <div className="relative">
                <FaSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={9} />
                <input type="text" placeholder="Name / plate / account…" value={search} onChange={(e) => handleSearch(e.target.value)}
                  className="h-7 w-44 rounded border border-slate-300 bg-white pl-6 pr-6 text-xs focus:border-[#0B3B2E] focus:outline-none" />
                {search && (
                  <button type="button" onClick={() => handleSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><FaTimes size={9} /></button>
                )}
              </div>

              <AppSelect
                value={filterStatus}
                onChange={(v) => { setFilterStatus(v ?? ""); setPage(1); }}
                options={[
                  { value: "active", label: "Active" },
                  { value: "suspended", label: "Suspended" },
                  { value: "closed", label: "Closed" },
                ]}
                placeholder="All Statuses"
                clearable
                size="sm"
              />
              <AppSelect
                value={filterType}
                onChange={(v) => { setFilterType(v ?? ""); setPage(1); }}
                options={[
                  { value: "credit", label: "Credit" },
                  { value: "monthly", label: "Monthly" },
                  { value: "prepaid", label: "Prepaid" },
                  { value: "voucher", label: "Voucher" },
                ]}
                placeholder="All Types"
                clearable
                size="sm"
              />

              <button onClick={() => refetch()} className="flex h-7 items-center gap-1 border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={9} className={loading ? "animate-spin" : ""} />
              </button>
              {canManage && (
                <button onClick={() => setShowCreate(true)} className="flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]">
                  <FaPlus size={9} /> New Account
                </button>
              )}
            </div>
          </div>

          {/* KPI strip */}
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="font-semibold text-slate-700">{total} account{total !== 1 ? "s" : ""}</span>
            <span className="text-slate-300">·</span>
            <span className="font-bold text-red-600">Owed: {fmt(stats.totalOwed)}</span>
            {stats.totalPrepaidFloat > 0 && (
              <><span className="text-slate-300">·</span>
              <span className="font-semibold text-emerald-700"><FaWallet className="mr-1 inline" size={8} />Float: {fmt(stats.totalPrepaidFloat)}</span></>
            )}
            {stats.overLimit > 0 && (
              <><span className="text-slate-300">·</span>
              <span className="font-bold text-amber-700"><FaExclamationTriangle className="mr-1 inline" size={8} />{stats.overLimit} over limit</span></>
            )}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#0B3B2E] text-white text-[10px]">
                <th className="w-6 px-3 py-1.5" />
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Account</th>
                <SortTh label="Customer / Plates" field="name"    sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Type</th>
                <SortTh label="Balance"            field="balance" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right" />
                <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Limit</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
                <th className="px-3 py-1.5 text-center font-bold uppercase tracking-wide">Debt Age</th>
                <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide text-white/70">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !accounts.length ? (
                <tr><td colSpan={9} className="py-10 text-center text-slate-400">Loading…</td></tr>
              ) : accounts.length === 0 ? (
                <tr><td colSpan={9} className="py-14 text-center">
                  <FaUser className="mx-auto mb-2 text-2xl text-slate-200" />
                  <div className="text-sm font-semibold text-slate-400">{debouncedSearch ? "No accounts match your search" : "No credit accounts yet"}</div>
                  {!debouncedSearch && <div className="mt-1 text-xs text-slate-400">Create an account to start tracking credit customers</div>}
                </td></tr>
              ) : accounts.map((acc) => {
                const balance    = Number(acc.currentBalance || 0);
                const overLimit  = acc.creditLimit > 0 && balance > acc.creditLimit;
                const expanded   = expandedId === acc._id;
                const isPrepaid  = acc.accountType === "prepaid";
                return (
                  <React.Fragment key={acc._id}>
                    <tr className={`border-b border-slate-100 ${overLimit ? "bg-amber-50/60" : "bg-white hover:bg-slate-50/60"} cursor-pointer`}
                      onClick={() => toggleExpand(acc)}>
                      <td className="px-3 py-2 text-slate-400">
                        {expanded ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-black text-slate-900">{acc.accountNumber}</div>
                        {acc.lastStatementAt && <div className="text-[10px] text-slate-400">Stmt: {fmtDate(acc.lastStatementAt)}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">{acc.customer?.name || "—"}</div>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {(acc.plates || []).map((p) => (
                            <span key={p} className="rounded bg-slate-100 px-1.5 py-0 text-[9px] font-bold text-slate-600">{p}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded px-2 py-0.5 text-[9px] font-bold uppercase ${typePill[acc.accountType] || "bg-slate-100 text-slate-600"}`}>
                          {acc.accountType}
                        </span>
                        {acc.accountType === "monthly" && <div className="text-[9px] text-slate-400 mt-0.5">Day {acc.billingDay}</div>}
                      </td>
                      {isPrepaid ? (
                        <td className="px-3 py-2 text-right font-black text-emerald-700">
                          <div className="text-[9px] font-bold text-slate-400 uppercase">Available</div>
                          {fmt(Number(acc.accountCredit || 0))}
                        </td>
                      ) : (
                        <td className={`px-3 py-2 text-right font-black ${balance > 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {fmt(balance)}
                          {overLimit && <div className="text-[9px] font-bold text-amber-600">Over limit</div>}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right text-slate-600">
                        {isPrepaid ? <span className="text-[10px] text-slate-400">—</span>
                          : acc.creditLimit > 0 ? fmt(acc.creditLimit) : <span className="text-slate-300">None</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded border px-2 py-0.5 text-[9px] font-bold uppercase ${statusPill[acc.status] || statusPill.active}`}>
                          {acc.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {!isPrepaid && <AgingBadge lastStatementAt={acc.lastStatementAt} currentBalance={balance} />}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          {isPrepaid && acc.status === "active" && canRecord && (
                            <button onClick={() => setTopupTarget(acc)} className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700 hover:bg-emerald-100">
                              <FaWallet size={8} /> Top Up
                            </button>
                          )}
                          {!isPrepaid && balance > 0 && acc.status === "active" && canRecord && (
                            <button onClick={() => setPayTarget(acc)} className="inline-flex items-center gap-1 border border-orange-200 bg-orange-50 px-2 py-0.5 text-[9px] font-bold text-orange-700 hover:bg-orange-100">
                              <FaMoneyBillWave size={8} /> Pay
                            </button>
                          )}
                          {!isPrepaid && acc.status === "active" && (
                            <button onClick={() => handleGenerateStatement(acc)} className="inline-flex items-center gap-1 border border-violet-200 bg-violet-50 px-2 py-0.5 text-[9px] font-bold text-violet-700 hover:bg-violet-100">
                              <FaFileInvoice size={8} /> Stmt
                            </button>
                          )}
                          {/* Quick balance-reminder SMS — no statement required */}
                          {acc.customer?.phone && balance > 0 && (
                            <button onClick={(e) => openRemind(e, acc)} title="Send balance reminder SMS"
                              className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-bold text-slate-600 hover:bg-slate-50">
                              <FaBell size={8} /> Remind
                            </button>
                          )}
                          {canManage && (
                            <button onClick={() => setEditTarget(acc)} className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-bold text-slate-600 hover:bg-slate-50">
                              Edit
                            </button>
                          )}
                          <button
                            onClick={() => {
                              toggleExpand(acc);
                              if (!expanded) {
                                if (isPrepaid) loadTopups(acc._id);
                                else loadStatements(acc._id);
                              }
                            }}
                            className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-bold text-slate-600 hover:bg-slate-50">
                            {expanded ? "Hide" : "View"}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* ── Expanded detail ── */}
                    {expanded && (
                      <tr className="border-b border-slate-100 bg-slate-50/60">
                        <td colSpan={9} className="px-6 py-3">
                          {isPrepaid ? (
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Wallet Summary</div>
                                <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm mb-3">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] text-slate-500 font-semibold">Available Balance</span>
                                    <span className="font-black text-emerald-700 text-base">{fmt(Number(acc.accountCredit || 0))}</span>
                                  </div>
                                </div>
                                <div className="text-[11px] font-black uppercase tracking-wide text-slate-500 mb-1">Recent Jobs</div>
                                <AccountJobsList accId={acc._id} accountType="prepaid" />
                              </div>
                              <div>
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="text-[11px] font-black uppercase tracking-wide text-slate-500 flex items-center gap-1"><FaHistory size={9} /> Top-up History</span>
                                  <button onClick={() => loadTopups(acc._id)} className="text-[10px] text-slate-400 hover:text-slate-600"><FaRedoAlt size={9} /></button>
                                </div>
                                {topupsLoading[acc._id] ? (
                                  <div className="text-[11px] text-slate-400">Loading…</div>
                                ) : !(expandedTopups[acc._id] || []).length ? (
                                  <div className="text-[11px] text-slate-400">No top-ups yet</div>
                                ) : (expandedTopups[acc._id] || []).map((t) => (
                                  <div key={t._id} className={`mb-1.5 flex items-center justify-between rounded border px-3 py-2 ${t.isVoided ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
                                    <div className="min-w-0">
                                      <div className={`font-black text-[11px] ${t.isVoided ? "text-slate-400 line-through" : "text-emerald-700"}`}>+{fmt(t.amount)}</div>
                                      <div className="text-[10px] text-slate-500">{t.method} {t.reference ? `· ${t.reference}` : ""} · {fmtDate(t.paymentDate)}</div>
                                      {t.isVoided && <div className="text-[10px] text-red-500 font-bold">VOIDED{t.voidReason ? ` — ${t.voidReason}` : ""}</div>}
                                    </div>
                                    {!t.isVoided && canRecord && (
                                      <button type="button"
                                        onClick={async () => {
                                          const reason = window.prompt(`Reason for voiding ${fmt(t.amount)}?`, "");
                                          if (reason === null) return;
                                          try {
                                            await carWashApi.voidTopup(acc._id, t._id, reason);
                                            toast.success("Top-up voided");
                                            loadTopups(acc._id);
                                            queryClient.invalidateQueries({ queryKey: ["cw-credit-accounts"] });
                                          } catch (err) {
                                            toast.error(err?.response?.data?.message || "Failed to void top-up");
                                          }
                                        }}
                                        className="ml-2 inline-flex shrink-0 items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-100">
                                        <FaUndo size={8} /> Void
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Unpaid Jobs</div>
                                <AccountJobsList accId={acc._id} accountType={acc.accountType} />
                              </div>
                              <div>
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">Statements</span>
                                  <button onClick={() => handleGenerateStatement(acc)} className="text-[10px] font-bold text-violet-700 hover:underline">+ Generate</button>
                                </div>
                                {stmtLoading[acc._id] ? (
                                  <div className="text-[11px] text-slate-400">Loading…</div>
                                ) : !(expandedStatements[acc._id] || []).length ? (
                                  <div className="text-[11px] text-slate-400">No statements yet</div>
                                ) : (expandedStatements[acc._id] || []).map((s) => (
                                  <div key={s._id} className="mb-1.5 flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2">
                                    <div>
                                      <div className="font-black text-slate-900 text-[11px]">{s.statementNumber}</div>
                                      <div className="text-[10px] text-slate-500">{fmtMonth(s.periodStart)} · {s.totalJobs} jobs</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${stmtPill[s.status] || stmtPill.draft}`}>{s.status}</span>
                                      <span className="font-black text-slate-900 text-[11px]">{fmt(s.totalOutstanding)}</span>
                                      <button onClick={() => printCreditStatement(acc, s)} title="Print" className="text-[10px] text-slate-400 hover:text-slate-700"><FaPrint /></button>
                                      {acc.customer?.phone && s.status !== "paid" && (
                                        <button
                                          onClick={() => setRemindTarget({ _id: acc._id, _stmtId: s._id, _customerId: acc.customer?._id, name: acc.customer?.name, phone: acc.customer?.phone })}
                                          title="Send SMS" className="text-[10px] text-emerald-700 hover:text-emerald-900">SMS</button>
                                      )}
                                      {s.status !== "paid" && (
                                        <button onClick={() => sendStatementEmail(acc, s)} disabled={emailSending === s._id}
                                          title={acc.billingEmail ? `Email to ${acc.billingEmail}` : "No billing email"}
                                          className={`text-[10px] ${acc.billingEmail ? "text-blue-600 hover:text-blue-800" : "text-slate-300 cursor-not-allowed"}`}>
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

        {/* ── Pagination ── */}
        {pages > 1 && (
          <div className="flex-shrink-0 flex items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5 text-[11px]">
            <span className="text-slate-500">Showing {((page - 1) * limit) + 1}–{Math.min(page * limit, total)} of {total}</span>
            <div className="flex items-center gap-1">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="h-6 px-3 border border-slate-300 rounded text-xs disabled:opacity-40 hover:bg-slate-50">Prev</button>
              <span className="px-2 text-slate-500">Page {page} of {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
                className="h-6 px-3 border border-slate-300 rounded text-xs disabled:opacity-40 hover:bg-slate-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {showCreate && <AccountModal customers={customers} onSave={handleCreate} onClose={() => setShowCreate(false)} />}
      {payTarget   && <PaymentModal account={payTarget} cashbooks={cashbooks} onSave={handlePayment} onClose={() => setPayTarget(null)} />}
      {topupTarget && <TopUpModal account={topupTarget} cashbooks={cashbooks} onSave={handleTopup} onClose={() => setTopupTarget(null)} />}
      {editTarget  && <EditAccountModal account={editTarget} onSave={handleEdit} onClose={() => setEditTarget(null)} />}

      {remindTarget && (
        <CwSmsModal
          target={{ _id: remindTarget._customerId, name: remindTarget.name, phone: remindTarget.phone }}
          defaultBody={`Hi ${remindTarget.name || "Customer"}, you have an outstanding balance on your car wash account. Please contact us to settle. Thank you.`}
          templates={[]}
          context="Balance Reminder"
          onSend={sendStatementSms}
          onClose={() => setRemindTarget(null)}
          sending={remindSending}
        />
      )}
    </CarWashShell>
  );
};

export default CarWashAccounts;

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaHandshake, FaTimes, FaPlus, FaTrash, FaCheckCircle, FaExclamationTriangle, FaUndoAlt } from "react-icons/fa";
import {
  createPaymentVoucher,
  createRentPayment,
  createTenantInvoice,
  getChartOfAccounts,
  getDepositSettlement,
  getTenantInvoices,
  recordLandlordDepositRefund,
  reverseLandlordDepositRefund,
} from "../../redux/apiCalls";
import { isCashbookAccount } from "../../utils/cashbookUtils";
import { fmtDate } from "../../utils/dates";
import AppSelect from "../../components/common/AppSelect";
import CurrencyInput from "../../components/common/CurrencyInput";
import Spinner from "../../components/common/Spinner";

// Move-out deposit settlement. Every posting goes through the flow that already owns it:
//   open charges + move-out charges  <- one "deposit_applied" receipt (server routes it by who holds the deposit)
//   move-out charges / forfeit       <- OTHER_CHARGE invoices, on the landlord statement only when the landlord keeps it
//   cash back to the tenant          <- a tenant-linked deposit_refund voucher, paid on the spot
//   landlord refunded tenant himself <- a memo on the tenant (no cash on the manager's books)
// Each step is a complete transaction of its own, so a failure part-way leaves a consistent ledger and
// reopening the screen picks up from the position the server reports.

const Section = ({ title, right, children, className = "" }) => (
  <div className={`border border-slate-200 bg-white ${className}`}>
    <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
      {right}
    </div>
    <div className="p-2.5">{children}</div>
  </div>
);

const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20";
const cellInputClass = "h-7 w-full border border-slate-300 bg-white px-2 text-right text-xs tabular-nums text-slate-900 outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 disabled:bg-slate-50 disabled:text-slate-400";

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const ksh = (value) => `Ksh ${round2(value).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const holderLabel = (holder) => (holder === "Landlord" ? "Landlord" : "Manager");
const ownerLabel = (owner) => (owner === "propertyManager" ? "Manager" : "Landlord");

const PAYMENT_METHODS = [
  { value: "mobile_money", label: "M-Pesa / Mobile Money" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
];

const OWNER_OPTIONS = [
  { value: "landlord", label: "Landlord" },
  { value: "propertyManager", label: "Manager" },
];

const chargeTypeOf = (invoice) => {
  const category = String(invoice?.category || "").toUpperCase();
  if (String(invoice?.noteType || "").toUpperCase() === "DEBIT_NOTE" || category === "DEBIT_NOTE") return { key: "other", label: "Debit Note" };
  if (category === "UTILITY_CHARGE") return { key: "utility", label: invoice?.metadata?.utilityType || "Utility" };
  if (category === "LATE_PENALTY_CHARGE") return { key: "late_fee", label: "Late Penalty" };
  if (category === "OTHER_CHARGE") return { key: "other", label: "Other Charge" };
  return { key: "rent", label: "Rent" };
};

const outstandingOf = (invoice) => {
  const billed = num(invoice?.netAmount ?? invoice?.adjustedAmount ?? invoice?.amount);
  const paid = Math.min(billed, Math.max(0, num(invoice?.appliedAmount)));
  return round2(Math.max(0, num(invoice?.outstanding ?? billed - paid)));
};

const accountCode = (account) => String(account?.code || account?.accountCode || "");

// Oldest charge first, never more than the deposit left or the charge's own balance
const suggestApplications = (items, available) => {
  let remaining = round2(available);
  const next = {};
  items.forEach((item) => {
    const apply = round2(Math.min(item.outstanding, Math.max(0, remaining)));
    next[item._id] = apply > 0 ? String(apply) : "";
    remaining = round2(remaining - apply);
  });
  return next;
};

let chargeKey = 0;
const newCharge = (owner, extra = {}) => ({ key: ++chargeKey, description: "", amount: "", owner, ...extra });

export default function DepositSettlementModal({ tenantId, businessId, canRefund, onClose, onSettled }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [settlement, setSettlement] = useState(null);
  const [openItems, setOpenItems] = useState([]);
  const [unpaidDepositInvoices, setUnpaidDepositInvoices] = useState([]);
  const [accounts, setAccounts] = useState([]);

  const [applications, setApplications] = useState({});
  const [charges, setCharges] = useState([]);
  const [forfeit, setForfeit] = useState({ enabled: false, owner: "landlord" });
  const [refund, setRefund] = useState({ mode: "voucher", amount: "", settlementAccount: "", paymentMethod: "mobile_money", reference: "", date: today(), notes: "" });
  const [steps, setSteps] = useState([]);
  const [posting, setPosting] = useState(false);
  const [waiveUnbilled, setWaiveUnbilled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [position, invoices, chart] = await Promise.all([
        getDepositSettlement(tenantId),
        getTenantInvoices({ business: businessId, tenantId, includeSnapshots: true }),
        accounts.length ? Promise.resolve(accounts) : getChartOfAccounts({ business: businessId }),
      ]);
      const live = (Array.isArray(invoices) ? invoices : []).filter(
        (inv) => !["cancelled", "reversed"].includes(String(inv?.status || "").toLowerCase()) && outstandingOf(inv) > 0.009
      );
      const byDate = (a, b) => new Date(a.invoiceDate || a.createdAt || 0) - new Date(b.invoiceDate || b.createdAt || 0);
      const items = live
        .filter((inv) => String(inv.category || "").toUpperCase() !== "DEPOSIT_CHARGE")
        .sort(byDate)
        .map((inv) => {
          const type = chargeTypeOf(inv);
          return {
            _id: String(inv._id),
            invoiceNumber: inv.invoiceNumber || inv.noteNumber || "",
            date: inv.invoiceDate || inv.noteDate || inv.createdAt,
            description: String(inv.description || "").trim() || `${type.label} — ${fmtDate(inv.invoiceDate)}`,
            typeKey: type.key,
            typeLabel: type.label,
            outstanding: outstandingOf(inv),
          };
        });

      setSettlement(position);
      setOpenItems(items);
      setUnpaidDepositInvoices(live.filter((inv) => String(inv.category || "").toUpperCase() === "DEPOSIT_CHARGE"));
      setAccounts(Array.isArray(chart) ? chart : []);
      setApplications(suggestApplications(items, position?.position?.available || 0));
      setCharges([]);
      setWaiveUnbilled(false);
      setForfeit({ enabled: false, owner: position?.forfeitTo || "landlord" });
      setRefund((prev) => ({ ...prev, mode: position?.depositHeldBy === "Landlord" ? "landlord_direct" : "voucher", amount: "", reference: "", notes: "" }));
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load the deposit settlement.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const cashbookOptions = useMemo(
    () => accounts.filter(isCashbookAccount).map((a) => ({ value: a._id, label: `${accountCode(a)} ${a.name}`.trim() })),
    [accounts]
  );
  const incomeAccountId = useCallback(
    (owner) => accounts.find((a) => accountCode(a) === (owner === "propertyManager" ? "4200" : "4300"))?._id || "",
    [accounts]
  );
  useEffect(() => {
    if (!refund.settlementAccount && cashbookOptions.length) setRefund((prev) => ({ ...prev, settlementAccount: cashbookOptions[0].value }));
  }, [cashbookOptions, refund.settlementAccount]);

  const holder = settlement?.depositHeldBy || "Management Company";
  const available = round2(settlement?.position?.available || 0);

  const totals = useMemo(() => {
    const applied = round2(openItems.reduce((sum, item) => sum + Math.min(item.outstanding, num(applications[item._id])), 0));
    const charged = round2(charges.reduce((sum, row) => sum + num(row.amount), 0));
    const beforeForfeit = round2(available - applied - charged);
    const forfeited = forfeit.enabled ? Math.max(0, beforeForfeit) : 0;
    const refundable = round2(Math.max(0, beforeForfeit - forfeited));
    const refunded = forfeit.enabled ? 0 : round2(Math.min(refundable, refund.amount === "" ? refundable : num(refund.amount)));
    const leftHeld = round2(beforeForfeit - forfeited - refunded);
    const owedAfter = round2(openItems.reduce((sum, item) => sum + item.outstanding, 0) - applied);
    return { applied, charged, forfeited, refundable, refunded, leftHeld, owedAfter };
  }, [openItems, applications, charges, available, forfeit.enabled, refund.amount]);

  const overDrawn = totals.applied + totals.charged > available + 0.009;
  const unbilledPeriods = settlement?.unbilledPeriods || [];
  const unbilledRent = round2(unbilledPeriods.reduce((sum, row) => sum + num(row.rent), 0));
  const blockedByUnbilled = unbilledPeriods.length > 0 && !waiveUnbilled;
  const nothingToDo = totals.applied <= 0 && totals.charged <= 0 && totals.forfeited <= 0 && totals.refunded <= 0;

  const setCharge = (key, field, value) => setCharges((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)));

  const openBillingSchedule = () => {
    onClose();
    navigate(`/tenant/${tenantId}/statement`, { state: { initialTab: "billing" } });
  };

  const post = async () => {
    if (blockedByUnbilled) return toast.error("Bill the unbilled rent periods first, or confirm they are not owed.");
    if (overDrawn) return toast.error(`Charges and arrears exceed the ${ksh(available)} deposit held. Reduce the amounts applied.`);
    if (charges.some((row) => num(row.amount) > 0 && !String(row.description).trim())) return toast.error("Describe each move-out charge.");
    if (totals.refunded > 0 && refund.mode === "voucher" && !refund.settlementAccount) return toast.error("Choose the cash or bank account the refund is paid from.");
    if (totals.refunded > 0 && !canRefund) return toast.error("You do not have permission to refund deposits.");

    const tenant = settlement.tenant;
    const plan = [];
    const chargeRows = [
      ...charges.filter((row) => num(row.amount) > 0).map((row) => ({ ...row, amount: round2(row.amount) })),
      ...(totals.forfeited > 0 ? [{ key: "forfeit", description: "Security deposit forfeited", amount: totals.forfeited, owner: forfeit.owner }] : []),
    ];
    if (chargeRows.length) plan.push({ id: "charges", label: `Raise ${chargeRows.length} move-out charge${chargeRows.length > 1 ? "s" : ""}` });
    if (totals.applied + chargeRows.reduce((s, r) => s + r.amount, 0) > 0) plan.push({ id: "apply", label: "Apply deposit to charges" });
    if (totals.refunded > 0) plan.push({ id: "refund", label: refund.mode === "landlord_direct" ? "Record landlord's direct refund" : `Pay refund of ${ksh(totals.refunded)}` });

    setPosting(true);
    setSteps(plan.map((step) => ({ ...step, state: "pending" })));
    const mark = (id, state, detail = "") => setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, state, detail } : s)));

    let current = null;
    try {
      const allocations = openItems
        .map((item) => ({ invoiceId: item._id, appliedAmount: round2(Math.min(item.outstanding, num(applications[item._id]))), typeKey: item.typeKey }))
        .filter((row) => row.appliedAmount > 0);

      if (chargeRows.length) {
        current = "charges";
        mark(current, "running");
        for (const row of chargeRows) {
          const keptByLandlord = row.owner !== "propertyManager";
          const created = await createTenantInvoice({
            business: businessId,
            tenant: tenant._id,
            unit: tenant.unit?._id,
            property: tenant.property?._id,
            category: "OTHER_CHARGE",
            amount: row.amount,
            description: row.description.trim(),
            invoiceDate: today(),
            dueDate: today(),
            chartAccountId: incomeAccountId(row.owner) || null,
            metadata: { depositSettlement: true, moveOutCharge: true, chargeOwner: row.owner, includeInLandlordStatement: keptByLandlord, includeInCategoryTotals: keptByLandlord },
          });
          const invoiceId = created?._id || created?.data?._id || created?.invoice?._id;
          if (!invoiceId) throw new Error(`Charge "${row.description}" was created without an id.`);
          allocations.push({ invoiceId: String(invoiceId), appliedAmount: row.amount, typeKey: "other" });
        }
        mark(current, "done");
      }

      if (allocations.length) {
        current = "apply";
        mark(current, "running");
        const amount = round2(allocations.reduce((sum, row) => sum + row.appliedAmount, 0));
        const byType = allocations.reduce((acc, row) => ({ ...acc, [row.typeKey]: (acc[row.typeKey] || 0) + row.appliedAmount }), {});
        const paymentType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0][0];
        const now = new Date();
        const receipt = await createRentPayment(dispatch, {
          business: businessId,
          tenant: tenant._id,
          unit: tenant.unit?._id,
          amount,
          paymentType,
          paymentMethod: "deposit_applied",
          cashbook: "",
          paymentDate: today(),
          dueDate: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
          description: "Deposit applied at move-out",
          ledgerType: "receipts",
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          allocations: allocations.map(({ invoiceId, appliedAmount }) => ({ invoiceId, appliedAmount })),
          allocationMode: "manual",
          isConfirmed: true,
        });
        mark(current, "done", receipt?.receiptNumber || receipt?.data?.receiptNumber || "");
      }

      if (totals.refunded > 0) {
        current = "refund";
        mark(current, "running");
        if (refund.mode === "landlord_direct") {
          await recordLandlordDepositRefund(tenant._id, { amount: totals.refunded, date: refund.date, reference: refund.reference, notes: refund.notes, waiveUnbilledRent: waiveUnbilled });
          mark(current, "done");
        } else {
          const voucher = await createPaymentVoucher({
            business: businessId,
            category: "deposit_refund",
            tenant: tenant._id,
            amount: totals.refunded,
            status: "paid",
            dueDate: refund.date,
            paidDate: refund.date,
            settlementAccount: refund.settlementAccount,
            paymentMethod: refund.paymentMethod,
            reference: refund.reference.trim(),
            payeeName: tenant.name,
            payeeBank: refund.paymentMethod === "mobile_money" && tenant.phone ? { mobileNumber: tenant.phone } : undefined,
            waiveUnbilledRent: waiveUnbilled,
            narration: refund.notes.trim() || `Deposit refund — ${tenant.name}${tenant.unit?.unitNumber ? ` (${tenant.unit.unitNumber})` : ""}`,
          });
          mark(current, "done", voucher?.voucherNo || "");
        }
      }

      toast.success("Deposit settled.");
      onSettled?.();
      await load();
    } catch (error) {
      const message = error?.response?.data?.message || error?.message || "Settlement step failed.";
      if (current) mark(current, "failed", message);
      toast.error(`${message} Steps already posted stay posted — the screen now shows what is left.`);
      onSettled?.();
      await load();
    } finally {
      setPosting(false);
    }
  };

  const reverseLandlordRefund = async (entryId) => {
    try {
      await reverseLandlordDepositRefund(settlement.tenant._id, entryId);
      toast.success("Landlord refund record reversed.");
      onSettled?.();
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to reverse the landlord refund record.");
    }
  };

  const tenant = settlement?.tenant;
  const history = useMemo(() => {
    if (!settlement) return [];
    return [
      ...settlement.applications.map((row) => ({ key: `a${row._id}`, date: row.date, label: "Applied to charges", ref: row.receiptNumber, amount: row.amount })),
      ...settlement.refunds.map((row) => ({ key: `r${row._id}`, date: row.date, label: row.status === "reversed" ? "Refund (reversed)" : "Refunded to tenant", ref: row.voucherNo, amount: row.amount, muted: row.status === "reversed" })),
      ...settlement.landlordRefunds.map((row) => ({ key: `l${row._id}`, date: row.date, label: row.reversedAt ? "Landlord refund (reversed)" : "Refunded by landlord", ref: row.reference || "—", amount: row.amount, muted: Boolean(row.reversedAt), reverseId: row.reversedAt ? null : row._id })),
    ].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  }, [settlement]);

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
        <div className="flex flex-shrink-0 items-center justify-between gap-3 bg-[#0B3B2E] px-4 py-2.5 text-white">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-black uppercase tracking-wide">
            <FaHandshake size={14} />
            <span className="truncate">Settle Deposit{tenant ? ` — ${tenant.name}` : ""}</span>
            {tenant && <span className="text-[11px] font-semibold normal-case tracking-normal text-white/70">{[tenant.tenantCode, tenant.property?.propertyName, tenant.unit?.unitNumber].filter(Boolean).join(" · ")}</span>}
          </h3>
          <button onClick={() => !posting && onClose()} disabled={posting} className="text-white/70 hover:text-white"><FaTimes size={13} /></button>
        </div>

        {loading || !settlement ? (
          <div className="flex h-64 items-center justify-center"><Spinner /></div>
        ) : (
          <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto bg-slate-50/60 p-3 lg:grid-cols-[1fr_300px]">
            <div className="min-w-0 space-y-3">
              <div className="grid grid-cols-2 border border-slate-200 bg-white sm:grid-cols-5">
                {[
                  ["Held by", holderLabel(holder)],
                  ["Collected", ksh(settlement.position.collected)],
                  ["Applied", ksh(settlement.position.applied)],
                  ["Refunded", ksh(settlement.position.refunded + settlement.position.landlordRefunded)],
                  ["Still held", ksh(available)],
                ].map(([label, value], i) => (
                  <div key={label} className={`px-3 py-2 ${i ? "border-l border-slate-200" : ""}`}>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
                    <p className={`mt-0.5 text-sm tabular-nums ${i === 4 ? "font-black text-[#0B3B2E]" : "font-bold text-slate-900"}`}>{value}</p>
                  </div>
                ))}
              </div>

              {unpaidDepositInvoices.length > 0 && (
                <div className="flex items-start gap-2 border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <FaExclamationTriangle className="mt-0.5 flex-shrink-0" />
                  <span>
                    {unpaidDepositInvoices.length} deposit invoice{unpaidDepositInvoices.length > 1 ? "s are" : " is"} still unpaid ({unpaidDepositInvoices.map((inv) => inv.invoiceNumber).join(", ")}).
                    A deposit that was never collected cannot be refunded — cancel {unpaidDepositInvoices.length > 1 ? "them" : "it"} with a credit note so the tenant does not owe it.
                  </span>
                </div>
              )}

              {unbilledPeriods.length > 0 && (
                <div className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
                  <div className="flex items-start gap-2">
                    <FaExclamationTriangle className="mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">
                        Rent was never billed for {unbilledPeriods.length} period{unbilledPeriods.length > 1 ? "s" : ""} before move-out — about {ksh(unbilledRent)} (before tax).
                      </p>
                      <p className="mt-0.5">
                        {unbilledPeriods.map((row) => `${row.label} (${ksh(row.rent)})`).join(" · ")}. Bill them first so the deposit covers them — refunding now would release security for rent the tenant still owes.
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-3">
                        <button type="button" onClick={openBillingSchedule} className="h-7 border border-red-700 bg-red-700 px-3 text-xs font-bold text-white hover:bg-red-800">Open billing schedule</button>
                        <label className="inline-flex cursor-pointer items-center gap-1.5 font-semibold">
                          <input type="checkbox" checked={waiveUnbilled} onChange={(e) => setWaiveUnbilled(e.target.checked)} />
                          These periods are not owed (rent-free, or vacated before them)
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {available <= 0.009 ? (
                <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800">
                  <FaCheckCircle /> No deposit is held for this tenant — nothing left to settle.
                </div>
              ) : (
                <>
                  <Section
                    title="1 · Apply deposit to what the tenant owes"
                    right={openItems.length > 0 && (
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => setApplications(suggestApplications(openItems, available - totals.charged))} className="h-6 border border-slate-300 bg-white px-2 text-[10px] font-bold text-slate-700 hover:bg-slate-50">Oldest first</button>
                        <button type="button" onClick={() => setApplications({})} className="h-6 border border-slate-300 bg-white px-2 text-[10px] font-bold text-slate-700 hover:bg-slate-50">Clear</button>
                      </div>
                    )}
                  >
                    {openItems.length === 0 ? (
                      <p className="py-2 text-xs text-slate-500">The tenant owes nothing — the whole deposit can be refunded.</p>
                    ) : (
                      <table className="w-full table-fixed text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-[10px] font-black uppercase tracking-wider text-slate-500">
                            <th className="w-[13%] py-1">Date</th>
                            <th className="py-1">Charge</th>
                            <th className="w-[17%] py-1 text-right">Owed</th>
                            <th className="w-[20%] py-1 pl-2 text-right">Apply</th>
                          </tr>
                        </thead>
                        <tbody>
                          {openItems.map((item) => (
                            <tr key={item._id} className="border-b border-slate-100">
                              <td className="py-1 text-slate-600">{fmtDate(item.date)}</td>
                              <td className="truncate py-1 pr-2">
                                <span className="font-semibold text-slate-900">{item.description}</span>
                                <span className="ml-1.5 text-slate-500">· {item.typeLabel}{item.invoiceNumber ? ` · ${item.invoiceNumber}` : ""}</span>
                              </td>
                              <td className="py-1 text-right tabular-nums text-slate-700">{ksh(item.outstanding)}</td>
                              <td className="py-1 pl-2">
                                <CurrencyInput prefix={null} value={applications[item._id] ?? ""} inputClassName={cellInputClass} onChange={(e) => setApplications((prev) => ({ ...prev, [item._id]: e.target.value }))} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </Section>

                  <Section title="2 · Move-out charges (damages, cleaning, final bills)">
                    {charges.length === 0 && <p className="pb-1.5 text-xs text-slate-500">Anything else the tenant owes at move-out. Each charge is billed to the tenant and paid from the deposit.</p>}
                    {charges.map((row) => (
                      <div key={row.key} className="mb-1.5 grid grid-cols-[1fr_130px_120px_28px] items-center gap-1.5">
                        <input className={inputClass} placeholder="e.g. Repaint bedroom, broken window" value={row.description} onChange={(e) => setCharge(row.key, "description", e.target.value)} />
                        <CurrencyInput prefix={null} value={row.amount} inputClassName={cellInputClass} onChange={(e) => setCharge(row.key, "amount", e.target.value)} />
                        <AppSelect size="sm" value={row.owner} options={OWNER_OPTIONS.map((o) => ({ ...o, label: `Kept by ${o.label}` }))} onChange={(v) => setCharge(row.key, "owner", v)} />
                        <button type="button" onClick={() => setCharges((prev) => prev.filter((r) => r.key !== row.key))} className="p-1 text-red-600 hover:bg-red-50 hover:text-red-800"><FaTrash size={11} /></button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setCharges((prev) => [...prev, newCharge("landlord")])} className="inline-flex items-center gap-1 text-xs font-bold text-[#0B3B2E] hover:underline"><FaPlus size={9} /> Add charge</button>
                  </Section>

                  <Section
                    title="3 · What happens to the rest"
                    right={<span className="text-[11px] font-bold tabular-nums text-slate-700">Left: {ksh(Math.max(0, available - totals.applied - totals.charged))}</span>}
                  >
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {[
                        { key: "refund", label: "Refund to tenant" },
                        { key: "forfeit", label: "Tenant forfeits it" },
                      ].map((opt) => {
                        const active = (opt.key === "forfeit") === forfeit.enabled;
                        return (
                          <button key={opt.key} type="button" onClick={() => setForfeit((prev) => ({ ...prev, enabled: opt.key === "forfeit" }))} className={`h-7 border px-3 text-xs font-bold ${active ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>

                    {forfeit.enabled ? (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
                        <div>
                          <label className={labelClass}>Kept by</label>
                          <AppSelect size="sm" value={forfeit.owner} options={OWNER_OPTIONS} onChange={(v) => setForfeit((prev) => ({ ...prev, owner: v }))} />
                        </div>
                        <p className="col-span-1 self-end pb-1 text-[11px] text-slate-500 md:col-span-3">
                          Billed to the tenant as "Security deposit forfeited" and paid from the deposit{forfeit.owner === "landlord" ? " — shows as landlord income on the statement." : " — manager income, not on the landlord statement."}
                          {settlement.forfeitToSource === "property" ? " Default comes from the property." : " Default set on this tenant."}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {holder === "Landlord" && (
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { key: "landlord_direct", label: "Landlord paid the tenant" },
                              { key: "voucher", label: "We pay for the landlord (deducted from landlord)" },
                            ].map((opt) => (
                              <button key={opt.key} type="button" onClick={() => setRefund((prev) => ({ ...prev, mode: opt.key }))} className={`h-7 border px-3 text-xs font-bold ${refund.mode === opt.key ? "border-[#0B3B2E] bg-[#EBF5EF] text-[#0B3B2E]" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
                          <div>
                            <label className={labelClass}>Refund amount</label>
                            <CurrencyInput value={refund.amount === "" ? String(totals.refundable) : refund.amount} onChange={(e) => setRefund((prev) => ({ ...prev, amount: e.target.value }))} />
                          </div>
                          <div>
                            <label className={labelClass}>Date</label>
                            <input type="date" className={inputClass} value={refund.date} max={today()} onChange={(e) => setRefund((prev) => ({ ...prev, date: e.target.value }))} />
                          </div>
                          {refund.mode === "voucher" && (
                            <>
                              <div>
                                <label className={labelClass}>Paid from<span className="ml-0.5 font-black text-red-600">*</span></label>
                                <AppSelect size="sm" value={refund.settlementAccount} options={cashbookOptions} placeholder="Cash / bank account" onChange={(v) => setRefund((prev) => ({ ...prev, settlementAccount: v }))} />
                              </div>
                              <div>
                                <label className={labelClass}>Method</label>
                                <AppSelect size="sm" value={refund.paymentMethod} options={PAYMENT_METHODS} onChange={(v) => setRefund((prev) => ({ ...prev, paymentMethod: v }))} />
                              </div>
                            </>
                          )}
                          <div>
                            <label className={labelClass}>Reference</label>
                            <input className={inputClass} placeholder={refund.mode === "voucher" ? "M-Pesa / cheque no." : "Landlord's reference"} value={refund.reference} onChange={(e) => setRefund((prev) => ({ ...prev, reference: e.target.value }))} />
                          </div>
                          <div className="col-span-2 md:col-span-3">
                            <label className={labelClass}>Notes</label>
                            <input className={inputClass} placeholder="Optional" value={refund.notes} onChange={(e) => setRefund((prev) => ({ ...prev, notes: e.target.value }))} />
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {holder === "Landlord"
                            ? refund.mode === "voucher"
                              ? "Paid from our cash and shown on the landlord statement as a deduction — the landlord already has this deposit."
                              : "No money moves through our books. This only records that the landlord refunded the tenant, closing the deposit."
                            : "Paid from the deposit we hold in trust. The landlord statement is not affected."}
                        </p>
                      </div>
                    )}
                  </Section>
                </>
              )}

              {history.length > 0 && (
                <Section title="Deposit history">
                  <table className="w-full text-xs">
                    <tbody>
                      {history.map((row) => (
                        <tr key={row.key} className={`border-b border-slate-100 ${row.muted ? "text-slate-400 line-through" : "text-slate-700"}`}>
                          <td className="w-[15%] py-1">{fmtDate(row.date)}</td>
                          <td className="py-1 font-semibold">{row.label}</td>
                          <td className="py-1 text-slate-500">{row.ref}</td>
                          <td className="py-1 text-right tabular-nums">{ksh(row.amount)}</td>
                          <td className="w-[28px] py-1 text-right">
                            {row.reverseId && canRefund && (
                              <button type="button" title="Reverse this record" onClick={() => reverseLandlordRefund(row.reverseId)} className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"><FaUndoAlt size={10} /></button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1.5 text-[10px] text-slate-500">Refund payments are reversed from Payment Vouchers; deposit applications from Receipts.</p>
                </Section>
              )}
            </div>

            <div className="space-y-3">
              <Section title="Settlement summary">
                <dl className="space-y-1 text-xs">
                  {[
                    ["Deposit held", available, "text-slate-900 font-bold"],
                    ["Applied to arrears", -totals.applied],
                    ["Move-out charges", -totals.charged],
                    ...(totals.forfeited > 0 ? [[`Forfeited to ${ownerLabel(forfeit.owner)}`, -totals.forfeited]] : []),
                    [refund.mode === "landlord_direct" && holder === "Landlord" ? "Refunded by landlord" : "Refunded to tenant", -totals.refunded],
                  ].map(([label, value, cls]) => (
                    <div key={label} className="flex justify-between gap-2">
                      <dt className="text-slate-600">{label}</dt>
                      <dd className={`tabular-nums ${cls || "text-slate-800"}`}>{ksh(value)}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between gap-2 border-t border-slate-200 pt-1.5">
                    <dt className="font-black uppercase tracking-wide text-slate-800">Still held</dt>
                    <dd className={`font-black tabular-nums ${totals.leftHeld > 0.009 || overDrawn ? "text-amber-700" : "text-emerald-700"}`}>{ksh(totals.leftHeld)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="font-bold text-slate-800">Tenant still owes</dt>
                    <dd className={`font-bold tabular-nums ${totals.owedAfter > 0.009 ? "text-red-700" : "text-emerald-700"}`}>{ksh(totals.owedAfter)}</dd>
                  </div>
                </dl>
                {overDrawn && <p className="mt-2 border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-800">More is applied than the deposit held.</p>}
                {!overDrawn && totals.leftHeld > 0.009 && <p className="mt-2 text-[11px] text-amber-800">Part of the deposit stays held — you can settle it later.</p>}
                {!overDrawn && totals.owedAfter > 0.009 && <p className="mt-2 text-[11px] text-slate-600">The tenant's remaining balance stays collectible on their statement.</p>}
              </Section>

              {steps.length > 0 && (
                <Section title="Progress">
                  <ul className="space-y-1 text-xs">
                    {steps.map((step) => (
                      <li key={step.id} className="flex items-start gap-1.5">
                        <span className={`mt-0.5 inline-block h-2 w-2 flex-shrink-0 ${step.state === "done" ? "bg-emerald-600" : step.state === "failed" ? "bg-red-600" : step.state === "running" ? "animate-pulse bg-amber-500" : "bg-slate-300"}`} />
                        <span className={step.state === "failed" ? "text-red-700" : "text-slate-700"}>
                          {step.label}{step.detail ? <span className="text-slate-500"> — {step.detail}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-3 py-2">
          <button type="button" onClick={onClose} disabled={posting} className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Close</button>
          {available > 0.009 && (
            <button type="button" onClick={post} disabled={posting || loading || overDrawn || nothingToDo || blockedByUnbilled} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60">
              {posting ? "Posting…" : "Post Settlement"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

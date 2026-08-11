import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaBan, FaBook, FaCalendarAlt, FaCheckCircle,
  FaExclamationTriangle, FaMoneyBillWave, FaPlus,
  FaReceipt, FaRedoAlt,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";
import {
  getVatReturnSummary,
  getVatRemittanceHistory,
  remitVat,
  voidVatRemittance,
  getChartOfAccounts,
} from "../../redux/apiCalls";
import { useConfirm } from "../../context/ConfirmContext";
import AppSelect from "../../components/common/AppSelect";
import { fmtDate } from "../../utils/dates";
import Modal from "../../components/common/Modal";
import { inputClass, labelClass } from "../../utils/formStyles";
import SharedStatusBadge from "../../components/common/StatusBadge";

// ── constants ────────────────────────────────────────────────────────────────
const GRN    = "#0B3B2E";
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ── helpers ──────────────────────────────────────────────────────────────────
const round2  = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtKES  = (n) =>
  `KES ${round2(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const EMPTY_FORM = {
  amountRemitted:    "",
  paymentDate:       new Date().toISOString().slice(0, 10),
  paymentReference:  "",
  cashbookAccountId: "",
  notes:             "",
};

// ── sub-components ────────────────────────────────────────────────────────────
const KpiCard = ({ icon: Icon, label, value, sub, warn = false, ok = false, iconBg = GRN }) => (
  <div className={`flex items-center gap-3 border bg-white px-4 py-3 shadow-sm ${
    warn ? "border-red-200 bg-red-50" : ok ? "border-emerald-200 bg-emerald-50" : "border-slate-200"
  }`}>
    <div className="flex h-9 w-9 shrink-0 items-center justify-center text-white" style={{ backgroundColor: iconBg }}>
      <Icon className="text-sm" />
    </div>
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`text-sm font-extrabold leading-tight ${
        warn ? "text-red-700" : ok ? "text-emerald-700" : "text-slate-900"
      }`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-400">{sub}</div>}
    </div>
  </div>
);

const SectionHeader = ({ title, right }) => (
  <div className="flex min-h-8 items-center justify-between border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
    <h2 className="text-[11px] font-extrabold uppercase tracking-wide text-[#0B3B2E]">{title}</h2>
    {right}
  </div>
);

const ColHeader = ({ children, right }) => (
  <th className={`px-2 py-1.5 font-bold uppercase tracking-wide text-[10px] text-slate-500 ${right ? "text-right" : "text-left"}`}>
    {children}
  </th>
);

const EmptyRows = ({ colSpan, text }) => (
  <tr>
    <td colSpan={colSpan} className="px-3 py-8 text-center">
      <div className="flex flex-col items-center gap-2 text-slate-400">
        <FaBook size={22} className="opacity-30" />
        <span className="text-xs font-semibold">{text}</span>
      </div>
    </td>
  </tr>
);

const VAT_STATUS_MAP = {
  voided:   "border-red-200 bg-red-50 text-red-700",
  remitted: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const Field = ({ label, required, children }) => (
  <div>
    <label className={labelClass}>
      {label}{required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
    {children}
  </div>
);

// ── RemittanceTable ───────────────────────────────────────────────────────────
const RemittanceTable = ({ rows, showPeriod, voidingId, onVoid, canVoid }) => {
  const colSpan = showPeriod ? 6 : 5;
  if (!rows.length) {
    return (
      <table className="w-full text-xs">
        <tbody><EmptyRows colSpan={colSpan} text="No remittances recorded" /></tbody>
      </table>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead className="bg-slate-50">
        <tr>
          {showPeriod && <ColHeader>Period</ColHeader>}
          <ColHeader>Payment Date</ColHeader>
          <ColHeader>KRA Reference (PRN)</ColHeader>
          <ColHeader right>Amount</ColHeader>
          <ColHeader>Status</ColHeader>
          <ColHeader>{/* void action */}</ColHeader>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isVoided = r.status === "voided";
          return (
            <tr key={r._id} className={`border-t border-slate-100 hover:bg-slate-50 ${isVoided ? "opacity-50" : ""}`}>
              {showPeriod && (
                <td className="px-2 py-1.5 font-semibold text-slate-700">
                  {MONTHS[(r.periodMonth || 1) - 1]} {r.periodYear}
                </td>
              )}
              <td className="px-2 py-1.5 text-slate-600">{fmtDate(r.paymentDate)}</td>
              <td className="px-2 py-1.5 font-mono text-[10px] text-slate-500">{r.paymentReference || "—"}</td>
              <td className="px-2 py-1.5 text-right font-extrabold text-slate-800">{fmtKES(r.amountRemitted)}</td>
              <td className="px-2 py-1.5"><SharedStatusBadge status={isVoided ? "voided" : "remitted"} map={VAT_STATUS_MAP} /></td>
              <td className="px-2 py-1.5 text-right">
                {!isVoided && canVoid && (
                  <button
                    type="button"
                    onClick={() => onVoid(r)}
                    disabled={voidingId === r._id}
                    className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400 hover:text-red-600 disabled:opacity-40"
                  >
                    <FaBan size={9} />
                    {voidingId === r._id ? "Voiding…" : "Void"}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

// ── main component ────────────────────────────────────────────────────────────
export default function VatRemittance() {
  const company     = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);

  const canProcess = hasCompanyPermission(currentUser, company, "financialReports", "process", "accounts");
  const canReverse = hasCompanyPermission(currentUser, company, "financialReports", "reverse", "accounts");
  const { confirm } = useConfirm();

  const now = new Date();
  const [year,  setYear]  = useTabState("/accounts/vat-remittance:year",  now.getFullYear());
  const [month, setMonth] = useTabState("/accounts/vat-remittance:month", now.getMonth() + 1);

  const [summary,    setSummary]    = useState(null);
  const [history,    setHistory]    = useState([]);
  const [cashbooks,  setCashbooks]  = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm,   setShowForm]   = useState(false);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [voidingId,  setVoidingId]  = useState(null);

  // ── data load ─────────────────────────────────────────────────────────────
  const load = useCallback(async (silent = false) => {
    if (!company?._id) return;
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const [sumData, histData] = await Promise.all([
        getVatReturnSummary({ business: company._id, year, month }),
        getVatRemittanceHistory({ business: company._id }),
      ]);
      setSummary(sumData);
      setHistory(Array.isArray(histData) ? histData : []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load VAT data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [company?._id, year, month]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!company?._id) return;
    const CB_PAT = /cash|bank|m-?pesa|mobile money|wallet|petty|till|collection/i;
    getChartOfAccounts({ business: company._id, type: "asset", isPosting: true })
      .then((accs) => setCashbooks(Array.isArray(accs) ? accs.filter((a) => !a.isHeader && !a.isControl && CB_PAT.test(`${a?.name || ""} ${a?.subGroup || ""}`)) : []))
      .catch(() => {});
  }, [company?._id]);

  // ── form handlers ─────────────────────────────────────────────────────────
  const openForm = () => {
    setForm({ ...EMPTY_FORM, amountRemitted: summary?.balanceDue > 0 ? String(summary.balanceDue) : "" });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amount = Number(form.amountRemitted);
    if (!amount || amount <= 0)  { toast.error("Enter a valid amount"); return; }
    if (!form.cashbookAccountId) { toast.error("Select a cashbook account"); return; }

    setSubmitting(true);
    try {
      await remitVat({
        business:          company._id,
        year,
        month,
        amountRemitted:    amount,
        paymentDate:       form.paymentDate,
        paymentReference:  form.paymentReference,
        cashbookAccountId: form.cashbookAccountId,
        notes:             form.notes,
      });
      toast.success("VAT remittance recorded");
      setShowForm(false);
      load(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record remittance");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoid = async (record) => {
    const ok = await confirm({
      title:        "Void Remittance",
      message:      `This will reverse the GL entries for ${fmtKES(record.amountRemitted)} remitted on ${fmtDate(record.paymentDate)}. The VAT balance will be restored.`,
      confirmLabel: "Void",
      danger:       true,
    });
    if (!ok) return;

    setVoidingId(record._id);
    try {
      await voidVatRemittance(record._id, { business: company._id, reason: "Voided by user" });
      toast.success("Remittance voided — GL reversed");
      load(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to void");
    } finally {
      setVoidingId(null);
    }
  };

  // ── derived ───────────────────────────────────────────────────────────────
  const bd            = summary?.balanceDue ?? 0;
  const periodLabel   = `${MONTHS[month - 1]} ${year}`;
  const periodRemit   = useMemo(() => Array.isArray(summary?.remittances) ? summary.remittances : [], [summary]);
  const yearOptions   = useMemo(() => Array.from({ length: 5 }, (_, i) => now.getFullYear() - i), [now]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-3 md:p-5">

        {/* ── page header ──────────────────────────────────────────────────── */}
        <div className="mb-4 flex flex-col gap-3 border border-slate-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-sm font-extrabold uppercase tracking-wide text-[#0B3B2E]">VAT Remittance</h1>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Track output VAT collected across all modules and record payments to KRA
            </p>
          </div>
          <div className="flex items-center gap-2">
            <FaCalendarAlt className="shrink-0 text-slate-400" size={11} />
            <AppSelect
              value={month}
              onChange={(v) => setMonth(Number(v ?? month))}
              options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
              size="sm"
            />
            <AppSelect
              value={year}
              onChange={(v) => setYear(Number(v ?? year))}
              options={yearOptions.map((y) => ({ value: y, label: String(y) }))}
              size="sm"
            />
            <button
              type="button"
              onClick={() => load(true)}
              disabled={refreshing}
              className="flex h-8 w-8 items-center justify-center border border-slate-300 text-slate-500 hover:border-[#0B3B2E] hover:text-[#0B3B2E] disabled:opacity-40"
              title="Refresh"
            >
              <FaRedoAlt size={11} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex h-36 items-center justify-center">
            <span className="animate-pulse text-xs text-slate-400">Loading VAT data…</span>
          </div>
        )}

        {!loading && summary && (
          <>
            {/* ── KPI cards ─────────────────────────────────────────────────── */}
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                icon={FaMoneyBillWave}
                label="Output VAT Collected"
                value={fmtKES(summary.totalCollected)}
                sub={periodLabel}
              />
              <KpiCard
                icon={FaReceipt}
                label="Already Remitted"
                value={fmtKES(summary.totalRemitted)}
                sub="This period"
                iconBg="#2563EB"
              />
              <KpiCard
                icon={bd > 0 ? FaExclamationTriangle : FaCheckCircle}
                label="Balance Due to KRA"
                value={fmtKES(bd)}
                sub={
                  bd > 0
                    ? "Remit by 20th of next month"
                    : bd < 0
                    ? "Over-remitted"
                    : summary.totalCollected > 0
                    ? "Fully remitted ✓"
                    : "No VAT collected this period"
                }
                warn={bd > 0}
                ok={bd <= 0 && summary.totalCollected > 0}
                iconBg={bd > 0 ? "#DC2626" : "#059669"}
              />
              <div className="flex">
                <button
                  type="button"
                  onClick={openForm}
                  disabled={!canProcess}
                  title={!canProcess ? "Full Access required" : undefined}
                  className="flex w-full items-center justify-center gap-2 border border-slate-200 bg-white px-4 py-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-600 shadow-sm hover:border-[#0B3B2E] hover:text-[#0B3B2E] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <FaPlus size={10} /> Record Remittance
                </button>
              </div>
            </div>

            {/* ── Account breakdown ─────────────────────────────────────────── */}
            {summary.breakdown?.length > 0 && (
              <div className="mb-4 overflow-x-auto border border-slate-200 bg-white shadow-sm">
                <SectionHeader title={`VAT Account Breakdown — ${periodLabel}`} />
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <ColHeader>Account</ColHeader>
                      <ColHeader right>VAT Collected</ColHeader>
                      <ColHeader right>Remitted</ColHeader>
                      <ColHeader right>Outstanding</ColHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.breakdown.map((b) => (
                      <tr key={b.accountId} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-1.5 text-slate-700">
                          <span className="mr-1.5 font-mono text-[10px] text-slate-400">{b.accountCode}</span>
                          {b.accountName}
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold text-slate-700">{fmtKES(b.vatCollected)}</td>
                        <td className="px-2 py-1.5 text-right text-blue-700">{fmtKES(b.vatRemitted)}</td>
                        <td className={`px-2 py-1.5 text-right font-extrabold ${b.balance > 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {fmtKES(b.balance)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-300 bg-slate-50">
                      <td className="px-2 py-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-600">Total</td>
                      <td className="px-2 py-1.5 text-right font-extrabold text-slate-800">{fmtKES(summary.totalCollected)}</td>
                      <td className="px-2 py-1.5 text-right font-extrabold text-blue-700">{fmtKES(summary.totalRemitted)}</td>
                      <td className={`px-2 py-1.5 text-right font-extrabold ${bd > 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {fmtKES(bd)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* ── This-period remittances ───────────────────────────────────── */}
            {periodRemit.length > 0 && (
              <div className="mb-4 overflow-x-auto border border-slate-200 bg-white shadow-sm">
                <SectionHeader title={`Remittances — ${periodLabel}`} />
                <RemittanceTable
                  rows={periodRemit}
                  showPeriod={false}
                  voidingId={voidingId}
                  onVoid={handleVoid}
                  canVoid={canReverse}
                />
              </div>
            )}
          </>
        )}

        {/* ── Full history ──────────────────────────────────────────────────── */}
        <div className="overflow-x-auto border border-slate-200 bg-white shadow-sm">
          <SectionHeader title="All Remittances — History" />
          {loading ? (
            <div className="py-8 text-center text-xs text-slate-400 animate-pulse">Loading…</div>
          ) : (
            <RemittanceTable
              rows={history}
              showPeriod
              voidingId={voidingId}
              onVoid={handleVoid}
            />
          )}
        </div>
      </div>

      {/* ── Record remittance modal ───────────────────────────────────────── */}
      {showForm && (
        <Modal
          title={`Record VAT Remittance — ${periodLabel}`}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="vat-remit-form"
                disabled={submitting || !canProcess}
                title={!canProcess ? "Full Access required" : undefined}
                className="px-5 py-1.5 text-xs font-extrabold uppercase tracking-wide text-white disabled:opacity-50"
                style={{ background: GRN }}
              >
                {submitting ? "Recording…" : "Record Remittance"}
              </button>
            </>
          }
        >
          {/* KRA deadline reminder */}
          <div className="mb-4 flex items-start gap-2 border border-amber-200 bg-amber-50 px-3 py-2">
            <FaExclamationTriangle className="mt-0.5 shrink-0 text-amber-500" size={11} />
            <p className="text-[11px] text-amber-800">
              VAT returns for <strong>{periodLabel}</strong> must be filed on{" "}
              <strong>KRA iTax</strong> and payment made by the{" "}
              <strong>20th of the following month</strong>. Enter the KRA Payment Registration Number (PRN) after generating it on iTax.
            </p>
          </div>

          <form id="vat-remit-form" onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount Remitted (KES)" required>
                <input
                  type="number" min="0.01" step="0.01" required
                  value={form.amountRemitted}
                  onChange={(e) => setForm((f) => ({ ...f, amountRemitted: e.target.value }))}
                  className={inputClass}
                  placeholder="0.00"
                />
              </Field>
              <Field label="Payment Date" required>
                <input
                  type="date" required
                  value={form.paymentDate}
                  onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
                  className={inputClass}
                />
              </Field>
            </div>

            <Field label="KRA PRN (Payment Registration No.)">
              <input
                type="text"
                value={form.paymentReference}
                onChange={(e) => setForm((f) => ({ ...f, paymentReference: e.target.value }))}
                className={inputClass}
                placeholder="e.g. PRN2026060012345"
              />
            </Field>

            <Field label="Cashbook / Bank Account" required>
              <AppSelect
                value={form.cashbookAccountId}
                onChange={(v) => setForm((f) => ({ ...f, cashbookAccountId: v ?? "" }))}
                options={cashbooks.map((a) => ({ value: a._id, label: `${a.code} — ${a.name}` }))}
                placeholder="Select account…"
                size="md"
                searchable
              />
            </Field>

            <Field label="Notes">
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full border border-slate-300 px-2 py-1.5 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none resize-none"
                placeholder="Optional notes…"
              />
            </Field>

            {/* Balance preview */}
            {summary && (
              <div className="border border-slate-200 bg-slate-50 px-3 py-2 space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold uppercase tracking-wide text-slate-500">Balance Due This Period</span>
                  <span className={`font-extrabold ${bd > 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {fmtKES(bd)}
                  </span>
                </div>
                {Number(form.amountRemitted) > 0 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold uppercase tracking-wide text-slate-500">Remaining After This Payment</span>
                    <span className={`font-extrabold ${round2(bd - Number(form.amountRemitted)) > 0.009 ? "text-red-600" : "text-emerald-600"}`}>
                      {fmtKES(round2(bd - Number(form.amountRemitted)))}
                    </span>
                  </div>
                )}
              </div>
            )}
          </form>
        </Modal>
      )}
    </DashboardLayout>
  );
}

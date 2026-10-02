import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaBan, FaBuilding, FaCalendarAlt,
  FaExclamationTriangle, FaPlus,
  FaPrint, FaRedoAlt,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import MilikTable from "../../components/common/MilikTable";
import printTabularList from "../../utils/printList";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";
import {
  getWhtReturnSummary,
  getWhtRemittanceHistory,
  remitWht,
  voidWhtRemittance,
  getChartOfAccounts,
} from "../../redux/apiCalls";
import { useConfirm } from "../../context/ConfirmContext";
import AppSelect from "../../components/common/AppSelect";
import ListToolbar from "../../components/common/ListToolbar";
import { fmtDate } from "../../utils/dates";
import Modal from "../../components/common/Modal";
import { inputClass, labelClass } from "../../utils/formStyles";
import SharedStatusBadge from "../../components/common/StatusBadge";

const GRN    = "#0B3B2E";
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const round2  = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtKES  = (n) => `KES ${round2(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const EMPTY_FORM = {
  amountRemitted:    "",
  paymentDate:       new Date().toISOString().slice(0, 10),
  paymentReference:  "",
  cashbookAccountId: "",
  notes:             "",
};


const SectionHeader = ({ title, right }) => (
  <div className="flex min-h-8 shrink-0 items-center justify-between bg-[#0B3B2E] px-3 py-1.5">
    <h2 className="text-[11px] font-extrabold uppercase tracking-wide text-white">{title}</h2>
    {right}
  </div>
);

const WHT_STATUS_MAP = {
  voided:   "border-red-200 bg-red-50 text-red-700",
  remitted: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const Field = ({ label, required, children }) => (
  <div>
    <label className={labelClass}>{label}{required && <span className="ml-0.5 text-red-500">*</span>}</label>
    {children}
  </div>
);

const RemittanceTable = ({ rows, showPeriod, voidingId, onVoid, canVoid, loading }) => (
  <MilikTable
    columns={[
      ...(showPeriod ? [{ label: "Period" }] : []),
      { label: "Payment Date" },
      { label: "KRA Reference (PRN)" },
      { label: "Amount", align: "right" },
      { label: "Status" },
    ]}
    rows={rows}
    rowKey="_id"
    loading={loading}
    empty="No WHT remittances recorded"
    rowClassName={(r) => (r.status === "voided" ? "opacity-50" : "")}
    renderActions={(r) => r.status !== "voided" && canVoid && (
      <button type="button" onClick={() => onVoid(r)} disabled={voidingId === r._id}
        className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400 hover:text-red-600 disabled:opacity-40">
        <FaBan size={9} />{voidingId === r._id ? "Voiding…" : "Void"}
      </button>
    )}
    renderRow={(r) => {
      const isVoided = r.status === "voided";
      return (
        <>
          {showPeriod && (
            <td className="px-2 py-1.5 border-r border-gray-100 font-semibold text-slate-700">
              {MONTHS[(r.periodMonth || 1) - 1]} {r.periodYear}
            </td>
          )}
          <td className="px-2 py-1.5 border-r border-gray-100 text-slate-600">{fmtDate(r.paymentDate)}</td>
          <td className="px-2 py-1.5 border-r border-gray-100 font-mono text-[10px] text-slate-500">{r.paymentReference || "—"}</td>
          <td className="px-2 py-1.5 border-r border-gray-100 text-right font-extrabold text-slate-800">{fmtKES(r.amountRemitted)}</td>
          <td className="px-2 py-1.5"><SharedStatusBadge status={isVoided ? "voided" : "remitted"} map={WHT_STATUS_MAP} /></td>
        </>
      );
    }}
  />
);

export default function WhtRemittance() {
  const company     = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const { confirm } = useConfirm();

  const canProcess = hasCompanyPermission(currentUser, company, "financialReports", "process", "accounts");
  const canReverse = hasCompanyPermission(currentUser, company, "financialReports", "reverse", "accounts");

  const now = new Date();
  const [year,  setYear]  = useTabState("/accounts/wht-remittance:year",  now.getFullYear());
  const [month, setMonth] = useTabState("/accounts/wht-remittance:month", now.getMonth() + 1);

  const [summary,    setSummary]    = useState(null);
  const [history,    setHistory]    = useState([]);
  const [cashbooks,  setCashbooks]  = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm,   setShowForm]   = useState(false);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [voidingId,  setVoidingId]  = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!company?._id) return;
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const [sumData, histData] = await Promise.all([
        getWhtReturnSummary({ business: company._id, year, month }),
        getWhtRemittanceHistory({ business: company._id }),
      ]);
      setSummary(sumData);
      setHistory(Array.isArray(histData) ? histData : []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load WHT data");
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

  const openForm = () => {
    setForm({ ...EMPTY_FORM, amountRemitted: summary?.balanceDue > 0 ? String(round2(summary.balanceDue)) : "" });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amount = Number(form.amountRemitted);
    if (!amount || amount <= 0)  { toast.error("Enter a valid amount"); return; }
    if (!form.cashbookAccountId) { toast.error("Select a cashbook account"); return; }

    setSubmitting(true);
    try {
      await remitWht({
        business: company._id,
        year, month,
        amountRemitted:    amount,
        paymentDate:       form.paymentDate,
        paymentReference:  form.paymentReference,
        cashbookAccountId: form.cashbookAccountId,
        notes:             form.notes,
      });
      toast.success("WHT remittance recorded");
      setShowForm(false);
      load(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record WHT remittance");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoid = async (record) => {
    const ok = await confirm({
      title:   "Void WHT Remittance",
      message: `This will reverse the GL entries for ${fmtKES(record.amountRemitted)} remitted on ${fmtDate(record.paymentDate)}. The WHT balance will be restored.`,
      confirmLabel: "Void",
      danger:  true,
    });
    if (!ok) return;

    setVoidingId(record._id);
    try {
      await voidWhtRemittance(record._id, { business: company._id, reason: "Voided by user" });
      toast.success("WHT remittance voided — GL reversed");
      load(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to void");
    } finally {
      setVoidingId(null);
    }
  };

  const bd          = summary?.balanceDue ?? 0;
  const periodLabel = `${MONTHS[month - 1]} ${year}`;
  const periodRemit = useMemo(() => Array.isArray(summary?.remittances) ? summary.remittances : [], [summary]);
  const yearOptions = useMemo(() => Array.from({ length: 5 }, (_, i) => now.getFullYear() - i), [now]);

  const handlePrint = useCallback(() => {
    const printed = printTabularList({
      title: "Withholding Tax Remittance",
      subtitle: `${periodLabel} · WHT withheld from vendor payments and payments to KRA`,
      company,
      columns: [
        { label: "Provider", value: (b) => `${b.providerName}${b.providerCode ? ` (${b.providerCode})` : ""}` },
        { label: "KRA PIN", value: (b) => b.kraPin || "—" },
        { label: "Vouchers", align: "right", value: (b) => b.voucherCount },
        { label: "WHT Withheld", align: "right", value: (b) => fmtKES(b.whtTotal) },
      ],
      rows: summary?.breakdown || [],
      summaryItems: [
        ["WHT Withheld", fmtKES(summary?.totalCollected)],
        ["Already Remitted", fmtKES(summary?.totalRemitted)],
        ["Balance Due to KRA", fmtKES(bd)],
      ],
      totalsRow: summary?.breakdown?.length
        ? ["Total", "", "", fmtKES(summary.totalCollected)]
        : undefined,
      sections: [
        ...(summary?.vouchers?.length ? [{
          heading: `Paid Vouchers with WHT — ${periodLabel}`,
          columns: [
            { label: "Voucher No.", value: (v) => v.voucherNo },
            { label: "Provider", value: (v) => v.providerName },
            { label: "Paid Date", value: (v) => fmtDate(v.paidDate) },
            { label: "Gross", align: "right", value: (v) => fmtKES(v.amount) },
            { label: "WHT", align: "right", value: (v) => fmtKES(v.whtAmount) },
          ],
          rows: summary.vouchers,
        }] : []),
        ...(periodRemit.length ? [{
          heading: `Remittances — ${periodLabel}`,
          columns: [
            { label: "Payment Date", value: (r) => fmtDate(r.paymentDate) },
            { label: "KRA Reference (PRN)", value: (r) => r.paymentReference || "—" },
            { label: "Amount", align: "right", value: (r) => fmtKES(r.amountRemitted) },
            { label: "Status", value: (r) => (r.status === "voided" ? "Voided" : "Remitted") },
          ],
          rows: periodRemit,
        }] : []),
        ...(history.length ? [{
          heading: "All WHT Remittances — History",
          columns: [
            { label: "Period", value: (r) => `${MONTHS[(r.periodMonth || 1) - 1]} ${r.periodYear}` },
            { label: "Payment Date", value: (r) => fmtDate(r.paymentDate) },
            { label: "KRA Reference (PRN)", value: (r) => r.paymentReference || "—" },
            { label: "Amount", align: "right", value: (r) => fmtKES(r.amountRemitted) },
            { label: "Status", value: (r) => (r.status === "voided" ? "Voided" : "Remitted") },
          ],
          rows: history,
        }] : []),
      ],
    });
    if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
  }, [company, periodLabel, summary, bd, periodRemit, history]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <ListToolbar>
          <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-400">Withholding Tax Remittance</span>
          <ListToolbar.Divider />
          <FaCalendarAlt className="shrink-0 text-slate-400" size={9} />
          <AppSelect
            value={month}
            onChange={(v) => setMonth(Number(v ?? month))}
            options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
            compact
          />
          <AppSelect
            value={year}
            onChange={(v) => setYear(Number(v ?? year))}
            options={yearOptions.map((y) => ({ value: y, label: String(y) }))}
            compact
          />
          <ListToolbar.Button icon={FaRedoAlt} variant="outline" disabled={refreshing} onClick={() => load(true)}>
            Refresh
          </ListToolbar.Button>

          {summary && (
            <span className={`inline-flex shrink-0 items-center gap-1 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${bd > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
              {bd > 0 ? `Balance due: ${fmtKES(bd)}` : "Fully remitted ✓"}
            </span>
          )}

          <ListToolbar.Button icon={FaPrint} variant="outline" className="ml-auto" onClick={handlePrint}>
            Print
          </ListToolbar.Button>
          <ListToolbar.Button
            icon={FaPlus}
            disabled={!canProcess}
            title={!canProcess ? "Full Access required" : undefined}
            onClick={openForm}
          >
            Record Remittance
          </ListToolbar.Button>
        </ListToolbar>

        {/* ── Scrollable content ───────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
          {/* ── account missing warning ───────────────────────────────────── */}
          {summary && !summary.whtAccountFound && (
            <div className="flex items-start gap-2 border border-amber-200 bg-amber-50 px-4 py-3">
              <FaExclamationTriangle className="mt-0.5 shrink-0 text-amber-500" size={13} />
              <div className="text-xs text-amber-800">
                <strong>WHT Payable account (2141) not found.</strong>{" "}
                Run the chart of accounts seeder or create it manually to enable WHT tracking.
              </div>
            </div>
          )}

          {/* ── Vendor breakdown ──────────────────────────────────────────── */}
          {summary?.breakdown?.length > 0 && (
            <div className="border border-slate-200 bg-white shadow-sm" style={{ maxHeight: '220px', display: 'flex', flexDirection: 'column' }}>
              <SectionHeader title={`WHT by Service Provider — ${periodLabel}`} />
              <MilikTable
                columns={[
                  { label: "Provider" },
                  { label: "KRA PIN" },
                  { label: "Vouchers", align: "right" },
                  { label: "WHT Withheld", align: "right" },
                ]}
                rows={summary.breakdown}
                rowKey="serviceProviderId"
                renderFooter={() => (
                  <>
                    <td colSpan={3} className="px-2 py-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-600">Total</td>
                    <td className="px-2 py-1.5 text-right font-extrabold text-amber-800">{fmtKES(summary.totalCollected)}</td>
                  </>
                )}
                renderRow={(b) => (
                  <>
                    <td className="px-2 py-1.5 border-r border-gray-100 font-semibold text-slate-800">
                      <div className="flex items-center gap-1.5">
                        <FaBuilding className="shrink-0 text-slate-400" size={9} />
                        {b.providerName}
                        {b.providerCode && <span className="font-mono text-[10px] text-slate-400">({b.providerCode})</span>}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 border-r border-gray-100 font-mono text-[10px] text-slate-500">{b.kraPin || "—"}</td>
                    <td className="px-2 py-1.5 border-r border-gray-100 text-right text-slate-600">{b.voucherCount}</td>
                    <td className="px-2 py-1.5 text-right font-extrabold text-amber-700">{fmtKES(b.whtTotal)}</td>
                  </>
                )}
              />
            </div>
          )}

          {/* ── Voucher detail ────────────────────────────────────────────── */}
          {summary?.vouchers?.length > 0 && (
            <div className="border border-slate-200 bg-white shadow-sm" style={{ maxHeight: '220px', display: 'flex', flexDirection: 'column' }}>
              <SectionHeader title={`Paid Vouchers with WHT — ${periodLabel}`} />
              <MilikTable
                columns={[
                  { label: "Voucher No." },
                  { label: "Provider" },
                  { label: "Paid Date" },
                  { label: "Gross", align: "right" },
                  { label: "WHT", align: "right" },
                ]}
                rows={summary.vouchers}
                rowKey="_id"
                renderRow={(v) => (
                  <>
                    <td className="px-2 py-1.5 border-r border-gray-100 font-mono text-[10px] font-bold text-slate-700">{v.voucherNo}</td>
                    <td className="px-2 py-1.5 border-r border-gray-100 text-slate-600">{v.providerName}</td>
                    <td className="px-2 py-1.5 border-r border-gray-100 text-slate-500">{fmtDate(v.paidDate)}</td>
                    <td className="px-2 py-1.5 border-r border-gray-100 text-right text-slate-700">{fmtKES(v.amount)}</td>
                    <td className="px-2 py-1.5 text-right font-extrabold text-amber-700">{fmtKES(v.whtAmount)}</td>
                  </>
                )}
              />
            </div>
          )}

          {/* ── This-period remittances ───────────────────────────────────── */}
          {periodRemit.length > 0 && (
            <div className="border border-slate-200 bg-white shadow-sm" style={{ maxHeight: '220px', display: 'flex', flexDirection: 'column' }}>
              <SectionHeader title={`Remittances — ${periodLabel}`} />
              <RemittanceTable rows={periodRemit} showPeriod={false} voidingId={voidingId} onVoid={handleVoid} canVoid={canReverse} />
            </div>
          )}

          {/* ── Full history ──────────────────────────────────────────────── */}
          <div className="border border-slate-200 bg-white shadow-sm" style={{ minHeight: '260px', display: 'flex', flexDirection: 'column' }}>
            <SectionHeader title="All WHT Remittances — History" />
            <RemittanceTable rows={history} showPeriod voidingId={voidingId} onVoid={handleVoid} canVoid={canReverse} loading={loading} />
          </div>
        </div>
      </div>

      {/* ── Record remittance modal ───────────────────────────────────────── */}
      {showForm && (
        <Modal
          title={`Record WHT Remittance — ${periodLabel}`}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowForm(false)}
                className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button type="submit" form="wht-remit-form" disabled={submitting || !canProcess}
                title={!canProcess ? "Full Access required" : undefined}
                className="px-5 py-1.5 text-xs font-extrabold uppercase tracking-wide text-white disabled:opacity-50"
                style={{ background: GRN }}>
                {submitting ? "Recording…" : "Record Remittance"}
              </button>
            </>
          }
        >
          <div className="mb-4 flex items-start gap-2 border border-amber-200 bg-amber-50 px-3 py-2">
            <FaExclamationTriangle className="mt-0.5 shrink-0 text-amber-500" size={11} />
            <p className="text-[11px] text-amber-800">
              WHT returns for <strong>{periodLabel}</strong> must be filed on{" "}
              <strong>KRA iTax</strong> and payment made by the{" "}
              <strong>20th of the following month</strong>. Enter the KRA Payment Registration Number (PRN) after generating it on iTax.
            </p>
          </div>

          <form id="wht-remit-form" onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount Remitted (KES)" required>
                <input type="number" min="0.01" step="0.01" required
                  value={form.amountRemitted}
                  onChange={(e) => setForm((f) => ({ ...f, amountRemitted: e.target.value }))}
                  className={inputClass} placeholder="0.00" />
              </Field>
              <Field label="Payment Date" required>
                <input type="date" required
                  value={form.paymentDate}
                  onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
                  className={inputClass} />
              </Field>
            </div>

            <Field label="KRA PRN (Payment Registration No.)">
              <input type="text"
                value={form.paymentReference}
                onChange={(e) => setForm((f) => ({ ...f, paymentReference: e.target.value }))}
                className={inputClass} placeholder="e.g. PRN2026060012345" />
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
              <textarea rows={2} value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full border border-slate-300 px-2 py-1.5 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none resize-none"
                placeholder="Optional notes…" />
            </Field>

            {summary && (
              <div className="border border-slate-200 bg-slate-50 px-3 py-2 space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold uppercase tracking-wide text-slate-500">WHT Balance Due This Period</span>
                  <span className={`font-extrabold ${bd > 0 ? "text-red-600" : "text-emerald-600"}`}>{fmtKES(bd)}</span>
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

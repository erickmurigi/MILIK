import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaExternalLinkAlt, FaPrint, FaRedoAlt, FaSearch } from "react-icons/fa";
import { carWashApi, formatMoney, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const statusLabels = { waiting: "Waiting", washing: "Washing", done: "Done", paid: "Paid", cancelled: "Cancelled" };
const paymentLabels = { cash: "Cash", mpesa: "M-Pesa", bank: "Bank", card: "Card", other: "Other" };
const reportStatuses = ["waiting", "washing", "done", "paid", "cancelled"];
const paymentMethods = ["cash", "mpesa", "bank", "card", "other"];
const reportModes = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

const monthISO = () => new Date().toISOString().slice(0, 7);

const formatTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
};

const ReportTable = ({ title, right, children, minWidth = "100%", className = "" }) => (
  <section className={`overflow-x-auto border border-slate-200 bg-white shadow-sm ${className}`}>
    <div className="flex min-h-8 items-center justify-between border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
      <h2 className="text-[11px] font-extrabold uppercase tracking-wide text-[#0B3B2E]">{title}</h2>
      {right}
    </div>
    <table className="w-full text-xs" style={{ minWidth }}>
      {children}
    </table>
  </section>
);

const EmptyRow = ({ colSpan, text }) => (
  <tr>
    <td colSpan={colSpan} className="px-3 py-8 text-center text-xs font-semibold text-slate-500">{text}</td>
  </tr>
);

const CarWashReports = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState("daily");
  const [date, setDate] = useState(todayISO());
  const [month, setMonth] = useState(monthISO());
  const [applied, setApplied] = useState({ mode: "daily", date: todayISO(), month: monthISO() });
  const [summary, setSummary] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [payments, setPayments] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (applied.mode === "daily") {
        const [summaryPayload, jobsPayload, paymentsPayload, expensesPayload] = await Promise.all([
          carWashApi.getDailySummary(applied.date),
          carWashApi.listJobs({ date: applied.date, limit: 30, page: 1 }),
          carWashApi.listPayments({ date: applied.date, limit: 30, page: 1 }),
          carWashApi.listExpenses({ date: applied.date, limit: 30, page: 1 }),
        ]);
        setSummary(summaryPayload || null);
        setJobs(normalizeListPayload(jobsPayload, "jobs"));
        setPayments(normalizeListPayload(paymentsPayload, "payments"));
        setExpenses(normalizeListPayload(expensesPayload, "expenses"));
        return;
      }

      const summaryPayload =
        applied.mode === "weekly" ? await carWashApi.getWeeklySummary(applied.date) : await carWashApi.getMonthlySummary(applied.month);
      setSummary(summaryPayload || null);
      setJobs([]);
      setPayments([]);
      setExpenses([]);
    } catch {
      setSummary(null);
      setJobs([]);
      setPayments([]);
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  const period = summary?.period || {};
  const counts = summary?.statusCounts || {};
  const methods = useMemo(() => summary?.revenueByMethod || {}, [summary?.revenueByMethod]);
  const totalRevenue = Number(summary?.totalRevenue ?? summary?.todayRevenue ?? 0);
  const totalExpenses = Number(summary?.totalExpenses || 0);
  const pendingExpenses = Number(summary?.pendingExpenses || 0);
  const pendingExpenseCount = Number(summary?.pendingExpenseCount || 0);
  const netPosition = Number(summary?.netPosition ?? totalRevenue - totalExpenses);
  const jobsCount = Number(summary?.jobsCount || 0);
  const paymentCount = Number(summary?.paymentCount || 0);
  const cashTotal = Number(summary?.cashTotal || 0);
  const mpesaTotal = Number(summary?.mpesaTotal || 0);
  const nonCashTotal = Number(summary?.nonCashTotal ?? Math.max(totalRevenue - cashTotal, 0));
  const openJobs = Number(summary?.openJobs ?? Number(counts.waiting || 0) + Number(counts.washing || 0) + Number(counts.done || 0));
  const averageJobValue = Number(summary?.averageJobValue ?? (jobsCount ? totalRevenue / jobsCount : 0));
  const trendRows = summary?.trendRows || [];
  const serviceRows = summary?.serviceRows || [];
  const staffRows = summary?.staffRows || [];
  const expenseRows = summary?.expenseRows || [];

  const periodLabel =
    applied.mode === "daily"
      ? applied.date
      : period.start && period.end
        ? `${period.start} to ${period.end}`
        : applied.mode === "monthly"
          ? applied.month
          : applied.date;

  const methodRows = useMemo(
    () => paymentMethods.map((key) => ({ key, label: paymentLabels[key], amount: Number(methods[key] || 0) })),
    [methods]
  );

  const submit = (event) => {
    event.preventDefault();
    setApplied({ mode, date, month });
  };

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setApplied({ mode: nextMode, date, month });
  };

  return (
    <CarWashShell
      title={`${reportModes.find((item) => item.key === mode)?.label || "Daily"} Reports`}
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button type="button" onClick={() => window.print()} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaPrint />
            Print
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="mb-2 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm md:grid-cols-[260px_180px_120px]">
        <div className="flex h-8 border border-[#B7C9C0] bg-[#F1F6F3]">
          {reportModes.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => changeMode(item.key)}
              className={`h-full flex-1 px-3 text-xs font-extrabold uppercase ${mode === item.key ? "bg-[#0B3B2E] text-white" : "text-[#0B3B2E] hover:bg-white"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {mode === "monthly" ? (
          <input
            type="month"
            className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        ) : (
          <input
            type="date"
            className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        )}
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch />
          Search
        </button>
      </form>

      <div className="mb-2 overflow-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Period: <strong className="text-slate-900">{periodLabel}</strong></span>
          <span>Jobs: <strong className="text-[#0B3B2E]">{jobsCount}</strong></span>
          <span>Revenue: <strong className="text-[#0B3B2E]">{formatMoney(totalRevenue)}</strong></span>
          <span>Paid Expenses: <strong className="text-[#FF8C00]">{formatMoney(totalExpenses)}</strong></span>
          <span>Pending Expenses: <strong className="text-cyan-700">{formatMoney(pendingExpenses)}</strong></span>
          <span>Net: <strong className={netPosition >= 0 ? "text-[#0B3B2E]" : "text-red-700"}>{formatMoney(netPosition)}</strong></span>
          <span>Cash: <strong className="text-[#0B3B2E]">{formatMoney(cashTotal)}</strong></span>
          <span>M-Pesa: <strong className="text-[#0B3B2E]">{formatMoney(mpesaTotal)}</strong></span>
          <span>Open Jobs: <strong className="text-[#FF8C00]">{openJobs}</strong></span>
        </div>
      </div>

      <div className="grid gap-2 xl:grid-cols-[0.95fr_1.05fr]">
        <ReportTable title="Operations Position">
          <thead className="bg-[#0B3B2E] text-white">
            <tr><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Metric</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Value</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Control Note</th></tr>
          </thead>
          <tbody>
            {[
              ["Total Jobs", jobsCount, "All jobs created in the report period"],
              ["Paid Jobs", counts.paid || 0, "Jobs completed and paid"],
              ["Open Jobs", openJobs, "Waiting, washing or done but not paid"],
              ["Cancelled", counts.cancelled || 0, "Jobs removed from the active flow"],
              ["Average Job Value", formatMoney(averageJobValue), "Revenue divided by total jobs"],
              ["Paid Expenses", formatMoney(totalExpenses), "Expenses already paid from a cashbook"],
              ["Pending Expenses", `${pendingExpenseCount} / ${formatMoney(pendingExpenses)}`, "Draft or approved costs not yet paid"],
              ["Net Position", formatMoney(netPosition), "Revenue minus paid expenses"],
            ].map(([label, value, note]) => (
              <tr key={label} className="border-b border-slate-200 hover:bg-slate-50"><td className="px-2 py-1 font-bold text-slate-700">{label}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{value}</td><td className="px-2 py-1 text-slate-500">{note}</td></tr>
            ))}
          </tbody>
        </ReportTable>

        <ReportTable title="Cash Control">
          <thead className="bg-[#0B3B2E] text-white">
            <tr><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Control</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Meaning</th></tr>
          </thead>
          <tbody>
            {[
              ["Cash Drawer", formatMoney(cashTotal), "Physical cash expected"],
              ["Non-Cash", formatMoney(nonCashTotal), "M-Pesa, bank, card and other"],
              ["Total Collections", formatMoney(totalRevenue), "All payments received"],
              ["Payment Count", paymentCount, "Number of payments recorded"],
            ].map(([label, value, note]) => (
              <tr key={label} className="border-b border-slate-200 hover:bg-slate-50"><td className="px-2 py-1 font-bold text-slate-700">{label}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{value}</td><td className="px-2 py-1 text-slate-500">{note}</td></tr>
            ))}
          </tbody>
        </ReportTable>
      </div>

      <div className="mt-2 grid gap-2 xl:grid-cols-2">
        <ReportTable title="Job Status Breakdown">
          <thead className="bg-[#0B3B2E] text-white">
            <tr><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Status</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Count</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">% of Jobs</th></tr>
          </thead>
          <tbody>
            {reportStatuses.map((key) => {
              const value = Number(counts[key] || 0);
              const share = jobsCount ? Math.round((value / jobsCount) * 100) : 0;
              return <tr key={key} className="border-b border-slate-200 hover:bg-slate-50"><td className="px-2 py-1 font-bold text-slate-700">{statusLabels[key]}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{value}</td><td className="px-2 py-1 text-right font-semibold text-[#0B3B2E]">{share}%</td></tr>;
            })}
          </tbody>
        </ReportTable>

        <ReportTable title="Revenue By Method">
          <thead className="bg-[#0B3B2E] text-white">
            <tr><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Method</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">% of Revenue</th></tr>
          </thead>
          <tbody>
            {methodRows.map((row) => {
              const share = totalRevenue ? Math.round((row.amount / totalRevenue) * 100) : 0;
              return <tr key={row.key} className="border-b border-slate-200 hover:bg-slate-50"><td className="px-2 py-1 font-bold text-slate-700">{row.label}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.amount)}</td><td className="px-2 py-1 text-right font-semibold text-[#0B3B2E]">{share}%</td></tr>;
            })}
          </tbody>
        </ReportTable>
      </div>

      <div className="mt-2">
        <ReportTable title="Paid Expenses By Category">
          <thead className="bg-[#0B3B2E] text-white">
            <tr><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Category</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Count</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">% of Expenses</th></tr>
          </thead>
          <tbody>
            {expenseRows.length ? expenseRows.map((row) => {
              const amount = Number(row.amount || 0);
              const share = totalExpenses ? Math.round((amount / totalExpenses) * 100) : 0;
              return <tr key={row.category} className="border-b border-slate-200 hover:bg-slate-50"><td className="px-2 py-1 font-bold text-slate-700">{row.category}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{row.count || 0}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(amount)}</td><td className="px-2 py-1 text-right font-semibold text-[#0B3B2E]">{share}%</td></tr>;
            }) : <EmptyRow colSpan={4} text="No paid Car Wash expenses recorded for this period." />}
          </tbody>
        </ReportTable>
      </div>

      {applied.mode !== "daily" && (
        <div className="mt-2 grid gap-2 xl:grid-cols-[1.2fr_0.8fr]">
          <ReportTable title="Daily Trend" minWidth="760px">
            <thead className="bg-[#0B3B2E] text-white">
              <tr><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Date</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Jobs</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Payments</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Revenue</th></tr>
            </thead>
            <tbody>
              {trendRows.length ? trendRows.map((row) => (
                <tr key={row.date} className="border-b border-slate-200 hover:bg-slate-50"><td className="px-2 py-1 font-bold text-slate-700">{row.date}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{row.jobs}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{row.payments}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.revenue)}</td></tr>
              )) : <EmptyRow colSpan={4} text="No trend data for this period." />}
            </tbody>
          </ReportTable>

          <ReportTable title="Staff Productivity">
            <thead className="bg-[#0B3B2E] text-white">
              <tr><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Staff</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Jobs</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Value</th></tr>
            </thead>
            <tbody>
              {staffRows.length ? staffRows.map((row) => (
                <tr key={row.staff} className="border-b border-slate-200 hover:bg-slate-50"><td className="px-2 py-1 font-bold text-slate-700">{row.staff}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{row.jobs}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.value)}</td></tr>
              )) : <EmptyRow colSpan={3} text="No staff activity for this period." />}
            </tbody>
          </ReportTable>

          <ReportTable title="Service Performance" className="xl:col-span-2">
            <thead className="bg-[#0B3B2E] text-white">
              <tr><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Service</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Jobs</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Value</th></tr>
            </thead>
            <tbody>
              {serviceRows.length ? serviceRows.map((row) => (
                <tr key={row.service} className="border-b border-slate-200 hover:bg-slate-50"><td className="px-2 py-1 font-bold text-slate-700">{row.service}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{row.jobs}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.value)}</td></tr>
              )) : <EmptyRow colSpan={3} text="No service activity for this period." />}
            </tbody>
          </ReportTable>
        </div>
      )}

      {applied.mode === "daily" && (
        <div className="mt-2 grid gap-2 xl:grid-cols-[1.15fr_0.85fr]">
          <ReportTable title="Job Audit" minWidth="900px" right={<button type="button" onClick={() => navigate("/carwash/jobs")} className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase text-[#0B3B2E] hover:text-[#FF8C00]"><FaExternalLinkAlt />Open Jobs</button>}>
            <thead className="bg-[#0B3B2E] text-white">
              <tr><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Time</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Job</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Plate</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Customer</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Service</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Status</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Payment</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Price</th></tr>
            </thead>
            <tbody>
              {jobs.length ? jobs.map((job) => (
                <tr key={job._id} className="border-b border-slate-200 hover:bg-slate-50"><td className="px-2 py-1 text-slate-600">{formatTime(job.createdAt)}</td><td className="px-2 py-1 font-extrabold text-slate-900">{job.jobNumber || "-"}</td><td className="px-2 py-1 font-bold uppercase text-slate-800">{job.plateNumber || "-"}</td><td className="px-2 py-1 text-slate-700">{job.customerName || "-"}</td><td className="px-2 py-1 text-slate-700">{job.serviceName || "-"}</td><td className="px-2 py-1 font-bold text-slate-700">{statusLabels[job.status] || job.status || "-"}</td><td className="px-2 py-1 font-bold uppercase text-slate-700">{job.paymentStatus || "unpaid"}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(job.price)}</td></tr>
              )) : <EmptyRow colSpan={8} text="No Car Wash jobs recorded for this date." />}
            </tbody>
          </ReportTable>

          <ReportTable title="Payment Audit" right={<button type="button" onClick={() => navigate("/carwash/payments")} className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase text-[#0B3B2E] hover:text-[#FF8C00]"><FaExternalLinkAlt />Open Payments</button>}>
            <thead className="bg-[#0B3B2E] text-white">
              <tr><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Time</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Method</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Ref</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th></tr>
            </thead>
            <tbody>
              {payments.length ? payments.map((payment) => (
                <tr key={payment._id} className="border-b border-slate-200 hover:bg-slate-50"><td className="px-2 py-1 text-slate-600">{formatTime(payment.paymentDate)}</td><td className="px-2 py-1 font-bold uppercase text-slate-700">{payment.method || "-"}</td><td className="px-2 py-1 text-slate-700">{payment.reference || payment.job?.jobNumber || "-"}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(payment.amount)}</td></tr>
              )) : <EmptyRow colSpan={4} text="No Car Wash payments recorded for this date." />}
            </tbody>
          </ReportTable>

          <ReportTable title="Expense Audit" className="xl:col-span-2" right={<button type="button" onClick={() => navigate("/carwash/expenses")} className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase text-[#0B3B2E] hover:text-[#FF8C00]"><FaExternalLinkAlt />Open Expenses</button>}>
            <thead className="bg-[#0B3B2E] text-white">
              <tr><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Time</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Expense</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Payee</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Category</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Method</th><th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Status</th><th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th></tr>
            </thead>
            <tbody>
              {expenses.length ? expenses.map((expense) => (
                <tr key={expense._id} className="border-b border-slate-200 hover:bg-slate-50"><td className="px-2 py-1 text-slate-600">{formatTime(expense.expenseDate)}</td><td className="px-2 py-1 font-extrabold text-slate-900">{expense.expenseNumber || "-"}</td><td className="px-2 py-1 text-slate-700">{expense.payee || "-"}</td><td className="px-2 py-1 text-slate-700">{expense.category || "-"}</td><td className="px-2 py-1 font-bold uppercase text-slate-700">{expense.method || "-"}</td><td className="px-2 py-1 font-bold uppercase text-slate-700">{expense.status || "-"}</td><td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(expense.amount)}</td></tr>
              )) : <EmptyRow colSpan={7} text="No Car Wash expenses recorded for this date." />}
            </tbody>
          </ReportTable>
        </div>
      )}
    </CarWashShell>
  );
};

export default CarWashReports;

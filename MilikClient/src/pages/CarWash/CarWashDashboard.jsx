import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaCar, FaCheckCircle, FaClock, FaMoneyBillWave, FaPhone, FaPlus, FaRedoAlt, FaSoap } from "react-icons/fa";
import { carWashApi, formatMoney, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const statusLabels = {
  waiting: "Waiting",
  washing: "Washing",
  done: "Done",
  paid: "Paid",
  cancelled: "Cancelled",
};

const paymentLabels = {
  cash: "Cash",
  mpesa: "M-Pesa",
  bank: "Bank",
  card: "Card",
  other: "Other",
};

const formatTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
};

const StatCard = ({ label, value, icon: StatIcon, tone = "green" }) => {
  const toneMap = {
    green: {
      bg: "bg-[#174D3A]",
      border: "border-[#174D3A]",
      iconBox: "bg-white/10 text-white",
      value: "text-white",
      label: "text-emerald-50",
    },
    orange: {
      bg: "bg-[#E65F1A]",
      border: "border-[#E65F1A]",
      iconBox: "bg-white/10 text-white",
      value: "text-white",
      label: "text-orange-50",
    },
  };
  const colors = toneMap[tone] || toneMap.green;
  return (
    <div className={`border ${colors.border} ${colors.bg} px-3 py-2 shadow-sm`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className={`text-[11px] font-bold uppercase tracking-wide ${colors.label}`}>{label}</div>
          <div className={`mt-1 text-xl font-extrabold leading-none ${colors.value}`}>{value}</div>
        </div>
        <span className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center ${colors.iconBox}`}>
          {React.createElement(StatIcon, { className: "h-3.5 w-3.5" })}
        </span>
      </div>
    </div>
  );
};

const Section = ({ title, right, children, className = "" }) => (
  <section className={`border border-slate-200 bg-white shadow-sm ${className}`}>
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
      <h2 className="text-xs font-extrabold uppercase tracking-wide text-[#0B3B2E]">{title}</h2>
      {right}
    </div>
    {children}
  </section>
);

const EmptyRow = ({ colSpan, text }) => (
  <tr>
    <td colSpan={colSpan} className="px-3 py-8 text-center text-xs font-semibold text-slate-500">
      {text}
    </td>
  </tr>
);

const CarWashDashboard = () => {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [payments, setPayments] = useState([]);
  const [date, setDate] = useState(todayISO());
  const [loading, setLoading] = useState(false);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const [summaryPayload, jobsPayload, paymentsPayload] = await Promise.all([
        carWashApi.getDailySummary(date),
        carWashApi.listJobs({ date, limit: 20 }),
        carWashApi.listPayments({ date, limit: 20 }),
      ]);
      setSummary(summaryPayload || null);
      setJobs(normalizeListPayload(jobsPayload, "jobs"));
      setPayments(normalizeListPayload(paymentsPayload, "payments"));
    } catch {
      setSummary(null);
      setJobs([]);
      setPayments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [date]);

  const counts = summary?.statusCounts || {};
  const revenueByMethod = summary?.revenueByMethod || {};
  const totalRevenue = Number(summary?.todayRevenue || 0);
  const activeQueue = Number(counts.waiting || 0) + Number(counts.washing || 0) + Number(counts.done || 0);
  const paidJobs = Number(counts.paid || 0);
  const unpaidJobs = jobs.filter((job) => job.paymentStatus !== "paid").length;

  const paymentRows = useMemo(
    () =>
      Object.keys(paymentLabels).map((method) => ({
        method,
        label: paymentLabels[method],
        amount: Number(revenueByMethod[method] || 0),
      })),
    [revenueByMethod]
  );

  return (
    <CarWashShell
      title="Daily Operations"
      action={
        <>
          <input
            type="date"
            className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <button
            type="button"
            onClick={loadDashboard}
            className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => navigate("/carwash/jobs")}
            className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#0A3127]"
          >
            <FaPlus />
            New Job
          </button>
        </>
      }
    >
      <div className="grid gap-1.5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Today Jobs" value={summary?.todayJobsCount || 0} icon={FaCar} tone="green" />
        <StatCard label="Active Queue" value={activeQueue} icon={FaClock} tone="orange" />
        <StatCard label="Today Revenue" value={formatMoney(totalRevenue)} icon={FaMoneyBillWave} tone="green" />
        <StatCard label="Cash" value={formatMoney(summary?.cashTotal)} icon={FaMoneyBillWave} tone="orange" />
        <StatCard label="M-Pesa" value={formatMoney(summary?.mpesaTotal)} icon={FaPhone} tone="green" />
      </div>

      <div className="mt-1.5 grid items-start gap-2 grid-cols-1 xl:grid-cols-[1.15fr_0.85fr]">
        <Section title="Operations Queue" right={<span className="text-[11px] font-bold text-slate-500">{date}</span>}>
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 sm:grid-cols-5 sm:divide-y-0">
            {[
              ["waiting", FaClock],
              ["washing", FaSoap],
              ["done", FaCheckCircle],
              ["paid", FaMoneyBillWave],
              ["cancelled", FaCar],
            ].map(([status, StatusIcon]) => (
              <div key={status} className="p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{statusLabels[status]}</span>
                  {React.createElement(StatusIcon, { className: "h-3.5 w-3.5 text-[#FF8C00]" })}
                </div>
                <div className="mt-1 text-xl font-extrabold leading-none text-[#082F25]">{counts[status] || 0}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Payment Mix">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[280px] text-xs">
            <thead className="bg-[#0B3B2E] text-white">
              <tr>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Method</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Amount</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Share</th>
              </tr>
            </thead>
            <tbody>
              {paymentRows.map((row) => {
                const share = totalRevenue > 0 ? Math.round((row.amount / totalRevenue) * 100) : 0;
                return (
                  <tr key={row.method} className="border-b border-slate-200 last:border-b-0">
                    <td className="px-3 py-2 font-semibold text-slate-700">{row.label}</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900">{formatMoney(row.amount)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-[#0B3B2E]">{share}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Section>
      </div>

      <div className="mt-2 grid items-start gap-2 grid-cols-1 xl:grid-cols-[1.4fr_0.6fr]">
        <Section
          title="Daily Control Summary"
          right={<span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Jobs and collections</span>}
        >
          <div className="overflow-x-auto">
          <table className="w-full min-w-[340px] text-xs">
            <thead className="bg-[#0B3B2E] text-white">
              <tr>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Metric</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Value</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Note</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Paid Jobs", paidJobs, "Completed and fully paid"],
                ["Unpaid Jobs", unpaidJobs, "Requires follow-up or payment"],
                ["Payments", summary?.paymentCount || 0, "Receipts recorded today"],
                ["Non-Cash", formatMoney(totalRevenue - Number(summary?.cashTotal || 0)), "M-Pesa, bank, card and other"],
              ].map(([label, value, note]) => (
                <tr key={label} className="border-b border-slate-200 last:border-b-0 hover:bg-slate-50">
                  <td className="px-3 py-2 font-semibold text-slate-700">{label}</td>
                  <td className="px-3 py-2 text-right font-extrabold text-slate-950">{value}</td>
                  <td className="px-3 py-2 text-slate-500">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Section>
        <Section title="Actions">
          <div className="grid gap-2 p-3">
            <button
              type="button"
              onClick={() => navigate("/carwash/jobs")}
              className="border border-[#0B3B2E] bg-[#0B3B2E] px-3 py-2 text-left text-xs font-bold text-white hover:bg-[#0A3127]"
            >
              New Job
            </button>
            <button
              type="button"
              onClick={() => navigate("/carwash/payments")}
              className="border border-[#B7C9C0] bg-white px-3 py-2 text-left text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
            >
              Payments
            </button>
            <button
              type="button"
              onClick={() => navigate("/carwash/reports")}
              className="border border-[#B7C9C0] bg-white px-3 py-2 text-left text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
            >
              Reports
            </button>
            <button
              type="button"
              onClick={() => navigate("/carwash/financials")}
              className="border border-[#B7C9C0] bg-white px-3 py-2 text-left text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
            >
              Financials
            </button>
          </div>
        </Section>
      </div>

      <div className="mt-2 grid items-start gap-2 grid-cols-1 xl:grid-cols-[1.4fr_0.6fr]">
        <Section
          title="Today Jobs"
          right={
            <button
              type="button"
              onClick={() => navigate("/carwash/jobs")}
              className="text-[11px] font-extrabold uppercase tracking-wide text-[#0B3B2E] hover:text-[#FF8C00]"
            >
              Open Jobs
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-xs">
              <thead className="bg-[#0B3B2E] text-white">
                <tr>
                  <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Time</th>
                  <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Job No.</th>
                  <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Plate</th>
                  <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Service</th>
                  <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Staff</th>
                  <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Status</th>
                  <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Payment</th>
                  <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Price</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length ? (
                  jobs.slice(0, 8).map((job) => (
                    <tr key={job._id} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-3 py-2 font-semibold text-slate-600">{formatTime(job.createdAt)}</td>
                      <td className="px-3 py-2 font-bold text-slate-900">{job.jobNumber || "-"}</td>
                      <td className="px-3 py-2 font-extrabold text-slate-900">{job.plateNumber || "-"}</td>
                      <td className="px-3 py-2 text-slate-700">{job.serviceName || "-"}</td>
                      <td className="px-3 py-2 text-slate-700">{job.assignedStaff?.name || "-"}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex border border-slate-200 bg-slate-50 px-2 py-0.5 font-bold uppercase text-slate-700">
                          {statusLabels[job.status] || job.status || "-"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex border px-2 py-0.5 font-bold uppercase ${
                            job.paymentStatus === "paid"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-orange-200 bg-orange-50 text-orange-700"
                          }`}
                        >
                          {job.paymentStatus || "unpaid"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-slate-900">{formatMoney(job.price)}</td>
                    </tr>
                  ))
                ) : (
                  <EmptyRow colSpan={8} text="No Car Wash jobs recorded for this date." />
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Recent Payments">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[260px] text-xs">
            <thead className="bg-[#0B3B2E] text-white">
              <tr>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Time</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Ref</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.length ? (
                payments.slice(0, 8).map((payment) => (
                  <tr key={payment._id} className="border-b border-slate-200 last:border-b-0 hover:bg-slate-50">
                    <td className="px-3 py-2 font-semibold text-slate-600">{formatTime(payment.paymentDate)}</td>
                    <td className="px-3 py-2">
                      <div className="font-bold uppercase text-slate-900">{payment.method || "-"}</div>
                      <div className="text-[11px] text-slate-500">{payment.reference || payment.job?.jobNumber || "-"}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900">{formatMoney(payment.amount)}</td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={3} text="No payments recorded for this date." />
              )}
            </tbody>
          </table>
          </div>
        </Section>
      </div>
    </CarWashShell>
  );
};

export default CarWashDashboard;

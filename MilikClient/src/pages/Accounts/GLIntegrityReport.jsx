import React, { useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaCheckCircle, FaExclamationCircle, FaExclamationTriangle,
  FaInfoCircle, FaShieldAlt, FaSyncAlt,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { selectCurrentCompany } from "../../redux/selectors";
import { runGLIntegrityReport } from "../../redux/apiCalls";

const GRN = "#0B3B2E";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtNum  = (n) =>
  Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SEV = {
  critical: { icon: FaExclamationCircle,  bar: "bg-red-500",   badge: "border-red-200 bg-red-50 text-red-700"   },
  warning:  { icon: FaExclamationTriangle, bar: "bg-amber-500", badge: "border-amber-200 bg-amber-50 text-amber-700" },
  info:     { icon: FaInfoCircle,          bar: "bg-blue-400",  badge: "border-blue-200 bg-blue-50 text-blue-700"   },
};

const TH = ({ children, right }) => (
  <th className={`border-b border-slate-200 bg-slate-50 px-3 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-slate-400 ${right ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const TD = ({ children, right, cls = "" }) => (
  <td className={`border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-700 last:border-0 ${right ? "text-right tabular-nums" : ""} ${cls}`}>
    {children}
  </td>
);

export default function GLIntegrityReport() {
  const company  = useSelector(selectCurrentCompany);
  const [loading, setLoading] = useState(false);
  const [report,  setReport]  = useState(null);

  const run = async () => {
    if (!company?._id) return;
    setLoading(true);
    try {
      setReport(await runGLIntegrityReport({ business: company._id }));
    } catch (err) {
      toast.error(err?.response?.data?.error || "Integrity check failed");
    } finally {
      setLoading(false);
    }
  };

  const status = report?.overallStatus;
  const STATUS_CFG = {
    clean:    { icon: FaCheckCircle,        cls: "border-emerald-200 bg-emerald-50", text: "text-emerald-700", label: "All Clear"         },
    warnings: { icon: FaExclamationTriangle, cls: "border-amber-200 bg-amber-50",    text: "text-amber-700",   label: "Warnings Found"    },
    critical: { icon: FaExclamationCircle,  cls: "border-red-200 bg-red-50",         text: "text-red-700",     label: "Critical Issues"   },
  };

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden bg-slate-100">

        {/* Toolbar */}
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-2.5">
          <FaShieldAlt size={11} style={{ color: GRN }} />
          <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: GRN }}>
            GL Integrity Report
          </span>
          <span className="text-[10px] text-slate-400">— Scan for unbalanced entries and orphaned records</span>
          <div className="ml-auto">
            <button
              onClick={run}
              disabled={loading}
              className="flex h-7 items-center gap-1.5 px-4 text-[11px] font-bold text-white disabled:opacity-60"
              style={{ backgroundColor: GRN }}
            >
              <FaSyncAlt size={9} className={loading ? "animate-spin" : ""} />
              {loading ? "Running…" : "Run Check"}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Empty state */}
          {!report && !loading && (
            <div className="border border-dashed border-slate-300 py-20 text-center">
              <FaShieldAlt size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-[11px] font-semibold text-slate-500">Click "Run Check" to audit your general ledger</p>
              <p className="mt-1 text-[10px] text-slate-400">
                Checks GL balance, journal group integrity, orphaned entries, abnormal signs & more
              </p>
            </div>
          )}

          {report && (
            <>
              {/* Overall status banner */}
              {status && STATUS_CFG[status] && (() => {
                const cfg = STATUS_CFG[status];
                const Icon = cfg.icon;
                return (
                  <div className={`flex items-center gap-3 border px-4 py-3 ${cfg.cls}`}>
                    <Icon size={18} className={cfg.text} />
                    <div>
                      <div className={`text-[12px] font-black ${cfg.text}`}>{cfg.label}</div>
                      <div className="text-[10px] text-slate-500">
                        Checked at {new Date(report.runAt).toLocaleString("en-GB")} · {report.issues?.length || 0} issue(s)
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Issues list */}
              {report.issues?.length > 0 && (
                <div className="border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="border-b border-slate-100 px-4 py-2.5" style={{ borderLeftWidth: 3, borderLeftColor: GRN }}>
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">
                      Issues · {report.issues.length}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {report.issues.map((issue, i) => {
                      const cfg = SEV[issue.severity] || SEV.info;
                      const Icon = cfg.icon;
                      return (
                        <div key={i} className="flex items-start gap-3 px-4 py-2.5">
                          <div className={`mt-0.5 h-4 w-4 shrink-0 flex items-center justify-center`}>
                            <Icon size={12} className={SEV[issue.severity]?.badge.includes("red") ? "text-red-500" : SEV[issue.severity]?.badge.includes("amber") ? "text-amber-500" : "text-blue-500"} />
                          </div>
                          <div className="flex-1">
                            <span className={`inline-flex items-center border px-1.5 py-0 text-[8px] font-bold uppercase tracking-[0.1em] mr-2 ${cfg.badge}`}>
                              {issue.severity}
                            </span>
                            <span className="text-[11px] text-slate-700">{issue.issue}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* GL Balance summary */}
              <div className="border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="border-b border-slate-100 px-4 py-2.5" style={{ borderLeftWidth: 3, borderLeftColor: GRN }}>
                  <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">GL Balance Summary</span>
                </div>
                <div className="flex overflow-hidden">
                  {[
                    { label: "Total Debits",  val: fmtNum(report.detail?.glBalance?.totalDebit),  color: "text-slate-800" },
                    { label: "Total Credits", val: fmtNum(report.detail?.glBalance?.totalCredit), color: "text-slate-800" },
                    { label: "Difference",    val: fmtNum(report.detail?.glBalance?.difference),  color: "text-red-600"   },
                    { label: "Balanced",
                      val: report.detail?.glBalance?.balanced ? "Yes" : "No",
                      color: report.detail?.glBalance?.balanced ? "text-emerald-700" : "text-red-600"
                    },
                  ].map((item, i) => (
                    <div key={i} className="flex flex-1 flex-col border-r border-slate-100 px-4 py-3 last:border-r-0">
                      <div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">{item.label}</div>
                      <div className={`mt-1 text-[13px] font-black tabular-nums ${item.color}`}>{item.val}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Misc counters */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Orphaned Entries",           val: report.detail?.orphanedEntriesCount    ?? 0 },
                  { label: "Inactive Account Entries",   val: report.detail?.inactiveAccountEntries   ?? 0 },
                  { label: "Posted Journals, No Ledger", val: report.detail?.journalsWithNoLedger?.length ?? 0 },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`border px-4 py-3 shadow-sm ${item.val > 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}
                  >
                    <div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">{item.label}</div>
                    <div className={`mt-1 text-2xl font-black ${item.val > 0 ? "text-red-600" : "text-emerald-700"}`}>
                      {item.val}
                    </div>
                  </div>
                ))}
              </div>

              {/* Unbalanced groups table */}
              {report.detail?.unbalancedGroups?.length > 0 && (
                <div className="border border-red-200 bg-white shadow-sm overflow-hidden">
                  <div className="border-b border-red-100 bg-red-50 px-4 py-2.5">
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-red-700">
                      Unbalanced Journal Groups · {report.detail.unbalancedGroups.length}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <TH>Group ID</TH><TH>Source</TH><TH>Date</TH>
                          <TH right>Debit</TH><TH right>Credit</TH><TH right>Difference</TH>
                        </tr>
                      </thead>
                      <tbody>
                        {report.detail.unbalancedGroups.map((g) => (
                          <tr key={g.journalGroupId} className="hover:bg-slate-50">
                            <TD cls="font-mono text-[10px] text-slate-400">{String(g.journalGroupId).slice(-8)}</TD>
                            <TD>{g.sourceType}</TD>
                            <TD>{fmtDate(g.date)}</TD>
                            <TD right>{fmtNum(g.debit)}</TD>
                            <TD right>{fmtNum(g.credit)}</TD>
                            <TD right cls="font-bold text-red-600">{fmtNum(g.difference)}</TD>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Abnormal balances table */}
              {report.detail?.abnormalBalances?.length > 0 && (
                <div className="border border-amber-200 bg-white shadow-sm overflow-hidden">
                  <div className="border-b border-amber-100 bg-amber-50 px-4 py-2.5">
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">
                      Abnormal Account Balances · {report.detail.abnormalBalances.length}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <TH>Code</TH><TH>Account Name</TH><TH>Type</TH><TH right>Net Balance</TH>
                        </tr>
                      </thead>
                      <tbody>
                        {report.detail.abnormalBalances.map((row) => (
                          <tr key={row.accountId} className="hover:bg-slate-50">
                            <TD cls="font-mono text-[10px]">{row.code}</TD>
                            <TD>{row.name}</TD>
                            <TD cls="capitalize">{row.type}</TD>
                            <TD right cls={`font-bold ${row.netBalance < 0 ? "text-red-600" : "text-amber-600"}`}>
                              {fmtNum(row.netBalance)}
                            </TD>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

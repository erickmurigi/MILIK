import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaCheckCircle, FaDownload, FaExclamationTriangle, FaEraser, FaRedoAlt, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { adminRequests } from "../../utils/requestMethods";
import { fmtDate } from "../../utils/dates";

const SCOPES = [
  { key: "transactions", label: "Transactions only" },
  { key: "all", label: "Everything except setup" },
];

// Worded from what this company actually holds (a car wash sees customers and staff, not landlords).
const scopeHint = (key, masters) => {
  const names = (masters || []).map((m) => m.label.toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  if (key === "transactions") {
    return list
      ? `Removes every transaction (listed below once selected). Keeps ${list}, with their balances set to zero.`
      : "Removes every transaction (listed below once selected). Setup stays.";
  }
  return `${list ? `Also removes ${list}. ` : ""}Keeps the chart of accounts, tax and module settings, users and the audit trail.`;
};

const EXPORT_VALID_MS = 24 * 60 * 60 * 1000;
const errorText = (err, fallback) => err?.response?.data?.message || err?.message || fallback;
const fmtCount = (n) => Number(n || 0).toLocaleString();

const StepBadge = ({ n, done }) => (
  <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center text-[10px] font-black ${done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"}`}>
    {done ? <FaCheckCircle size={10} /> : n}
  </span>
);

export default function CompanyDataResetModal({ company, onClose, onFinished }) {
  const companyId = company?._id || company?.id;
  const [scope, setScope] = useState("transactions");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [password, setPassword] = useState("");
  const [overrideFiled, setOverrideFiled] = useState(false);
  const [job, setJob] = useState(null);
  const requestRef = useRef(0);
  // one preview per scope: switching back and forth doesn't recount the whole company
  const previewCache = useRef({});

  const loadPreview = useCallback(async ({ force = false } = {}) => {
    const requestId = ++requestRef.current;
    if (force) previewCache.current = {};
    const cached = previewCache.current[scope];
    if (cached) { setPreview(cached); setLoading(false); return; }
    setLoading(true);
    try {
      const { data } = await adminRequests.get(`/companies/${companyId}/data-reset/preview`, { params: { scope } });
      if (requestId !== requestRef.current) return;
      previewCache.current[scope] = data;
      setPreview(data);
      // a reset still running, or one that stopped and needs a retry, takes over the dialog
      if (["running", "failed"].includes(data.latest?.status) && data.latest?.startedAt) setJob(data.latest);
    } catch (err) {
      if (requestId === requestRef.current) toast.error(errorText(err, "Failed to load the reset preview."));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [companyId, scope]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  // follow a running reset until it finishes
  const running = job?.status === "running";
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(async () => {
      try {
        const { data } = await adminRequests.get(`/companies/${companyId}/data-reset/latest`);
        setJob(data);
        if (data?.status === "completed") { toast.success(`${company?.companyName || "Company"} data was reset.`); onFinished?.(); }
        if (data?.status === "failed") toast.error(data.error || "The reset failed.");
      } catch { /* keep polling */ }
    }, 1500);
    return () => clearInterval(timer);
  }, [running, companyId, company?.companyName, onFinished]);

  const latest = preview?.latest;
  const backupReady = Boolean(
    latest?.status === "ready" && latest.scope === scope && latest.exportedAt && Date.now() - new Date(latest.exportedAt).getTime() < EXPORT_VALID_MS
  );

  const { removals, resets } = useMemo(() => {
    const groups = new Map();
    const resetSteps = [];
    for (const step of preview?.steps || []) {
      if (step.action === "reset") { if (step.total) resetSteps.push(step); continue; }
      if (!step.total) continue;
      if (!groups.has(step.module)) groups.set(step.module, []);
      groups.get(step.module).push(step);
    }
    return { removals: [...groups.entries()], resets: resetSteps };
  }, [preview]);

  const filed = preview?.filed || {};
  const hasFiled = Boolean(filed.closedPeriods || filed.taxRemittances);
  const unclassified = preview?.unclassified || [];
  const nameMatches = confirmName.trim() === String(preview?.company?.companyName || company?.companyName || "").trim();
  const canStart = backupReady && nameMatches && password && (!hasFiled || overrideFiled) && !unclassified.length && !starting;

  const downloadBackup = async () => {
    setDownloading(true);
    try {
      const res = await adminRequests.get(`/companies/${companyId}/data-reset/backup`, { params: { scope }, responseType: "blob", timeout: 0 });
      const safeName = String(company?.companyName || "company").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
      const url = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeName}-backup-${new Date().toISOString().slice(0, 10)}.json.gz`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded. Keep it safe before resetting.");
      await loadPreview({ force: true });
    } catch (err) {
      toast.error(errorText(err, "Backup download failed."));
    } finally {
      setDownloading(false);
    }
  };

  const startReset = async () => {
    setStarting(true);
    try {
      const { data } = await adminRequests.post(`/companies/${companyId}/data-reset`, { scope, confirmName: confirmName.trim(), password, overrideFiled });
      setJob(data);
      setPassword("");
    } catch (err) {
      toast.error(errorText(err, "The reset could not start."));
    } finally {
      setStarting(false);
    }
  };

  const retry = async () => {
    if (!password) { toast.error("Enter your password to retry."); return; }
    setStarting(true);
    try {
      const { data } = await adminRequests.post(`/companies/${companyId}/data-reset/${job._id}/retry`, { password });
      setJob(data);
      setPassword("");
    } catch (err) {
      toast.error(errorText(err, "Retry failed."));
    } finally {
      setStarting(false);
    }
  };

  const steps = job?.steps || [];
  const doneSteps = steps.filter((s) => s.status === "done").length;
  const currentStep = steps.find((s) => s.status === "running");
  const progress = steps.length ? Math.round((doneSteps / steps.length) * 100) : 0;
  const removed = steps.filter((s) => s.action === "delete").reduce((sum, s) => sum + (s.done || 0), 0);

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
        <div className="flex flex-shrink-0 items-center justify-between gap-3 bg-red-800 px-4 py-2.5 text-white">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-black uppercase tracking-wide">
            <FaEraser size={13} />
            <span className="truncate">Reset Company Data — {company?.companyName}</span>
          </h3>
          <button onClick={() => !running && onClose()} disabled={running} className="text-white/70 hover:text-white disabled:opacity-40"><FaTimes size={13} /></button>
        </div>

        {job ? (
          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4">
            <div className="border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-700">
                <span>
                  {job.status === "running" && `Resetting… ${currentStep?.label || ""}`}
                  {job.status === "completed" && "Reset complete"}
                  {job.status === "failed" && "Reset stopped"}
                </span>
                <span>{doneSteps} / {steps.length} steps</span>
              </div>
              <div className="h-2 w-full bg-slate-200">
                <div className={`h-2 transition-all ${job.status === "failed" ? "bg-red-600" : "bg-emerald-600"}`} style={{ width: `${job.status === "completed" ? 100 : progress}%` }} />
              </div>
              <p className="mt-3 text-xs text-slate-600">
                {job.status === "completed" && `${fmtCount(removed)} records removed (${job.scope === "all" ? "everything except setup" : "transactions only"}). The company is unlocked again.`}
                {job.status === "running" && "The company is locked while this runs. This window stays open until it finishes."}
                {job.status === "failed" && (
                  <span className="text-red-700">{job.error || "The reset failed."} The company stays locked. Retry finishes what is left; the backup you downloaded still covers everything.</span>
                )}
              </p>
            </div>

            {job.status === "failed" && (
              <div className="flex flex-wrap items-end gap-2 border border-red-200 bg-white p-3">
                <label className="flex flex-col text-[11px] font-bold text-slate-700">
                  Your password
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="mt-1 h-8 w-60 border border-slate-300 px-2 text-xs font-normal outline-none focus:border-red-700" />
                </label>
                <button type="button" onClick={retry} disabled={starting} className="inline-flex h-8 items-center gap-1.5 bg-red-700 px-4 text-xs font-black text-white hover:bg-red-800 disabled:opacity-60">
                  <FaRedoAlt size={10} /> Retry reset
                </button>
              </div>
            )}

            <div className="max-h-72 overflow-y-auto border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <tbody>
                  {steps.filter((s) => s.total || s.done).map((s) => (
                    <tr key={`${s.model}-${s.action}`} className="border-b border-slate-100">
                      <td className="px-3 py-1.5 text-slate-500">{s.module}</td>
                      <td className="px-3 py-1.5 font-semibold text-slate-800">{s.label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{s.status === "done" ? fmtCount(s.done) : s.status === "running" ? "…" : fmtCount(s.total)}</td>
                      <td className="w-8 px-2 text-center">{s.status === "done" && <FaCheckCircle className="text-emerald-600" size={11} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4">
            <div className="flex gap-2 border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <FaExclamationTriangle className="mt-0.5 shrink-0" />
              <span>Use this for wrong or test data only. Records removed here cannot be restored from Milik — only from the backup file you download in step 1. For a client who is leaving, lock or archive the company instead: their records must be kept for 5 years.</span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SCOPES.map((opt) => (
                <button key={opt.key} type="button" onClick={() => setScope(opt.key)} className={`border p-3 text-left ${scope === opt.key ? "border-red-700 bg-red-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                  <div className="text-xs font-black text-slate-800">{opt.label}</div>
                  <div className="mt-1 text-[11px] leading-snug text-slate-600">{preview ? scopeHint(opt.key, preview.masters) : "…"}</div>
                </button>
              ))}
            </div>

            {loading || !preview ? (
              <div className="flex h-40 items-center justify-center"><FaRedoAlt className="animate-spin text-slate-400" /></div>
            ) : (
              <>
                <div className="border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                    <span className="text-[11px] font-black uppercase tracking-wide text-slate-800">What will be removed</span>
                    <span className="text-xs font-black text-red-700">{fmtCount(preview.totalRecords)} records</span>
                  </div>
                  {removals.length ? (
                    <div className="grid grid-cols-1 gap-x-6 px-3 py-2 sm:grid-cols-2">
                      {removals.map(([module, rows]) => (
                        <div key={module} className="py-1">
                          <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{module}</div>
                          {rows.map((r) => (
                            <div key={r.model} className="flex justify-between text-xs text-slate-700">
                              <span>{r.label}</span><span className="tabular-nums">{fmtCount(r.total)}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="px-3 py-3 text-xs text-slate-500">Nothing to remove for this scope.</p>
                  )}
                  {resets.length > 0 && (
                    <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-600">
                      <span className="font-bold text-slate-700">Also reset: </span>{resets.map((r) => r.label).join(" · ")}
                    </div>
                  )}
                </div>

                {unclassified.length > 0 && (
                  <div className="border border-red-300 bg-red-50 p-3 text-xs text-red-800">
                    Reset is unavailable until these record types are classified by a developer: {unclassified.join(", ")}.
                  </div>
                )}

                {hasFiled && (
                  <label className="flex items-start gap-2 border border-red-300 bg-red-50 p-3 text-xs text-red-800">
                    <input type="checkbox" checked={overrideFiled} onChange={(e) => setOverrideFiled(e.target.checked)} className="mt-0.5" />
                    <span>
                      This company has {filed.closedPeriods} closed accounting period(s) and {filed.taxRemittances} tax remittance(s). Those may already be filed with KRA. Tick to confirm they are wrong or test data and may be removed.
                    </span>
                  </label>
                )}

                <div className="border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                      <StepBadge n={1} done={backupReady} />
                      Download a backup
                      {backupReady && <span className="font-normal text-slate-500">— taken {fmtDate(latest.exportedAt)}, valid 24 hours</span>}
                    </div>
                    <button type="button" onClick={downloadBackup} disabled={downloading} className="inline-flex h-8 items-center gap-1.5 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                      {downloading ? <FaRedoAlt className="animate-spin" size={10} /> : <FaDownload size={10} />} {backupReady ? "Download again" : "Download backup"}
                    </button>
                  </div>
                </div>

                <div className={`border border-slate-200 bg-white p-3 ${backupReady ? "" : "opacity-50"}`}>
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-800">
                    <StepBadge n={2} done={false} /> Confirm
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="flex flex-col text-[11px] font-bold text-slate-700">
                      Type <span className="font-black text-red-700">{preview.company?.companyName}</span> to confirm
                      <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} disabled={!backupReady} className="mt-1 h-8 border border-slate-300 px-2 text-xs font-normal outline-none focus:border-red-700" />
                    </label>
                    <label className="flex flex-col text-[11px] font-bold text-slate-700">
                      Your password
                      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!backupReady} autoComplete="current-password" className="mt-1 h-8 border border-slate-300 px-2 text-xs font-normal outline-none focus:border-red-700" />
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-2.5">
          <button type="button" onClick={onClose} disabled={running} className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Close</button>
          {!job && (
            <button type="button" onClick={startReset} disabled={!canStart} className="inline-flex h-8 items-center gap-1.5 bg-red-700 px-4 text-xs font-black text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50">
              {starting ? <FaRedoAlt className="animate-spin" size={10} /> : <FaEraser size={10} />} Reset company data
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

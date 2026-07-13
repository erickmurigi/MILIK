import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaBook, FaCalculator, FaEye, FaPlay, FaSyncAlt } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import JournalEntriesDrawer from "../../components/Accounting/JournalEntriesDrawer";
import { previewDepreciation, runDepreciation } from "../../redux/apiCalls";

const GRN = "#0B3B2E";
const fmt = (n) =>
  Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const METHODS = [
  { value: "straight_line",    label: "Straight Line" },
  { value: "reducing_balance", label: "Reducing Balance" },
  { value: "none",             label: "No Depreciation" },
];
const methodLabel = (m) => METHODS.find((x) => x.value === m)?.label || m;

const localDate = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

// ─────────────────────────────────────────────────────────────────────────────
const FixedAssetsDepreciation = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const businessId = currentCompany?._id;

  const [preview, setPreview]               = useState(null);
  const [depPeriodStart, setDepPeriodStart] = useState("");
  const [glAsset, setGlAsset]              = useState(null);
  const [depPeriodEnd, setDepPeriodEnd]     = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [depRunning, setDepRunning]         = useState(false);
  const [depResult, setDepResult]           = useState(null);

  useEffect(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    setDepPeriodStart(localDate(new Date(y, m, 1)));
    setDepPeriodEnd(localDate(new Date(y, m + 1, 0)));
  }, []);

  const loadPreview = async () => {
    if (!businessId) return;
    setPreviewLoading(true);
    setDepResult(null);
    try {
      const data = await previewDepreciation({ business: businessId });
      setPreview(data);
      if (!data?.preview?.length) toast.info("No active assets with depreciation to preview.");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load preview.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRun = async () => {
    if (!businessId) return;
    if (!depPeriodStart || !depPeriodEnd) return toast.error("Select a period first.");
    if (!preview) return toast.error("Load a preview first.");
    setDepRunning(true);
    try {
      const result = await runDepreciation({ business: businessId, periodStart: depPeriodStart, periodEnd: depPeriodEnd });
      setDepResult(result);
      setPreview(null);
      toast.success("Depreciation posted to GL");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Depreciation run failed.");
    } finally {
      setDepRunning(false);
    }
  };

  const activeRows  = useMemo(() => (preview?.preview || []).filter((p) => p.monthlyDepreciation > 0), [preview]);
  const skippedRows = useMemo(() => (preview?.preview || []).filter((p) => p.monthlyDepreciation === 0), [preview]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-[calc(100dvh-152px)] flex-col overflow-hidden">

        {/* ── Toolbar ── */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-gray-50/95 px-4 py-2">
          <FaCalculator size={11} className="text-slate-400" />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Depreciation</p>

          <div className="mx-1 h-4 w-px bg-slate-200" />

          {/* Period */}
          <div className="flex flex-col gap-0.5">
            <label className="text-[9px] font-semibold uppercase text-slate-400">Period Start</label>
            <input type="date" value={depPeriodStart} onChange={(e) => setDepPeriodStart(e.target.value)}
              className="h-7 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[9px] font-semibold uppercase text-slate-400">Period End</label>
            <input type="date" value={depPeriodEnd} onChange={(e) => setDepPeriodEnd(e.target.value)}
              className="h-7 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
          </div>

          <div className="mx-1 h-4 w-px bg-slate-200" />

          <button
            onClick={loadPreview} disabled={previewLoading}
            className="flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {previewLoading ? <FaSyncAlt size={9} className="animate-spin" /> : <FaEye size={10} />}
            {previewLoading ? "Loading…" : "Preview"}
          </button>

          <button
            onClick={handleRun}
            disabled={depRunning || !preview || activeRows.length === 0}
            className="flex h-7 items-center gap-1.5 rounded px-3 text-xs font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: GRN }}
            title={!preview ? "Load preview first" : ""}
          >
            {depRunning ? <FaSyncAlt size={9} className="animate-spin" /> : <FaPlay size={9} />}
            {depRunning ? "Posting…" : "Post Depreciation"}
          </button>

          {preview && (
            <>
              <div className="mx-1 h-4 w-px bg-slate-200" />
              <span className="text-[10px] font-semibold text-slate-400">
                {activeRows.length} asset{activeRows.length !== 1 ? "s" : ""} · Total KES {fmt(preview.totalDepreciation)}
              </span>
            </>
          )}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-auto">

          {/* Empty / initial state */}
          {!preview && !depResult && !previewLoading && (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-slate-400">
              <FaCalculator size={24} className="opacity-20" />
              <p className="text-xs font-semibold">Select a period and click Preview</p>
              <p className="text-[11px] text-slate-400">See what will be posted before committing to the GL.</p>
            </div>
          )}

          {/* Preview table */}
          {preview && (
            <table className="min-w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Code</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Asset Name</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Category</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Method</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Book Value (KES)</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Monthly Dep. (KES)</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Last Run</th>
                  <th className="px-3 py-1 text-center font-bold">Will Post</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((p, idx) => (
                  <tr key={p._id} className={`border-b border-gray-100 ${idx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                    <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-400">{p.code || "—"}</td>
                    <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">{p.name}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{p.category || "—"}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{methodLabel(p.depreciationMethod)}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-slate-700">{fmt(p.bookValue)}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-semibold text-rose-600">{fmt(p.monthlyDepreciation)}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-400">
                      {p.lastDepreciationDate
                        ? new Date(p.lastDepreciationDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })
                        : "Never"}
                    </td>
                    <td className="px-3 py-1 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <span className="inline-block rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Yes</span>
                        <button onClick={() => setGlAsset(p)} className="rounded p-1 text-teal-600 hover:bg-teal-50 hover:text-teal-800" title="View past GL entries for this asset"><FaBook size={10} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {skippedRows.map((p, idx) => (
                  <tr key={p._id} className="border-b border-gray-100 opacity-35">
                    <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-400">{p.code || "—"}</td>
                    <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">{p.name}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{p.category || "—"}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{methodLabel(p.depreciationMethod)}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-slate-700">{fmt(p.bookValue)}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-slate-300">—</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-400">
                      {p.lastDepreciationDate
                        ? new Date(p.lastDepreciationDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })
                        : "Never"}
                    </td>
                    <td className="px-3 py-1 text-center">
                      <span className="inline-block rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">Skip</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {activeRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500">
                    <td colSpan={5} className="px-4 py-2">Total to post · {activeRows.length} asset{activeRows.length !== 1 ? "s" : ""}</td>
                    <td className="px-4 py-2 text-right font-mono text-rose-600">{fmt(preview.totalDepreciation)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          )}

          {/* Post result */}
          {depResult && (
            <div className="m-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="mb-3 text-xs font-black uppercase tracking-widest text-emerald-700">
                Depreciation Posted · {depResult.periodStart} → {depResult.periodEnd}
              </p>
              <div className="space-y-1.5">
                {depResult.results.map((r) => (
                  <div key={r.assetId} className="flex items-start gap-2 text-xs">
                    {r.skipped ? (
                      <>
                        <span className="mt-0.5 text-slate-400">⊘</span>
                        <span className="text-slate-400">{r.name} — skipped ({r.reason})</span>
                      </>
                    ) : (
                      <>
                        <span className="mt-0.5 font-bold text-emerald-600">✓</span>
                        <span className="text-slate-700">
                          <span className="font-semibold">{r.name}</span>: KES {fmt(r.depreciation)} charged
                          <span className="mx-1 text-slate-400">·</span>
                          book value → KES {fmt(r.newBookValue)}
                        </span>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setDepResult(null)}
                className="mt-4 flex h-7 items-center gap-1.5 rounded border border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                Run Another Period
              </button>
            </div>
          )}

        </div>
      </div>

      <JournalEntriesDrawer
        open={!!glAsset}
        onClose={() => setGlAsset(null)}
        title="Fixed Asset Depreciation"
        transactionRef={glAsset?.code ? `${glAsset.code} — ${glAsset.name}` : glAsset?.name}
        amount={glAsset?.bookValue}
        contextFields={glAsset ? [
          { label: "Category",   value: glAsset.category },
          { label: "Method",     value: methodLabel(glAsset.depreciationMethod) },
          { label: "Book Value", value: `KES ${fmt(glAsset.bookValue)}` },
          { label: "Monthly Dep", value: `KES ${fmt(glAsset.monthlyDepreciation)}` },
        ].filter((f) => f.value) : []}
        businessId={businessId}
        sourceType="fixed_asset_depreciation"
        sourceId={glAsset?._id}
      />

    </DashboardLayout>
  );
};

export default FixedAssetsDepreciation;

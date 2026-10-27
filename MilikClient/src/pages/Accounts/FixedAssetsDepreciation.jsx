import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaBook, FaCalculator, FaEye, FaPlay, FaSyncAlt } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import ListToolbar from "../../components/common/ListToolbar";
import JournalEntriesDrawer from "../../components/Accounting/JournalEntriesDrawer";
import MilikTable from "../../components/common/MilikTable";
import StatusBadge from "../../components/common/StatusBadge";
import { previewDepreciation, runDepreciation } from "../../redux/apiCalls";

const fmt = (n) =>
  Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const POST_STATUS_MAP = {
  yes:  "border-emerald-200 bg-emerald-50 text-emerald-700",
  skip: "border-slate-200 bg-slate-100 text-slate-500",
};

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
  const [depAsOf, setDepAsOf]               = useState("");
  const [glAsset, setGlAsset]              = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [depRunning, setDepRunning]         = useState(false);
  const [depResult, setDepResult]           = useState(null);

  useEffect(() => {
    setDepAsOf(localDate(new Date()));
  }, []);

  const loadPreview = async () => {
    if (!businessId) return;
    if (!depAsOf) return toast.error("Select a date first.");
    setPreviewLoading(true);
    setDepResult(null);
    try {
      const data = await previewDepreciation({ business: businessId, asOf: depAsOf });
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
    if (!depAsOf) return toast.error("Select a date first.");
    if (!preview) return toast.error("Load a preview first.");
    setDepRunning(true);
    try {
      const result = await runDepreciation({ business: businessId, asOf: depAsOf });
      setDepResult(result);
      setPreview(null);
      toast.success("Depreciation posted to GL");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Depreciation run failed.");
    } finally {
      setDepRunning(false);
    }
  };

  const activeRows  = useMemo(() => (preview?.preview || []).filter((p) => p.amountDue > 0), [preview]);
  const skippedRows = useMemo(() => (preview?.preview || []).filter((p) => !(p.amountDue > 0)), [preview]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-[calc(100dvh-152px)] flex-col overflow-hidden">

        {/* ── Toolbar ── */}
        <ListToolbar>
          {preview && (
            <>
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                To Post: {activeRows.length}
              </span>
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                Total: KES {fmt(preview.totalDepreciation)}
              </span>
              <ListToolbar.Divider />
            </>
          )}

          <span className="shrink-0 text-[10px] font-semibold text-slate-500">Through</span>
          <ListToolbar.Input width="w-[130px]" type="date" value={depAsOf} onChange={(e) => setDepAsOf(e.target.value)} />

          <ListToolbar.Divider />

          <ListToolbar.Button icon={previewLoading ? FaSyncAlt : FaEye} variant="outline" onClick={loadPreview} disabled={previewLoading} className={previewLoading ? "[&>svg]:animate-spin" : ""}>
            {previewLoading ? "Loading…" : "Preview"}
          </ListToolbar.Button>

          <ListToolbar.Button
            icon={depRunning ? FaSyncAlt : FaPlay}
            onClick={handleRun}
            disabled={depRunning || !preview || activeRows.length === 0}
            title={!preview ? "Load preview first" : ""}
            className={depRunning ? "[&>svg]:animate-spin" : ""}
          >
            {depRunning ? "Posting…" : "Post Depreciation"}
          </ListToolbar.Button>
        </ListToolbar>

        {/* ── Content ── */}
        <div className="flex-1 overflow-auto">

          {/* Empty / initial state */}
          {!preview && !depResult && !previewLoading && (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-slate-400">
              <FaCalculator size={24} className="opacity-20" />
              <p className="text-xs font-semibold">Select a date and click Preview</p>
              <p className="text-[11px] text-slate-400">See what will be posted before committing to the GL.</p>
            </div>
          )}

          {/* Preview table */}
          {preview && (
            <MilikTable
              columns={[
                { label: "Code" },
                { label: "Asset Name" },
                { label: "Category" },
                { label: "Method" },
                { label: "Book Value (KES)", align: "right" },
                { label: "Amount Due (KES)", align: "right" },
                { label: "Months", align: "right" },
                { label: "Last Run" },
                { label: "Will Post", align: "center" },
              ]}
              rows={[...activeRows, ...skippedRows]}
              rowClassName={(p) => (p.amountDue > 0 ? "" : "opacity-35")}
              empty="No active assets with depreciation to preview."
              renderFooter={activeRows.length > 0 ? () => (
                <>
                  <td colSpan={5} className="px-4 py-2">Total to post · {activeRows.length} asset{activeRows.length !== 1 ? "s" : ""}</td>
                  <td className="px-4 py-2 text-right font-mono text-rose-600">{fmt(preview.totalDepreciation)}</td>
                  <td colSpan={3} />
                </>
              ) : undefined}
              renderRow={(p) => (
                <>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-bold text-[#0B3B2E]">{p.code || "—"}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-800">{p.name}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">{p.category || "—"}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">{methodLabel(p.depreciationMethod)}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono text-slate-700">{fmt(p.bookValue)}</td>
                  <td className={`px-3 py-1.5 border-r border-gray-100 text-right font-mono ${p.amountDue > 0 ? "font-semibold text-rose-600" : "text-slate-300"}`}>
                    {p.amountDue > 0 ? fmt(p.amountDue) : "—"}
                  </td>
                  <td className={`px-3 py-1.5 border-r border-gray-100 text-right font-mono ${p.monthsDue > 1 ? "font-bold text-amber-600" : "text-slate-500"}`}>
                    {p.monthsDue > 0 ? p.monthsDue : "—"}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-400">
                    {p.lastDepreciationDate
                      ? new Date(p.lastDepreciationDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })
                      : "Never"}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <StatusBadge status={p.amountDue > 0 ? "yes" : "skip"} map={POST_STATUS_MAP} />
                      {p.amountDue > 0 && (
                        <button onClick={() => setGlAsset(p)} className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="View past GL entries for this asset"><FaBook size={10} /></button>
                      )}
                    </div>
                  </td>
                </>
              )}
            />
          )}

          {/* Post result */}
          {depResult && (
            <div className="m-4 border border-emerald-200 bg-emerald-50 p-4">
              <p className="mb-3 text-xs font-black uppercase tracking-widest text-emerald-700">
                Depreciation Posted · Through {depResult.asOf}
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
                          {r.monthsCharged} month{r.monthsCharged !== 1 ? "s" : ""}
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
                className="mt-4 flex h-7 items-center gap-1.5 border border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                Run Another Date
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
          { label: "Amount Due", value: `KES ${fmt(glAsset.amountDue)} (${glAsset.monthsDue} mo)` },
        ].filter((f) => f.value) : []}
        businessId={businessId}
        sourceType="fixed_asset_depreciation"
        sourceId={glAsset?._id}
      />

    </DashboardLayout>
  );
};

export default FixedAssetsDepreciation;

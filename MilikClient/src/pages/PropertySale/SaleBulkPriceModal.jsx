import React, { useMemo, useState } from "react";
import { toast } from "react-toastify";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import { useTerms } from "../../hooks/useTerm";
import Modal from "../../components/common/Modal";
import AppSelect from "../../components/common/AppSelect";
import { inputClass, labelClass } from "../../utils/formStyles";
import { errorMessage } from "./SaleProjectShared";

const MODES = [
  { value: "percent", label: "Percent", hint: "Add or subtract a percentage, e.g. 5 raises every price by 5%, -10 lowers it by 10%." },
  { value: "amount", label: "Amount", hint: "Add or subtract a fixed amount, e.g. 50000 or -25000." },
  { value: "set", label: "Set price", hint: "Give every matching unit the same price." },
];

const newPrice = (mode, value, price) => {
  const raw = mode === "percent" ? price * (1 + value / 100) : mode === "amount" ? price + value : value;
  return Math.max(0, Math.round(raw * 100) / 100);
};

// Reprices a project's available units (optionally one block). `units` is the loaded unit list, used for the preview.
export default function SaleBulkPriceModal({ project, units, onDone, onClose }) {
  const T = useTerms("saleUnit", "saleUnits");
  const [mode, setMode] = useState("percent");
  const [value, setValue] = useState("");
  const [block, setBlock] = useState("");
  const [saving, setSaving] = useState(false);

  const blockOptions = useMemo(
    () => [...new Set(units.map((u) => u.block).filter(Boolean))].map((b) => ({ value: b, label: b })),
    [units],
  );

  const numeric = value === "" ? null : Number(value);
  const valid = numeric != null && Number.isFinite(numeric)
    && !(mode === "percent" && numeric <= -100) && !(mode === "set" && numeric < 0);

  const preview = useMemo(() => {
    const scope = units.filter((u) => u.status === "available" && (!block || u.block === block));
    const before = scope.reduce((s, u) => s + (u.askingPrice || 0), 0);
    const after = valid ? scope.reduce((s, u) => s + newPrice(mode, numeric, u.askingPrice || 0), 0) : null;
    return { count: scope.length, before, after };
  }, [units, block, mode, numeric, valid]);

  const modeHint = MODES.find((m) => m.value === mode)?.hint;

  const handleSave = async () => {
    if (!valid) return toast.warning("Enter a valid number");
    setSaving(true);
    try {
      const res = await saleApi.updateProjectUnitPrices(project._id, { mode, value: numeric, ...(block && { block }) });
      await onDone?.();
      toast.success(`${res?.updated ?? 0} ${T.saleUnits.toLowerCase()} repriced`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update prices"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Bulk Price Change"
      size="md"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving || !valid || preview.count === 0} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
            {saving ? "Updating…" : "Apply Price Change"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="border border-[#B7C9C0] bg-[#F1F6F3] px-3 py-2 text-[11px] text-[#0B3B2E]">
          Only <span className="font-bold">available</span> {T.saleUnits.toLowerCase()} are repriced. Reserved, under-contract, sold and withdrawn {T.saleUnits.toLowerCase()} are never touched.
        </p>
        <div>
          <label className={labelClass}>Change by</label>
          <div className="flex">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={`flex-1 border px-3 py-1.5 text-xs font-bold ${mode === m.value ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-slate-400">{modeHint}</p>
        </div>
        <div>
          <label className={labelClass}>{mode === "percent" ? "Percentage (%)" : mode === "amount" ? "Amount (KES)" : "Price (KES)"}</label>
          <input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} autoFocus />
        </div>
        {blockOptions.length > 0 && (
          <AppSelect label="Only in block (optional)" value={block} onChange={(v) => setBlock(v ?? "")} options={blockOptions} placeholder="All blocks" size="md" clearable />
        )}
        <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {preview.count === 0
            ? `No available ${T.saleUnits.toLowerCase()} to reprice.`
            : (
              <>
                <span className="font-bold">{preview.count}</span> available {(preview.count === 1 ? T.saleUnit : T.saleUnits).toLowerCase()} · total {fmtKES(preview.before)}
                {preview.after != null && <> → <span className="font-bold text-[#0B3B2E]">{fmtKES(preview.after)}</span></>}
              </>
            )}
        </div>
      </div>
    </Modal>
  );
}

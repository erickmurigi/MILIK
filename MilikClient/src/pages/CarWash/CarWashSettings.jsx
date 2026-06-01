import React, { useCallback, useEffect, useState } from "react";
import { FaCheckCircle, FaCog, FaMoneyBillWave, FaRedoAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const inputClass = "h-9 w-full border border-slate-300 bg-white px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";

const METHOD_LABELS = {
  cash:  "Cash",
  mpesa: "M-Pesa (manual)",
  bank:  "Bank Transfer",
  card:  "Card / POS",
  other: "Other",
};

const METHODS = ["cash", "mpesa", "bank", "card", "other"];

const emptyDefaults = METHODS.reduce((acc, m) => { acc[m] = ""; return acc; }, {});

export default function CarWashSettings() {
  const [cashbooks, setCashbooks]   = useState([]);
  const [defaults, setDefaults]     = useState(emptyDefaults);
  const [loading, setLoading]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [dirty, setDirty]           = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cbRes, settingsRes] = await Promise.all([
        carWashApi.listCashbooks(),
        carWashApi.getCarWashSettings(),
      ]);
      setCashbooks(normalizeListPayload(cbRes, "accounts"));
      const saved = settingsRes?.defaultCashbooks || {};
      setDefaults(METHODS.reduce((acc, m) => {
        acc[m] = saved[m]?._id || saved[m] || "";
        return acc;
      }, {}));
      setDirty(false);
    } catch {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const set = (method, value) => {
    setDefaults((prev) => ({ ...prev, [method]: value }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await carWashApi.updateCarWashSettings({ defaultCashbooks: defaults });
      toast.success("Financial defaults saved");
      setDirty(false);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <CarWashShell
      title="Operational Settings"
      action={
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="inline-flex items-center gap-1.5 border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
            <FaRedoAlt size={10} /> Refresh
          </button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:opacity-50"
          >
            <FaCheckCircle size={10} /> {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      }
    >
      <div className="space-y-4 max-w-2xl">

        {/* Financial Defaults */}
        <div className="border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-[#EDF5F1] px-4 py-2.5">
            <FaMoneyBillWave className="text-[#0B3B2E] text-[13px]" />
            <span className="text-xs font-black uppercase tracking-wide text-[#0B3B2E]">Default Cashbooks by Payment Method</span>
          </div>
          <div className="p-4">
            <p className="mb-4 text-xs text-slate-500 leading-5">
              When recording a payment, the cashbook is automatically pre-selected based on the payment method.
              Setting these defaults saves your staff from having to pick an account on every transaction.
            </p>
            {loading ? (
              <div className="flex h-24 items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-[#0B3B2E]" />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {METHODS.map((method) => (
                  <div key={method}>
                    <label className={labelClass}>{METHOD_LABELS[method]}</label>
                    <select
                      className={inputClass}
                      value={defaults[method]}
                      onChange={(e) => set(method, e.target.value)}
                    >
                      <option value="">— No default —</option>
                      {cashbooks.map((cb) => (
                        <option key={cb._id} value={cb._id}>
                          {cb.code} – {cb.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Future settings panels can go here */}
        <div className="border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-[#EDF5F1] px-4 py-2.5">
            <FaCog className="text-[#0B3B2E] text-[13px]" />
            <span className="text-xs font-black uppercase tracking-wide text-[#0B3B2E]">More Settings</span>
          </div>
          <div className="p-4 text-xs text-slate-400 italic">
            Additional operational settings will appear here as the module grows.
          </div>
        </div>

      </div>
    </CarWashShell>
  );
}

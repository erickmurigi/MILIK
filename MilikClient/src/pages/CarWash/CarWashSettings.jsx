import React, { useCallback, useEffect, useState } from "react";
import { FaCheckCircle, FaCog, FaMoneyBillWave, FaPiggyBank, FaRedoAlt, FaSms, FaToggleOn, FaToggleOff, FaChevronDown, FaChevronUp } from "react-icons/fa";
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
  const [cashbooks, setCashbooks]         = useState([]);
  const [defaults, setDefaults]           = useState(emptyDefaults);
  const [savingsAmount, setSavingsAmount] = useState(100);
  const [smsTemplates, setSmsTemplates]   = useState([]);
  const [expandedSms, setExpandedSms]     = useState(null);
  const [loading, setLoading]             = useState(false);
  const [saving, setSaving]               = useState(false);
  const [dirty, setDirty]                 = useState(false);

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
      setSavingsAmount(Number(settingsRes?.savingsDeductionPerJob ?? 100));
      setSmsTemplates(Array.isArray(settingsRes?.smsTemplates) ? settingsRes.smsTemplates : []);
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

  const setSmsField = (key, field, value) => {
    setSmsTemplates((prev) =>
      prev.map((t) => t.key === key ? { ...t, [field]: value } : t)
    );
    setDirty(true);
  };

  const insertPlaceholder = (key, token) => {
    setSmsTemplates((prev) =>
      prev.map((t) => {
        if (t.key !== key) return t;
        return { ...t, messageBody: (t.messageBody || "") + token };
      })
    );
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await carWashApi.updateCarWashSettings({
        defaultCashbooks: defaults,
        savingsDeductionPerJob: Number(savingsAmount),
        smsTemplates: smsTemplates.map(({ key, enabled, messageBody }) => ({ key, enabled, messageBody })),
      });
      toast.success("Settings saved");
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

        {/* Staff Savings Scheme */}
        <div className="border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-[#EDF5F1] px-4 py-2.5">
            <FaPiggyBank className="text-[#0B3B2E] text-[13px]" />
            <span className="text-xs font-black uppercase tracking-wide text-[#0B3B2E]">Staff Savings Scheme</span>
          </div>
          <div className="p-4">
            <p className="mb-4 text-xs text-slate-500 leading-5">
              A fixed amount is automatically held from each staff member's commission payout
              for each job they complete. The accumulated savings are disbursed annually
              or on request from the Commissions page.
            </p>
            <div className="max-w-xs">
              <label className={labelClass}>Deduction per job (Ksh)</label>
              <input
                type="number"
                min="0"
                step="10"
                className={inputClass}
                value={savingsAmount}
                onChange={(e) => { setSavingsAmount(e.target.value); setDirty(true); }}
              />
              <p className="mt-1 text-[10px] text-slate-400">
                Set to 0 to disable the savings scheme.
              </p>
            </div>
          </div>
        </div>

        {/* SMS Templates */}
        <div className="border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-[#EDF5F1] px-4 py-2.5">
            <FaSms className="text-[#0B3B2E] text-[13px]" />
            <span className="text-xs font-black uppercase tracking-wide text-[#0B3B2E]">Automatic SMS Templates</span>
          </div>
          <div className="p-4">
            <p className="mb-4 text-xs text-slate-500 leading-5">
              Customise the message sent for each automatic SMS event. Toggle a template off to stop that SMS entirely.
              Use the placeholder chips to insert dynamic values — they will be replaced with real data at send time.
            </p>
            {loading ? (
              <div className="flex h-16 items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-[#0B3B2E]" />
              </div>
            ) : (
              <div className="space-y-2">
                {smsTemplates.map((tpl) => {
                  const isOpen = expandedSms === tpl.key;
                  return (
                    <div key={tpl.key} className={`border ${tpl.enabled ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
                      {/* Header row */}
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-slate-50"
                        onClick={() => setExpandedSms(isOpen ? null : tpl.key)}
                      >
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            className="shrink-0"
                            title={tpl.enabled ? "Click to disable" : "Click to enable"}
                            onClick={(e) => { e.stopPropagation(); setSmsField(tpl.key, "enabled", !tpl.enabled); }}
                          >
                            {tpl.enabled
                              ? <FaToggleOn size={18} className="text-emerald-600" />
                              : <FaToggleOff size={18} className="text-slate-300" />}
                          </button>
                          <div>
                            <p className="text-xs font-bold text-slate-800">{tpl.name}</p>
                            <p className="text-[10px] text-slate-400">{tpl.description}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] font-black uppercase tracking-wide px-2 py-0.5 border ${tpl.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
                            {tpl.enabled ? "ON" : "OFF"}
                          </span>
                          {isOpen ? <FaChevronUp size={10} className="text-slate-400" /> : <FaChevronDown size={10} className="text-slate-400" />}
                        </div>
                      </button>

                      {/* Expanded editor */}
                      {isOpen && (
                        <div className="border-t border-slate-100 bg-slate-50 px-3 py-3 space-y-2">
                          {/* Placeholder chips */}
                          <div>
                            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Available placeholders — click to insert</p>
                            <div className="flex flex-wrap gap-1">
                              {(tpl.placeholders || []).map((p) => (
                                <button
                                  key={p.token}
                                  type="button"
                                  title={p.hint}
                                  onClick={() => insertPlaceholder(tpl.key, p.token)}
                                  className="border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-mono font-bold text-slate-700 hover:border-[#0B3B2E] hover:bg-[#EDF5F1]"
                                >
                                  {p.token}
                                </button>
                              ))}
                            </div>
                          </div>
                          {/* Body textarea */}
                          <div>
                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-400">Message body</label>
                            <textarea
                              rows={3}
                              className="w-full border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none font-mono resize-y"
                              value={tpl.messageBody || ""}
                              onChange={(e) => setSmsField(tpl.key, "messageBody", e.target.value)}
                            />
                            <p className="mt-0.5 text-right text-[10px] text-slate-400">{(tpl.messageBody || "").length} chars</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </CarWashShell>
  );
}

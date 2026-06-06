import React, { useCallback, useEffect, useState } from "react";
import {
  FaCheckCircle, FaMoneyBillWave, FaPiggyBank,
  FaRedoAlt, FaSms, FaToggleOff, FaToggleOn,
  FaChevronDown, FaChevronUp, FaExclamationCircle, FaInfoCircle,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";

const labelCls = "mb-1 block text-[10px] font-extrabold uppercase tracking-widest text-slate-500";
const inputCls = "h-9 w-full border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20 transition";

const METHOD_LABELS = { cash: "Cash", mpesa: "M-Pesa (manual)", bank: "Bank Transfer", card: "Card / POS", other: "Other" };
const METHODS = ["cash", "mpesa", "bank", "card", "other"];
const emptyDefaults = METHODS.reduce((acc, m) => { acc[m] = ""; return acc; }, {});

const SectionHeader = ({ icon: Icon, title, subtitle }) => (
  <div className="flex items-start gap-3 border-b border-slate-200 bg-[#EDF5F1] px-5 py-3.5 flex-shrink-0">
    <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-[#0B3B2E]/10">
      <Icon size={12} className="text-[#0B3B2E]" />
    </div>
    <div>
      <p className="text-xs font-black uppercase tracking-wide text-[#0B3B2E]">{title}</p>
      {subtitle && <p className="mt-0.5 text-[10px] leading-4 text-slate-500">{subtitle}</p>}
    </div>
  </div>
);

export default function CarWashSettings() {
  const [cashbooks, setCashbooks]         = useState([]);
  const [defaults, setDefaults]           = useState(emptyDefaults);
  const [savingsAmount, setSavingsAmount] = useState(100);
  const [smsTemplates, setSmsTemplates]   = useState([]);
  const [expandedSms, setExpandedSms]     = useState(null);
  const [loading, setLoading]             = useState(false);
  const [saving, setSaving]               = useState(false);
  const [dirty, setDirty]                 = useState(false);
  const canManage = useCarWashPermission("carwash-settings", "manage");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cbRes, settingsRes] = await Promise.all([
        carWashApi.listCashbooks(),
        carWashApi.getCarWashSettings(),
      ]);
      setCashbooks(normalizeListPayload(cbRes, "accounts"));
      const saved = settingsRes?.defaultCashbooks || {};
      setDefaults(METHODS.reduce((acc, m) => { acc[m] = saved[m]?._id || saved[m] || ""; return acc; }, {}));
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

  const setDefault    = (m, v)        => { setDefaults((p) => ({ ...p, [m]: v })); setDirty(true); };
  const setSmsField   = (k, f, v)     => { setSmsTemplates((p) => p.map((t) => t.key === k ? { ...t, [f]: v } : t)); setDirty(true); };
  const insertToken   = (k, token)    => { setSmsTemplates((p) => p.map((t) => t.key !== k ? t : { ...t, messageBody: (t.messageBody || "") + token })); setDirty(true); };

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
          <button type="button" onClick={loadData} disabled={loading}
            className="inline-flex items-center gap-1.5 border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition">
            <FaRedoAlt size={10} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          {canManage && (
            <button type="button" onClick={save} disabled={saving || !dirty}
              className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:opacity-50 transition">
              <FaCheckCircle size={10} /> {saving ? "Saving…" : "Save Changes"}
            </button>
          )}
        </div>
      }
    >
      {/* Root: flex column, fills shell exactly */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">

        {/* Unsaved banner */}
        {dirty && (
          <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
              <FaExclamationCircle size={11} className="flex-shrink-0 text-amber-500" />
              You have unsaved changes
            </div>
            {canManage && (
              <button type="button" onClick={save} disabled={saving}
                className="flex-shrink-0 bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50">
                {saving ? "Saving…" : "Save now"}
              </button>
            )}
          </div>
        )}

        {/* Two-column body
            Mobile  : flex-col → left stacks on top of right, outer div scrolls all
            Desktop : flex-row → each column scrolls independently
        */}
        <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden lg:flex lg:flex-row lg:divide-x lg:divide-slate-200">

          {/* ── LEFT COLUMN ─────────────────────────────────────────────── */}
          <div className="lg:w-[40%] lg:flex-shrink-0 lg:overflow-y-auto divide-y divide-slate-200 border-b lg:border-b-0">

            {/* Default Cashbooks */}
            <div className="bg-white">
              <SectionHeader
                icon={FaMoneyBillWave}
                title="Default Cashbooks by Payment Method"
                subtitle="Auto-selected when recording a payment — saves staff from picking an account on every transaction."
              />
              <div className="p-5">
                {loading ? (
                  <div className="flex h-28 items-center justify-center">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-[#0B3B2E]" />
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {METHODS.map((method) => (
                      <div key={method}>
                        <label className={labelCls}>{METHOD_LABELS[method]}</label>
                        <select className={inputCls} value={defaults[method]} onChange={(e) => setDefault(method, e.target.value)} disabled={!canManage}>
                          <option value="">— No default —</option>
                          {cashbooks.map((cb) => (
                            <option key={cb._id} value={cb._id}>{cb.code} – {cb.name}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Staff Savings Scheme */}
            <div className="bg-white">
              <SectionHeader
                icon={FaPiggyBank}
                title="Staff Savings Scheme"
                subtitle="A fixed deduction from each commission payout, held in savings and disbursed via the Commissions page."
              />
              <div className="p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Deduction per job (Ksh)</label>
                    <input type="number" min="0" step="10" className={inputCls}
                      value={savingsAmount}
                      onChange={(e) => { setSavingsAmount(e.target.value); setDirty(true); }}
                      disabled={!canManage}
                    />
                    <p className="mt-1.5 text-[10px] text-slate-400">Set to <strong>0</strong> to disable entirely.</p>
                  </div>
                  <div className="flex items-start gap-2.5 rounded border border-blue-100 bg-blue-50 p-3">
                    <FaInfoCircle size={11} className="mt-0.5 flex-shrink-0 text-blue-400" />
                    <p className="text-[10px] leading-4 text-blue-700">
                      Savings accumulate each time a commission is paid out. Staff can view their balance and request disbursement from the Commissions module.
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* ── RIGHT COLUMN — SMS Templates ────────────────────────────── */}
          {/* On mobile: natural height (outer scrolls). On desktop: flex-col with inner scroll. */}
          <div className="bg-white lg:flex-1 lg:flex lg:flex-col lg:overflow-hidden">

            <SectionHeader
              icon={FaSms}
              title="Automatic SMS Templates"
              subtitle="Customise messages for each event. Toggle off to disable an SMS entirely. Placeholders are replaced with live data at send time."
            />

            <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto divide-y divide-slate-100">
              {loading ? (
                <div className="flex h-28 items-center justify-center">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-[#0B3B2E]" />
                </div>
              ) : smsTemplates.length === 0 ? (
                <div className="flex h-28 items-center justify-center">
                  <p className="text-sm text-slate-400">No SMS templates configured</p>
                </div>
              ) : smsTemplates.map((tpl) => {
                const isOpen   = expandedSms === tpl.key;
                const charCount = (tpl.messageBody || "").length;
                const smsCount  = Math.ceil(charCount / 160) || 1;
                return (
                  <div key={tpl.key} className={`transition-colors ${!tpl.enabled ? "bg-slate-50/60" : "bg-white"}`}>

                    {/* Row */}
                    <button type="button"
                      className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-slate-50 transition"
                      onClick={() => setExpandedSms(isOpen ? null : tpl.key)}>
                      <div className="flex min-w-0 items-center gap-3">
                        <button type="button"
                          title={tpl.enabled ? "Disable" : "Enable"}
                          onClick={(e) => { e.stopPropagation(); if (canManage) setSmsField(tpl.key, "enabled", !tpl.enabled); }}>
                          {tpl.enabled
                            ? <FaToggleOn size={22} className="text-emerald-500" />
                            : <FaToggleOff size={22} className="text-slate-300" />}
                        </button>
                        <div className="min-w-0">
                          <p className={`truncate text-xs font-bold ${tpl.enabled ? "text-slate-800" : "text-slate-400"}`}>{tpl.name}</p>
                          {tpl.description && <p className="truncate text-[10px] text-slate-400">{tpl.description}</p>}
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2.5">
                        {!isOpen && charCount > 0 && (
                          <span className="hidden text-[10px] tabular-nums text-slate-400 sm:block">{charCount}c</span>
                        )}
                        <span className={`text-[9px] font-black uppercase tracking-wide px-2 py-0.5 border ${
                          tpl.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-400"
                        }`}>
                          {tpl.enabled ? "ON" : "OFF"}
                        </span>
                        {isOpen ? <FaChevronUp size={9} className="text-slate-400" /> : <FaChevronDown size={9} className="text-slate-400" />}
                      </div>
                    </button>

                    {/* Editor */}
                    {isOpen && (
                      <div className="border-t border-slate-100 bg-slate-50/80 px-5 py-4 space-y-3">
                        {(tpl.placeholders || []).length > 0 && (
                          <div>
                            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Placeholders — click to insert</p>
                            <div className="flex flex-wrap gap-1.5">
                              {tpl.placeholders.map((p) => (
                                <button key={p.token} type="button" title={p.hint}
                                  onClick={() => { if (canManage) insertToken(tpl.key, p.token); }}
                                  className="rounded-sm border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] font-bold text-[#0B3B2E] shadow-sm hover:border-[#0B3B2E] hover:bg-[#EDF5F1] transition">
                                  {p.token}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <div className="mb-1.5 flex items-center justify-between">
                            <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Message body</label>
                            <div className="flex items-center gap-2 text-[10px] tabular-nums">
                              <span className={charCount > 320 ? "font-bold text-red-500" : "text-slate-400"}>{charCount} chars</span>
                              <span className={`rounded border px-1.5 py-0.5 font-bold ${smsCount > 1 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                                {smsCount} SMS
                              </span>
                            </div>
                          </div>
                          <textarea rows={4}
                            className="w-full border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20 resize-y"
                            value={tpl.messageBody || ""}
                            onChange={(e) => { if (canManage) setSmsField(tpl.key, "messageBody", e.target.value); }}
                            readOnly={!canManage}
                            placeholder="Enter message text…"
                          />
                          {smsCount > 1 && (
                            <p className="mt-1 text-[10px] text-amber-600">
                              Messages over 160 characters are sent as {smsCount} SMS parts and may incur extra cost.
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* Sticky save footer */}
        {canManage && (
          <div className="flex-shrink-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
            <p className="text-xs">
              {dirty
                ? <span className="font-semibold text-amber-600">● Unsaved changes</span>
                : <span className="text-slate-400">All changes saved</span>}
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={loadData} disabled={loading || saving}
                className="border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition">
                Discard
              </button>
              <button type="button" onClick={save} disabled={saving || !dirty}
                className="bg-[#0B3B2E] px-5 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:opacity-50 transition">
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        )}

      </div>
    </CarWashShell>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FaCalculator, FaRedoAlt, FaSave, FaPlus, FaTrash, FaUndo } from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const pct = (v) => `${(Number(v) * 100).toFixed(2)}%`;
const fmtKES = (n) => `KES ${Number(n || 0).toLocaleString('en-KE')}`;

function computeClientPAYE(gross, { personalRelief, payeBands }) {
  let tax = 0, remaining = Math.max(0, gross), prev = 0;
  for (const { upTo, rate } of payeBands) {
    const limit   = (upTo === null || upTo === undefined || upTo === '') ? Infinity : Number(upTo);
    const taxable = Math.min(remaining, limit - prev);
    if (taxable <= 0) { prev = limit; continue; }
    tax += taxable * Number(rate);
    remaining -= taxable;
    prev = limit;
    if (remaining <= 0) break;
  }
  return Math.max(0, Math.round(tax - Number(personalRelief)));
}

function computeClientAll(gross, cfg) {
  const g = Math.max(0, Number(gross));
  const paye = computeClientPAYE(g, cfg);
  const nhif = Math.max(Number(cfg.shaMin), Math.round(g * Number(cfg.shaRate)));
  const nssfLo = Number(cfg.nssfLower), nssfUp = Number(cfg.nssfUpper), nssfR = Number(cfg.nssfRate);
  const nssf = Math.round(nssfLo * nssfR + (g > nssfLo ? (Math.min(g, nssfUp) - nssfLo) * nssfR : 0));
  const ahl  = Math.round(g * Number(cfg.ahlRate));
  return { paye, nhif, nssf, ahl, total: paye + nhif + nssf + ahl };
}

const DEFAULTS = {
  personalRelief: 2400,
  payeBands: [
    { upTo: 24000,   rate: 0.10 },
    { upTo: 32333,   rate: 0.25 },
    { upTo: 500000,  rate: 0.30 },
    { upTo: 800000,  rate: 0.325 },
    { upTo: null,    rate: 0.35 },
  ],
  shaRate: 0.0275, shaMin: 500,
  nssfLower: 7000, nssfUpper: 36000, nssfRate: 0.06,
  ahlRate: 0.015,
};

const inputCls = 'h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] text-right w-full';

export default function StatutoryDeductions() {
  const [cfg, setCfg]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [dirty, setDirty]     = useState(false);
  const [preview, setPreview] = useState(100000);
  const [confirm, setConfirm] = useState({ isOpen: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequests.get('/hr/statutory-config');
      setCfg(res.data);
      setDirty(false);
    } catch {
      toast.error('Failed to load statutory config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (field, value) => {
    setCfg((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const setBand = (i, field, value) => {
    setCfg((prev) => {
      const bands = [...prev.payeBands];
      bands[i] = { ...bands[i], [field]: value };
      return { ...prev, payeBands: bands };
    });
    setDirty(true);
  };

  const addBand = () => {
    setCfg((prev) => {
      const bands = [...prev.payeBands];
      const last  = bands[bands.length - 1];
      const newBand = { upTo: null, rate: last?.rate ?? 0 };
      if (last) last.upTo = last.upTo ?? 1000000;
      bands.push(newBand);
      return { ...prev, payeBands: bands };
    });
    setDirty(true);
  };

  const removeBand = (i) => {
    setCfg((prev) => {
      const bands = prev.payeBands.filter((_, idx) => idx !== i);
      if (bands.length > 0) bands[bands.length - 1] = { ...bands[bands.length - 1], upTo: null };
      return { ...prev, payeBands: bands };
    });
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...cfg,
        payeBands: cfg.payeBands.map((b, i) => ({
          rate: Number(b.rate),
          upTo: i === cfg.payeBands.length - 1 ? null : (b.upTo === '' || b.upTo === null ? null : Number(b.upTo)),
        })),
        personalRelief: Number(cfg.personalRelief),
        shaRate: Number(cfg.shaRate), shaMin: Number(cfg.shaMin),
        nssfLower: Number(cfg.nssfLower), nssfUpper: Number(cfg.nssfUpper), nssfRate: Number(cfg.nssfRate),
        ahlRate: Number(cfg.ahlRate),
      };
      await adminRequests.put('/hr/statutory-config', payload);
      toast.success('Statutory config saved');
      setDirty(false);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfirm({
      isOpen: true,
      title: 'Reset to Kenya Defaults',
      message: 'This will restore all statutory rates to Kenya 2024 defaults. Any customisations will be lost. Proceed?',
      isDangerous: true,
      confirmText: 'Reset',
      onConfirm: async () => {
        try {
          await adminRequests.delete('/hr/statutory-config');
          toast.success('Reset to Kenya defaults');
          load();
        } catch {
          toast.error('Failed to reset');
        } finally {
          setConfirm((p) => ({ ...p, isOpen: false }));
        }
      },
    });
  };

  const calc = useMemo(() => (cfg ? computeClientAll(preview, cfg) : null), [cfg, preview]);

  const cardCls = 'rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden';
  const sectionHead = (label, color = 'bg-[#0B3B2E]') =>
    <div className={`${color} px-4 py-2.5`}>
      <span className="text-[11px] font-black uppercase tracking-widest text-white">{label}</span>
    </div>;

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Payroll</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">Statutory Deductions Configuration</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleReset} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaUndo size={9} /> Reset to Defaults
              </button>
              <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={9} />
              </button>
              {dirty && (
                <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23] disabled:opacity-60">
                  <FaSave size={9} /> {saving ? 'Saving…' : 'Save Changes'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading config…</div>
          ) : !cfg ? null : (
            <div className="grid gap-4 lg:grid-cols-3">

              {/* Left column — PAYE */}
              <div className="lg:col-span-2 space-y-4">

                {/* PAYE bands */}
                <div className={cardCls}>
                  {sectionHead('PAYE Tax Bands')}
                  <div className="p-4 space-y-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                      Monthly cumulative bands — upper limit of each band from 0
                    </div>
                    <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center">
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">#</span>
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 text-right">Up to (KES)</span>
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 text-right">Rate (%)</span>
                      <span />
                    </div>
                    {cfg.payeBands.map((band, i) => {
                      const isLast = i === cfg.payeBands.length - 1;
                      return (
                        <div key={i} className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center">
                          <span className="w-5 text-center text-[10px] font-black text-slate-400">{i + 1}</span>
                          <input
                            type="number"
                            value={isLast ? '' : (band.upTo ?? '')}
                            onChange={(e) => setBand(i, 'upTo', e.target.value)}
                            placeholder={isLast ? '∞ (top band)' : ''}
                            disabled={isLast}
                            className={`${inputCls} ${isLast ? 'bg-slate-50 text-slate-400' : ''}`}
                          />
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={Number(band.rate * 100).toFixed(2)}
                            onChange={(e) => setBand(i, 'rate', Number(e.target.value) / 100)}
                            className={inputCls}
                          />
                          <button
                            onClick={() => removeBand(i)}
                            disabled={cfg.payeBands.length <= 1}
                            className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-500 hover:bg-rose-100 disabled:opacity-30"
                          >
                            <FaTrash size={9} />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      onClick={addBand}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-500 hover:border-slate-400 hover:bg-slate-50"
                    >
                      <FaPlus size={9} /> Add Band
                    </button>
                  </div>
                </div>

                {/* Personal Relief */}
                <div className={cardCls}>
                  {sectionHead('Personal Relief', 'bg-emerald-700')}
                  <div className="p-4">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Monthly Personal Relief (KES)</label>
                        <input
                          type="number"
                          value={cfg.personalRelief}
                          onChange={(e) => set('personalRelief', e.target.value)}
                          className={`mt-1 ${inputCls}`}
                        />
                      </div>
                      <div className="text-xs text-slate-500 max-w-xs">
                        Deducted from gross PAYE tax. Currently <span className="font-black text-slate-800">{fmtKES(cfg.personalRelief)}/month</span>.
                      </div>
                    </div>
                  </div>
                </div>

                {/* SHA */}
                <div className={cardCls}>
                  {sectionHead('SHA / NHIF', 'bg-blue-700')}
                  <div className="p-4 grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Rate (% of gross)</label>
                      <input type="number" step="0.01" value={Number(cfg.shaRate * 100).toFixed(2)}
                        onChange={(e) => set('shaRate', Number(e.target.value) / 100)}
                        className={`mt-1 ${inputCls}`} />
                      <div className="mt-0.5 text-[10px] text-slate-400">{pct(cfg.shaRate)} of gross</div>
                    </div>
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Minimum (KES)</label>
                      <input type="number" value={cfg.shaMin}
                        onChange={(e) => set('shaMin', e.target.value)}
                        className={`mt-1 ${inputCls}`} />
                    </div>
                  </div>
                </div>

                {/* NSSF */}
                <div className={cardCls}>
                  {sectionHead('NSSF (New Act)', 'bg-violet-700')}
                  <div className="p-4 grid grid-cols-3 gap-4">
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Lower Earnings Limit (KES)</label>
                      <input type="number" value={cfg.nssfLower}
                        onChange={(e) => set('nssfLower', e.target.value)}
                        className={`mt-1 ${inputCls}`} />
                    </div>
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Upper Earnings Limit (KES)</label>
                      <input type="number" value={cfg.nssfUpper}
                        onChange={(e) => set('nssfUpper', e.target.value)}
                        className={`mt-1 ${inputCls}`} />
                    </div>
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Rate (% of earnings)</label>
                      <input type="number" step="0.01" value={Number(cfg.nssfRate * 100).toFixed(2)}
                        onChange={(e) => set('nssfRate', Number(e.target.value) / 100)}
                        className={`mt-1 ${inputCls}`} />
                      <div className="mt-0.5 text-[10px] text-slate-400">{pct(cfg.nssfRate)} on Tier 1 + Tier 2</div>
                    </div>
                  </div>
                </div>

                {/* AHL */}
                <div className={cardCls}>
                  {sectionHead('Affordable Housing Levy', 'bg-amber-600')}
                  <div className="p-4 flex items-center gap-4">
                    <div className="w-40">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Rate (% of gross)</label>
                      <input type="number" step="0.01" value={Number(cfg.ahlRate * 100).toFixed(2)}
                        onChange={(e) => set('ahlRate', Number(e.target.value) / 100)}
                        className={`mt-1 ${inputCls}`} />
                      <div className="mt-0.5 text-[10px] text-slate-400">{pct(cfg.ahlRate)} of gross</div>
                    </div>
                    <div className="text-xs text-slate-500">
                      Affordable Housing Levy (employee share). Employer matches this contribution.
                    </div>
                  </div>
                </div>
              </div>

              {/* Right column — Preview calculator */}
              <div className="space-y-4">
                <div className={cardCls}>
                  <div className="bg-slate-700 px-4 py-2.5">
                    <span className="text-[11px] font-black uppercase tracking-widest text-white">Live Calculator</span>
                  </div>
                  <div className="p-4 space-y-3">
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Gross Salary (KES)</label>
                      <input
                        type="number"
                        value={preview}
                        onChange={(e) => setPreview(Number(e.target.value))}
                        className={`mt-1 ${inputCls}`}
                      />
                    </div>
                    {calc && (
                      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                        {[
                          { label: 'PAYE',     value: calc.paye, color: 'text-rose-700' },
                          { label: 'SHA/NHIF', value: calc.nhif, color: 'text-rose-600' },
                          { label: 'NSSF',     value: calc.nssf, color: 'text-rose-600' },
                          { label: 'AHL',      value: calc.ahl,  color: 'text-rose-600' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-600">{label}</span>
                            <span className={`font-black tabular-nums ${color}`}>{fmtKES(value)}</span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xs">
                          <span className="font-black text-slate-500 uppercase tracking-widest text-[10px]">Total Deductions</span>
                          <span className="font-black text-rose-800">{fmtKES(calc.total)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-black text-slate-500 uppercase tracking-widest text-[10px]">Net Pay</span>
                          <span className="font-black text-emerald-700 text-sm">{fmtKES(preview - calc.total)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Summary of current rates */}
                <div className={cardCls}>
                  <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200">
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-600">Rate Summary</span>
                  </div>
                  <div className="p-4 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Personal Relief</span>
                      <span className="font-black text-slate-800">{fmtKES(cfg.personalRelief)}/mo</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">SHA Rate</span>
                      <span className="font-black text-slate-800">{pct(cfg.shaRate)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">SHA Minimum</span>
                      <span className="font-black text-slate-800">{fmtKES(cfg.shaMin)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">NSSF Rate</span>
                      <span className="font-black text-slate-800">{pct(cfg.nssfRate)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">NSSF Lower / Upper</span>
                      <span className="font-black text-slate-800">{fmtKES(cfg.nssfLower)} / {fmtKES(cfg.nssfUpper)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">AHL Rate</span>
                      <span className="font-black text-slate-800">{pct(cfg.ahlRate)}</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-100 pt-2">
                      <span className="text-slate-500">PAYE Bands</span>
                      <span className="font-black text-slate-800">{cfg.payeBands.length}</span>
                    </div>
                  </div>
                </div>

                {dirty && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                    <span className="font-black">Unsaved changes.</span> These rates will apply to the next payroll run.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <MilikConfirmDialog {...confirm} onClose={() => setConfirm((p) => ({ ...p, isOpen: false }))} />
    </DashboardLayout>
  );
}

import React from "react";

const tierInputClass = "w-full border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-800 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";

// Editable list of { thresholdPct, releasePct } tiers — shared by the company-wide Commission Release
// Schedule (Settings) and any deal-level override of it (SaleDealFormModal / SaleCommissions), since both
// edit the exact same shape and need the exact same add/remove/validate behavior.
export default function TierListEditor({ tiers, setTiers, label }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-700">{label}</span>
        <button type="button" onClick={() => setTiers((rows) => [...rows, { thresholdPct: 0, releasePct: 0 }])}
          className="border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-50">
          + Add Tier
        </button>
      </div>
      {tiers.length === 0 ? (
        <p className="text-[11px] text-slate-400">No tiers — nothing releases until at least one is added (while the schedule is enabled).</p>
      ) : (
        <div className="space-y-2">
          {tiers.map((tier, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <label className="mb-0.5 block text-[10px] text-slate-400">% of price paid</label>
                <input type="number" min="0" max="100" step="1" value={tier.thresholdPct} className={tierInputClass}
                  onChange={(e) => setTiers((rows) => rows.map((r, idx) => idx === i ? { ...r, thresholdPct: Number(e.target.value || 0) } : r))} />
              </div>
              <div className="flex-1">
                <label className="mb-0.5 block text-[10px] text-slate-400">% of commission released</label>
                <input type="number" min="0" max="100" step="1" value={tier.releasePct} className={tierInputClass}
                  onChange={(e) => setTiers((rows) => rows.map((r, idx) => idx === i ? { ...r, releasePct: Number(e.target.value || 0) } : r))} />
              </div>
              <button type="button" onClick={() => setTiers((rows) => rows.filter((_, idx) => idx !== i))}
                className="mt-4 border border-red-200 bg-white px-2 py-1.5 text-[10px] font-bold text-red-600 hover:bg-red-50">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

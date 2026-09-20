import React, { useMemo } from "react";
import { fmtKES } from "../../services/propertySaleApi";
import { LISTING_STATUS_MAP, STATUS_LABEL } from "../../utils/saleListingConstants";

// Compact price for a small tile: 1.5M, 850K
const shortPrice = (n) => {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${Number((v / 1_000_000).toFixed(2))}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(v);
};

// Tile colours are the listing status badge classes, so a unit looks the same here as on the Listings page
const Tile = React.memo(function Tile({ unit, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(unit._id)}
      title={`${unit.unitNumber || unit.listingNumber} · ${fmtKES(unit.askingPrice)} · ${STATUS_LABEL[unit.status] || unit.status}`}
      className={`flex flex-col items-start border px-2 py-1.5 text-left transition-shadow hover:shadow-md ${LISTING_STATUS_MAP[unit.status] || "border-slate-200 bg-slate-50 text-slate-500"} ${selected ? "ring-2 ring-offset-1 ring-[#0B3B2E]" : ""}`}
    >
      <span className="w-full truncate text-xs font-black leading-tight">{unit.unitNumber || unit.listingNumber}</span>
      <span className="text-[10px] font-semibold tabular-nums opacity-80">{shortPrice(unit.askingPrice)}</span>
    </button>
  );
});

// Colour-coded tiles, one section per block when the project uses blocks
const SaleProjectUnitGrid = React.memo(function SaleProjectUnitGrid({ units, selectedId, onSelect, unitsLabel }) {
  const groups = useMemo(() => {
    const map = new Map();
    for (const u of units) {
      const key = u.block || "";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(u);
    }
    return [...map.entries()];
  }, [units]);

  if (!units.length) {
    return <div className="px-4 py-12 text-center text-xs font-semibold text-slate-400">No {unitsLabel.toLowerCase()} match these filters.</div>;
  }

  const showHeaders = groups.length > 1 || groups[0][0] !== "";
  return (
    <div className="space-y-3 p-3">
      {groups.map(([block, items]) => (
        <section key={block || "__none"}>
          {showHeaders && (
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
              {block ? `Block ${block}` : "No block"} <span className="font-semibold text-slate-400">· {items.length}</span>
            </div>
          )}
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))" }}>
            {items.map((u) => <Tile key={u._id} unit={u} selected={u._id === selectedId} onSelect={onSelect} />)}
          </div>
        </section>
      ))}
    </div>
  );
});

export default SaleProjectUnitGrid;

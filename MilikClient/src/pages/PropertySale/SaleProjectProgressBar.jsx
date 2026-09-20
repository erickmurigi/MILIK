import React from "react";
import { STATUS_SWATCH } from "./SaleProjectShared";
import { STATUS_LABEL } from "../../utils/saleListingConstants";

// Order the segments run in: closed sales first, open stock last
const SEGMENTS = ["sold", "under_contract", "reserved", "available"];

// Segmented bar of a project's units (withdrawn units are left out, as in the sell-through figure)
const SaleProjectProgressBar = React.memo(function SaleProjectProgressBar({ units, className = "" }) {
  const open = SEGMENTS.reduce((sum, k) => sum + (units?.[k] || 0), 0);
  const title = SEGMENTS.map((k) => `${STATUS_LABEL[k]}: ${units?.[k] || 0}`).join(" · ");
  return (
    <div className={`flex h-2 w-full overflow-hidden bg-slate-100 ${className}`} title={title}>
      {open > 0 && SEGMENTS.map((k) => (
        units?.[k] > 0 ? <div key={k} className={STATUS_SWATCH[k]} style={{ width: `${(units[k] / open) * 100}%` }} /> : null
      ))}
    </div>
  );
});

export default SaleProjectProgressBar;

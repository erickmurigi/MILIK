import React from "react";
import { Link } from "react-router-dom";
import { FaEdit, FaExternalLinkAlt, FaTimes, FaUnlink } from "react-icons/fa";
import { fmtKES } from "../../services/propertySaleApi";
import StatusBadge from "../../components/common/StatusBadge";
import { LISTING_STATUS_MAP } from "./SaleProjectShared";
import { listingAgentText } from "../../utils/saleAgent";

// Side panel with one unit's details and actions
const SaleProjectUnitPanel = React.memo(function SaleProjectUnitPanel({ unit, terms, busy, onClose, onEdit, onDetach }) {
  const rows = [
    [`${terms.saleListing} No.`, unit.listingNumber],
    ["Title", unit.title],
    ["Block", unit.block],
    ["Type", String(unit.propertyType || "").replace(/_/g, " ")],
    ["Size", unit.size ? `${unit.size} ${unit.sizeUnit || ""}`.trim() : null],
    ["Price", fmtKES(unit.askingPrice)],
    [terms.saleAgent, listingAgentText(unit, terms.saleProject.toLowerCase())],
    ["Title deed", unit.titleDeedAvailable ? "Available" : "Not available"],
  ].filter(([, v]) => v);

  return (
    <div className="absolute bottom-0 right-0 top-0 z-10 flex w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-xl sm:w-[320px]">
      <div className="shrink-0 bg-[#0B3B2E] px-4 py-3 text-white">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-wider text-white/60">{terms.saleUnit}</div>
            <div className="mt-0.5 truncate text-sm font-black leading-tight">{unit.unitNumber || unit.listingNumber}</div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 p-1 text-white/70 hover:bg-white/10"><FaTimes size={12} /></button>
        </div>
        <div className="mt-2"><StatusBadge status={unit.status} map={LISTING_STATUS_MAP} /></div>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
        {rows.map(([label, val]) => (
          <div key={label} className="flex items-baseline gap-2">
            <span className="w-[76px] shrink-0 text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</span>
            <span className="min-w-0 break-words text-xs capitalize text-slate-800">{val}</span>
          </div>
        ))}
        <Link to="/sale/offers" className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline">
          <FaExternalLinkAlt size={9} /> View {terms.saleOffers.toLowerCase()}
        </Link>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-1 border-t border-slate-200 bg-slate-50 px-3 py-2">
        <button
          type="button"
          onClick={() => onDetach(unit)}
          disabled={busy}
          className="inline-flex items-center gap-1 border border-red-200 bg-white px-2.5 py-1 text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          <FaUnlink size={9} /> Remove
        </button>
        <button
          type="button"
          onClick={() => onEdit(unit)}
          className="inline-flex items-center gap-1 bg-[#0B3B2E] px-3 py-1 text-[11px] font-black text-white hover:bg-[#07271e]"
        >
          <FaEdit size={9} /> Edit {terms.saleUnit}
        </button>
      </div>
    </div>
  );
});

export default SaleProjectUnitPanel;

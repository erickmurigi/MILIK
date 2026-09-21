import React from "react";
import { FaPrint } from "react-icons/fa";

// The Print button used on every Property Sales report.
const SalePrintButton = ({ onClick, disabled = false, busy = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || busy}
    title="Print this report"
    className="inline-flex h-7 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-50"
  >
    <FaPrint size={10} /> {busy ? "Preparing…" : "Print"}
  </button>
);

export default SalePrintButton;

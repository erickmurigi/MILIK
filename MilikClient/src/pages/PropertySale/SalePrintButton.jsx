import React from "react";
import { FaPrint } from "react-icons/fa";
import ListToolbar from "../../components/common/ListToolbar";

// The Print button used on every Property Sales report.
const SalePrintButton = ({ onClick, disabled = false, busy = false }) => (
  <ListToolbar.Button
    icon={FaPrint}
    variant="outline"
    onClick={onClick}
    disabled={disabled || busy}
    title="Print this report"
  >
    {busy ? "Preparing…" : "Print"}
  </ListToolbar.Button>
);

export default SalePrintButton;

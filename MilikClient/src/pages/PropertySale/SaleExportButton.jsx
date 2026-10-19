import React from "react";
import { FaFileExcel } from "react-icons/fa";
import ListToolbar from "../../components/common/ListToolbar";

// The Export-to-Excel button used on every Property Sales report — pairs with SalePrintButton.
const SaleExportButton = ({ onClick, disabled = false, busy = false }) => (
  <ListToolbar.Button
    icon={FaFileExcel}
    variant="outline"
    onClick={onClick}
    disabled={disabled || busy}
    title="Export to Excel"
  >
    {busy ? "Preparing…" : "Export"}
  </ListToolbar.Button>
);

export default SaleExportButton;

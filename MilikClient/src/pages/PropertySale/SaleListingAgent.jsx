import React from "react";
import { listingAgentName } from "../../utils/saleAgent";

// Table cell content for a listing's agent. An agent inherited from the project is shown in italics with an arrow
// (tooltip explains); it stays word-free so it needs no terminology lookup per row.
const SaleListingAgent = React.memo(function SaleListingAgent({ row }) {
  const name = listingAgentName(row);
  if (!name) return <span className="italic text-slate-400">Unassigned</span>;
  if (row.agentInherited) {
    return <span className="italic" title="Inherited from the project — set an agent on the item itself to override">↳ {name}</span>;
  }
  return name;
});

export default SaleListingAgent;

import React from "react";
import { listingAdvocateName } from "../../utils/saleAdvocate";

// Table cell content for a listing's advocate. Mirrors SaleListingAgent.jsx exactly — an advocate
// inherited from the project is shown in italics with an arrow (tooltip explains).
const SaleListingAdvocate = React.memo(function SaleListingAdvocate({ row }) {
  const name = listingAdvocateName(row);
  if (!name) return <span className="italic text-slate-400">Unassigned</span>;
  if (row.advocateInherited) {
    return <span className="italic" title="Inherited from the project — set an advocate on the item itself to override">↳ {name}</span>;
  }
  return name;
});

export default SaleListingAdvocate;

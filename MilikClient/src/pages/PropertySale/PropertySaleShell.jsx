import React, { useContext } from "react";
import { EmbeddedReportContext } from "./EmbeddedReportContext";
import ModuleShell from "../../components/Layout/ModuleShell";
import { useTerm } from "../../hooks/useTerm";

const PropertySaleShell = ({ title, subtitle, action, children }) => {
  const moduleName = useTerm("saleModule");
  const embedded = useContext(EmbeddedReportContext);
  if (embedded) return <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-1.5">{children}</div>;
  return (
    <ModuleShell moduleLabel={`MILIK ${moduleName}`} title={title} subtitle={subtitle} action={action}>
      {children}
    </ModuleShell>
  );
};

export default PropertySaleShell;

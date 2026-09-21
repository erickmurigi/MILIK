import { createContext } from "react";

// The Report Center shows the existing report pages inside its own workspace: with this set to true PropertySaleShell
// drops its layout and header and renders only the page content.
export const EmbeddedReportContext = createContext(false);
